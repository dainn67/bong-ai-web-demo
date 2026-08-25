/**
 * Drives a v2 lesson graph.
 *
 * Plays a node; at a question, opens the mic, decides which branch the answer
 * falls into, and descends into it. Narration follows `next`. Repeats until a
 * node has nowhere to go.
 *
 * Two properties are load-bearing and worth keeping in mind when changing
 * anything here:
 *
 * **The generation counter.** Anything that supersedes the current flow — a
 * skip, an interruption, leaving the lesson — bumps `gen`, and every async
 * continuation checks `stale()` before touching state. Without it, a promise
 * resolving after the child has moved on writes into a lesson that no longer
 * exists.
 *
 * **Never dead-end.** A lesson must always be able to continue. Empty graph,
 * 404 clip, unresolvable placeholder, grader down, classifier timeout, missing
 * branch, authoring cycle — each has a defined way forward. The only genuine
 * error state is a denied microphone, because there is no version of this that
 * works without one.
 */

import {
  allAudioUrls,
  firstGroup,
  followingGroup,
  isTopLevel,
  nodesByOrder,
  referencedDataCategories,
  type LessonGraph,
} from './lesson-graph';
import {
  branchByName,
  branchesByName,
  isBrain,
  isGraded,
  isQuestion,
  isRead,
  type LessonNode,
} from './lesson-node';
import { hasUnresolvedToken, resolvePlaceholders } from './placeholder';
import { GroupPlayer, type ClipSpec } from './group-player';
import type { LessonAnswer, LessonMic } from './lesson-mic';
import {
  checkAnswer,
  classifyAnswer,
  LessonDataStore,
  saveProgress,
  type AnswerResult,
} from './lesson-api';
import type { ActivityState } from '../screen/activity-state';

/** Guard against an authored cycle. Bounded walk, then finish. */
const MAX_NODES = 500;

/** Below this the classifier's branch is discarded for the safe default. */
const BRAIN_CONFIDENCE_THRESHOLD = 0.7;

export interface EngineHandlers {
  onActivity: (patch: Partial<ActivityState>) => void;
  onLog?: (message: string) => void;
}

export interface EngineDeps {
  graph: LessonGraph;
  player: GroupPlayer;
  mic: LessonMic;
  data: LessonDataStore;
  lessonId: string;
  category?: string;
  metadataUrl?: string;
  title?: string;
  /** False when replaying a finished lesson, so progress is not downgraded. */
  trackProgress?: boolean;
}

export class GraphEngine {
  private gen = 0;
  private disposed = false;
  private visited = 0;
  private paused = false;
  private lastCheckpoint = 0;

  /** Values the classifier extracted this turn. Overwritten each question. */
  private turnValues: Record<string, unknown> | null = null;
  /** The scalar `{value}` for the branch being played. */
  private branchValue: string | null = null;
  /**
   * True only between choosing a value-bearing branch and playing its first
   * group. Any other group clears `branchValue`, which is what stops a stale
   * value leaking into a later node that happens to use `{value}`.
   */
  private branchValuePending = false;

  currentNode: LessonNode | null = null;

  private readonly deps: EngineDeps;
  private readonly handlers: EngineHandlers;

  constructor(deps: EngineDeps, handlers: EngineHandlers) {
    this.deps = deps;
    this.handlers = handlers;
  }

  private stale(gen: number): boolean {
    return gen !== this.gen || this.disposed;
  }

  private log(message: string): void {
    this.handlers.onLog?.(message);
  }

  async start(resumeOrder = 0): Promise<void> {
    const { graph, player, data } = this.deps;
    const first = firstGroup(graph);

    if (first.length === 0) {
      // No content. Finish quietly rather than showing an error — an empty
      // lesson is a content problem, and there is nothing the child can do.
      this.log('graph rỗng — kết thúc');
      this.handlers.onActivity({ phase: 'finished' });
      return;
    }

    this.handlers.onActivity({ phase: 'loading' });

    // The child's saved values ARE awaited: a `{data.*}` recall can appear in
    // the very first node, and resolving it against an empty store would send
    // the lesson down the "nothing saved yet" branch for a child who has one.
    await data.preload(referencedDataCategories(graph));
    await data.preloadCategories();

    // The clips are NOT. A real lesson is ~140 clips and ~25MB; blocking on all
    // of it leaves a child watching a counter for ten seconds before the first
    // word. Warm the cache in the background and start — each group fetches
    // what it needs on demand, so node one is audible in well under a second.
    void player.preload(allAudioUrls(graph));

    if (this.stale(this.gen)) return;

    this.visited = 0;
    const resumeGroup = resumeOrder > 0 ? nodesByOrder(graph, String(resumeOrder)) : [];
    if (resumeGroup.length > 0) {
      this.lastCheckpoint = resumeOrder;
      this.log(`tiếp tục tại order ${resumeOrder}`);
      await this.playGroup(resumeGroup, this.gen);
    } else {
      await this.playGroup(first, this.gen);
    }
  }

