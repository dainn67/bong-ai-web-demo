/**
 * What the badge is doing when it is doing something other than chatting.
 *
 * Free talk is driven entirely by the backend, so the screen for it is the face
 * state machine and nothing else. A lesson or a story is driven from *here*,
 * and it needs its own small state: which phase it is in, what line is playing,
 * and whether anything went wrong.
 *
 * Kept apart from `FaceState` on purpose. That reducer's whole job is to be a
 * pure function of the protocol; folding locally-driven playback into it would
 * mean the face could no longer be explained by the packets that produced it.
 */

import type { TouchLayoutType } from './touch-layout';

export type ActivityKind = 'story' | 'lesson';

export type ActivityPhase =
  | 'loading'
  | 'playing'
  /** Mic open, waiting for the child's answer (lessons only). */
  | 'listening'
  /** Touch window open, waiting for child tap/swipe (lessons only). */
  | 'touching'
  /** Waiting on the grader or the classifier (lessons only). */
  | 'evaluating'
  | 'paused'
  | 'finished'
  | 'error';

export interface ActivityState {
  kind: ActivityKind | null;
  title: string;
  phase: ActivityPhase;
  /** The line being spoken right now — the caption on the glass. */
  caption: string | null;
  /** Image illustration for the current node/scene, or null. */
  imageUrl?: string | null;
  /**
   * Bumped on every display, so the same file shown twice starts over.
   *
   * A GIF is one `<img>` to React; without something changing in the key it
   * reuses the element, and the second showing continues mid-animation.
   */
  imageSeq?: number;
  /** Which kind of answer the glass is open for, if any. Drives the wait ring. */
  waitingFor?: 'speech' | 'touch' | null;
  /** The zone grid a `câu hỏi chạm` is being answered against. */
  touchLayout?: TouchLayoutType | null;
  /**
   * The expected answer, shown only while the mic is open.
   *
   * A hint on screen while the question is still playing would be reading the
   * answer out from under the child. The app applies the same rule.
   */
  hint: string | null;
  /** A one-off message from the grader, shown briefly then cleared. */
  notice: string | null;
  error: string | null;
}

export const IDLE_ACTIVITY: ActivityState = {
  kind: null,
  title: '',
  phase: 'loading',
  caption: null,
  imageUrl: null,
  imageSeq: 0,
  waitingFor: null,
  touchLayout: null,
  hint: null,
  notice: null,
  error: null,
};

/** Whether an activity owns the screen right now. */
export function isActive(state: ActivityState): boolean {
  return state.kind !== null;
}

/** Whether pausing is meaningful. Only a playing clip can be paused. */
export function canPause(state: ActivityState): boolean {
  return state.phase === 'playing' || state.phase === 'paused';
}

/** Vietnamese status line for the phase, shown under the caption. */
export function phaseLabel(state: ActivityState): string | null {
  switch (state.phase) {
    case 'loading':
      return 'Đang tải…';
    case 'listening':
      return 'Bống đang nghe bé…';
    case 'touching':
      return 'Bé chạm hoặc vuốt nhé…';
    case 'evaluating':
      return 'Bống đang nghĩ…';
    case 'paused':
      return 'Đã tạm dừng';
    case 'finished':
      return state.kind === 'lesson' ? 'Hết bài rồi!' : 'Hết truyện rồi!';
    case 'error':
      return state.error;
    case 'playing':
      return null;
  }
}
