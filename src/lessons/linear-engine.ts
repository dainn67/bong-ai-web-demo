/**
 * Drives a v1 (linear) lesson.
 *
 * Older format, still four of the seventeen catalog entries. A flat list of
 * parts played in order; an interactive part opens the mic and, on a wrong or
 * silent answer, plays a consolation clip and **asks the same question again**,
 * up to three attempts. That retry loop is the one real behavioural difference
 * from v2, which never re-asks — it plays the "sai" branch and moves on.
 *
 * Each part carries its own mp3, but also a start/end pair into one long file,
 * which is how the app plays it. Both are supported: a part's own clip if it
 * has one, otherwise a slice of the main audio.
 */

import { parseTimestamp } from '../content/srt';
import { cdnUrl } from './catalog';
import { GroupPlayer, type ClipSpec } from './group-player';
import type { LessonMic } from './lesson-mic';
import { checkAnswer, saveProgress, type AnswerResult } from './lesson-api';
import type { ActivityState } from '../screen/activity-state';

export const MAX_ATTEMPTS = 3;

export interface LinearPart {
  id: string;
  interactive: boolean;
  /** Author's note about the part — the only text v1 carries. */
  description: string | null;
  answer: string | null;
  url: string;
  startOffsetMs: number;
  maxDurationMs: number | null;
  /** Pause after the clip, before whatever comes next. */
  sleepMs: number;
}

export interface LinearLesson {
  title: string;
  parts: LinearPart[];
  /** Consolation clips, keyed by `wrong_answer` / `unknown_answer`. */
  extras: Record<string, LinearPart[]>;
}

export function parseLinear(raw: unknown): LinearLesson {
  const json = (raw ?? {}) as Record<string, unknown>;
  const mainAudio = typeof json.audio_url === 'string' ? json.audio_url : '';

  const parts = asArray(json.parts)
    .map((entry) => toPart(entry, mainAudio))
    .filter((part): part is LinearPart => part !== null);

  const extras: Record<string, LinearPart[]> = {};
  for (const entry of asArray(json.extra_parts)) {
    const part = toPart(entry, mainAudio);
    if (!part || !isRecord(entry)) continue;
    const type = String(entry.type ?? '');
    (extras[type] ??= []).push(part);
  }

  return { title: String(json.title ?? ''), parts, extras };
}

function toPart(raw: unknown, mainAudio: string): LinearPart | null {
  if (!isRecord(raw)) return null;

  const start = parseTimestamp(String(raw.start_at ?? ''));
  const end = parseTimestamp(String(raw.end_at ?? ''));
  const own = typeof raw.audio_url === 'string' ? raw.audio_url : '';

  // A part with its own clip plays it whole; only a slice of the shared file
  // needs the offsets.
  const url = own || mainAudio;
  if (!url) return null;

  return {
    id: String(raw.id ?? ''),
    interactive: String(raw.type ?? '') === 'question',
    description: typeof raw.description === 'string' ? raw.description : null,
    answer: typeof raw.answer === 'string' ? raw.answer : null,
    url: cdnUrl(url),
    startOffsetMs: own ? 0 : start,
    maxDurationMs: own ? null : Math.max(0, end - start) || null,
    sleepMs: typeof raw.sleep === 'number' ? raw.sleep : 0,
  };
}

export interface LinearHandlers {
  onActivity: (patch: Partial<ActivityState>) => void;
  onLog?: (message: string) => void;
}

export interface LinearDeps {
  lesson: LinearLesson;
  player: GroupPlayer;
  mic: LessonMic;
  lessonId: string;
  category?: string;
  metadataUrl?: string;
  title?: string;
  trackProgress?: boolean;
}

export class LinearEngine {
  private gen = 0;
  private disposed = false;
  private index = 0;
  private attempts = 0;
  private paused = false;

  private readonly deps: LinearDeps;
  private readonly handlers: LinearHandlers;

  constructor(deps: LinearDeps, handlers: LinearHandlers) {
    this.deps = deps;
    this.handlers = handlers;
  }

  private stale(gen: number): boolean {
    return gen !== this.gen || this.disposed;
  }

  async start(): Promise<void> {
    const { lesson, player } = this.deps;
    if (lesson.parts.length === 0) {
      this.handlers.onLog?.('lesson v1 rỗng — kết thúc');
      this.emit({ phase: 'finished' });
      return;
    }

    this.emit({ phase: 'loading' });
    const urls = [
      ...lesson.parts.map((part) => part.url),
      ...Object.values(lesson.extras).flatMap((list) => list.map((part) => part.url)),
    ];
    await player.preload(urls, (done, total) => {
      this.emit({ caption: `Đang tải… ${done}/${total}` });
    });
    if (this.stale(this.gen)) return;

    this.index = 0;
    this.attempts = 0;
    await this.runPart(this.gen);
  }

