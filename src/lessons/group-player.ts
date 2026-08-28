/**
 * Plays one order-group: several clips at once, each on its own schedule.
 *
 * Web Audio rather than `<audio>` elements, because the format asks for things
 * an element cannot do: start 400ms into a file, stop after exactly 2s, ramp
 * the gain up over 300ms, and begin at a precise offset from when the group
 * started. An element gives you `currentTime` and `volume` and nothing that
 * schedules ahead of the clock.
 *
 * Clips are warmed in the background and fetched on demand if a group reaches
 * one first. Both halves matter: without the warm-up every line pays a few
 * hundred milliseconds of dead air, and without the on-demand path a lesson
 * that starts before the warm-up finishes silently skips whatever has not
 * arrived yet.
 */

export interface ClipSpec {
  url: string;
  delayMs: number;
  volume: number;
  startOffsetMs: number;
  maxDurationMs: number | null;
  fadeInMs: number;
  fadeOutMs: number;
  /** Whether this clip's node carries a `next` — decides the winner. */
  hasNext: boolean;
}

export interface GroupResult {
  /**
   * Index of the clip whose `next` the engine should follow.
   *
   * The "winner" rule: among the clips that have a `next`, the one that
   * finished last. Background music under narration usually has no `next`, so
   * this picks the narration — but a group can hold two speakers, and the one
   * still talking is the one that decides where the lesson goes.
   */
  winner: number;
  /** True when playback was cut short by {@link GroupPlayer.stop}. */
  aborted: boolean;
}

/** A clip that failed to load. Playback skips it; the lesson keeps going. */
const MISSING = Symbol('missing');

/** Releases one in-flight await early. See {@link GroupPlayer.waiters}. */
type Waiter = () => void;

/**
 * A `waitDelay` in flight.
 *
 * Tracked rather than left to its own `setTimeout` so that pausing freezes it.
 * A schedule half on the audio clock and half on wall time drifts apart the
 * moment anyone pauses, and the whole point of version 2's sequential `waitMs`
 * is that the two tracks stay in step.
 */
interface PendingDelay {
  remainingMs: number;
  armedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  finish: (aborted: boolean) => void;
  release: Waiter | null;
}

