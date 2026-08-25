import { describe, expect, it } from 'vitest';
import {
  dataCategoriesIn,
  hasUnresolvedToken,
  resolveAccountPlaceholders,
  resolvePlaceholders,
} from './placeholder';

describe('resolvePlaceholders', () => {
  it('returns a token-free string untouched', () => {
    expect(resolvePlaceholders('https://x/a.mp3', {})).toBe('https://x/a.mp3');
  });

  it('substitutes {values.*} from this turn', () => {
    expect(resolvePlaceholders('https://x/{values.mau}.mp3', { values: { mau: 'xanh' } })).toBe(
      'https://x/xanh.mp3',
    );
  });

  it('substitutes {data.*} from the store', () => {
    const out = resolvePlaceholders('https://x/{data.so_thich.mau}.mp3', {
      dataLookup: (category, key) => (category === 'so_thich' && key === 'mau' ? 'do' : null),
    });
    expect(out).toBe('https://x/do.mp3');
  });

  it('substitutes {value} from the branch scalar', () => {
    expect(resolvePlaceholders('{value}.mp3', { branchValue: 'bong' })).toBe('bong.mp3');
  });

  // §8.3: a missing value must vanish silently. Returning null is what makes
  // the caller drop the clip instead of playing an error or saving "{value}".
  describe('the golden rule — unresolved poisons the whole string', () => {
    it('nulls when {value} has no branch scalar', () => {
      expect(resolvePlaceholders('{value}.mp3', {})).toBeNull();
      expect(resolvePlaceholders('{value}.mp3', { branchValue: null })).toBeNull();
    });

    it('nulls when a {values.*} key is missing', () => {
      expect(resolvePlaceholders('{values.mau}.mp3', { values: {} })).toBeNull();
    });

    it('nulls when a {values.*} key is present but empty', () => {
      expect(resolvePlaceholders('{values.mau}.mp3', { values: { mau: '' } })).toBeNull();
    });

    it('nulls when {data.*} has nothing stored', () => {
      expect(
        resolvePlaceholders('{data.c.k}.mp3', { dataLookup: () => null }),
      ).toBeNull();
    });

    it('nulls the whole string when only one of several tokens fails', () => {
      const out = resolvePlaceholders('{values.a}/{values.b}.mp3', { values: { a: 'ok' } });
      expect(out).toBeNull();
    });
  });

  it('resolves several tokens of different kinds at once', () => {
    const out = resolvePlaceholders('{value}/{values.a}/{data.c.k}.mp3', {
      branchValue: 'v',
      values: { a: 'x' },
      dataLookup: () => 'y',
    });
    expect(out).toBe('v/x/y.mp3');
  });
});

describe('dataCategoriesIn', () => {
  it('finds every referenced category', () => {
    expect(dataCategoriesIn('{data.a.k}/{data.b.j}')).toEqual(['a', 'b']);
  });

  it('is empty when there are none', () => {
    expect(dataCategoriesIn('plain.mp3')).toEqual([]);
  });
});

describe('resolveAccountPlaceholders', () => {
  it('fills both account tokens', () => {
    expect(
      resolveAccountPlaceholders('{userPhone}/{voiceID}/a.mp3', {
        phone: '090',
        voiceId: 'v1',
      }),
    ).toBe('090/v1/a.mp3');
  });

  // Unlike the runtime tokens, these are left in place so a missing account is
  // visible in a log rather than becoming a silent null two layers away.
  it('leaves the token when the account lacks the value', () => {
    expect(resolveAccountPlaceholders('{userPhone}/a.mp3', {})).toBe('{userPhone}/a.mp3');
  });
});

describe('hasUnresolvedToken', () => {
  it('spots a leftover token', () => {
    expect(hasUnresolvedToken('https://x/{voiceID}/a.mp3')).toBe(true);
    expect(hasUnresolvedToken('https://x/a.mp3')).toBe(false);
  });
});
