/**
 * One node of a v2 lesson graph.
 *
 * A lesson is a tree of pre-recorded mp3s. Narration plays and follows `next`;
 * a question plays, opens the mic, and descends into whichever `branches` entry
 * matches the answer. The only intelligence in the whole format is picking the
 * branch — everything else is playback.
 *
 * Ported from `lesson_node.dart`. The string matching below looks loose because
 * it is: the `type` and `branchType` fields are Vietnamese prose typed by
 * content authors, so they are compared with accents stripped and matched on
 * substrings.
 */

import { resolveAccountPlaceholders } from './placeholder';
import { normalizeVietnamese } from './vietnamese';

export type NodeType = 'narration' | 'questionAny' | 'questionGraded' | 'questionBrain' | 'read';

/** The four canonical outcomes câu hỏi 1 and 2 branch on. */
export type BranchType = 'correct' | 'wrong' | 'silent' | 'responded';

export type LessonVoice = 'teacher' | 'bong' | 'song' | 'unknown';

/** The `brain` block on a câu hỏi 3 node, relayed to the classifier verbatim. */
export interface LessonBrain {
  instruction: string;
  /** A shared value list the LLM matches against. The backend loads it. */
  valuesFrom: string | null;
  branches: { name: string; desc: string; extract?: string[] }[];
}

/** A branch node's `save` directive. */
export interface LessonSave {
  category: string;
  key: string;
  value: string;
}

/** A read node's `recall` directive. */
export interface LessonRecall {
  category: string;
  key: string;
  valuesFrom: string | null;
}

export interface LessonNode {
  /**
   * Authored id, e.g. "5" or "13.2.1".
   *
   * **Not unique.** Several top-level nodes may share one `order`, which is how
   * the format expresses "play these together" — see `lesson-graph.ts`.
   */
  order: string;
  type: NodeType;
  audioUrl: string;
  voice: LessonVoice;

  /** Wait this long after the group starts before playing. */
  delayMs: number;
  /** 0..1. Comes from `volume` 0–100, or the `{bongVolume}` placeholder. */
  volume: number;
  /** Stop after this long. Null plays the whole clip. */
  maxDurationMs: number | null;
  /** Skip this far into the file before playing. */
  startOffsetMs: number;
  fadeInMs: number;
  fadeOutMs: number;

  /** Where to go after this clip. Null ends the lesson. */
  next: string | null;
  /** Expected answer for câu hỏi 1/2 — a UI hint only, never sent anywhere. */
  answer: string | null;
  text: string | null;

  brain: LessonBrain | null;
  save: LessonSave | null;
  recall: LessonRecall | null;

  /** Response nodes, keyed by branch token. See the note on `useRawKey`. */
  branches: Record<string, LessonNode[]>;
}

export function isQuestion(node: LessonNode): boolean {
  return node.type !== 'narration' && node.type !== 'read';
}

/** Câu hỏi 2 — needs the grader. Câu hỏi 1 is decided locally, no round trip. */
export function isGraded(node: LessonNode): boolean {
  return node.type === 'questionGraded';
}

/** Câu hỏi 3 — routed through the LLM classifier. */
export function isBrain(node: LessonNode): boolean {
  return node.type === 'questionBrain';
}

export function isRead(node: LessonNode): boolean {
  return node.type === 'read';
}

/** All branch nodes filed under `name`, or empty. */
export function branchesByName(node: LessonNode, name: string): LessonNode[] {
  return node.branches[name.trim().toLowerCase()] ?? [];
}

export function branchByName(node: LessonNode, name: string): LessonNode | null {
  return branchesByName(node, name)[0] ?? null;
}

/**
 * Maps the authored `type` label.
 *
 * Order matters and is deliberate. A label with no "cau hoi" in it is narration;
 * after that the digit decides. Note this is a *substring* test — the app's own
 * docs flag that a hypothetical "câu hỏi 13" would read as câu hỏi 1. Kept
 * identical to the app rather than quietly fixed: the simulator's job is to
 * behave the way the thing it simulates behaves, and a divergence here would
 * make a content bug reproduce on the phone but not here.
 */
export function nodeTypeFromVi(label: string | null | undefined): NodeType {
  const n = normalizeVietnamese(label ?? '');
  if (n.includes('doc gia tri da luu')) return 'read';
  if (!n.includes('cau hoi')) return 'narration';
  if (n.includes('1')) return 'questionAny';
  if (n.includes('3')) return 'questionBrain';
  return 'questionGraded';
}

/**
 * Maps an authored `branchType` label to a canonical outcome, or null.
 *
 * The order is load-bearing: the câu hỏi 2 labels ("phản hồi đúng", "phản hồi
 * sai") *also* contain "phản hồi", so the specific words have to be tested
 * before falling back to `responded`. A label that matches nothing returns null
 * and the branch is dropped at parse time.
 */
