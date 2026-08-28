/**
 * Parser for Lesson Schema Version 2 JSON format.
 *
 * Implements the specification in Bong-AI-Man-hinh-Dac-ta-doi-App.md.
 */

import { dataCategoriesIn, resolveAccountPlaceholders } from './placeholder';
import { parseTouchLayout } from '../screen/touch-layout';
import { DEFAULT_TOUCH_TIMEOUT_MS, RECALL_TYPE } from './lesson-v2-types';
import type {
  AudioNodeType,
  LessonV2AudioNode,
  LessonV2Graph,
  LessonV2Index,
  LessonV2VisualNode,
  VisualNodeType,
} from './lesson-v2-types';
import type { ParseContext } from './lesson-node';

/**
 * Whether this file claims to be version 2.
 *
 * `version` alone, deliberately. §8 of the screen spec is explicit that the
 * format must not be inferred from which arrays are present — so a file that
 * says 2 and then has no `indexes` is a broken version 2 file, not a version 1
 * one, and has to be reported rather than quietly re-read under the old rules.
 */
export function isLessonV2(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return (raw as Record<string, unknown>).version === 2;
}

export function parseLessonV2(raw: unknown, context: ParseContext): LessonV2Graph | null {
  if (!isLessonV2(raw)) return null;

  const json = raw as Record<string, unknown>;
  if (!Array.isArray(json.indexes)) return null;

  const indexes: LessonV2Index[] = [];
  const byOrder = new Map<string, LessonV2Index>();
  const warnings: string[] = [];

  for (const rawIndex of json.indexes) {
    const parsed = parseIndex(rawIndex, context, warnings);
    if (parsed) indexes.push(parsed);
  }

  const graph: LessonV2Graph = {
    version: 2,
    page: String(json.page ?? json.title ?? ''),
    indexes,
    byOrder,
    warnings,
  };

  // Branches are registered too, not just top-level indexes: they are full
  // indexes with their own `order`, so nothing stops a script pointing `next`
  // at one, and an unresolvable `next` ends the lesson where it stands.
  walkIndexes(graph, (index) => {
    if (!byOrder.has(index.order)) byOrder.set(index.order, index);
  });

  return graph;
}

/** Every clip URL in the lesson, so the player can warm them all up front. */
export function allV2AudioUrls(graph: LessonV2Graph): string[] {
  const urls: string[] = [];
  walkIndexes(graph, (index) => {
    for (const node of index.audio) if (node.url) urls.push(node.url);
  });
  return urls;
}

/**
 * Every `{data.<category>}` bucket the lesson touches, from clip URLs, `save`
 * values and `recall` categories, so exactly those load before the first index.
 */
export function referencedV2DataCategories(graph: LessonV2Graph): string[] {
  const out = new Set<string>();
  walkIndexes(graph, (index) => {
    for (const node of index.audio) for (const c of dataCategoriesIn(node.url)) out.add(c);
    for (const node of index.visual) for (const c of dataCategoriesIn(node.url)) out.add(c);
    if (index.save) {
      out.add(index.save.category);
      for (const c of dataCategoriesIn(index.save.value)) out.add(c);
    }
    if (index.recall) out.add(index.recall.category);
  });
  out.delete('');
  return [...out];
}

/** Every index in the lesson, branches included. */
function walkIndexes(graph: LessonV2Graph, visit: (index: LessonV2Index) => void): void {
  const stack = [...graph.indexes];
  const seen = new Set<LessonV2Index>();
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (seen.has(index)) continue;
    seen.add(index);
    visit(index);
    if (index.branches) stack.push(...index.branches);
  }
}

function parseIndex(raw: unknown, context: ParseContext, warnings: string[]): LessonV2Index | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const order = String(obj.order ?? '').trim();
  if (!order) return null;

  const next = obj.next !== undefined && obj.next !== null ? String(obj.next).trim() : null;
  const branchType = obj.branchType ? String(obj.branchType).trim() : undefined;
  const type = obj.type ? String(obj.type).trim() : undefined;

  // 1. Parse audio nodes
  const rawAudio = Array.isArray(obj.audio) ? obj.audio : [];
  const audio: LessonV2AudioNode[] = [];
  for (const item of rawAudio) {
    const parsedAudio = parseAudioNode(item, context, order, warnings);
    if (parsedAudio) audio.push(parsedAudio);
  }

  // 2. Parse visual nodes
  const rawVisual = Array.isArray(obj.visual) ? obj.visual : [];
  const visual: LessonV2VisualNode[] = [];
  for (const item of rawVisual) {
    const parsedVisual = parseVisualNode(item, context);
    if (parsedVisual) visual.push(parsedVisual);
  }

  // 3. Parse branches recursively
  const rawBranches = Array.isArray(obj.branches) ? obj.branches : [];
  const branches: LessonV2Index[] = [];
  for (const branch of rawBranches) {
    const parsedBranch = parseIndex(branch, context, warnings);
    if (parsedBranch) branches.push(parsedBranch);
  }

  // 4. Parse save & recall
  const save = obj.save && typeof obj.save === 'object'
    ? {
        category: String((obj.save as Record<string, unknown>).category ?? ''),
        key: String((obj.save as Record<string, unknown>).key ?? ''),
        value: String((obj.save as Record<string, unknown>).value ?? ''),
      }
    : null;

  const recall = obj.recall && typeof obj.recall === 'object'
    ? {
        category: String((obj.recall as Record<string, unknown>).category ?? ''),
        key: String((obj.recall as Record<string, unknown>).key ?? ''),
        valuesFrom: (obj.recall as Record<string, unknown>).values_from
          ? String((obj.recall as Record<string, unknown>).values_from)
          : null,
      }
    : null;

  // §5.4 has the engine decide on `type`, so a `recall` without it never runs.
  // Worth saying out loud — it looks exactly like a branch that never fires.
  if (recall && type !== RECALL_TYPE) {
    warnings.push(`index ${order}: có "recall" nhưng type không phải "${RECALL_TYPE}" — sẽ không được đọc`);
  }

  return {
    order,
    audio,
    visual,
    next,
    branches: branches.length > 0 ? branches : undefined,
    branchType,
    save,
    type,
    recall,
  };
}

