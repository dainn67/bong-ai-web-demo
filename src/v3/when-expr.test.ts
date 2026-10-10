import { describe, it, expect } from 'vitest';
import { evalWhen, normalizeReply } from './when-expr';
import type { MemorySpaces } from './types';

const MEM: MemorySpaces = {
  sys: {
    rnd: 7,
    silent_streak: 0,
    net: true,
    time: '19:50',
    battery: 40,
    first_run: false,
    plan: 'basic',
  },
  profile: {
    child_name: 'Bảo Anh',
    bong_name: 'Bống',
    bedtime: '20:30',
    lesson_from: '19:45',
    lesson_to: '20:30',
  },
  learn: { unit: 3 },
  user: { fav_color: 'blue' },
  stat: { today_min: 15, sessions: 2 },
  tmp: { z: 2 },
};

const ctx = (reply: string | null) => ({ reply, memory: MEM });

describe('when expression evaluator (Excel syntax)', () => {
  it('equality on reply', () => {
    expect(evalWhen('{reply} = cat', ctx('cat'))).toBe(true);
    expect(evalWhen('{reply} = cat', ctx('dog'))).toBe(false);
    expect(evalWhen('{reply} = cat', ctx(null))).toBe(false);
  });

  it('AND/OR/NOT combinators', () => {
    expect(evalWhen('AND({reply} = more, {sys.plan} = basic)', ctx('more'))).toBe(true);
    expect(evalWhen('AND({reply} = more, {sys.plan} = pro)', ctx('more'))).toBe(false);
    expect(evalWhen('OR({reply} = silent, {reply} = unclear)', ctx('unclear'))).toBe(true);
    expect(evalWhen('NOT({tmp.z} < 3)', ctx(null))).toBe(false);
    expect(evalWhen('NOT({tmp.z} < 1)', ctx(null))).toBe(true);
  });

  it('ISBLANK on missing vars', () => {
    // MEM.stat has no guide_done → blank → ISBLANK true
    expect(evalWhen('ISBLANK({stat.guide_done})', ctx(null))).toBe(true);
    expect(evalWhen('ISBLANK({learn.unit})', ctx(null))).toBe(false);
  });

  it('nested AND(ISBLANK, NOT(ISBLANK))', () => {
    const m = { ...MEM, stat: { ...MEM.stat, guide_done: true } };
    const c = { reply: null, memory: m };
    expect(evalWhen('AND(ISBLANK({stat.missing}), NOT(ISBLANK({stat.guide_done})))', c)).toBe(true);
  });

  it('time-of-day comparison HH:MM', () => {
    expect(evalWhen('{sys.time} >= {profile.bedtime}', ctx(null))).toBe(false); // 19:50 < 20:30
    expect(evalWhen('{sys.time} < {profile.bedtime}', ctx(null))).toBe(true);
  });

  it('duration literals h/m/d', () => {
    expect(evalWhen('{sys.sleep_gap} >= 18h', ctx(null))).toBe(false); // blank < → false
    const m = { ...MEM, sys: { ...MEM.sys, sleep_gap: 19 * 3600 } };
    // sleep_gap stored as seconds — 19h in seconds ≥ 18h
    expect(evalWhen('{sys.sleep_gap} >= 18h', { reply: null, memory: m })).toBe(true);
  });

  it('numeric comparisons', () => {
    expect(evalWhen('{sys.battery} < 15', ctx(null))).toBe(false);
    expect(evalWhen('{sys.battery} >= 40', ctx(null))).toBe(true);
    expect(evalWhen('{tmp.z} <> 5', ctx(null))).toBe(true);
  });

  it('boolean literals are TRUE/FALSE uppercase', () => {
    expect(evalWhen('{sys.first_run} = FALSE', ctx(null))).toBe(true);
    expect(evalWhen('{sys.first_run} = TRUE', ctx(null))).toBe(false);
    // lowercase literal is a parse error → fails closed
    expect(evalWhen('{sys.first_run} = false', ctx(null))).toBe(false);
  });

  it('string var compares to string literal (name with space works)', () => {
    expect(evalWhen('{user.fav_color} = blue', ctx(null))).toBe(true);
    expect(evalWhen('{user.fav_color} = red', ctx(null))).toBe(false);
  });

  it('malformed expressions fail closed', () => {
    expect(evalWhen('AND({reply} = a', ctx('a'))).toBe(false); // unclosed
    expect(evalWhen('{cfg.x} = 1', ctx(null))).toBe(false);
    expect(evalWhen('', ctx(null))).toBe(false);
  });

  it('blank var with ordering operator → FALSE', () => {
    expect(evalWhen('{stat.missing} < 3', ctx(null))).toBe(false);
    expect(evalWhen('{stat.missing} > 3', ctx(null))).toBe(false);
  });
});