export function branchTypeFromVi(label: string | null | undefined): BranchType | null {
  const n = normalizeVietnamese(label ?? '');
  if (n.includes('dung')) return 'correct';
  if (n.includes('im lang')) return 'silent';
  if (n.includes('sai')) return 'wrong';
  if (n.includes('phan hoi')) return 'responded';
  return null;
}

export function lessonVoiceFromVi(label: string | null | undefined): LessonVoice {
  const n = normalizeVietnamese(label ?? '');
  if (n.includes('co giao')) return 'teacher';
  if (n.includes('bai hat')) return 'song';
  if (n.includes('bong')) return 'bong';
  return 'unknown';
}

export interface ParseContext {
  phone?: string | null;
  voiceId?: string | null;
  bongVolume?: number | null;
}

/**
 * Builds a node from lesson JSON, filling the account-scoped placeholders.
 *
 * Branch keys are filed two different ways, decided here: câu hỏi 3 and read
 * nodes keep the author's free-form token (`match`, `chua_co`, `other`), while
 * câu hỏi 1/2 are normalised to the canonical outcome names. Both live in the
 * same `branches` map, which is why the lookup helpers take a string.
 */
export function parseNode(raw: unknown, context: ParseContext): LessonNode | null {
  if (!isRecord(raw)) return null;

  const useRawKey = isRecord(raw.brain) || isRecord(raw.recall);
  const branches: Record<string, LessonNode[]> = {};

  for (const entry of asArray(raw.branches)) {
    if (!isRecord(entry)) continue;
    const label = asString(entry.branchType);
    const key = useRawKey ? label?.trim().toLowerCase() : (branchTypeFromVi(label) ?? undefined);
    if (!key) continue;
    const child = parseNode(entry, context);
    if (!child) continue;
    (branches[key] ??= []).push(child);
  }

  return {
    order: String(raw.order ?? ''),
    type: nodeTypeFromVi(asString(raw.type)),
    audioUrl: resolveAccountPlaceholders(asString(raw.audio) ?? '', {
      phone: context.phone,
      voiceId: context.voiceId,
    }),
    voice: lessonVoiceFromVi(asString(raw.voice)),

    delayMs: parseMs(raw.delayMs) ?? 0,
    volume: parseVolume(raw.volume, context.bongVolume),
    maxDurationMs: parseMs(raw.durationMs),
    startOffsetMs: parseMs(raw.startTime) ?? 0,
    fadeInMs: parseMs(raw.fadeIn) ?? 0,
    fadeOutMs: parseMs(raw.fadeOut) ?? 0,

    next: asString(raw.next),
    answer: asString(raw.answer),
    text: asString(raw.text ?? raw.transcript ?? raw.script ?? raw.content),

    brain: parseBrain(raw.brain),
    save: parseSave(raw.save),
    recall: parseRecall(raw.recall),
    branches,
  };
}

function parseBrain(raw: unknown): LessonBrain | null {
  if (!isRecord(raw)) return null;
  return {
    instruction: String(raw.instruction ?? ''),
    valuesFrom: asString(raw.values_from),
    branches: asArray(raw.branches)
      .filter(isRecord)
      .map((b) => ({
        name: String(b.name ?? ''),
        desc: String(b.desc ?? ''),
        extract: asArray(b.extract).map(String),
      })),
  };
}

function parseSave(raw: unknown): LessonSave | null {
  if (!isRecord(raw)) return null;
  const category = String(raw.category ?? '');
  const key = String(raw.key ?? '');
  if (!category || !key) return null;
  return { category, key, value: String(raw.value ?? '') };
}

function parseRecall(raw: unknown): LessonRecall | null {
  if (!isRecord(raw)) return null;
  const category = String(raw.category ?? '');
  const key = String(raw.key ?? '');
  if (!category || !key) return null;
  return { category, key, valuesFrom: asString(raw.values_from) };
}

/**
 * A millisecond field. Absent, non-numeric or the sentinel `"full"` → null,
 * which the caller reads as "no cap" or "no delay".
 */
function parseMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * `volume` as 0..1. Accepts a literal 0–100, or the `{bongVolume}` placeholder
 * standing in for the level this parent configured. Anything unrecognised plays
 * at full — a clip nobody can hear is worse than one that is slightly loud.
 */
function parseVolume(value: unknown, bongVolume: number | null | undefined): number {
  let raw = value;
  if (typeof raw === 'string' && isBongVolumeToken(raw)) raw = bongVolume ?? undefined;
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw.trim()) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n / 100));
}

function isBongVolumeToken(value: string): boolean {
  return value.trim().replace(/[{}<>]/g, '').toLowerCase() === 'bongvolume';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