function parseAudioNode(
  raw: unknown,
  context: ParseContext,
  order: string,
  warnings: string[],
): LessonV2AudioNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const rawUrl = String(obj.url ?? obj.audio ?? '').trim();
  const url = resolveAccountPlaceholders(rawUrl, {
    phone: context.phone,
    voiceId: context.voiceId,
  });

  const nodeType: AudioNodeType =
    obj.nodeType === 'music' || obj.nodeType === 'sfx' || obj.nodeType === 'amb'
      ? obj.nodeType
      : 'voice';

  let durationMs: number | 'full' = 'full';
  if (typeof obj.durationMs === 'number') {
    durationMs = Math.max(0, obj.durationMs);
  } else if (typeof obj.durationMs === 'string' && obj.durationMs !== 'full' && !isNaN(Number(obj.durationMs))) {
    durationMs = Math.max(0, Number(obj.durationMs));
  }

  const waitMs = typeof obj.waitMs === 'number' ? Math.max(0, obj.waitMs) : 0;
  const repeat = typeof obj.repeat === 'number' ? Math.max(1, Math.floor(obj.repeat)) : 1;
  const volume = typeof obj.volume === 'number' ? Math.max(0, Math.min(100, obj.volume)) : 80;

  // Question metadata
  const type = obj.type ? String(obj.type).trim() : undefined;
  let touch: LessonV2AudioNode['touch'];
  if (obj.touch && typeof obj.touch === 'object') {
    const t = obj.touch as Record<string, unknown>;
    const layout = parseTouchLayout(t.layout);
    if (layout) {
      touch = {
        layout,
        timeoutMs: typeof t.timeoutMs === 'number' ? t.timeoutMs : DEFAULT_TOUCH_TIMEOUT_MS,
      };
    } else {
      // Left unset rather than defaulted: the engine reads a touch question with
      // no usable layout as `cham_khac`, which §5.2 guarantees exists. Silently
      // substituting tap4 would grade the child against the wrong grid.
      warnings.push(
        `index ${order}: layout chạm "${String(t.layout)}" không hợp lệ — câu hỏi sẽ đi nhánh cham_khac`,
      );
    }
  }

  const brain = obj.brain && typeof obj.brain === 'object'
    ? {
        instruction: String((obj.brain as Record<string, unknown>).instruction ?? ''),
        valuesFrom: (obj.brain as Record<string, unknown>).values_from
          ? String((obj.brain as Record<string, unknown>).values_from)
          : null,
        branches: Array.isArray((obj.brain as Record<string, unknown>).branches)
          ? ((obj.brain as Record<string, unknown>).branches as any[])
          : [],
      }
    : null;

  const answer = obj.answer ? String(obj.answer) : null;

  return {
    fileName: String(obj.fileName ?? ''),
    nodeType,
    scopeType: obj.scopeType ? String(obj.scopeType) : undefined,
    voice: obj.voice ? String(obj.voice) : undefined,
    url,
    waitMs,
    durationMs,
    repeat,
    volume,
    type,
    touch,
    brain,
    answer,
  };
}

function parseVisualNode(raw: unknown, context: ParseContext): LessonV2VisualNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const rawUrl = String(obj.url ?? obj.image ?? obj.gif ?? '').trim();
  if (!rawUrl) return null;

  const url = resolveAccountPlaceholders(rawUrl, {
    phone: context.phone,
    voiceId: context.voiceId,
  });

  const nodeType: VisualNodeType = obj.nodeType === 'video' ? 'video' : 'image';

  let durationMs: number | 'full' = 'full';
  if (typeof obj.durationMs === 'number') {
    durationMs = Math.max(0, obj.durationMs);
  } else if (typeof obj.durationMs === 'string' && obj.durationMs !== 'full' && !isNaN(Number(obj.durationMs))) {
    durationMs = Math.max(0, Number(obj.durationMs));
  }

  const waitMs = typeof obj.waitMs === 'number' ? Math.max(0, obj.waitMs) : 0;
  const repeat: number | 'loop' =
    obj.repeat === 'loop' ? 'loop' : typeof obj.repeat === 'number' ? Math.max(1, Math.floor(obj.repeat)) : 1;

  // `giu` when unstated. The spec gives no default, and of the two this is the
  // safe direction: §4.3 makes avoiding an unnecessary black flash a
  // requirement, so an authoring omission should not manufacture one.
  const stop: 'giu' | 'tat' = obj.stop === 'tat' ? 'tat' : 'giu';

  return {
    fileName: String(obj.fileName ?? ''),
    nodeType,
    scopeType: obj.scopeType ? String(obj.scopeType) : undefined,
    url,
    waitMs,
    durationMs,
    repeat,
    stop,
  };
}