  /**
   * Plays one order-group and decides what follows it.
   *
   * A group is several clips at once. Once every clip has drained: a question
   * node in the group takes over, else a read node does, else it is pure
   * narration and the winner's `next` decides.
   */
  private async playGroup(group: LessonNode[], gen: number): Promise<void> {
    if (this.stale(gen) || group.length === 0) return;

    if (++this.visited > MAX_NODES) {
      this.log(`chạm giới hạn ${MAX_NODES} node — kết thúc`);
      await this.complete();
      return;
    }

    if (isTopLevel(this.deps.graph, group[0].order)) this.checkpoint(group[0].order);

    // `{value}` belongs to exactly one group: the first of the branch that set
    // it. Every other group clears it.
    if (this.branchValuePending) this.branchValuePending = false;
    else this.branchValue = null;

    const question = group.find(isQuestion) ?? null;
    const readNode = question ? null : (group.find(isRead) ?? null);

    this.currentNode = question ?? readNode ?? group[0];
    this.paused = false;
    this.handlers.onActivity({
      phase: 'playing',
      caption: this.captionFor(this.currentNode),
      hint: null,
    });

    // Resolve at play time and drop any clip whose placeholders cannot be
    // filled — §8.3, a missing value vanishes silently.
    const playable: LessonNode[] = [];
    const specs: ClipSpec[] = [];

    for (const node of group) {
      const url = this.resolve(node.audioUrl);
      if (url === null || hasUnresolvedToken(url)) {
        this.log(`bỏ node ${node.order}: không resolve được "${node.audioUrl}"`);
        continue;
      }
      playable.push(node);
      if (!url) continue;
      specs.push({
        url,
        delayMs: node.delayMs,
        volume: node.volume,
        startOffsetMs: node.startOffsetMs,
        maxDurationMs: node.maxDurationMs,
        fadeInMs: node.fadeInMs,
        fadeOutMs: node.fadeOutMs,
        hasNext: node.next !== null,
      });
    }

    let winner = -1;
    if (specs.length > 0) {
      const result = await this.deps.player.playGroup(specs);
      if (result.aborted || this.stale(gen)) return;
      winner = result.winner;
    }
    if (this.stale(gen)) return;

    if (question) {
      await this.listenAndGrade(question, gen);
      return;
    }
    if (readNode) {
      await this.readAndBranch(readNode, gen);
      return;
    }

    // Pure narration. Follow the winner — the clip with a `next` that finished
    // last. If every clip was skipped, take the first authored `next` in the
    // group so a dropped recall clip still advances the lesson.
    if (winner < 0 || winner >= playable.length) {
      const fallback = group.find((node) => node.next !== null)?.next ?? null;
      if (!fallback) await this.complete();
      else await this.advanceToOrder(fallback, gen);
      return;
    }
    await this.advanceToOrder(playable[winner].next, gen);
  }

  /** Opens the mic for one answer, then descends into the matching branch. */
  private async listenAndGrade(node: LessonNode, gen: number): Promise<void> {
    if (!(await this.deps.mic.hasPermission())) {
      // The one real error state. Everything else has a way forward.
      this.handlers.onActivity({
        phase: 'error',
        error: 'Bống cần quyền micro để nghe bé trả lời.',
      });
      return;
    }

    this.handlers.onActivity({
      phase: 'listening',
      // The hint appears only now, not while the question was still playing —
      // showing it earlier would read the answer out from under the child.
      hint: node.answer,
    });

    const answer = await this.deps.mic.listen();
    if (this.stale(gen)) return;
    this.handlers.onActivity({ hint: null });

    // No branches at all: nothing could consume a grade, so skip the round trip
    // entirely. The child still got their turn to speak.
    if (Object.keys(node.branches).length === 0) {
      await this.advancePast(node, gen);
      return;
    }

    if (isBrain(node)) {
      await this.routeBrain(node, answer, gen);
      return;
    }

    // Câu hỏi 1 — did they say anything? Decided here, no network.
    if (!isGraded(node)) {
      const responded = answer.speechDetected && answer.text !== null;
      await this.onResult(node, responded ? 'responded' : 'silent', gen);
      return;
    }

    // Câu hỏi 2. Silence short-circuits before the grader.
    if (!answer.speechDetected || !answer.text) {
      await this.onResult(node, 'silent', gen);
      return;
    }

    this.handlers.onActivity({ phase: 'evaluating' });
    try {
      const judgement = await checkAnswer({
        text: answer.text,
        lessonId: this.deps.lessonId,
        partId: node.order,
      });
      if (this.stale(gen)) return;
      if (judgement.reason) this.handlers.onActivity({ notice: judgement.reason });
      await this.onResult(node, judgement.result, gen);
    } catch (error) {
      if (this.stale(gen)) return;
      this.log(`chấm điểm lỗi: ${String(error)}`);
      this.handlers.onActivity({ notice: 'Chưa chấm được câu trả lời, Bống thử lại nhé.' });
      // An unreachable grader reads as wrong. Stalling would be worse.
      await this.onResult(node, 'wrong', gen);
    }
  }

