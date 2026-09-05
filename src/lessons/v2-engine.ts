/**
 * Dual-channel playback engine for Lesson Schema Version 2.
 *
 * Implements the runtime rules in Bong-AI-Man-hinh-Dac-ta-doi-App.md:
 * - Two parallel tracks per index: audio[] and visual[]
 * - Sequential waitMs within each track relative to the completion of the previous node
 * - Index completion when both tracks finish (infinite visual loops do not hold the index)
 * - Seamless visual transition (anti-flicker) if next index visual has waitMs: 0
 * - Immediate branch jump on question response (discards remaining audio nodes)
 * - Touch question handling with direct branch mapping (no LLM)
 * - 'đọc giá trị đã lưu' index evaluation
 */

import type { TouchClassificationResult } from '../screen/touch-layout';
import type { ActivityState } from '../screen/activity-state';
import type { GroupPlayer } from './group-player';
import type { LessonMic } from './lesson-mic';
import type { LessonDataStore } from './lesson-api';
import { checkAnswer, classifyAnswer, saveProgress } from './lesson-api';
import { allV2AudioUrls, referencedV2DataCategories } from './lesson-v2-parser';
import {
  ASSUMED_ANIMATION_MS,
  DEFAULT_TOUCH_TIMEOUT_MS,
  RECALL_TYPE,
  TOUCH_QUESTION_TYPE,
  type LessonV2AudioNode,
  type LessonV2Graph,
  type LessonV2Index,
  type LessonV2VisualNode,
} from './lesson-v2-types';
import { hasUnresolvedToken } from './placeholder';

/** Stops a runaway script rather than letting a cycle spin forever. */
const MAX_INDEX_VISITS = 500;

export interface V2EngineHandlers {
  onActivity: (patch: Partial<ActivityState>) => void;
  onLog?: (message: string) => void;
}

export interface V2EngineDeps {
  graph: LessonV2Graph;
  player: GroupPlayer;
  mic: LessonMic;
  data: LessonDataStore;
  lessonId: string;
  category?: string;
  metadataUrl?: string;
  title?: string;
  trackProgress?: boolean;
}

export class V2Engine {
  private gen = 0;
  private disposed = false;
  private finished = false;
  private visited = 0;
  private paused = false;

  private currentIndex: LessonV2Index | null = null;
  private currentFile: string | null = null;
  private resolveTouch: ((result: TouchClassificationResult) => void) | null = null;
  private touchTimer: ReturnType<typeof setTimeout> | null = null;
  private activeVisualUrl: string | null = null;
  private activeVisualSeq = 0;
  private activeVisualStop: 'giu' | 'tat' = 'tat';

  get currentVisualUrl(): string | null {
    return this.activeVisualUrl;
  }

  private readonly deps: V2EngineDeps;
  private readonly handlers: V2EngineHandlers;

  constructor(deps: V2EngineDeps, handlers: V2EngineHandlers) {
    this.deps = deps;
    this.handlers = handlers;
  }

  async start(): Promise<void> {
    this.handlers.onActivity({
      kind: 'lesson',
      title: this.deps.title || this.deps.graph.page || 'Bài học Bống',
      phase: 'playing',
      error: null,
      imageUrl: null,
    });

    for (const warning of this.deps.graph.warnings) {
      this.handlers.onLog?.(`kịch bản: ${warning}`);
    }

    // Saved values first, and awaited: a `đọc giá trị đã lưu` index in the first
    // few steps would otherwise read an empty store and send every child down
    // the `chua_co` branch.
    await this.deps.data.preload(referencedV2DataCategories(this.deps.graph));
    await this.deps.data.preloadCategories();
    if (this.disposed) return;

    // Clips are warmed in the background, never awaited. The whole reason
    // version 2 measures `waitMs` from the previous node's end is that authored
    // gaps should be exact; making the first one absorb a network round trip
    // would give that back.
    void this.deps.player.preload(allV2AudioUrls(this.deps.graph));

    if (this.deps.graph.indexes.length === 0) {
      this.finish();
      return;
    }

    await this.runIndex(this.deps.graph.indexes[0]);
  }

  /**
   * Hands a touch/swipe result to the question that is waiting for one.
   *
   * Silently dropped when no window is open, which is what makes acceptance
   * item 11 hold: a child holding the badge presses the glass constantly.
   */
  dispatchTouch(result: TouchClassificationResult): void {
    this.resolveTouch?.(result);
  }

  async skipNext(): Promise<void> {
    if (this.disposed || !this.currentIndex) return;
    const current = this.currentIndex;

    // Retire this index's generation *before* cutting playback. Without it the
    // outgoing index survives its own abort — its pending question resolves, and
    // the lesson resumes into a branch after we have already moved on.
    this.gen++;
    this.resolveTouch?.('cham_khac');
    this.deps.player.stop();

    const nextIndex = this.resolveNext(current);
    if (nextIndex) {
      await this.runIndex(nextIndex);
      return;
    }
    this.finish();
  }

