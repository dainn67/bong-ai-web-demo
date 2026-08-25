import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GraphEngine, scalarFor } from './graph-engine';
import { parseGraph } from './lesson-graph';
import { parseNode } from './lesson-node';
import type { GroupPlayer } from './group-player';
import type { LessonMic } from './lesson-mic';
import type { LessonDataStore } from './lesson-api';
import type { ActivityState } from '../screen/activity-state';

// The engine's whole design is "a lesson can always continue". These tests
// exist to pin that down: every failure mode below has a defined way forward,
// and a regression in any of them strands a child at a node forever.

vi.mock('./lesson-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lesson-api')>();
  return {
    ...actual,
    checkAnswer: vi.fn(),
    classifyAnswer: vi.fn(),
    saveProgress: vi.fn(async () => undefined),
  };
});

const api = await import('./lesson-api');
const checkAnswer = vi.mocked(api.checkAnswer);
const classifyAnswer = vi.mocked(api.classifyAnswer);

/** Records which clips were played, in order, and reports a winner. */
function fakePlayer() {
  const played: string[][] = [];
  const missing = new Set<string>();
  const player = {
    played,
    missing,
    preload: vi.fn(async () => undefined),
    has: (url: string) => !missing.has(url),
    playGroup: vi.fn(async (specs: { url: string; hasNext: boolean }[]) => {
      played.push(specs.map((s) => s.url));
      // Winner: last spec that has a `next`, matching the real rule closely
      // enough for routing (the real one uses finish times).
      let winner = -1;
      specs.forEach((s, i) => {
        if (s.hasNext) winner = i;
      });
      return { winner, aborted: false };
    }),
    stop: vi.fn(),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    setVolume: vi.fn(),
    get paused() {
      return false;
    },
  };
  return player as unknown as GroupPlayer & typeof player;
}