export class GroupPlayer {
  private context: AudioContext | null = null;
  private readonly master: { node: GainNode | null } = { node: null };
  private readonly buffers = new Map<string, AudioBuffer | typeof MISSING>();
  /** In-flight loads, so preload and an on-demand fetch never race the same url. */
  private readonly loading = new Map<string, Promise<AudioBuffer | typeof MISSING>>();
  private active: AudioBufferSourceNode[] = [];
  private stopped = false;
  private volume = 1;
  /**
   * Every await `stop` has to release, not just the newest one.
   *
   * A single slot was enough while one track owned the player. Version 2 runs
   * the audio and visual tracks against it at the same time, and with one field
   * whichever registered last was the only one `stop` could reach — the other
   * never resolved, so its track hung and the index never ended.
   */
  private readonly waiters = new Set<Waiter>();
  /** The subset of waiters that are timers, so `pause` can freeze them. */
  private readonly delays = new Set<PendingDelay>();
  private frozen = false;

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.master.node = this.context.createGain();
      this.master.node.gain.value = this.volume;
      this.master.node.connect(this.context.destination);
    }
    return this.context;
  }

  /** Master volume, applied over each clip's own authored level. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master.node) this.master.node.gain.value = this.volume;
  }

  /**
   * Warms the cache for every clip in the lesson.
   *
   * **Do not await this to start playback.** A real lesson is 140-odd clips and
   * around 25MB; blocking on all of it leaves the child staring at a loading
   * counter for ten seconds before the first word. Kick it off and play — each
   * group loads what it needs on demand ({@link ensure}), so the first node is
   * audible in under a second while the rest streams in behind it.
   *
   * Failures are recorded rather than thrown: a 404 on one clip should cost
   * that line, not the lesson.
   */
  async preload(urls: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const unique = [...new Set(urls.filter(Boolean))];
    let done = 0;
    await Promise.all(
      unique.map(async (url) => {
        await this.ensure(url);
        onProgress?.(++done, unique.length);
      }),
    );
  }

  /**
   * The buffer for a clip, fetching it if the warm-up has not reached it yet.
   *
   * Concurrent callers share one in-flight request — otherwise a group playing
   * ahead of the preload would fetch the same file twice, and on a lesson with
   * a hundred nodes that doubles the traffic.
   */
  private async ensure(url: string): Promise<AudioBuffer | typeof MISSING> {
    const cached = this.buffers.get(url);
    if (cached !== undefined) return cached;

    const inFlight = this.loading.get(url);
    if (inFlight) return inFlight;

    const context = this.ensureContext();
    const load = (async (): Promise<AudioBuffer | typeof MISSING> => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        return MISSING;
      }
    })().then((result) => {
      this.buffers.set(url, result);
      this.loading.delete(url);
      return result;
    });

    this.loading.set(url, load);
    return load;
  }

  /** Whether a clip is loaded and playable. */
  has(url: string): boolean {
    const buffer = this.buffers.get(url);
    return buffer !== undefined && buffer !== MISSING;
  }

  /**
   * Plays every clip in the group and resolves once the last one has drained.
   *
   * Waiting for all of them — not just the longest — is what lets a group mix a
   * short line over a long bed of music without the engine advancing early.
   */
  async playGroup(specs: ClipSpec[]): Promise<GroupResult> {
    this.stopped = false;
    if (specs.length === 0) return { winner: -1, aborted: false };

    const context = this.ensureContext();
    // A context can come back suspended after a tab switch; without this the
    // clips are scheduled against a clock that is not running.
    if (context.state === 'suspended') await context.resume();

    // Resolve the group's clips before touching the clock. Scheduling against
    // `currentTime` and then awaiting a fetch would put the first clip's start
    // in the past by however long the network took.
    const buffers = await Promise.all(specs.map((spec) => this.ensure(spec.url)));
    if (this.stopped) return { winner: -1, aborted: true };

    const startedAt = context.currentTime;
    const finishes: Promise<number | null>[] = [];

    specs.forEach((spec, index) => {
      const buffer = buffers[index];
      if (!buffer || buffer === MISSING) {
        finishes.push(Promise.resolve(null));
        return;
      }
      finishes.push(this.scheduleClip(context, buffer, spec, index, startedAt));
    });

    let release: Waiter | null = null;
    const aborted = await Promise.race([
      Promise.all(finishes).then(() => false),
      new Promise<boolean>((resolve) => {
        release = () => resolve(true);
        this.waiters.add(release);
      }),
    ]);
    if (release) this.waiters.delete(release);

    if (aborted || this.stopped) return { winner: -1, aborted: true };

    // The winner is the last-finishing clip that has somewhere to go next.
    const ends = await Promise.all(finishes);
    let winner = -1;
    let latest = -Infinity;
    ends.forEach((endsAt, index) => {
      if (endsAt === null || !specs[index].hasNext) return;
      if (endsAt >= latest) {
        latest = endsAt;
        winner = index;
      }
    });

    return { winner, aborted: false };
  }

  /** Schedules one clip, resolving with the context time it finished. */
  private scheduleClip(
    context: AudioContext,
    buffer: AudioBuffer,
    spec: ClipSpec,
    _index: number,
    groupStart: number,
  ): Promise<number> {
    const source = context.createBufferSource();
    source.buffer = buffer;

    const gain = context.createGain();
    source.connect(gain);
    gain.connect(this.master.node!);

    const startAt = groupStart + spec.delayMs / 1000;
    const offset = Math.min(spec.startOffsetMs / 1000, buffer.duration);
    const remaining = buffer.duration - offset;
    const duration =
      spec.maxDurationMs === null ? remaining : Math.min(spec.maxDurationMs / 1000, remaining);

    const level = spec.volume;
    const fadeIn = spec.fadeInMs / 1000;
    const fadeOut = spec.fadeOutMs / 1000;

    if (fadeIn > 0) {
      // Ramps cannot start from an exact zero on an exponential curve, and a
      // linear ramp from silence is what the format describes anyway.
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(level, startAt + Math.min(fadeIn, duration));
    } else {
      gain.gain.setValueAtTime(level, startAt);
    }

    if (fadeOut > 0 && duration > fadeOut) {
      const fadeStart = startAt + duration - fadeOut;
      gain.gain.setValueAtTime(level, fadeStart);
      gain.gain.linearRampToValueAtTime(0, startAt + duration);
    }

    source.start(startAt, offset, duration);
    this.active.push(source);

    return new Promise<number>((resolve) => {
      source.onended = () => {
        this.active = this.active.filter((node) => node !== source);
        resolve(startAt + duration);
      };
    });
  }

  /**
   * Plays one clip on its own, the way version 2's `audio` track wants it.
   *
   * Sequential rather than scheduled: the caller awaits this and then applies
   * the next node's `waitMs` from where this returned, which is exactly what
   * §4.1 of the screen spec describes. `playGroup` cannot express that — it
   * lays every clip out against one group start time.
   */
  async playSingle(
    url: string,
    options: {
      volume?: number;
      waitMs?: number;
      durationMs?: number | 'full';
      repeat?: number;
    } = {},
  ): Promise<{ aborted: boolean; durationSec: number }> {
    this.stopped = false;
    const waitMs = options.waitMs ?? 0;
    if (waitMs > 0) {
      const waitAborted = await this.waitDelay(waitMs);
      if (waitAborted || this.stopped) return { aborted: true, durationSec: 0 };
    }

    const context = this.ensureContext();
    if (context.state === 'suspended' && !this.frozen) await context.resume();

    const buffer = await this.ensure(url);
    if (this.stopped || !buffer || buffer === MISSING) {
      return { aborted: this.stopped, durationSec: 0 };
    }

    const repeats = Math.max(1, options.repeat ?? 1);
    // The schema authors volume as 0–100; callers inside this file already work
    // in gain. Anything above 1 can only be the former.
    const volume =
      options.volume === undefined ? 1 : options.volume > 1 ? options.volume / 100 : options.volume;
    const maxDurSec = typeof options.durationMs === 'number' ? options.durationMs / 1000 : buffer.duration;
    const clipDurSec = Math.min(buffer.duration, maxDurSec);

    let totalPlayedSec = 0;
    for (let i = 0; i < repeats; i++) {
      if (this.stopped) return { aborted: true, durationSec: totalPlayedSec };

      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume, context.currentTime);
      source.connect(gain);
      gain.connect(this.master.node!);

      source.start(context.currentTime, 0, clipDurSec);
      this.active.push(source);

      const aborted = await new Promise<boolean>((resolve) => {
        let settled = false;
        const release: Waiter = () => {
          if (settled) return;
          settled = true;
          this.waiters.delete(release);
          try {
            source.stop();
          } catch {
            // Already finished. Nothing to do.
          }
          this.active = this.active.filter((n) => n !== source);
          resolve(true);
        };
        this.waiters.add(release);
        source.onended = () => {
          if (settled) return;
          settled = true;
          this.waiters.delete(release);
          this.active = this.active.filter((n) => n !== source);
          resolve(false);
        };
      });

      if (aborted || this.stopped) return { aborted: true, durationSec: totalPlayedSec };
      totalPlayedSec += clipDurSec;
    }

    return { aborted: false, durationSec: totalPlayedSec };
  }

  /**
   * Waits out a gap, resolving `true` if `stop` cut it short.
   *
   * Freezes with {@link pause} rather than running on regardless, so a paused
   * lesson does not silently burn through the gaps between its clips.
   */
  waitDelay(ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const delay: PendingDelay = {
        remainingMs: Math.max(0, ms),
        armedAt: 0,
        timer: null,
        finish: (aborted) => resolve(aborted),
        release: null,
      };
      delay.release = () => this.settleDelay(delay, true);

      this.delays.add(delay);
      this.waiters.add(delay.release);
      if (!this.frozen) this.armDelay(delay);
    });
  }

  private armDelay(delay: PendingDelay): void {
    delay.armedAt = Date.now();
    delay.timer = setTimeout(() => {
      delay.timer = null;
      this.settleDelay(delay, false);
    }, delay.remainingMs);
  }

  private settleDelay(delay: PendingDelay, aborted: boolean): void {
    if (delay.timer !== null) {
      clearTimeout(delay.timer);
      delay.timer = null;
    }
    // A delay can be reached from both `stop` and its own timer; whoever gets
    // here first owns the resolution.
    if (!this.delays.delete(delay)) return;
    if (delay.release) this.waiters.delete(delay.release);
    delay.finish(aborted);
  }

  /** Suspends the clock, which freezes every scheduled clip where it stands. */
  async pause(): Promise<void> {
    this.frozen = true;
    for (const delay of this.delays) {
      if (delay.timer === null) continue;
      clearTimeout(delay.timer);
      delay.timer = null;
      delay.remainingMs = Math.max(0, delay.remainingMs - (Date.now() - delay.armedAt));
    }
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    this.frozen = false;
    for (const delay of this.delays) {
      if (delay.timer === null) this.armDelay(delay);
    }
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  get paused(): boolean {
    return this.context?.state === 'suspended';
  }

  /** Cuts everything off now and lets every waiting await return. */
  stop(): void {
    this.stopped = true;
    this.frozen = false;
    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished. Nothing to do.
      }
    }
    this.active = [];

    // Copied first: releasing a waiter removes it from the set.
    for (const release of [...this.waiters]) release();
    this.waiters.clear();
    this.delays.clear();
  }

  async dispose(): Promise<void> {
    this.stop();
    this.buffers.clear();
    this.loading.clear();
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.master.node = null;
  }
}