  async togglePause(): Promise<void> {
    this.paused = !this.paused;
    if (this.paused) {
      await this.deps.player.pause();
      this.handlers.onActivity({ phase: 'paused' });
    } else {
      await this.deps.player.resume();
      this.handlers.onActivity({ phase: 'playing' });
    }
  }

  get debugStatus(): string | null {
    if (!this.currentIndex) return null;
    const file = this.currentFile ? ` · ${this.currentFile}` : '';
    return `Index ${this.currentIndex.order}${file}`;
  }

  get debugPosition(): string | null {
    return this.currentIndex ? this.currentIndex.order : null;
  }

  private stale(expectedGen: number): boolean {
    return this.disposed || this.gen !== expectedGen;
  }

  private async runIndex(index: LessonV2Index): Promise<void> {
    if (this.disposed) return;
    this.gen++;
    const currentGen = this.gen;
    this.currentIndex = index;

    if (++this.visited > MAX_INDEX_VISITS) {
      this.handlers.onLog?.('Max node visit limit reached.');
      this.finish();
      return;
    }

    if (index.save && index.save.category && index.save.key) {
      void this.deps.data.save(index.save.category, index.save.key, index.save.value);
    }

    // §5.4: the type is checked *before* anything plays, and such an index is
    // allowed to have both tracks empty.
    if (index.type === RECALL_TYPE) {
      await this.runRecallIndex(index, currentGen);
      return;
    }

    // Visual glass policy (§4.3):
    // 1. If next picture starts at waitMs 0, cut straight to it (anti-flicker).
    // 2. If next picture starts with waitMs > 0, cut to black during the gap.
    // 3. If there is no visual in this index (visual: []):
    //    Cut to black! "Index có mảng visual rỗng → màn hình đen suốt index đó."
    const firstVisual = index.visual[0];
    if (firstVisual) {
      if (firstVisual.waitMs > 0) {
        this.showVisual(null);
      }
    } else {
      this.showVisual(null);
      this.activeVisualStop = 'tat';
    }

    const visualDone = this.runVisualChannel(index.visual, currentGen);
    const audioDone = this.runAudioChannel(index.audio, index.branches, currentGen);

    const branch = await this.settleIndex(audioDone, visualDone);
    if (this.stale(currentGen)) return;

    if (branch) {
      // The visual track may still be mid-node. Releasing the player drops its
      // pending wait so the jump is immediate rather than queued behind a
      // picture nobody is looking at any more.
      this.deps.player.stop();
      await this.runIndex(branch);
      return;
    }

    await this.followNext(index, currentGen);
  }

  /**
   * When the index is over, and with which branch if any.
   *
   * §4.2 says an index ends once both tracks have drained, which is why the
   * visual is awaited at all. §5 says an answered question jumps *immediately* —
   * so a branch short-circuits the visual rather than waiting it out.
   */
  private async settleIndex(
    audioDone: Promise<LessonV2Index | null>,
    visualDone: Promise<void>,
  ): Promise<LessonV2Index | null> {
    const branch = await audioDone;
    if (branch) return branch;
    await visualDone;
    return null;
  }

  private showVisual(url: string | null): void {
    if (url === null && this.activeVisualUrl === null) return;
    this.activeVisualUrl = url;
    if (url === null) {
      this.handlers.onActivity({ imageUrl: null });
      return;
    }
    // The sequence number is what restarts a GIF when the same file is shown
    // twice in a row; React reuses the element otherwise.
    this.activeVisualSeq++;
    this.handlers.onActivity({ imageUrl: url, imageSeq: this.activeVisualSeq });
  }

  private async runVisualChannel(
    visualNodes: LessonV2VisualNode[],
    currentGen: number,
  ): Promise<void> {
    if (visualNodes.length === 0) {
      this.showVisual(null);
      this.activeVisualStop = 'tat';
      return;
    }

    for (const node of visualNodes) {
      if (this.stale(currentGen)) return;

      if (node.waitMs > 0) {
        const aborted = await this.deps.player.waitDelay(node.waitMs);
        if (aborted || this.stale(currentGen)) return;
      }

      this.showVisual(node.url);
      this.activeVisualStop = node.stop === 'tat' ? 'tat' : 'giu';

      // §4.2: an endless picture keeps showing but stops being the index's
      // clock, so as far as this track is concerned it is done the moment it
      // starts. The export step guarantees the other track is finite.
      const endless = node.repeat === 'loop' || (node.nodeType === 'image' && node.durationMs === 'full');
      if (endless) return;

      const repeats = typeof node.repeat === 'number' ? node.repeat : 1;
      let onceMs: number;
      if (typeof node.durationMs === 'number') {
        onceMs = node.durationMs;
      } else {
        onceMs = ASSUMED_ANIMATION_MS;
        this.handlers.onLog?.(
          `visual "${node.fileName}": durationMs "full" trên node ${node.nodeType} — tạm tính ${ASSUMED_ANIMATION_MS}ms (xem §10 câu 1)`,
        );
      }

      const aborted = await this.deps.player.waitDelay(onceMs * repeats);
      if (aborted || this.stale(currentGen)) return;

      // §4.1: through the next node's waitMs the glass shows whatever this
      // node's `stop` left behind — the held frame, or black.
      if (node.stop === 'tat') {
        this.activeVisualStop = 'tat';
        this.showVisual(null);
      }
    }
  }

