/**
 * A v2 lesson: top-level nodes reached by `next`, branches nested inside them.
 *
 * The one surprising thing about the format is that `order` is **not unique**.
 * Nodes sharing an order are a concurrent group — background music under a line
 * of narration, staggered by each clip's own `delayMs`. The engine plays the
 * whole group and waits for all of it to drain.
 */

import { dataCategoriesIn } from './placeholder';
import { parseNode, type LessonNode, type ParseContext } from './lesson-node';

export interface LessonGraph {
  title: string;
  nodes: LessonNode[];
  /** order → every top-level node sharing it, in authored order. */
  byOrder: Map<string, LessonNode[]>;
}

export function parseGraph(raw: unknown, context: ParseContext): LessonGraph {
  const json = (raw ?? {}) as Record<string, unknown>;
  const nodes: LessonNode[] = [];

  for (const entry of Array.isArray(json.nodes) ? json.nodes : []) {
    const node = parseNode(entry, context);
    if (node) nodes.push(node);
  }

  const byOrder = new Map<string, LessonNode[]>();
  for (const node of nodes) {
    const group = byOrder.get(node.order);
    if (group) group.push(node);
    else byOrder.set(node.order, [node]);
  }

  return { title: String(json.page ?? json.title ?? ''), nodes, byOrder };
}

/** Every node at `order` — the concurrent group. Empty for an unknown order. */
export function nodesByOrder(graph: LessonGraph, order: string | null): LessonNode[] {
  if (!order) return [];
  return graph.byOrder.get(order) ?? [];
}

/** The group the lesson opens with. */
export function firstGroup(graph: LessonGraph): LessonNode[] {
  const first = graph.nodes[0];
  return first ? nodesByOrder(graph, first.order) : [];
}

/** Walks every node in the graph, branches included. */
export function walkNodes(graph: LessonGraph, visit: (node: LessonNode) => void): void {
  const stack = [...graph.nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    for (const branch of Object.values(node.branches)) stack.push(...branch);
  }
}

/**
 * Every clip URL in the lesson, so the player can fetch them all up front.
 *
 * URLs still carrying an unresolved placeholder are included — the player skips
 * what it cannot fetch, and filtering here would hide a missing account behind
 * a lesson that merely sounds short.
 */
export function allAudioUrls(graph: LessonGraph): string[] {
  const urls: string[] = [];
  walkNodes(graph, (node) => {
    if (node.audioUrl) urls.push(node.audioUrl);
  });
  return urls;
}

/**
 * Every `{data.<category>}` bucket the lesson touches, from clip URLs and from
 * `save` values, so exactly those are preloaded before the first node plays.
 */
export function referencedDataCategories(graph: LessonGraph): string[] {
  const out = new Set<string>();
  walkNodes(graph, (node) => {
    for (const category of dataCategoriesIn(node.audioUrl)) out.add(category);
    if (node.save) for (const category of dataCategoriesIn(node.save.value)) out.add(category);
  });
  return [...out];
}

/** The top-level group following `order` in the node list, or empty. */
export function followingGroup(graph: LessonGraph, order: string): LessonNode[] {
  const index = graph.nodes.findIndex((node) => node.order === order);
  if (index < 0 || index + 1 >= graph.nodes.length) return [];
  return nodesByOrder(graph, graph.nodes[index + 1].order);
}

/** Whether `order` names a top-level group (branches are not in the list). */
export function isTopLevel(graph: LessonGraph, order: string): boolean {
  return graph.nodes.some((node) => node.order === order);
}
