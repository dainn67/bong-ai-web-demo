import { describe, expect, it } from 'vitest';
import {
  INITIAL_MENU_STATE,
  MODE_INTENTS,
  MODE_LABELS,
  MODE_ORDER,
  categoryFor,
  intentFor,
  isOpen,
  reduceMenu,
  rowsFor,
  type MenuState,
} from './menu-state';
import type { LessonSummary } from '../api/catalog-client';

const ROOT: MenuState = { view: { screen: 'root' }, cursor: 0 };
const PICKER: MenuState = { view: { screen: 'picker', category: 'learning' }, cursor: 0 };

const entry = (
  id: string,
  title: string,
  category: LessonSummary['category'],
): LessonSummary => ({ id, title, description: '', category, coverUrl: null });

/**
 * Two entries share the title "Rùa và thỏ" — one lesson, one story. That is
 * real: it is in the live catalog, and it is the case `intentFor` has to keep
 * apart.
 */
const CATALOG: LessonSummary[] = [
  entry('lesson_1', 'Rùa và thỏ', 'learning'),
  entry('L_001', 'Lời chào', 'learning'),
  entry('S_001', 'Rùa và Thỏ', 'stories'),
];

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

  it('goes back from the picker to the modes, and from the modes to closed', () => {
    expect(reduceMenu(PICKER, { type: 'back' })).toEqual(ROOT);
    expect(reduceMenu(ROOT, { type: 'back' })).toEqual(INITIAL_MENU_STATE);
  });

  it('opens a picker for the modes that have something to list', () => {
    expect(reduceMenu(ROOT, { type: 'choose-mode', mode: 'lesson' })).toEqual(PICKER);
    expect(reduceMenu(ROOT, { type: 'choose-mode', mode: 'story' })).toEqual({
      view: { screen: 'picker', category: 'stories' },
      cursor: 0,
    });
  });

  it('closes outright for free talk, which has nothing to pick', () => {
    expect(reduceMenu(ROOT, { type: 'choose-mode', mode: 'freetalk' })).toEqual(
      INITIAL_MENU_STATE,
    );
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

describe('rowsFor', () => {
  it('shows only the picked category', () => {
    expect(rowsFor(PICKER, CATALOG).map((r) => r.id)).toEqual(['lesson_1', 'L_001']);
  });

  it('shows nothing outside a picker', () => {
    expect(rowsFor(ROOT, CATALOG)).toEqual([]);
    expect(rowsFor(INITIAL_MENU_STATE, CATALOG)).toEqual([]);
  });
});

describe('intentFor', () => {
  /**
   * These strings are matched by `_find_lesson_by_intent` on the backend, and
   * the prefix decides which category is searched: anything containing "chuyện"
   * is routed to stories *before* lessons are considered. Two catalog entries
   * share the title "Rùa và thỏ", so the prefix is the only thing telling them
   * apart — a lesson phrase that leaks the word "chuyện" silently starts the
   * wrong thing.
   */
  it('keeps a lesson clear of the story keywords', () => {
    const phrase = intentFor(CATALOG[0]);
    expect(phrase).toBe('Bắt đầu bài học Rùa và thỏ');
    expect(phrase.toLowerCase()).not.toContain('chuyện');
    expect(phrase.toLowerCase()).not.toContain('truyện');
  });

  it('gives a story the keyword that routes it to the stories list', () => {
    const phrase = intentFor(CATALOG[2]);
    expect(phrase).toBe('Kể chuyện Rùa và Thỏ');
    expect(phrase.toLowerCase()).toContain('kể chuyện');
  });

  it('carries the title verbatim, since the match is a substring test', () => {
    const punctuated = entry('L_003', 'Bài 2: Family', 'learning');
    expect(intentFor(punctuated)).toContain('Bài 2: Family');
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

  it('sends only free talk straight through without a list', () => {
    expect(categoryFor('freetalk')).toBeNull();
    expect(categoryFor('lesson')).toBe('learning');
    expect(categoryFor('story')).toBe('stories');
  });
});
