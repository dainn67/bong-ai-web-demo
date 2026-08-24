/**
 * Plays one order-group: several clips at once, each on its own schedule.
 *
 * Web Audio rather than `<audio>` elements, because the format asks for things
 * an element cannot do: start 400ms into a file, stop after exactly 2s, ramp
 * the gain up over 300ms, and begin at a precise offset from when the group
 * started. An element gives you `currentTime` and `volume` and nothing that
 * schedules ahead of the clock.
 *
 * The whole graph is preloaded up front. Fetching a clip when it is reached
 * costs a few hundred milliseconds of dead air between every line, which on a
 * 100-node lesson is minutes of silence.
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

export class GroupPlayer {
  private context: AudioContext | null = null;
  private readonly master: { node: GainNode | null } = { node: null };
  private readonly buffers = new Map<string, AudioBuffer | typeof MISSING>();
  private active: AudioBufferSourceNode[] = [];
  private stopped = false;
  private volume = 1;
  /** Resolves the in-flight group early when the player is stopped or paused. */
  private abortGroup: (() => void) | null = null;

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
   * Fetches and decodes every clip, concurrently.
   *
   * Failures are recorded rather than thrown: a 404 on one clip should cost
   * that line, not the lesson. Clips whose URL still holds an unresolved
   * placeholder are attempted too — they will simply fail, and the log shows
   * which node has no account behind it.
   */
  async preload(urls: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const unique = [...new Set(urls.filter(Boolean))];
    const context = this.ensureContext();
    let done = 0;

    await Promise.all(
      unique.map(async (url) => {
        if (this.buffers.has(url)) return;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          this.buffers.set(url, await context.decodeAudioData(await response.arrayBuffer()));
        } catch {
          this.buffers.set(url, MISSING);
        } finally {
          onProgress?.(++done, unique.length);
        }
      }),
    );
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

    const startedAt = context.currentTime;
    const finishes: Promise<number | null>[] = [];

    specs.forEach((spec, index) => {
      const buffer = this.buffers.get(spec.url);
      if (!buffer || buffer === MISSING) {
        finishes.push(Promise.resolve(null));
        return;
      }
      finishes.push(this.scheduleClip(context, buffer, spec, index, startedAt));
    });

    const aborted = await Promise.race([
      Promise.all(finishes).then(() => false),
      new Promise<boolean>((resolve) => {
        this.abortGroup = () => resolve(true);
      }),
    ]);
    this.abortGroup = null;

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

  /** Suspends the clock, which freezes every scheduled clip where it stands. */
  async pause(): Promise<void> {
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  get paused(): boolean {
    return this.context?.state === 'suspended';
  }

  /** Cuts everything off now and lets any waiting `playGroup` return. */
  stop(): void {
    this.stopped = true;
    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished. Nothing to do.
      }
    }
    this.active = [];
    this.abortGroup?.();
    this.abortGroup = null;
  }

  async dispose(): Promise<void> {
    this.stop();
    this.buffers.clear();
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.master.node = null;
  }
}
