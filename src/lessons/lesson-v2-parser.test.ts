import { describe, expect, it } from 'vitest';
import {
  allV2AudioUrls,
  isLessonV2,
  parseLessonV2,
  referencedV2DataCategories,
} from './lesson-v2-parser';

const CONTEXT = { phone: '0901234567', voiceId: 'bong_standard' };

describe('lesson-v2-parser', () => {
  it('decides the format on version alone (§8)', () => {
    expect(isLessonV2(null)).toBe(false);
    expect(isLessonV2({})).toBe(false);
    expect(isLessonV2({ nodes: [] })).toBe(false);
    expect(isLessonV2({ version: 2, indexes: [] })).toBe(true);
    // Says 2, so it is a version 2 file — a broken one, not a version 1 one.
    // Reading it under the old rules would play something subtly wrong.
    expect(isLessonV2({ version: 2 })).toBe(true);
    expect(parseLessonV2({ version: 2 }, CONTEXT)).toBeNull();
  });

  it('rejects an unknown touch layout instead of substituting tap4', () => {
    const parsed = parseLessonV2(
      {
        version: 2,
        indexes: [
          {
            order: '1',
            audio: [
              {
                fileName: 'Q',
                url: 'https://cdn.example.com/Q.mp3',
                type: 'câu hỏi chạm',
                touch: { layout: 'tap7' },
              },
            ],
          },
        ],
      },
      CONTEXT,
    );

    expect(parsed!.indexes[0].audio[0].touch).toBeUndefined();
    expect(parsed!.warnings.some((w) => w.includes('tap7'))).toBe(true);
  });

  it('defaults a missing timeout and a missing stop', () => {
    const parsed = parseLessonV2(
      {
        version: 2,
        indexes: [
          {
            order: '1',
            audio: [
              {
                fileName: 'Q',
                url: 'https://cdn.example.com/Q.mp3',
                type: 'câu hỏi chạm',
                touch: { layout: 'tap4' },
              },
            ],
            visual: [{ fileName: 'IMG', url: 'https://cdn.example.com/IMG.png' }],
          },
        ],
      },
      CONTEXT,
    );

    expect(parsed!.indexes[0].audio[0].touch?.timeoutMs).toBe(10_000);
    // `giu` rather than `tat`: §4.3 makes avoiding a needless black flash a
    // requirement, so an authoring omission must not manufacture one.
    expect(parsed!.indexes[0].visual[0].stop).toBe('giu');
  });

  it('flags a recall that the engine will never read', () => {
    const parsed = parseLessonV2(
      {
        version: 2,
        indexes: [{ order: '1', recall: { category: 'user', key: 'mau' } }],
      },
      CONTEXT,
    );

    expect(parsed!.warnings.some((w) => w.includes('recall'))).toBe(true);
  });

  it('parses structured indexes with audio, visual and branches', () => {
    const raw = {
      version: 2,
      page: 'Unit-01-Day-03',
      indexes: [
        {
          order: '12',
          audio: [
            {
              fileName: 'B3_12',
              nodeType: 'voice',
              url: 'https://cdn.example.com/OT2/{voiceID}/B3_12.mp3',
              waitMs: 0,
              durationMs: 'full',
              repeat: 1,
              volume: 80,
            },
            {
              fileName: 'B3_13',
              nodeType: 'voice',
              url: 'https://cdn.example.com/OT2/{voiceID}/B3_13.mp3',
              waitMs: 800,
              durationMs: 'full',
              repeat: 1,
              volume: 80,
            },
          ],
          visual: [
            {
              fileName: 'IMG_hang_toi',
              nodeType: 'image',
              url: 'https://cdn.example.com/OT1/IMG_hang_toi.png',
              waitMs: 0,
              durationMs: 'full',
              repeat: 1,
              stop: 'giu',
            },
          ],
          next: '13',
        },
        {
          order: '30',
          audio: [
            {
              fileName: 'B3_30',
              nodeType: 'voice',
              url: 'https://cdn.example.com/B3_30.mp3',
              waitMs: 0,
              type: 'câu hỏi chạm',
              touch: { layout: 'tap4', timeoutMs: 10000 },
            },
          ],
          visual: [
            {
              fileName: 'IMG_4convat',
              nodeType: 'image',
              url: 'https://cdn.example.com/IMG_4convat.png',
              waitMs: 0,
              stop: 'giu',
            },
          ],
          branches: [
            {
              order: '30.1',
              branchType: 'zone1',
              audio: [{ fileName: 'B3_30_1', url: 'https://cdn.example.com/B3_30_1.mp3' }],
              visual: [{ fileName: 'GIF_dung', url: 'https://cdn.example.com/GIF_dung.gif', repeat: 'loop', stop: 'giu' }],
              save: { category: 'user', key: 'tu_moi', value: 'cat' },
              next: '31',
            },
            {
              order: '30.2',
              branchType: 'cham_khac',
              audio: [{ fileName: 'B3_30_2', url: 'https://cdn.example.com/B3_30_2.mp3' }],
              visual: [],
              next: '31',
            },
          ],
        },
      ],
    };

    const parsed = parseLessonV2(raw, CONTEXT);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(2);
    expect(parsed!.page).toBe('Unit-01-Day-03');
    expect(parsed!.indexes).toHaveLength(2);

    // Index 12
    const idx12 = parsed!.byOrder.get('12');
    expect(idx12).toBeDefined();
    expect(idx12!.audio).toHaveLength(2);
    expect(idx12!.audio[0].url).toBe('https://cdn.example.com/OT2/bong_standard/B3_12.mp3');
    expect(idx12!.audio[1].waitMs).toBe(800);
    expect(idx12!.visual).toHaveLength(1);
    expect(idx12!.visual[0].stop).toBe('giu');
    expect(idx12!.next).toBe('13');

    // Index 30 (Touch Question)
    const idx30 = parsed!.byOrder.get('30');
    expect(idx30).toBeDefined();
    expect(idx30!.audio[0].type).toBe('câu hỏi chạm');
    expect(idx30!.audio[0].touch?.layout).toBe('tap4');
    expect(idx30!.branches).toHaveLength(2);
    expect(idx30!.branches![0].branchType).toBe('zone1');
    expect(idx30!.branches![0].visual[0].repeat).toBe('loop');
    expect(idx30!.branches![0].save?.value).toBe('cat');

    // Branches are addressable too: nothing stops a `next` pointing at one, and
    // an unresolvable `next` would end the lesson where it stood.
    expect(parsed!.byOrder.get('30.1')).toBe(idx30!.branches![0]);

    // Everything the player and the data store need, branches included.
    expect(allV2AudioUrls(parsed!)).toContain('https://cdn.example.com/B3_30_1.mp3');
    expect(referencedV2DataCategories(parsed!)).toEqual(['user']);
  });
});
