import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog-client';

/**
 * The real response, trimmed to two rows per category.
 *
 * Copied from `GET https://bong-api.bcserver.xyz/api/v1/lessions` rather than
 * invented, because the two things this parser can get wrong — the `{success,
 * data}` envelope and cover paths being relative to `config.base_url` — are
 * both only visible in the genuine shape.
 */
const RESPONSE = {
  success: true,
  code: null,
  message: null,
  data: {
    config: {
      version: '1.0.0',
      language: 'vi',
      base_url: 'https://static-bongai.bcserver.xyz',
    },
    stories: [
      {
        id: 'S_001',
        title: 'Rùa và Thỏ',
        description: 'Truyện ngụ ngôn La Phông Ten',
        cover_url: 'lessions/S_001/cover.png',
        data_url: 'lessions/S_001',
      },
    ],
    learning: [
      {
        id: 'L_001',
        title: 'Lời chào',
        description: 'Học các từ tiếng anh Good Morning, Hello, Hi, Goodbye',
        cover_url: 'lessions/L_001/cover.png',
        data_url: 'lessions/L_001',
      },
    ],
  },
};

describe('parseCatalog', () => {
  it('reads both categories out of the envelope', () => {
    const rows = parseCatalog(RESPONSE);

    expect(rows.map((r) => [r.id, r.category])).toEqual([
      ['S_001', 'stories'],
      ['L_001', 'learning'],
    ]);
    expect(rows[1].title).toBe('Lời chào');
  });

  it('resolves cover paths against the catalog’s own base_url', () => {
    const [story] = parseCatalog(RESPONSE);
    expect(story.coverUrl).toBe('https://static-bongai.bcserver.xyz/lessions/S_001/cover.png');
  });

  it('leaves an already-absolute cover alone', () => {
    const rows = parseCatalog({
      ...RESPONSE,
      data: {
        ...RESPONSE.data,
        stories: [{ ...RESPONSE.data.stories[0], cover_url: 'https://cdn.example/a.png' }],
        learning: [],
      },
    });
    expect(rows[0].coverUrl).toBe('https://cdn.example/a.png');
  });

  it('accepts the bare payload as well as the envelope', () => {
    // Not hypothetical: the same shape is served straight off the CDN as
    // `lessions.json`, without a `{success, data}` wrapper around it.
    expect(parseCatalog(RESPONSE.data)).toHaveLength(2);
  });

  /**
   * A hand-edited catalog is exactly the kind of thing that has one bad row in
   * it. Losing that row is fine; refusing to open the menu is not.
   */
  it('drops unusable rows without losing the good ones', () => {
    const rows = parseCatalog({
      data: {
        config: RESPONSE.data.config,
        learning: [
          { id: 'L_001', title: 'Lời chào' },
          { id: 'L_002' }, // no title — nothing to say out loud
          { title: 'Không có id' },
          'not an object',
          null,
        ],
      },
    });
    expect(rows.map((r) => r.id)).toEqual(['L_001']);
  });

  it('prefers lesson_id when a row carries both spellings', () => {
    const rows = parseCatalog({
      data: { learning: [{ lesson_id: 'L_009', id: 'row-42', title: 'X' }] },
    });
    expect(rows[0].id).toBe('L_009');
  });

  it('returns an empty list for anything it cannot read', () => {
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog('nope')).toEqual([]);
    expect(parseCatalog({ data: { learning: 'not an array' } })).toEqual([]);
  });

  it('yields no cover rather than a broken one when base_url is missing', () => {
    const rows = parseCatalog({
      data: { learning: [{ id: 'L_001', title: 'X', cover_url: 'lessions/L_001/cover.png' }] },
    });
    expect(rows[0].coverUrl).toBeNull();
  });
});
