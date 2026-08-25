import { describe, expect, it } from 'vitest';
import {
  INITIAL_MENU_STATE,
  MODE_INTENTS,
  MODE_LABELS,
  MODE_ORDER,
  isOpen,
  reduceMenu,
  type MenuState,
} from './menu-state';

const ROOT: MenuState = { view: { screen: 'root' }, cursor: 0 };

describe('reduceMenu', () => {
  it('opens onto the mode list', () => {
    expect(reduceMenu(INITIAL_MENU_STATE, { type: 'open' })).toEqual(ROOT);
  });

  it('reopens at the top rather than where it was left', () => {
    const scrolled: MenuState = { view: { screen: 'root' }, cursor: 2 };
    expect(reduceMenu(scrolled, { type: 'open' }).cursor).toBe(0);
  });

  it('closes to the same object when already closed', () => {
    // Reference equality, not deep equality: this is what lets React skip the
    // render, so it is the property worth pinning.
    expect(reduceMenu(INITIAL_MENU_STATE, { type: 'close' })).toBe(INITIAL_MENU_STATE);
  });

  it('goes back out to closed — the menu is one screen deep now', () => {
    expect(reduceMenu(ROOT, { type: 'back' })).toEqual(INITIAL_MENU_STATE);
  });

  it('closes when a mode is chosen, because the rest is the server’s job', () => {
    expect(reduceMenu(ROOT, { type: 'choose-mode', mode: 'lesson' })).toEqual(INITIAL_MENU_STATE);
  });

  it('wraps the cursor in both directions', () => {
    expect(reduceMenu(ROOT, { type: 'move', delta: -1 }, 3).cursor).toBe(2);
    expect(reduceMenu({ ...ROOT, cursor: 2 }, { type: 'move', delta: 1 }, 3).cursor).toBe(0);
  });

  it('ignores movement with no rows', () => {
    expect(reduceMenu(ROOT, { type: 'move', delta: 1 }, 0)).toBe(ROOT);
  });
});

describe('isOpen', () => {
  it('is false only when closed', () => {
    expect(isOpen(INITIAL_MENU_STATE)).toBe(false);
    expect(isOpen(ROOT)).toBe(true);
  });
});

describe('mode table', () => {
  it('labels every mode it offers', () => {
    for (const mode of MODE_ORDER) expect(MODE_LABELS[mode].title).toBeTruthy();
  });

  /**
   * Free talk having no phrase is the design, not an omission: free talk is
   * what the socket already does, so there is nothing to ask for. The other two
   * must carry one, because a mode with no phrase is a menu row that silently
   * does nothing.
   */
  it('gives every mode but free talk something to say', () => {
    expect(MODE_INTENTS.freetalk).toBeNull();
    expect(MODE_INTENTS.lesson).toBeTruthy();
    expect(MODE_INTENTS.story).toBeTruthy();
  });
});
