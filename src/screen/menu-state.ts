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
 * It used to be two screens deep: pick a mode, then pick a lesson from the
 * catalog. The second screen is gone. The device does not browse a catalog —
 * it says what it wants and the server decides, so choosing a mode now sends a
 * sentence and the menu's whole job is over. What lesson runs is the server's
 * call, which is the point of `plan-server-driven-modes.md`.
 */

/** What the child can start from the menu. */
export type DeviceMode = 'freetalk' | 'lesson' | 'story';

export type MenuView =
  | { screen: 'closed' }
  /** The three modes. */
  | { screen: 'root' };

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
      // One screen deep, so back and close are the same thing.
      return state.view.screen === 'closed' ? state : INITIAL_MENU_STATE;

    case 'move': {
      if (rowCount <= 0) return state;
      // Wraps, because a round screen shows about three rows and hitting a hard
      // stop at the bottom is worse than looping.
      const cursor = (((state.cursor + action.delta) % rowCount) + rowCount) % rowCount;
      return cursor === state.cursor ? state : { ...state, cursor };
    }

    case 'choose-mode':
      // Picking a mode says a sentence and gets out of the way. Nothing to
      // drill into — the server decides what happens next.
      return INITIAL_MENU_STATE;
  }
  return state;
}