  private async runAudioChannel(
    audioNodes: LessonV2AudioNode[],
    branches: LessonV2Index[] | undefined,
    currentGen: number,
  ): Promise<LessonV2Index | null> {
    for (const node of audioNodes) {
      if (this.stale(currentGen)) return null;
      this.currentFile = node.fileName || null;
      this.handlers.onActivity({ phase: 'playing' });

      if (node.url && !hasUnresolvedToken(node.url)) {
        const result = await this.deps.player.playSingle(node.url, {
          waitMs: node.waitMs,
          durationMs: node.durationMs,
          repeat: node.repeat,
          volume: node.volume,
        });
        if (result.aborted || this.stale(currentGen)) return null;
      } else if (node.waitMs > 0) {
        const aborted = await this.deps.player.waitDelay(node.waitMs);
        if (aborted || this.stale(currentGen)) return null;
      }

      // §5: a question ends the track. Whatever audio was authored after it is
      // never heard, because the answer jumps the branch straight away.
      if (node.type) return await this.handleQuestion(node, branches, currentGen);
    }

    return null;
  }

  private async handleQuestion(
    node: LessonV2AudioNode,
    branches: LessonV2Index[] | undefined,
    currentGen: number,
  ): Promise<LessonV2Index | null> {
    if (!branches || branches.length === 0) {
      this.handlers.onLog?.(`điểm hỏi "${node.fileName}" không có branches — bỏ qua`);
      return null;
    }

    const branchType =
      node.type === TOUCH_QUESTION_TYPE || node.touch
        ? await this.askByTouch(node, currentGen)
        : await this.askBySpeech(node, currentGen);

    if (branchType === null || this.stale(currentGen)) return null;

    const match =
      branches.find((b) => b.branchType === branchType) ??
      branches.find((b) => b.branchType === 'cham_khac') ??
      branches[0];

    this.handlers.onLog?.(
      `điểm hỏi "${node.fileName}" → "${branchType}" → nhánh ${match.branchType ?? '?'} (index ${match.order})`,
    );
    return match;
  }

  /** §5.2: the app decides the zone itself and matches `branchType`. No LLM. */
  private async askByTouch(node: LessonV2AudioNode, currentGen: number): Promise<string | null> {
    // A touch question whose layout the parser rejected. `cham_khac` always
    // exists, so the lesson has a way out that does not involve guessing which
    // grid the artwork was drawn to.
    if (!node.touch) {
      this.handlers.onLog?.(`câu hỏi chạm "${node.fileName}" thiếu layout hợp lệ → cham_khac`);
      return 'cham_khac';
    }

    // No caption. The script's own audio has just asked the question, and the
    // artwork *is* the answer sheet — inventing a line of Vietnamese here would
    // put words in Bống's mouth that the lesson never wrote. The phase alone is
    // enough for the status line and the wait ring.
    this.handlers.onActivity({
      phase: 'touching',
      waitingFor: 'touch',
      touchLayout: node.touch.layout,
    });

    const result = await this.awaitTouch(node.touch.timeoutMs ?? DEFAULT_TOUCH_TIMEOUT_MS);

    this.handlers.onActivity({ waitingFor: null, touchLayout: null });
    if (this.stale(currentGen)) return null;
    return result;
  }

  private awaitTouch(timeoutMs: number): Promise<TouchClassificationResult> {
    return new Promise<TouchClassificationResult>((resolve) => {
      const settle = (result: TouchClassificationResult) => {
        if (this.resolveTouch !== settle) return;
        this.resolveTouch = null;
        if (this.touchTimer !== null) {
          clearTimeout(this.touchTimer);
          this.touchTimer = null;
        }
        resolve(result);
      };
      this.resolveTouch = settle;
      this.touchTimer = setTimeout(() => settle('silent'), timeoutMs);
    });
  }