describe('K7 reply normalization', () => {
  it('lowercases, trims, strips trailing punctuation and quotes', () => {
    expect(normalizeReply('Cat_near.')).toBe('cat_near');
    expect(normalizeReply('"Cat"')).toBe('cat');
    expect(normalizeReply('  YES!  ')).toBe('yes');
    expect(normalizeReply('mèo…')).toBe('mèo');
    expect(normalizeReply('')).toBe('');
  });
});

describe('CT-04 INLIST evaluator vectors', () => {
  const manifestLists = {
    colors: [{ value: 'red' }, { value: 'blue' }],
  };
  const ctxInList = (reply: string | null, customMem?: Partial<MemorySpaces>) => ({
    reply,
    memory: { ...MEM, ...customMem },
    manifestLists,
  });

  it('matches first item in list', () => {
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('red'))).toBe(true);
  });

  it('matches second item in list', () => {
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('blue'))).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('Red'))).toBe(false);
  });

  it('returns false for value outside list', () => {
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('purple'))).toBe(false);
  });

  it('returns false for reserved reply keywords (other/silent/unclear/error)', () => {
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('other'))).toBe(false);
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('silent'))).toBe(false);
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('unclear'))).toBe(false);
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList('error'))).toBe(false);
  });

  it('returns false for empty / null reply', () => {
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList(''))).toBe(false);
    expect(evalWhen('INLIST({reply}, {lists.colors.value})', ctxInList(null))).toBe(false);
  });

  it('returns false and logs warning when list is missing from manifest', () => {
    expect(evalWhen('INLIST({reply}, {lists.animals.value})', ctxInList('red'))).toBe(false);
  });

  it('works with NOT operator', () => {
    expect(evalWhen('NOT(INLIST({reply}, {lists.colors.value}))', ctxInList('purple'))).toBe(true);
    expect(evalWhen('NOT(INLIST({reply}, {lists.colors.value}))', ctxInList('red'))).toBe(false);
  });

  it('works combined with AND operator and memory vars', () => {
    expect(evalWhen('AND(INLIST({reply}, {lists.colors.value}), {sys.plan} = basic)', ctxInList('red'))).toBe(true);
    expect(evalWhen('AND(INLIST({reply}, {lists.colors.value}), {sys.plan} = pro)', ctxInList('red'))).toBe(false);
  });

  it('returns false when memory variable is unset', () => {
    expect(evalWhen('INLIST({user.unset_color}, {lists.colors.value})', ctxInList(null))).toBe(false);
  });

  it('evaluates entire branches table from CT-04 §3 correctly', () => {
    const branches = [
      { when: 'INLIST({reply}, {lists.colors.value})', go: '5_confirm', saveKey: 'user.fav_color' },
      { when: '{reply} = other', go: '5_other_color' },
      { default: '6' },
    ];
    function runBranches(reply: string | null) {
      const c = ctxInList(reply);
      for (const b of branches) {
        if ('when' in b && b.when && evalWhen(b.when, c)) {
          return { target: b.go, saved: b.saveKey ? reply : null };
        }
        if ('default' in b) {
          return { target: b.default, saved: null };
        }
      }
      return null;
    }

    expect(runBranches('red')).toEqual({ target: '5_confirm', saved: 'red' });
    expect(runBranches('blue')).toEqual({ target: '5_confirm', saved: 'blue' });
    expect(runBranches('other')).toEqual({ target: '5_other_color', saved: null });
    expect(runBranches('silent')).toEqual({ target: '6', saved: null });
    expect(runBranches('unclear')).toEqual({ target: '6', saved: null });
    expect(runBranches('error')).toEqual({ target: '6', saved: null });
  });
});
