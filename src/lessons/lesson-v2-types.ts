/**
 * TypeScript types for Lesson Schema Version 2.
 *
 * As specified in Bong-AI-Man-hinh-Dac-ta-doi-App.md.
 */

import type { TouchLayoutType } from '../screen/touch-layout';
import type { LessonBrain, LessonRecall, LessonSave } from './lesson-node';

export type AudioNodeType = 'voice' | 'sfx' | 'amb' | 'music';
export type VisualNodeType = 'image' | 'video';

/** The index type that reads a saved value and branches without playing — §5.4. */
export const RECALL_TYPE = 'đọc giá trị đã lưu';

/** The question type answered by touching the glass rather than speaking — §5.2. */
export const TOUCH_QUESTION_TYPE = 'câu hỏi chạm';

/**
 * How long a touch window stays open when the script does not say.
 *
 * Longer than the listening window because the child has to look at the
 * picture, decide, and only then reach out — spec §5.2.
 */
export const DEFAULT_TOUCH_TIMEOUT_MS = 10_000;

/**
 * How long a finite animation is assumed to run when the file itself is the
 * only place its length is written down.
 *
 * A `video` node with `durationMs: "full"` and a finite `repeat` is meant to
 * end when the GIF ends, but nothing on this side knows how long that is
 * without decoding the file. This is the placeholder until §10 Q1 is answered
 * — which is also the question that decides whether GIFs can stop on their last
 * frame at all. Scripts that care about index timing should state `durationMs`.
 */
export const ASSUMED_ANIMATION_MS = 3_000;

export interface LessonV2TouchConfig {
  layout: TouchLayoutType;
  timeoutMs?: number;
}

export interface LessonV2AudioNode {
  fileName: string;
  nodeType: AudioNodeType;
  scopeType?: string;
  voice?: string;
  url: string;
  /** Wait in ms AFTER previous audio node in the same array ends. */
  waitMs: number;
  /** Cut after N ms, or 'full' to play the entire file. */
  durationMs: number | 'full';
  /** Number of times to play. Audio nodes never loop infinitely. */
  repeat: number;
  /** 0-100 */
  volume: number;
  /** Present only on question nodes. */
  type?: string;
  touch?: LessonV2TouchConfig;
  brain?: LessonBrain | null;
  answer?: string | null;
}

export interface LessonV2VisualNode {
  fileName: string;
  nodeType: VisualNodeType;
  scopeType?: string;
  url: string;
  /** Wait in ms AFTER previous visual node in the same array ends. */
  waitMs: number;
  /** Cut after N ms, or 'full' (indefinite display for images). */
  durationMs: number | 'full';
  /** Number of times to repeat, or 'loop' to repeat indefinitely (only last visual node). */
  repeat: number | 'loop';
  /** 'giu' to hold the last frame; 'tat' to turn the screen black. */
  stop: 'giu' | 'tat';
}

export interface LessonV2Index {
  order: string;
  audio: LessonV2AudioNode[];
  visual: LessonV2VisualNode[];
  next: string | null;
  /** Present in question nodes. Each element is a full index with branchType. */
  branches?: LessonV2Index[];
  /** Present when this index is inside a branches[] array. */
  branchType?: string;
  save?: LessonSave | null;
  /** E.g. 'đọc giá trị đã lưu' */
  type?: string;
  recall?: LessonRecall | null;
}

export interface LessonV2Graph {
  version: 2;
  page: string;
  indexes: LessonV2Index[];
  byOrder: Map<string, LessonV2Index>;
  /**
   * Authoring problems found while parsing, for the log.
   *
   * Collected rather than thrown: one bad layout should cost that question its
   * grid, not the lesson its playback.
   */
  warnings: string[];
}