  /**
   * Câu hỏi 3 — the LLM classifier.
   *
   * Every path lands in an authored branch, so a session can never dead-end:
   * silence and any failure go to `silent`; low confidence or an unknown branch
   * name goes to the safe default.
   */
  private async routeBrain(node: LessonNode, answer: LessonAnswer, gen: number): Promise<void> {
    const brain = node.brain;
    const text = answer.text?.trim();

    if (!brain || !answer.speechDetected || !text) {
      await this.enterBrainBranch(node, 'silent', null, gen);
      return;
    }

    this.handlers.onActivity({ phase: 'evaluating' });
    let routing: Awaited<ReturnType<typeof classifyAnswer>> | null = null;
    try {
      routing = await classifyAnswer({ brain, childText: text });
    } catch (error) {
      this.log(`classify lỗi: ${String(error)}`);
      routing = null;
    }
    if (this.stale(gen)) return;

    if (!routing) {
      await this.enterBrainBranch(node, 'silent', null, gen);
      return;
    }

    let branch = routing.branch.trim().toLowerCase();
    if (routing.confidence < BRAIN_CONFIDENCE_THRESHOLD || !branchByName(node, branch)) {
      branch = this.defaultBrainBranch(node);
    }
    await this.enterBrainBranch(node, branch, routing.values, gen);
  }

  /** `other`, else `unclear`, else `silent`. */
  private defaultBrainBranch(node: LessonNode): string {
    if (branchByName(node, 'other')) return 'other';
    if (branchByName(node, 'unclear')) return 'unclear';
    return 'silent';
  }

  private async enterBrainBranch(
    node: LessonNode,
    name: string,
    values: Record<string, unknown> | null,
    gen: number,
  ): Promise<void> {
    if (this.stale(gen)) return;
    this.turnValues = values;
    this.log(`câu hỏi 3 order=${node.order} → nhánh "${name}"`);

    let branch = branchesByName(node, name);
    if (branch.length === 0) branch = branchesByName(node, 'silent');
    if (branch.length === 0) {
      await this.advancePast(node, gen);
      return;
    }

    this.branchValue = scalarFor(node, values);
    this.branchValuePending = this.branchValue !== null;
    await this.playBranch(branch, gen);
  }

  /** Plays the branch for an outcome, or advances when none is authored. */
  private async onResult(node: LessonNode, result: AnswerResult, gen: number): Promise<void> {
    if (this.stale(gen)) return;
    const branch = branchesByName(node, result);
    this.log(`order=${node.order} → ${result} (${branch.length} node)`);

    if (branch.length > 0) await this.playBranch(branch, gen);
    // No branch for that outcome: move on rather than substituting a different
    // one. Playing "sai" at a child who was merely quiet is worse than nothing.
    else await this.advancePast(node, gen);
  }

  /**
   * Runs a branch's `save` then plays it.
   *
   * Save first, deliberately: a `{data.*}` recall later in the same lesson has
   * to see the value this branch just wrote (§7.1).
   */
  private async playBranch(branch: LessonNode[], gen: number): Promise<void> {
    if (this.stale(gen)) return;
    for (const node of branch) await this.runSave(node);
    await this.playGroup(branch, gen);
  }

  private async runSave(node: LessonNode): Promise<void> {
    const save = node.save;
    if (!save) return;
    const value = this.resolve(save.value);
    if (value === null || hasUnresolvedToken(value)) {
      // Never persist a literal "{value}". Doing so is what broke read-back in
      // the app: the token was stored, then read back and played as a path.
      this.log(`bỏ save ${save.category}[${save.key}]: chưa resolve "${save.value}"`);
      return;
    }
    await this.deps.data.save(save.category, save.key, value);
  }