  private async runPart(gen: number): Promise<void> {
    if (this.stale(gen)) return;
    const part = this.deps.lesson.parts[this.index];
    if (!part) {
      await this.complete();
      return;
    }

    this.emit({
      phase: 'playing',
      caption: part.description,
      hint: null,
    });

    const aborted = await this.playClip(part, gen);
    if (aborted || this.stale(gen)) return;

    if (part.sleepMs > 0) {
      await delay(part.sleepMs);
      if (this.stale(gen)) return;
    }

    if (part.interactive) await this.listenAndGrade(part, gen);
    else await this.advance(gen);
  }

  private async playClip(part: LinearPart, gen: number): Promise<boolean> {
    const spec: ClipSpec = {
      url: part.url,
      delayMs: 0,
      volume: 1,
      startOffsetMs: part.startOffsetMs,
      maxDurationMs: part.maxDurationMs,
      fadeInMs: 0,
      fadeOutMs: 0,
      hasNext: true,
    };
    const result = await this.deps.player.playGroup([spec]);
    return result.aborted || this.stale(gen);
  }

  private async listenAndGrade(part: LinearPart, gen: number): Promise<void> {
    if (!(await this.deps.mic.hasPermission())) {
      this.emit({
        phase: 'error',
        error: 'Bống cần quyền micro để nghe bé trả lời.',
      });
      return;
    }

    this.emit({ phase: 'listening', hint: part.answer });
    const answer = await this.deps.mic.listen();
    if (this.stale(gen)) return;
    this.emit({ hint: null });

    let result: AnswerResult;
    if (!answer.speechDetected || !answer.text) {
      result = 'silent';
    } else {
      this.emit({ phase: 'evaluating' });
      try {
        const judgement = await checkAnswer({
          text: answer.text,
          lessonId: this.deps.lessonId,
          partId: part.id,
        });
        if (this.stale(gen)) return;
        if (judgement.reason) this.emit({ notice: judgement.reason });
        result = judgement.result;
      } catch (error) {
        if (this.stale(gen)) return;
        this.handlers.onLog?.(`chấm điểm lỗi: ${String(error)}`);
        this.emit({ notice: 'Chưa chấm được câu trả lời, Bống thử lại nhé.' });
        result = 'wrong';
      }
    }

    await this.onResult(part, result, gen);
  }

  /**
   * Right answer moves on. Anything else plays a consolation clip and re-asks —
   * but only up to {@link MAX_ATTEMPTS}, so a child who cannot get it is not
   * held at the same question indefinitely.
   */
  private async onResult(part: LinearPart, result: AnswerResult, gen: number): Promise<void> {
    if (this.stale(gen)) return;
    if (result === 'correct') {
      await this.advance(gen);
      return;
    }

    this.attempts++;
    const extras = this.deps.lesson.extras[result === 'silent' ? 'unknown_answer' : 'wrong_answer'];
    if (this.attempts >= MAX_ATTEMPTS || !extras || extras.length === 0) {
      await this.advance(gen);
      return;
    }

    const extra = extras[Math.min(this.attempts - 1, extras.length - 1)];
    const aborted = await this.playClip(extra, gen);
    if (aborted || this.stale(gen)) return;
    await this.listenAndGrade(part, gen);
  }

  private async advance(gen: number): Promise<void> {
    if (this.stale(gen)) return;
    this.index++;
    this.attempts = 0;
    await this.runPart(gen);
  }

  /**
   * One line saying where in the lesson we are.
   *
   * The app reports a *cue* index here, because its v1 flow slices one long mp3
   * and renders the SRT beside it. This engine plays each part's own clip and
   * ships no transcript, so a part index is the position that exists — and it
   * is the more useful one for a tester anyway, since a part is what `Next`
   * skips.
   */
  get debugStatus(): string {
    const parts = this.deps.lesson.parts;
    const position = `${Math.min(this.index + 1, parts.length)}/${parts.length}`;
    const part = parts[this.index];
    return `phần ${position} · id=${part?.id ?? '-'} · ${
      part?.interactive ? 'câu hỏi' : 'kể'
    } · ${this.phase}`;
  }

  /** The phase last reported — see the note on the graph engine's `emit`. */
  private phase: ActivityState['phase'] = 'loading';

  private emit(patch: Partial<ActivityState>): void {
    if (patch.phase) this.phase = patch.phase;
    this.handlers.onActivity(patch);
  }

  async skipNext(): Promise<void> {
    if (this.disposed) return;
    const gen = ++this.gen;
    this.paused = false;
    this.deps.player.stop();
    await this.deps.mic.cancel();
    this.index++;
    this.attempts = 0;
    await this.runPart(gen);
  }

  async togglePause(): Promise<void> {
    this.paused = !this.paused;
    if (this.paused) {
      await this.deps.player.pause();
      this.emit({ phase: 'paused' });
    } else {
      await this.deps.player.resume();
      this.emit({ phase: 'playing' });
    }
  }

  private async complete(): Promise<void> {
    this.emit({ phase: 'finished', caption: null, hint: null });
    if (this.deps.trackProgress === false) return;
    await saveProgress({
      lessonId: this.deps.lessonId,
      status: 'completed',
      category: this.deps.category,
      metadataUrl: this.deps.metadataUrl,
      title: this.deps.title,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.gen++;
    this.deps.player.stop();
    void this.deps.mic.dispose();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