  /** §5.1: unchanged from version 1 — listen, then grade or classify. */
  private async askBySpeech(node: LessonV2AudioNode, currentGen: number): Promise<string | null> {
    this.handlers.onActivity({
      phase: 'listening',
      waitingFor: 'speech',
      hint: node.answer ?? null,
    });

    const answer = await this.deps.mic.listen();
    this.handlers.onActivity({ waitingFor: null, hint: null });
    if (this.stale(currentGen)) return null;

    if (!answer.speechDetected || !answer.text) return 'silent';

    if (node.brain) {
      this.handlers.onActivity({ phase: 'evaluating' });
      const classified = await classifyAnswer({ brain: node.brain, childText: answer.text });
      if (this.stale(currentGen)) return null;
      return classified?.branch ?? 'silent';
    }

    if (node.answer) {
      this.handlers.onActivity({ phase: 'evaluating' });
      const evaluated = await checkAnswer({
        text: answer.text,
        lessonId: this.deps.lessonId,
        partId: node.fileName,
      });
      if (this.stale(currentGen)) return null;
      return evaluated.result === 'correct' ? 'correct' : 'wrong';
    }

    return 'responded';
  }

  /**
   * §5.4: look the value up and branch, playing nothing.
   *
   * The branch names match what version 1's read node produces, so a script
   * converted between the two formats keeps its branches: `chua_co` when
   * nothing is stored, `not_in_list` / `match` when `values_from` pins the
   * valid set, otherwise the stored value itself and `other` as the catch-all.
   */
  private async runRecallIndex(index: LessonV2Index, currentGen: number): Promise<void> {
    const recall = index.recall;
    const branches = index.branches ?? [];

    if (!recall || !recall.category || !recall.key) {
      this.handlers.onLog?.(`index ${index.order} kiểu "${RECALL_TYPE}" nhưng thiếu recall — bỏ qua`);
      await this.followNext(index, currentGen);
      return;
    }

    const stored = this.deps.data.value(recall.category, recall.key) ?? null;
    let branchType: string;

    if (recall.valuesFrom) {
      const valid = this.deps.data.categoryValues(recall.valuesFrom);
      if (!valid) {
        // `match` and `not_in_list` are indistinguishable without the shared
        // list. Skipping beats routing every child down one of them because a
        // fetch happened to fail.
        this.handlers.onLog?.(
          `index ${index.order} bỏ qua: thiếu danh mục "${recall.valuesFrom}"`,
        );
        await this.followNext(index, currentGen);
        return;
      }
      if (!stored) branchType = 'chua_co';
      else if (!valid.includes(stored)) branchType = 'not_in_list';
      else branchType = 'match';
    } else if (!stored) {
      branchType = 'chua_co';
    } else {
      branchType = branches.some((b) => b.branchType === stored) ? stored : 'other';
    }

    this.handlers.onLog?.(`index ${index.order} đọc "${stored ?? ''}" → nhánh "${branchType}"`);

    const match = branches.find((b) => b.branchType === branchType);
    if (!match) {
      await this.followNext(index, currentGen);
      return;
    }
    if (this.stale(currentGen)) return;
    await this.runIndex(match);
  }

  private async followNext(index: LessonV2Index, currentGen: number): Promise<void> {
    if (this.stale(currentGen)) return;
    const nextIndex = this.resolveNext(index);
    if (nextIndex) {
      await this.runIndex(nextIndex);
      return;
    }
    this.finish();
  }

  /**
   * The index `next` points at, or null for the end of the script.
   *
   * A `next` naming an index that does not exist ends the lesson silently,
   * which on the glass is indistinguishable from reaching the end on purpose —
   * so it gets said out loud.
   */
  private resolveNext(index: LessonV2Index): LessonV2Index | null {
    if (!index.next) return null;
    const found = this.deps.graph.byOrder.get(index.next);
    if (!found) {
      this.handlers.onLog?.(`index ${index.order}: next "${index.next}" không tồn tại — dừng bài`);
      return null;
    }
    return found;
  }

  private finish(): void {
    // `skipNext` past the last index and the index's own tail can both land
    // here; the lesson only ends once.
    if (this.finished) return;
    this.finished = true;

    if (this.deps.trackProgress !== false && this.deps.lessonId) {
      void saveProgress({ lessonId: this.deps.lessonId, status: 'completed' });
    }

    this.activeVisualUrl = null;
    this.handlers.onActivity({
      phase: 'finished',
      caption: null,
      hint: null,
      imageUrl: null,
      waitingFor: null,
      touchLayout: null,
    });
  }

  dispose(): void {
    this.disposed = true;
    this.gen++;
    // Resolved rather than dropped: an abandoned promise here leaves the audio
    // track awaiting an answer that can never arrive.
    this.resolveTouch?.('silent');
    this.deps.player.stop();
  }
}
