/**
 * The mode picker drawn inside the circle.
 *
 * A pure reducer, like `face-state-machine.ts`, for the same reason: navigation
 * bugs on a 240px round screen are miserable to chase by clicking, and trivial
 * to pin down in a test.
 *
 * Worth saying plainly — **no real badge has this menu.** The hardware has one
 * button and a touch surface, and the shipping design has the server pick the
 * mode. This is instrumentation that happens to be drawn on the glass because
 * that is where it has to be exercised. It belongs to the same family as
 * `src/dev/`, not to the firmware being simulated.
 *
 * Two screens deep: pick a mode, then pick a lesson. What changed under the
 * thin device is not the shape of the menu but what a tap *does*. It used to
 * build a lesson engine in the browser. Now it says the lesson's name out loud,
 * and the server takes it from there — see `MODE_INTENTS` and `intentFor`.
 */

import type { LessonCategory, LessonSummary } from '../api/catalog-client';

/** What the child can start from the menu. */
export type DeviceMode = 'freetalk' | 'lesson' | 'story';

export type MenuView =
  | { screen: 'closed' }
  /** The three modes. */
  | { screen: 'root' }
  /** A scrollable list of catalog entries for one category. */
  | { screen: 'picker'; category: LessonCategory };

export interface MenuState {
  view: MenuView;
  /** Highlighted row, so the list can be driven without a pointer. */
  cursor: number;
}

export const INITIAL_MENU_STATE: MenuState = { view: { screen: 'closed' }, cursor: 0 };

export type MenuAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'back' }
  | { type: 'move'; delta: number }
  | { type: 'choose-mode'; mode: DeviceMode };

/** The modes in the order they appear, so the UI and the reducer agree. */
export const MODE_ORDER: readonly DeviceMode[] = ['freetalk', 'lesson', 'story'] as const;

export const MODE_LABELS: Record<DeviceMode, { title: string; hint: string; icon: string }> = {
  freetalk: { title: 'Trò chuyện', hint: 'Nói chuyện thoải mái với Bống', icon: '💬' },
  lesson: { title: 'Bài học', hint: 'Học tiếng Anh cùng Bống', icon: '📚' },
  story: { title: 'Đọc truyện', hint: 'Nghe Bống kể chuyện', icon: '🎧' },
};

/**
 * What the badge says to enter each mode.
 *
 * This is the whole mode-entry mechanism. The phrase goes up as
 * `listen`/`detect`, the server's LLM routes it to the lesson orchestrator, and
 * from there the badge is just a speaker again. Free talk has no phrase because
 * free talk is what the socket already does — there is nothing to enter.
 *
 * The wording matters more than it looks: it is matched by an LLM, not by a
 * parser, so it should read like something a child would actually say. These
 * two are lifted from the examples in the backend's own architecture doc
 * (`xiaozhi-lesson-architecture.md` §0.1).
 */
export const MODE_INTENTS: Record<DeviceMode, string | null> = {
  freetalk: null,
  lesson: 'Bắt đầu bài học tiếng Anh',
  story: 'Kể chuyện cho con nghe',
};

/** Which catalog category a mode picks from, or null when it needs no picking. */
export function categoryFor(mode: DeviceMode): LessonCategory | null {
  switch (mode) {
    case 'lesson':
      return 'learning';
    case 'story':
      return 'stories';
    case 'freetalk':
      return null;
  }
}

/**
 * What the badge says to start one specific entry.
 *
 * Built to land on the backend's `_find_lesson_by_intent`, which is worth
 * understanding because the prefix is doing real work:
 *
 * - An intent containing `kể chuyện` / `truyện` / `chuyện` is routed into the
 *   **stories** category before anything else is tried, and matched on title
 *   there. So a story has to carry one of those words, and a lesson must not.
 * - Everything else walks `learning` first, then `stories`, matching a full
 *   title as a substring of the intent.
 *
 * That difference is what keeps the two "Rùa và thỏ" entries apart — there is a
 * lesson by that name *and* a story by that name. "Bắt đầu bài học Rùa và thỏ"
 * finds the lesson; "Kể chuyện Rùa và Thỏ" finds the story. Swap the prefixes
 * and you get the wrong one, silently.
 *
 * The title goes out verbatim, including any punctuation: the match is a plain
 * lowercase substring test, so "Bài 2: Family" has to arrive with its colon.
 */
export function intentFor(entry: LessonSummary): string {
  return entry.category === 'stories'
    ? `Kể chuyện ${entry.title}`
    : `Bắt đầu bài học ${entry.title}`;
}

export function isOpen(state: MenuState): boolean {
  return state.view.screen !== 'closed';
}

/**
 * Advances the menu.
 *
 * Returns the same object when nothing changes, so React can skip the render —
 * the same contract `reduceFace` keeps.
 */
export function reduceMenu(state: MenuState, action: MenuAction, rowCount = 0): MenuState {
  switch (action.type) {
    case 'open':
      // Always lands on the root with a fresh cursor. Reopening the menu into
      // wherever it was last left is disorienting on a screen this small.
      return { view: { screen: 'root' }, cursor: 0 };

    case 'close':
      return state.view.screen === 'closed' ? state : INITIAL_MENU_STATE;

    case 'back':
      switch (state.view.screen) {
        case 'picker':
          return { view: { screen: 'root' }, cursor: 0 };
        case 'root':
          return INITIAL_MENU_STATE;
        case 'closed':
          return state;
      }
      break;

    case 'move': {
      if (rowCount <= 0) return state;
      // Wraps, because a round screen shows about three rows and hitting a hard
      // stop at the bottom is worse than looping.
      const cursor = (((state.cursor + action.delta) % rowCount) + rowCount) % rowCount;
      return cursor === state.cursor ? state : { ...state, cursor };
    }

    case 'choose-mode': {
      const category = categoryFor(action.mode);
      // Free talk needs nothing picked — the caller starts it and closes us.
      if (!category) return INITIAL_MENU_STATE;
      return { view: { screen: 'picker', category }, cursor: 0 };
    }
  }
  return state;
}

/** Rows shown for the current view, so the cursor and the UI can't disagree. */
export function rowsFor(state: MenuState, catalog: LessonSummary[]): LessonSummary[] {
  if (state.view.screen !== 'picker') return [];
  const { category } = state.view;
  return catalog.filter((entry) => entry.category === category);
}
