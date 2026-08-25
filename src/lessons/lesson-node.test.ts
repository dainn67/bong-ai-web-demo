import { describe, expect, it } from 'vitest';
import {
  branchByName,
  branchTypeFromVi,
  branchesByName,
  isBrain,
  isGraded,
  isQuestion,
  isRead,
  lessonVoiceFromVi,
  nodeTypeFromVi,
  parseNode,
} from './lesson-node';
import { normalizeVietnamese } from './vietnamese';

describe('normalizeVietnamese', () => {
  it('strips tone marks and lowercases', () => {
    expect(normalizeVietnamese('Câu Hỏi')).toBe('cau hoi');
    expect(normalizeVietnamese('phản hồi đúng')).toBe('phan hoi dung');
  });

  // đ is a separate letter, not a d with a mark, so NFD alone leaves it.
  it('folds đ to d', () => {
    expect(normalizeVietnamese('đọc giá trị đã lưu')).toBe('doc gia tri da luu');
  });
});

describe('nodeTypeFromVi', () => {
  it('reads the four node types', () => {
    expect(nodeTypeFromVi('dẫn truyện')).toBe('narration');
    expect(nodeTypeFromVi('câu hỏi 1')).toBe('questionAny');
    expect(nodeTypeFromVi('câu hỏi 2')).toBe('questionGraded');
    expect(nodeTypeFromVi('câu hỏi 3')).toBe('questionBrain');
    expect(nodeTypeFromVi('đọc giá trị đã lưu')).toBe('read');
  });

  it('treats anything without "câu hỏi" as narration', () => {
    expect(nodeTypeFromVi('hát')).toBe('narration');
    expect(nodeTypeFromVi('')).toBe('narration');
    expect(nodeTypeFromVi(null)).toBe('narration');
  });

  // Back-compat with older content that wrote a bare label.
  it('falls back to câu hỏi 2 for an undigited question', () => {
    expect(nodeTypeFromVi('câu hỏi')).toBe('questionGraded');
  });

  // Documented quirk, deliberately preserved: the digit test is a substring
  // match, so a two-digit label reads as its first digit. Kept identical to the
  // app so a content bug reproduces in both places rather than only on the phone.
  it('matches the app quirk where "câu hỏi 13" reads as câu hỏi 1', () => {
    expect(nodeTypeFromVi('câu hỏi 13')).toBe('questionAny');
  });
});

describe('branchTypeFromVi', () => {
  // The graded labels all contain "phản hồi" too, so the specific words must be
  // tested first. This ordering is the bug most likely to be reintroduced.
  it('prefers the specific outcome over the generic "phản hồi"', () => {
    expect(branchTypeFromVi('phản hồi đúng')).toBe('correct');
    expect(branchTypeFromVi('phản hồi sai')).toBe('wrong');
    expect(branchTypeFromVi('phản hồi im lặng')).toBe('silent');
    expect(branchTypeFromVi('có phản hồi')).toBe('responded');
  });

  it('returns null for an unrecognised label', () => {
    expect(branchTypeFromVi('nhánh lạ')).toBeNull();
    expect(branchTypeFromVi(null)).toBeNull();
  });
});

describe('lessonVoiceFromVi', () => {
  it('maps the three voices', () => {
    expect(lessonVoiceFromVi('cô giáo')).toBe('teacher');
    expect(lessonVoiceFromVi('bống')).toBe('bong');
    expect(lessonVoiceFromVi('bài hát')).toBe('song');
    expect(lessonVoiceFromVi('???')).toBe('unknown');
  });
});