  /** A read node: look up a stored value and branch on it. No mic, no waiting. */
  private async readAndBranch(node: LessonNode, gen: number): Promise<void> {
    if (this.stale(gen)) return;
    const recall = node.recall;
    if (!recall) {
      await this.advancePast(node, gen);
      return;
    }

    const stored = this.deps.data.value(recall.category, recall.key) ?? null;
    this.branchValue = stored;

    let branchName: string;
    if (recall.valuesFrom) {
      const valid = this.deps.data.categoryValues(recall.valuesFrom);
      if (!valid) {
        // The shared list did not load, so `match` and `not_in_list` cannot be
        // told apart. Skipping is safer than routing every child down the wrong
        // branch on a transient fetch failure.
        this.log(`read order=${node.order} bỏ qua: thiếu category "${recall.valuesFrom}"`);
        await this.advancePast(node, gen);
        return;
      }
      if (!stored) branchName = 'chua_co';
      else if (!valid.includes(stored)) branchName = 'not_in_list';
      else branchName = 'match';
    } else if (!stored) {
      branchName = 'chua_co';
    } else {
      branchName = branchByName(node, stored) ? stored : 'other';
    }

    this.log(`read order=${node.order} V="${stored ?? ''}" → nhánh "${branchName}"`);

    const branch = branchesByName(node, branchName);
    if (branch.length === 0) {
      await this.advancePast(node, gen);
      return;
    }
    this.branchValuePending = true;
    await this.playBranch(branch, gen);
  }

  private resolve(input: string): string | null {
    return resolvePlaceholders(input, {
      values: this.turnValues,
      branchValue: this.branchValue,
      dataLookup: (category, key) => this.deps.data.value(category, key),
    });
  }

  private captionFor(node: LessonNode): string | null {
    if (!node.text) return null;
    return this.resolve(node.text) ?? node.text;
  }

  private async advanceToOrder(order: string | null, gen: number): Promise<void> {
    if (this.stale(gen)) return;
    const group = nodesByOrder(this.deps.graph, order);
    if (group.length === 0) await this.complete();
    else await this.playGroup(group, gen);
  }

  /** Past a node: its `next`, else the following top-level node, else finish. */
  private async advancePast(node: LessonNode, gen: number): Promise<void> {
    if (this.stale(gen)) return;
    const byNext = nodesByOrder(this.deps.graph, node.next);
    if (byNext.length > 0) {
      await this.playGroup(byNext, gen);
      return;
    }
    const following = followingGroup(this.deps.graph, node.order);
    if (following.length > 0) {
      await this.playGroup(following, gen);
      return;
    }
    await this.complete();
  }

  /**
   * Jumps to the next top-level node. Testing aid.
   *
   * Walks the list by index rather than following `node.next`, because a
   * question node has no `next` of its own — its continuations live on each
   * branch — and using it would end the lesson at every question.
   */
  async skipNext(): Promise<void> {
    const node = this.currentNode;
    if (this.disposed || !node) return;

    const gen = ++this.gen;
    this.paused = false;
    this.deps.player.stop();
    await this.deps.mic.cancel();

    const nodes = this.deps.graph.nodes;
    const index = nodes.findIndex((candidate) => candidate.order === node.order);
    const nextOrder = index >= 0 && index + 1 < nodes.length ? nodes[index + 1].order : node.next;
    await this.advanceToOrder(nextOrder, gen);
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

  /**
   * Saves the resume point when a top-level group begins.
   *
   * Only integer orders — a branch order like "13.2.1" is not a place the
   * lesson can be re-entered. Throttled to once per distinct order so a group
   * replayed within a branch does not re-post.
   */
  private checkpoint(order: string): void {
    if (this.deps.trackProgress === false) return;
    const n = Number.parseInt(order, 10);
    if (Number.isNaN(n) || String(n) !== order || n === this.lastCheckpoint) return;
    this.lastCheckpoint = n;
    void saveProgress({
      lessonId: this.deps.lessonId,
      status: 'learning',
      resumeMs: n,
      category: this.deps.category,
      metadataUrl: this.deps.metadataUrl,
    });
  }

  private async complete(): Promise<void> {
    this.log('hoàn thành bài học');
    this.handlers.onActivity({ phase: 'finished', caption: null, hint: null });
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

/**
 * The single scalar a câu hỏi 3 branch resolves `{value}` with.
 *
 * The classifier returns an extraction as `{id, label}`; `id` is the canonical
 * form to save and substitute. Falls back to the node's `values_from` key, then
 * to the sole extracted value if there is exactly one.
 */
export function scalarFor(
  node: LessonNode,
  values: Record<string, unknown> | null,
): string | null {
  if (!values) return null;
  const entries = Object.entries(values);
  if (entries.length === 0) return null;

  const key = node.brain?.valuesFrom;
  const raw =
    values.id ?? (key ? values[key] : undefined) ?? (entries.length === 1 ? entries[0][1] : undefined);

  const text = raw === undefined || raw === null ? '' : String(raw).trim();
  return text.length > 0 ? text : null;
}
