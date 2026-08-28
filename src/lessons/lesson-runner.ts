/**
 * One lesson, start to finish.
 *
 * Loads the metadata, detects which of the two formats it is, builds the
 * matching engine, and owns the player and the microphone for its lifetime.
 * The store talks to this and never to an engine directly, so the presentation
 * layer stays unaware of which format is playing.
 */

import { fetchProfile, hasActiveSubscription, hasStoredSession, type Account } from '../api/auth-client';
import type { ActivityState } from '../screen/activity-state';
import type { LessonSummary } from './catalog';
import { GraphEngine } from './graph-engine';
import { GroupPlayer } from './group-player';
import { LessonDataStore } from './lesson-api';
import { LessonMic } from './lesson-mic';
import { parseGraph } from './lesson-graph';
import { LinearEngine, parseLinear } from './linear-engine';

import { isLessonV2, parseLessonV2 } from './lesson-v2-parser';
import { V2Engine } from './v2-engine';
import type { TouchClassificationResult } from '../screen/touch-layout';

export interface LessonRunnerHandlers {
  onActivity: (patch: Partial<ActivityState>) => void;
  getVolume: () => number;
}

export class LessonRunner {
  private readonly player = new GroupPlayer();
  private readonly mic = new LessonMic();
  private readonly data = new LessonDataStore();
  private engine: V2Engine | GraphEngine | LinearEngine | null = null;
  private readonly abort = new AbortController();

  private readonly summary: LessonSummary;
  private readonly handlers: LessonRunnerHandlers;

  constructor(summary: LessonSummary, handlers: LessonRunnerHandlers) {
    this.summary = summary;
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    this.handlers.onActivity({ phase: 'loading', caption: 'Đang tải bài học…' });
    this.player.setVolume(this.handlers.getVolume());

    // The account is what makes two thirds of a lesson's clips addressable —
    // `{userPhone}` and `{voiceID}` live in the URLs. Without it the lesson
    // does not error, it plays mostly silence, so say so plainly up front
    // rather than letting it look like a broken lesson.
    const account = await this.loadAccount();
    if (!account) {
      this.handlers.onActivity({
        phase: 'error',
        error: 'Cần đăng nhập tài khoản phụ huynh (mở Kỹ thuật → Tài khoản) để chạy bài học.',
      });
      return;
    }
    if (!hasActiveSubscription(account)) {
      // Not fatal — narration and câu hỏi 1 still work. But every grading call
      // will 403, and that failure looks exactly like a bug if unannounced.
      this.handlers.onActivity({
        notice: 'Thuê bao đã hết hạn — phần chấm điểm sẽ không chạy.',
      });
    }

    const raw = await this.fetchMetadata();
    if (this.abort.signal.aborted) return;

    const handlers = {
      onActivity: this.handlers.onActivity,
      onLog: (message: string) => console.info(`[lesson] ${message}`),
    };
    const common = {
      player: this.player,
      mic: this.mic,
      lessonId: this.summary.id,
      category: this.summary.category,
      metadataUrl: this.summary.metadataUrl,
      title: this.summary.title,
    };

    // 1. Version 2 (indexes[], parallel audio[] + visual[]).
    //
    // Decided by `version` and nothing else — §8 forbids inferring the format
    // from which arrays happen to be present. So a file that says 2 and then
    // does not parse is a broken version 2 file, and saying so beats re-reading
    // it under version 1's rules and playing something subtly wrong.
    if (isLessonV2(raw)) {
      const v2Graph = parseLessonV2(raw, {
        phone: account.phone,
        voiceId: account.voiceId,
        bongVolume: account.bongVolume,
      });
      if (!v2Graph) {
        this.handlers.onActivity({
          phase: 'error',
          error: 'Bài học khai "version": 2 nhưng thiếu mảng "indexes"',
        });
        return;
      }
      this.engine = new V2Engine({ ...common, graph: v2Graph, data: this.data }, handlers);
      await this.engine.start();
      return;
    }

    // 2. Version 1 legacy Graph format (flat nodes[])
    if (isRecord(raw) && Array.isArray(raw.nodes)) {
      const graph = parseGraph(raw, {
        phone: account.phone,
        voiceId: account.voiceId,
        bongVolume: account.bongVolume,
      });
      this.engine = new GraphEngine({ ...common, graph, data: this.data }, handlers);
      await this.engine.start();
      return;
    }

    // 3. Version 1 linear lesson (parts[])
    if (isRecord(raw) && Array.isArray(raw.parts)) {
      this.engine = new LinearEngine({ ...common, lesson: parseLinear(raw) }, handlers);
      await this.engine.start();
      return;
    }

    this.handlers.onActivity({
      phase: 'error',
      error: 'Không nhận dạng được định dạng bài học',
    });
  }

  dispatchTouch(result: TouchClassificationResult): void {
    if (this.engine instanceof V2Engine) {
      this.engine.dispatchTouch(result);
    }
  }

  private async loadAccount(): Promise<Account | null> {
    if (!hasStoredSession()) return null;
    try {
      return await fetchProfile();
    } catch {
      return null;
    }
  }

  private async fetchMetadata(): Promise<unknown> {
    const response = await fetch(this.summary.metadataUrl, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`Không tải được bài học (HTTP ${response.status})`);
    return response.json();
  }

  async togglePause(): Promise<void> {
    await this.engine?.togglePause();
  }

  async skipNext(): Promise<void> {
    await this.engine?.skipNext();
  }

  /** Where the lesson is, for the dev drawer. Null before an engine exists. */
  get debugStatus(): string | null {
    return this.engine?.debugStatus ?? null;
  }

  /** The same position, short enough for the badge's screen. */
  get debugPosition(): string | null {
    return this.engine?.debugPosition ?? null;
  }

  /** The raw metadata, so a tester can open what the engine is reading. */
  get metadataUrl(): string {
    return this.summary.metadataUrl;
  }

  setVolume(volume: number): void {
    this.player.setVolume(volume);
  }

  dispose(): void {
    this.abort.abort();
    this.engine?.dispose();
    this.engine = null;
    void this.player.dispose();
    void this.mic.dispose();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