describe('parseNode', () => {
  const context = { phone: '0900000001', voiceId: 'voice-abc', bongVolume: 60 };

  it('fills the account placeholders in the audio URL', () => {
    const node = parseNode(
      { order: '1', type: 'dẫn truyện', audio: 'https://x/{userPhone}/{voiceID}/a.mp3' },
      context,
    )!;
    expect(node.audioUrl).toBe('https://x/0900000001/voice-abc/a.mp3');
  });

  it('leaves placeholders alone when there is no account', () => {
    const node = parseNode({ order: '1', audio: 'https://x/{userPhone}/a.mp3' }, {})!;
    expect(node.audioUrl).toBe('https://x/{userPhone}/a.mp3');
  });

  describe('volume', () => {
    it('scales 0–100 to 0–1', () => {
      expect(parseNode({ order: '1', volume: 40 }, context)!.volume).toBeCloseTo(0.4);
    });

    it('resolves {bongVolume} to the parent setting', () => {
      expect(parseNode({ order: '1', volume: '{bongVolume}' }, context)!.volume).toBeCloseTo(0.6);
    });

    it('plays full when absent or unparseable', () => {
      expect(parseNode({ order: '1' }, context)!.volume).toBe(1);
      expect(parseNode({ order: '1', volume: 'loud' }, context)!.volume).toBe(1);
    });

    it('clamps out-of-range values', () => {
      expect(parseNode({ order: '1', volume: 500 }, context)!.volume).toBe(1);
      expect(parseNode({ order: '1', volume: -20 }, context)!.volume).toBe(0);
    });
  });

  describe('timing fields', () => {
    it('reads numbers and numeric strings', () => {
      const node = parseNode(
        { order: '1', delayMs: 250, durationMs: '3000', startTime: 500, fadeIn: 100, fadeOut: 200 },
        context,
      )!;
      expect(node.delayMs).toBe(250);
      expect(node.maxDurationMs).toBe(3000);
      expect(node.startOffsetMs).toBe(500);
      expect(node.fadeInMs).toBe(100);
      expect(node.fadeOutMs).toBe(200);
    });

    // "full" means play the whole clip, which is null (no cap), not zero.
    it('reads "full" as no cap', () => {
      expect(parseNode({ order: '1', durationMs: 'full' }, context)!.maxDurationMs).toBeNull();
    });

    it('defaults the offsets to zero', () => {
      const node = parseNode({ order: '1' }, context)!;
      expect(node.delayMs).toBe(0);
      expect(node.startOffsetMs).toBe(0);
      expect(node.maxDurationMs).toBeNull();
    });
  });

  describe('branch keys', () => {
    it('normalises câu hỏi 1/2 branches to canonical names', () => {
      const node = parseNode(
        {
          order: '5',
          type: 'câu hỏi 2',
          branches: [
            { branchType: 'phản hồi đúng', order: '5.1', audio: 'a.mp3' },
            { branchType: 'phản hồi sai', order: '5.2', audio: 'b.mp3' },
          ],
        },
        context,
      )!;
      expect(Object.keys(node.branches).sort()).toEqual(['correct', 'wrong']);
      expect(branchByName(node, 'correct')?.order).toBe('5.1');
    });

    // A brain or recall block flips the keying to the author's raw token.
    it('keeps raw tokens for câu hỏi 3', () => {
      const node = parseNode(
        {
          order: '7',
          type: 'câu hỏi 3',
          brain: { instruction: 'phân loại', branches: [{ name: 'match', desc: '' }] },
          branches: [
            { branchType: 'match', order: '7.1' },
            { branchType: 'other', order: '7.2' },
          ],
        },
        context,
      )!;
      expect(Object.keys(node.branches).sort()).toEqual(['match', 'other']);
    });

    it('keeps raw tokens for a read node', () => {
      const node = parseNode(
        {
          order: '8',
          type: 'đọc giá trị đã lưu',
          recall: { category: 'so_thich_mau', key: 'mau' },
          branches: [{ branchType: 'chua_co', order: '8.1' }],
        },
        context,
      )!;
      expect(branchByName(node, 'chua_co')?.order).toBe('8.1');
    });

    // An unrecognised label yields no key, so the branch is dropped at parse
    // time rather than becoming an unreachable entry nobody notices.
    it('drops a branch whose label maps to nothing', () => {
      const node = parseNode(
        { order: '5', type: 'câu hỏi 2', branches: [{ branchType: 'hmm', order: '5.9' }] },
        context,
      )!;
      expect(node.branches).toEqual({});
    });

    it('keeps several branches under one key, in authored order', () => {
      const node = parseNode(
        {
          order: '5',
          type: 'câu hỏi 2',
          branches: [
            { branchType: 'phản hồi đúng', order: '5.1' },
            { branchType: 'phản hồi đúng', order: '5.2' },
          ],
        },
        context,
      )!;
      expect(branchesByName(node, 'correct').map((n) => n.order)).toEqual(['5.1', '5.2']);
    });
  });

  it('parses the brain block', () => {
    const node = parseNode(
      {
        order: '7',
        type: 'câu hỏi 3',
        brain: {
          instruction: 'phân loại màu',
          values_from: 'mau_sac',
          branches: [{ name: 'match', desc: 'nói một màu', extract: ['mau'] }],
        },
      },
      context,
    )!;
    expect(node.brain?.valuesFrom).toBe('mau_sac');
    expect(node.brain?.branches[0].extract).toEqual(['mau']);
  });

  it('drops a save or recall missing its category or key', () => {
    const node = parseNode(
      { order: '1', save: { category: '', key: 'k', value: 'v' }, recall: { category: 'c' } },
      context,
    )!;
    expect(node.save).toBeNull();
    expect(node.recall).toBeNull();
  });

  it('classifies node predicates', () => {
    const narration = parseNode({ order: '1', type: 'dẫn truyện' }, context)!;
    const any = parseNode({ order: '2', type: 'câu hỏi 1' }, context)!;
    const graded = parseNode({ order: '3', type: 'câu hỏi 2' }, context)!;
    const brain = parseNode({ order: '4', type: 'câu hỏi 3' }, context)!;
    const read = parseNode({ order: '5', type: 'đọc giá trị đã lưu' }, context)!;

    expect([narration, any, graded, brain, read].map(isQuestion)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(isGraded(graded)).toBe(true);
    expect(isBrain(brain)).toBe(true);
    expect(isRead(read)).toBe(true);
  });

  it('returns null for junk', () => {
    expect(parseNode(null, context)).toBeNull();
    expect(parseNode('nope', context)).toBeNull();
  });
});