function fakeMic(answers: { text: string | null; speechDetected: boolean }[]) {
  let i = 0;
  return {
    hasPermission: vi.fn(async () => true),
    listen: vi.fn(async () => ({
      ...(answers[Math.min(i++, answers.length - 1)] ?? {
        text: null,
        speechDetected: false,
      }),
      failed: false,
    })),
    cancel: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as LessonMic;
}

function fakeData(values: Record<string, Record<string, string>> = {}, categories?: Record<string, string[]>) {
  const saved: string[] = [];
  const store = {
    saved,
    preload: vi.fn(async () => undefined),
    preloadCategories: vi.fn(async () => undefined),
    value: (category: string, key: string) => values[category]?.[key],
    categoryValues: (name: string) => categories?.[name],
    save: vi.fn(async (category: string, key: string, value: string) => {
      (values[category] ??= {})[key] = value;
      saved.push(`${category}[${key}]=${value}`);
    }),
  };
  return store as unknown as LessonDataStore & typeof store;
}

/** Builds an engine over a raw node list and runs it to completion. */
async function run(
  nodes: unknown[],
  options: {
    mic?: LessonMic;
    data?: ReturnType<typeof fakeData>;
    player?: ReturnType<typeof fakePlayer>;
  } = {},
) {
  const graph = parseGraph({ page: 'test', nodes }, {});
  const player = options.player ?? fakePlayer();
  const data = options.data ?? fakeData();
  const patches: Partial<ActivityState>[] = [];

  const engine = new GraphEngine(
    { graph, player, mic: options.mic ?? fakeMic([]), data, lessonId: 'L_TEST', trackProgress: false },
    { onActivity: (patch) => patches.push(patch) },
  );
  await engine.start();

  return {
    engine,
    player,
    data,
    patches,
    /** Flattened list of clip URLs played, in order. */
    urls: player.played.flat(),
    phases: patches.map((p) => p.phase).filter(Boolean),
    finished: patches.some((p) => p.phase === 'finished'),
    errored: patches.some((p) => p.phase === 'error'),
  };
}

const narration = (order: string, next: string | null, audio = `${order}.mp3`) => ({
  order,
  type: 'dẫn truyện',
  audio,
  next,
});

beforeEach(() => {
  vi.clearAllMocks();
  checkAnswer.mockResolvedValue({ result: 'correct', reason: null });
  classifyAnswer.mockResolvedValue({ branch: 'match', values: null, confidence: 1 });
});

afterEach(() => vi.restoreAllMocks());

describe('narration flow', () => {
  it('walks next until a node has nowhere to go', async () => {
    const { urls, finished } = await run([
      narration('1', '2'),
      narration('2', '3'),
      narration('3', null),
    ]);
    expect(urls).toEqual(['1.mp3', '2.mp3', '3.mp3']);
    expect(finished).toBe(true);
  });

  // Same order = a concurrent group: music under narration, played together.
  it('plays every clip sharing an order as one group', async () => {
    const { player } = await run([
      { order: '1', type: 'dẫn truyện', audio: 'voice.mp3', next: '2' },
      { order: '1', type: 'dẫn truyện', audio: 'music.mp3' },
      narration('2', null),
    ]);
    expect(player.played[0]).toEqual(['voice.mp3', 'music.mp3']);
  });

  // A real lesson is ~140 clips and ~25MB. Blocking playback on the whole
  // warm-up left a child watching a counter for ten seconds before the first
  // word, so the engine has to start while it is still downloading.
  it('starts playing without waiting for the clip warm-up', async () => {
    const player = fakePlayer();
    // Never resolves: if the engine awaits this, the test hangs.
    player.preload = vi.fn(() => new Promise<undefined>(() => {}));

    const { urls, finished } = await run([narration('1', '2'), narration('2', null)], { player });
    expect(urls).toEqual(['1.mp3', '2.mp3']);
    expect(finished).toBe(true);
  });

  it('finishes silently on an empty graph, without an error screen', async () => {
    const { finished, errored } = await run([]);
    expect(finished).toBe(true);
    expect(errored).toBe(false);
  });

  // An authored cycle must not spin forever.
  it('stops at the node cap when the graph loops', async () => {
    const { urls, finished } = await run([narration('1', '2'), narration('2', '1')]);
    expect(finished).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(501);
    expect(urls.length).toBeGreaterThan(100);
  });

  it('falls through to the next listed node when next is missing', async () => {
    const { urls } = await run([narration('1', 'nowhere'), narration('2', null)]);
    // `next` points nowhere, so the lesson ends rather than guessing.
    expect(urls).toEqual(['1.mp3']);
  });
});

describe('câu hỏi 1 — decided locally', () => {
  const nodes = [
    {
      order: '1',
      type: 'câu hỏi 1',
      audio: 'q.mp3',
      branches: [
        { branchType: 'có phản hồi', order: '1.a', audio: 'yes.mp3' },
        { branchType: 'phản hồi im lặng', order: '1.b', audio: 'quiet.mp3' },
      ],
    },
  ];

  it('takes the responded branch when the child speaks', async () => {
    const { urls } = await run(nodes, { mic: fakeMic([{ text: 'hello', speechDetected: true }]) });
    expect(urls).toEqual(['q.mp3', 'yes.mp3']);
    expect(checkAnswer).not.toHaveBeenCalled();
  });

  it('takes the silent branch when they do not', async () => {
    const { urls } = await run(nodes, { mic: fakeMic([{ text: null, speechDetected: false }]) });
    expect(urls).toEqual(['q.mp3', 'quiet.mp3']);
  });

  // Correctness is irrelevant for this type — it only asks whether they spoke.
  it('never calls the grader', async () => {
    await run(nodes, { mic: fakeMic([{ text: 'totally wrong', speechDetected: true }]) });
    expect(checkAnswer).not.toHaveBeenCalled();
  });
});

describe('câu hỏi 2 — graded', () => {
  const nodes = [
    {
      order: '1',
      type: 'câu hỏi 2',
      audio: 'q.mp3',
      branches: [
        { branchType: 'phản hồi đúng', order: '1.a', audio: 'right.mp3' },
        { branchType: 'phản hồi sai', order: '1.b', audio: 'wrong.mp3' },
        { branchType: 'phản hồi im lặng', order: '1.c', audio: 'quiet.mp3' },
      ],
    },
  ];

  it('plays the branch the grader chose', async () => {
    checkAnswer.mockResolvedValue({ result: 'correct', reason: 'Giỏi quá!' });
    const { urls, patches } = await run(nodes, {
      mic: fakeMic([{ text: 'dog', speechDetected: true }]),
    });
    expect(urls).toEqual(['q.mp3', 'right.mp3']);
    expect(patches.some((p) => p.notice === 'Giỏi quá!')).toBe(true);
  });

  // Silence short-circuits before the round trip.
  it('does not call the grader when nothing was said', async () => {
    const { urls } = await run(nodes, { mic: fakeMic([{ text: null, speechDetected: false }]) });
    expect(checkAnswer).not.toHaveBeenCalled();
    expect(urls).toEqual(['q.mp3', 'quiet.mp3']);
  });

  // An unreachable grader must not stall the lesson.
  it('treats a grader failure as wrong and carries on', async () => {
    checkAnswer.mockRejectedValue(new Error('502'));
    const { urls, errored } = await run(nodes, {
      mic: fakeMic([{ text: 'dog', speechDetected: true }]),
    });
    expect(urls).toEqual(['q.mp3', 'wrong.mp3']);
    expect(errored).toBe(false);
  });

  // No branch for the outcome: advance rather than substituting a different
  // one. Playing "sai" at a child who was merely quiet is worse than nothing.
  it('advances past a question with no branch for the outcome', async () => {
    const { urls, finished } = await run(
      [
        {
          order: '1',
          type: 'câu hỏi 2',
          audio: 'q.mp3',
          next: '2',
          branches: [{ branchType: 'phản hồi đúng', order: '1.a', audio: 'right.mp3' }],
        },
        narration('2', null),
      ],
      { mic: fakeMic([{ text: null, speechDetected: false }]) },
    );
    expect(urls).toEqual(['q.mp3', '2.mp3']);
    expect(finished).toBe(true);
  });
});

describe('câu hỏi 3 — the classifier', () => {
  const nodes = (extra: Record<string, unknown> = {}) => [
    {
      order: '1',
      type: 'câu hỏi 3',
      audio: 'q.mp3',
      brain: { instruction: 'phân loại', branches: [{ name: 'match', desc: '' }] },
      branches: [
        { branchType: 'match', order: '1.a', audio: 'match.mp3' },
        { branchType: 'other', order: '1.b', audio: 'other.mp3' },
        { branchType: 'silent', order: '1.c', audio: 'quiet.mp3' },
      ],
      ...extra,
    },
  ];

  it('enters the branch the classifier picked', async () => {
    const { urls } = await run(nodes(), { mic: fakeMic([{ text: 'xanh', speechDetected: true }]) });
    expect(urls).toEqual(['q.mp3', 'match.mp3']);
  });

  it('falls to the safe default below the confidence threshold', async () => {
    classifyAnswer.mockResolvedValue({ branch: 'match', values: null, confidence: 0.5 });
    const { urls } = await run(nodes(), { mic: fakeMic([{ text: 'mmm', speechDetected: true }]) });
    expect(urls).toEqual(['q.mp3', 'other.mp3']);
  });

  it('falls to the safe default for a branch name that does not exist', async () => {
    classifyAnswer.mockResolvedValue({ branch: 'invented', values: null, confidence: 1 });
    const { urls } = await run(nodes(), { mic: fakeMic([{ text: 'x', speechDetected: true }]) });
    expect(urls).toEqual(['q.mp3', 'other.mp3']);
  });

  it('routes a classifier failure to silent', async () => {
    classifyAnswer.mockRejectedValue(new Error('timeout'));
    const { urls, errored } = await run(nodes(), {
      mic: fakeMic([{ text: 'x', speechDetected: true }]),
    });
    expect(urls).toEqual(['q.mp3', 'quiet.mp3']);
    expect(errored).toBe(false);
  });

  it('decides silence locally, with no classifier call', async () => {
    const { urls } = await run(nodes(), { mic: fakeMic([{ text: null, speechDetected: false }]) });
    expect(classifyAnswer).not.toHaveBeenCalled();
    expect(urls).toEqual(['q.mp3', 'quiet.mp3']);
  });
});

describe('placeholders and saved values', () => {
  it('drops a clip whose placeholder cannot be resolved, and keeps going', async () => {
    const { urls, finished } = await run([
      { order: '1', type: 'dẫn truyện', audio: '{data.missing.key}.mp3', next: '2' },
      narration('2', null),
    ]);
    expect(urls).toEqual(['2.mp3']);
    expect(finished).toBe(true);
  });

  it('resolves {data.*} from the store', async () => {
    const data = fakeData({ so_thich: { mau: 'xanh' } });
    const { urls } = await run(
      [{ order: '1', type: 'dẫn truyện', audio: '{data.so_thich.mau}.mp3', next: null }],
      { data },
    );
    expect(urls).toEqual(['xanh.mp3']);
  });

  // Persisting the literal "{value}" is what broke read-back in the app.
  it('skips a save whose value cannot be resolved', async () => {
    const data = fakeData();
    await run(
      [
        {
          order: '1',
          type: 'câu hỏi 3',
          audio: 'q.mp3',
          brain: { instruction: 'x', branches: [{ name: 'match', desc: '' }] },
          branches: [
            {
              branchType: 'match',
              order: '1.a',
              audio: 'a.mp3',
              save: { category: 'c', key: 'k', value: '{value}' },
            },
          ],
        },
      ],
      { mic: fakeMic([{ text: 'x', speechDetected: true }]), data },
    );
    expect(data.saved).toEqual([]);
  });

  it('saves an extracted value and substitutes it into the branch clip', async () => {
    classifyAnswer.mockResolvedValue({
      branch: 'match',
      values: { id: 'xanh' },
      confidence: 1,
    });
    const data = fakeData();
    const { urls } = await run(
      [
        {
          order: '1',
          type: 'câu hỏi 3',
          audio: 'q.mp3',
          brain: { instruction: 'x', values_from: 'mau_sac', branches: [{ name: 'match', desc: '' }] },
          branches: [
            {
              branchType: 'match',
              order: '1.a',
              audio: '{value}.mp3',
              save: { category: 'so_thich', key: 'mau', value: '{value}' },
            },
          ],
        },
      ],
      { mic: fakeMic([{ text: 'xanh', speechDetected: true }]), data },
    );
    expect(urls).toEqual(['q.mp3', 'xanh.mp3']);
    expect(data.saved).toEqual(['so_thich[mau]=xanh']);
  });

  // `{value}` belongs to exactly one group. A later node using the token must
  // not silently inherit the previous branch's value.
  it('clears {value} after the branch group that owns it', async () => {
    classifyAnswer.mockResolvedValue({ branch: 'match', values: { id: 'xanh' }, confidence: 1 });
    const { urls } = await run(
      [
        {
          order: '1',
          type: 'câu hỏi 3',
          audio: 'q.mp3',
          brain: { instruction: 'x', branches: [{ name: 'match', desc: '' }] },
          branches: [{ branchType: 'match', order: '1.a', audio: '{value}.mp3', next: '2' }],
        },
        { order: '2', type: 'dẫn truyện', audio: 'leak-{value}.mp3', next: null },
      ],
      { mic: fakeMic([{ text: 'xanh', speechDetected: true }]) },
    );
    expect(urls).toEqual(['q.mp3', 'xanh.mp3']);
  });
});

describe('read nodes', () => {
  const readNode = (extra: Record<string, unknown> = {}) => ({
    order: '1',
    type: 'đọc giá trị đã lưu',
    audio: '',
    recall: { category: 'so_thich', key: 'mau', ...extra },
    branches: [
      { branchType: 'chua_co', order: '1.a', audio: 'none.mp3' },
      { branchType: 'match', order: '1.b', audio: 'match.mp3' },
      { branchType: 'not_in_list', order: '1.c', audio: 'unknown.mp3' },
      { branchType: 'other', order: '1.d', audio: 'other.mp3' },
    ],
  });

  it('takes chua_co when nothing is stored', async () => {
    const { urls } = await run([readNode()], { data: fakeData() });
    expect(urls).toEqual(['none.mp3']);
  });

  it('matches a value that is in the shared list', async () => {
    const { urls } = await run([readNode({ values_from: 'mau_sac' })], {
      data: fakeData({ so_thich: { mau: 'xanh' } }, { mau_sac: ['xanh', 'do'] }),
    });
    expect(urls).toEqual(['match.mp3']);
  });

  it('takes not_in_list for a value outside it', async () => {
    const { urls } = await run([readNode({ values_from: 'mau_sac' })], {
      data: fakeData({ so_thich: { mau: 'tím' } }, { mau_sac: ['xanh', 'do'] }),
    });
    expect(urls).toEqual(['unknown.mp3']);
  });

  // Cannot tell match from not_in_list without the list, so skip rather than
  // route every child down the wrong branch on a transient fetch failure.
  it('skips the node when the shared list is unavailable', async () => {
    const { urls, finished } = await run([readNode({ values_from: 'mau_sac' })], {
      data: fakeData({ so_thich: { mau: 'xanh' } }, undefined),
    });
    expect(urls).toEqual([]);
    expect(finished).toBe(true);
  });
});

describe('scalarFor', () => {
  const node = parseNode(
    { order: '1', type: 'câu hỏi 3', brain: { instruction: 'x', values_from: 'mau_sac' } },
    {},
  )!;

  it('prefers the canonical id', () => {
    expect(scalarFor(node, { id: 'bong', label: 'Bống' })).toBe('bong');
  });

  it('falls back to the values_from key', () => {
    expect(scalarFor(node, { mau_sac: 'xanh' })).toBe('xanh');
  });

  it('falls back to a sole extracted value', () => {
    expect(scalarFor(node, { whatever: 'x' })).toBe('x');
  });

  it('is null when nothing usable was extracted', () => {
    expect(scalarFor(node, null)).toBeNull();
    expect(scalarFor(node, {})).toBeNull();
    expect(scalarFor(node, { id: '  ' })).toBeNull();
  });
});

describe('microphone permission', () => {
  // The one genuine error state in the whole engine.
  it('is the only failure that shows an error screen', async () => {
    const mic = {
      hasPermission: vi.fn(async () => false),
      listen: vi.fn(),
      cancel: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    } as unknown as LessonMic;

    const { errored, patches } = await run(
      [{ order: '1', type: 'câu hỏi 1', audio: 'q.mp3', branches: [{ branchType: 'có phản hồi', order: '1.a' }] }],
      { mic },
    );
    expect(errored).toBe(true);
    expect(patches.some((p) => p.error?.includes('micro'))).toBe(true);
  });
});
