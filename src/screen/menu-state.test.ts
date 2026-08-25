import { describe, expect, it } from 'vitest';
import {
  INITIAL_MENU_STATE,
  categoryFor,
  isOpen,
  reduceMenu,
  rowsFor,
  type MenuState,
} from './menu-state';
import type { LessonSummary } from '../lessons/catalog';

const entry = (id: string, category: LessonSummary['category']): LessonSummary => ({
  id,
  title: id,
  description: '',
  category,
  metadataUrl: `/cdn/lessions/${id}/metadata.json`,
  coverUrl: null,
});

const CATALOG: LessonSummary[] = [
  entry('S_001', 'stories'),
  entry('S_002', 'stories'),
  entry('L_001', 'learning'),
  entry('L_002', 'learning'),
  entry('L_003', 'learning'),
];

const root: MenuState = { view: { screen: 'root' }, cursor: 0 };

describe('reduceMenu', () => {
  it('opens onto the root', () => {
    expect(reduceMenu(INITIAL_MENU_STATE, { type: 'open' })).toEqual(root);
  });

  // Reopening into wherever it was last left is disorienting at this size.
  it('resets the cursor when reopened', () => {
    const deep = reduceMenu({ view: { screen: 'root' }, cursor: 2 }, { type: 'open' });
    expect(deep.cursor).toBe(0);
  });

  it('closing an already-closed menu changes nothing', () => {
    expect(reduceMenu(INITIAL_MENU_STATE, { type: 'close' })).toBe(INITIAL_MENU_STATE);
  });

  it('back steps picker → root → closed', () => {
    const picker = reduceMenu(root, { type: 'choose-mode', mode: 'lesson' });
    expect(picker.view).toEqual({ screen: 'picker', category: 'learning' });

    const backToRoot = reduceMenu(picker, { type: 'back' });
    expect(backToRoot.view).toEqual({ screen: 'root' });

    expect(reduceMenu(backToRoot, { type: 'back' })).toEqual(INITIAL_MENU_STATE);
  });

  it('sends story mode to the stories picker', () => {
    const state = reduceMenu(root, { type: 'choose-mode', mode: 'story' });
    expect(state.view).toEqual({ screen: 'picker', category: 'stories' });
  });

  // Free talk has nothing to pick — the caller starts it and the menu gets out
  // of the way in the same action.
  it('closes outright on free talk', () => {
    expect(reduceMenu(root, { type: 'choose-mode', mode: 'freetalk' })).toEqual(
      INITIAL_MENU_STATE,
    );
  });

  describe('move', () => {
    it('walks the list', () => {
      expect(reduceMenu(root, { type: 'move', delta: 1 }, 3).cursor).toBe(1);
    });

    it('wraps past the end and before the start', () => {
      expect(reduceMenu({ ...root, cursor: 2 }, { type: 'move', delta: 1 }, 3).cursor).toBe(0);
      expect(reduceMenu({ ...root, cursor: 0 }, { type: 'move', delta: -1 }, 3).cursor).toBe(2);
    });

    it('is inert with no rows', () => {
      expect(reduceMenu(root, { type: 'move', delta: 1 }, 0)).toBe(root);
    });

    it('returns the same object when the cursor would not move', () => {
      expect(reduceMenu(root, { type: 'move', delta: 3 }, 3)).toBe(root);
    });
  });
});

describe('categoryFor', () => {
  it('maps modes to catalog buckets', () => {
    expect(categoryFor('lesson')).toBe('learning');
    expect(categoryFor('story')).toBe('stories');
    expect(categoryFor('freetalk')).toBeNull();
  });
});

describe('rowsFor', () => {
  it('filters the catalog to the open picker', () => {
    const picker = reduceMenu(root, { type: 'choose-mode', mode: 'story' });
    expect(rowsFor(picker, CATALOG).map((r) => r.id)).toEqual(['S_001', 'S_002']);
  });

  it('is empty outside a picker', () => {
    expect(rowsFor(root, CATALOG)).toEqual([]);
    expect(rowsFor(INITIAL_MENU_STATE, CATALOG)).toEqual([]);
  });
});

describe('isOpen', () => {
  it('is false only when closed', () => {
    expect(isOpen(INITIAL_MENU_STATE)).toBe(false);
    expect(isOpen(root)).toBe(true);
  });
});
