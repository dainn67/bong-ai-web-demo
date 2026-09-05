import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V2Engine } from './v2-engine';
import { LessonDataStore } from './lesson-api';
import type {
  LessonV2AudioNode,
  LessonV2Graph,
  LessonV2Index,
  LessonV2VisualNode,
} from './lesson-v2-types';
import type { ActivityState } from '../screen/activity-state';

/**
 * The acceptance list in §9 of `Bong-AI-Man-hinh-Dac-ta-doi-App.md`, as tests.
 *
 * The engine is driven through a fake player, so what is being checked is the
 * scheduling — which clip plays, which picture is on the glass, and when an
 * index is considered over — rather than anything about Web Audio.
 */

const voice = (fileName: string, extra: Partial<LessonV2AudioNode> = {}): LessonV2AudioNode => ({
  fileName,
  nodeType: 'voice',
  url: `https://cdn.example.com/${fileName}.mp3`,
  waitMs: 0,
  durationMs: 'full',
  repeat: 1,
  volume: 80,
  ...extra,
});

const picture = (fileName: string, extra: Partial<LessonV2VisualNode> = {}): LessonV2VisualNode => ({
  fileName,
  nodeType: 'image',
  url: `https://cdn.example.com/${fileName}.png`,
  waitMs: 0,
  durationMs: 'full',
  repeat: 1,
  stop: 'giu',
  ...extra,
});

const index = (order: string, extra: Partial<LessonV2Index> = {}): LessonV2Index => ({
  order,
  audio: [],
  visual: [],
  next: null,
  ...extra,
});

function graphOf(...indexes: LessonV2Index[]): LessonV2Graph {
  const byOrder = new Map<string, LessonV2Index>();
  const stack = [...indexes];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    byOrder.set(entry.order, entry);
    if (entry.branches) stack.push(...entry.branches);
  }
  return { version: 2, page: 'Unit-01', indexes, byOrder, warnings: [] };
}

describe('v2-engine', () => {
  let player: {
    playSingle: ReturnType<typeof vi.fn>;
    waitDelay: ReturnType<typeof vi.fn>;
    preload: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  let mic: { listen: ReturnType<typeof vi.fn> };
  let data: LessonDataStore;
  let patches: Partial<ActivityState>[];
  let logs: string[];
  /** Every url handed to the player, in order. */
  let played: string[];
  /** Every gap the engine asked to wait out, in order. */
  let waited: number[];

  beforeEach(() => {
    patches = [];
    logs = [];
    played = [];
    waited = [];

    player = {
      playSingle: vi.fn(async (url: string) => {
        played.push(url);
        return { aborted: false, durationSec: 1 };
      }),
      waitDelay: vi.fn(async (ms: number) => {
        waited.push(ms);
        return false;
      }),
      preload: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      stop: vi.fn(),
    };

    mic = {
      listen: vi.fn(async () => ({ text: 'con mèo', speechDetected: true, failed: false })),
    };

    data = new LessonDataStore();
    vi.spyOn(data, 'preload').mockResolvedValue(undefined);
    vi.spyOn(data, 'preloadCategories').mockResolvedValue(undefined);
    vi.spyOn(data, 'save').mockImplementation(async (category, key, value) => {
      // The real one caches then POSTs; only the cache matters here.
      (data as unknown as { values: Map<string, Map<string, string>> }).values.set(
        category,
        new Map([[key, value]]),
      );
    });
  });

  function engineFor(graph: LessonV2Graph) {
    return new V2Engine(
      {
        graph,
        player: player as never,
        mic: mic as never,
        data,
        lessonId: 'test-v2-lesson',
        trackProgress: false,
      },
      {
        onActivity: (patch) => patches.push(patch),
        onLog: (message) => logs.push(message),
      },
    );
  }

  /**
   * Every picture the glass was told to show while the lesson ran, `null`
   * meaning black.
   *
   * The opening patch (the one carrying `kind`) and the closing one are both
   * black by definition and say nothing about scheduling, so neither counts.
   */
  const shown = () =>
    patches
      .filter((p) => 'imageUrl' in p && p.kind === undefined && p.phase !== 'finished')
      .map((p) => p.imageUrl ?? null);

  const lastPhase = () => patches.filter((p) => p.phase).at(-1)?.phase;

  it('plays both tracks and follows next (§9.1 ordering)', async () => {
    const graph = graphOf(
      index('1', { audio: [voice('A1'), voice('A2', { waitMs: 800 })], visual: [picture('V1')], next: '2' }),
      index('2', { audio: [voice('A3')] }),
    );

    await engineFor(graph).start();

    expect(played).toEqual([
      'https://cdn.example.com/A1.mp3',
      'https://cdn.example.com/A2.mp3',
      'https://cdn.example.com/A3.mp3',
    ]);
    // The gap belongs to the clip that follows it, and the player applies it.
    expect(player.playSingle).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({ waitMs: 800 }));
    expect(lastPhase()).toBe('finished');
  });

  it('warms the clips up front instead of fetching mid-playback', async () => {
    const graph = graphOf(index('1', { audio: [voice('A1')] }));
    await engineFor(graph).start();

    expect(player.preload).toHaveBeenCalledWith(['https://cdn.example.com/A1.mp3']);
    expect(data.preload).toHaveBeenCalled();
  });

  it('§9.1: an index with no visual is black throughout', async () => {
    const graph = graphOf(index('1', { audio: [voice('A1')] }));
    await engineFor(graph).start();

    expect(shown().every((url) => url === null)).toBe(true);
  });

  it('§9.2: a looping GIF never holds the index — the audio ends it', async () => {
    const graph = graphOf(
      index('1', {
        audio: [voice('long')],
        visual: [picture('gif', { nodeType: 'video', repeat: 'loop' })],
      }),
    );

    await engineFor(graph).start();

    // Nothing was waited out for the visual: an endless one is done the moment
    // it starts, as far as the index clock is concerned.
    expect(waited).toEqual([]);
    expect(played).toEqual(['https://cdn.example.com/long.mp3']);
    expect(lastPhase()).toBe('finished');
  });

  it('§9.3: a still picture with stop "giu" is held to the end of the index', async () => {
    const graph = graphOf(
      index('1', { audio: [voice('long')], visual: [picture('still', { stop: 'giu' })] }),
    );

    await engineFor(graph).start();

    // Shown once and never blacked out again while the index ran.
    expect(shown()).toEqual(['https://cdn.example.com/still.png']);
  });

  it('§9.4: with no audio, the visual track is what ends the index', async () => {
    const graph = graphOf(
      index('1', {
        audio: [],
        visual: [picture('a', { nodeType: 'video', durationMs: 500, repeat: 2 })],
        next: '2',
      }),
      index('2', { audio: [voice('after')] }),
    );

    await engineFor(graph).start();

    expect(waited).toEqual([1000]); // 500ms, twice
    expect(played).toEqual(['https://cdn.example.com/after.mp3']);
  });

  it('§9.5: two pictures starting at waitMs 0 hand over without a black frame', async () => {
    const graph = graphOf(
      index('1', { audio: [voice('A1')], visual: [picture('one')], next: '2' }),
      index('2', { audio: [voice('A2')], visual: [picture('two')] }),
    );

    await engineFor(graph).start();

    expect(shown()).toEqual([
      'https://cdn.example.com/one.png',
      'https://cdn.example.com/two.png',
    ]);
  });

  it('blacks the glass when the next picture is not immediate', async () => {
    const graph = graphOf(
      index('1', { audio: [voice('A1')], visual: [picture('one')], next: '2' }),
      index('2', { audio: [voice('A2')], visual: [picture('two', { waitMs: 400 })] }),
    );

    await engineFor(graph).start();

    expect(shown()).toEqual([
      'https://cdn.example.com/one.png',
      null,
      'https://cdn.example.com/two.png',
    ]);
    expect(waited).toContain(400);
  });

  it('holds or clears the frame through the next gap according to stop', async () => {
    const held = graphOf(
      index('1', {
        visual: [
          picture('first', { nodeType: 'video', durationMs: 300, stop: 'giu' }),
          picture('second', { waitMs: 200 }),
        ],
      }),
    );
    await engineFor(held).start();
    expect(shown()).toEqual([
      'https://cdn.example.com/first.png',
      'https://cdn.example.com/second.png',
    ]);

    patches = [];
    const cleared = graphOf(
      index('1', {
        visual: [
          picture('first', { nodeType: 'video', durationMs: 300, stop: 'tat' }),
          picture('second', { waitMs: 200 }),
        ],
      }),
    );
    await engineFor(cleared).start();
    expect(shown()).toEqual([
      'https://cdn.example.com/first.png',
      null,
      'https://cdn.example.com/second.png',
    ]);
  });

  it('blanks visual across subsequent audio-only indexes (index 10, 11, 12 with visual: [])', async () => {
    const graph = graphOf(
      index('9', {
        audio: [voice('A9')],
        visual: [picture('book', { nodeType: 'video', durationMs: 200, stop: 'giu' })],
        next: '10',
      }),
      index('10', { audio: [voice('A10')], visual: [], next: '11' }),
      index('11', { audio: [voice('A11')], visual: [], next: '12' }),
      index('12', { audio: [voice('A12')], visual: [] }),
    );

    const engine = engineFor(graph);
    await engine.start();

    // §4.3: Index có mảng visual rỗng -> màn hình đen suốt index đó.
    // Visual should show book.png during index 9, and then cut to null when index 10 starts.
    expect(shown()).toEqual(['https://cdn.example.com/book.png', null]);
    expect(played).toEqual([
      'https://cdn.example.com/A9.mp3',
      'https://cdn.example.com/A10.mp3',
      'https://cdn.example.com/A11.mp3',
      'https://cdn.example.com/A12.mp3',
    ]);
  });

  it('blanks glass on subsequent audio-only index when previous visual had stop "tat"', async () => {
    const graph = graphOf(
      index('1', {
        audio: [voice('A1')],
        visual: [picture('intro', { nodeType: 'video', durationMs: 200, stop: 'tat' })],
        next: '2',
      }),
      index('2', { audio: [voice('A2')], visual: [] }),
    );

    const engine = engineFor(graph);
    await engine.start();

    expect(shown()).toEqual(['https://cdn.example.com/intro.png', null]);
  });

  describe('touch questions (§5.2)', () => {
    function touchGraph(extra: Partial<LessonV2AudioNode> = {}) {
      return graphOf(
        index('10', {
          audio: [
            voice('Q', {
              type: 'câu hỏi chạm',
              touch: { layout: 'tap4', timeoutMs: 60_000 },
              ...extra,
            }),
            voice('never'),
          ],
          visual: [picture('four-animals')],
          branches: [
            index('10.1', {
              branchType: 'zone1',
              audio: [voice('right')],
              save: { category: 'user', key: 'tu_moi', value: 'cat' },
            }),
            index('10.2', { branchType: 'cham_khac', audio: [voice('other')] }),
            index('10.3', { branchType: 'silent', audio: [voice('quiet')] }),
          ],
        }),
      );
    }

    it('jumps to the matching branch and drops the audio behind the question', async () => {
      const engine = engineFor(touchGraph());
      const done = engine.start();
      await vi.waitUntil(() => patches.some((p) => p.phase === 'touching'));

      expect(patches.find((p) => p.phase === 'touching')?.touchLayout).toBe('tap4');

      engine.dispatchTouch('zone1');
      await done;

      expect(played).toEqual([
        'https://cdn.example.com/Q.mp3',
        'https://cdn.example.com/right.mp3',
      ]);
      expect(data.value('user', 'tu_moi')).toBe('cat');
    });

    it('falls to cham_khac for a result no branch claims', async () => {
      const engine = engineFor(touchGraph());
      const done = engine.start();
      await vi.waitUntil(() => patches.some((p) => p.phase === 'touching'));

      engine.dispatchTouch('zone5');
      await done;

      expect(played).toContain('https://cdn.example.com/other.mp3');
    });

    it('takes the silent branch when the window times out', async () => {
      const graph = touchGraph({ touch: { layout: 'tap4', timeoutMs: 20 } });
      await engineFor(graph).start();

      expect(played).toEqual([
        'https://cdn.example.com/Q.mp3',
        'https://cdn.example.com/quiet.mp3',
      ]);
    });

    it('§9.11: a press outside the window changes nothing', async () => {
      const engine = engineFor(touchGraph());

      // Before the question is even reached.
      engine.dispatchTouch('zone1');

      const done = engine.start();
      await vi.waitUntil(() => patches.some((p) => p.phase === 'touching'));

      // Still waiting, so the early press was dropped rather than queued.
      expect(played).toEqual(['https://cdn.example.com/Q.mp3']);

      engine.dispatchTouch('zone1');
      // A second press, after the window closed, must not jump anywhere again.
      engine.dispatchTouch('zone1');
      await done;

      expect(played).toEqual([
        'https://cdn.example.com/Q.mp3',
        'https://cdn.example.com/right.mp3',
      ]);
    });

    it('routes a question with an unusable layout to cham_khac', async () => {
      // What the parser produces for `layout: "tap7"`: the question stands, the
      // grid does not.
      const graph = touchGraph({ touch: undefined });
      await engineFor(graph).start();

      expect(played).toContain('https://cdn.example.com/other.mp3');
      expect(logs.some((line) => line.includes('thiếu layout'))).toBe(true);
    });

    it('§5: the branch runs at once, even with a picture still on the clock', async () => {
      // A picture with a long way still to run, held open under our control.
      const visualHold: { release: (() => void) | null } = { release: null };
      player.waitDelay = vi.fn(
        (ms: number) =>
          new Promise<boolean>((resolve) => {
            waited.push(ms);
            if (ms === 999_000) visualHold.release = () => resolve(false);
            else resolve(false);
          }),
      );

      const graph = graphOf(
        index('20', {
          audio: [voice('Q', { type: 'câu hỏi chạm', touch: { layout: 'tap4', timeoutMs: 60_000 } })],
          visual: [picture('slow', { nodeType: 'video', durationMs: 999_000 })],
          branches: [index('20.1', { branchType: 'zone1', audio: [voice('right')] })],
        }),
      );

      const engine = engineFor(graph);
      const done = engine.start();
      await vi.waitUntil(() => patches.some((p) => p.phase === 'touching'));

      engine.dispatchTouch('zone1');
      await vi.waitUntil(() => played.includes('https://cdn.example.com/right.mp3'));

      // Releasing the picture afterwards must not resurrect the old index.
      visualHold.release?.();
      await done;
      expect(played).toEqual([
        'https://cdn.example.com/Q.mp3',
        'https://cdn.example.com/right.mp3',
      ]);
    });
  });

  describe('speech questions (§5.1)', () => {
    const speechGraph = () =>
      graphOf(
        index('30', {
          audio: [voice('Q', { type: 'câu hỏi 1' })],
          branches: [
            index('30.1', { branchType: 'responded', audio: [voice('thanks')] }),
            index('30.2', { branchType: 'silent', audio: [voice('quiet')] }),
          ],
        }),
      );

    it('branches on a spoken answer', async () => {
      await engineFor(speechGraph()).start();
      expect(played).toContain('https://cdn.example.com/thanks.mp3');
    });

    it('branches on silence', async () => {
      mic.listen = vi.fn(async () => ({ text: null, speechDetected: false, failed: false }));
      await engineFor(speechGraph()).start();
      expect(played).toContain('https://cdn.example.com/quiet.mp3');
    });
  });

  describe('đọc giá trị đã lưu (§5.4)', () => {
    const recallGraph = (recall: NonNullable<LessonV2Index['recall']>) =>
      graphOf(
        index('40', {
          type: 'đọc giá trị đã lưu',
          recall,
          branches: [
            index('40.1', { branchType: 'do', audio: [voice('red')] }),
            index('40.2', { branchType: 'chua_co', audio: [voice('ask')] }),
            index('40.3', { branchType: 'match', audio: [voice('known')] }),
            index('40.4', { branchType: 'not_in_list', audio: [voice('odd')] }),
            index('40.5', { branchType: 'other', audio: [voice('shrug')] }),
          ],
        }),
      );

    it('§9.10: plays nothing and branches straight away', async () => {
      await data.save('user', 'so_thich_mau', 'do');
      await engineFor(recallGraph({ category: 'user', key: 'so_thich_mau', valuesFrom: null })).start();

      // Only the branch's own clip — the recall index itself is silent.
      expect(played).toEqual(['https://cdn.example.com/red.mp3']);
      expect(player.waitDelay).not.toHaveBeenCalled();
    });

    it('takes chua_co when nothing has been stored yet', async () => {
      await engineFor(recallGraph({ category: 'user', key: 'so_thich_mau', valuesFrom: null })).start();
      expect(played).toEqual(['https://cdn.example.com/ask.mp3']);
    });

    it('takes other when the stored value has no branch of its own', async () => {
      await data.save('user', 'so_thich_mau', 'tim');
      await engineFor(recallGraph({ category: 'user', key: 'so_thich_mau', valuesFrom: null })).start();
      expect(played).toEqual(['https://cdn.example.com/shrug.mp3']);
    });

    it('uses values_from to tell match from not_in_list', async () => {
      vi.spyOn(data, 'categoryValues').mockReturnValue(['do', 'xanh', 'vang']);

      await data.save('user', 'so_thich_mau', 'do');
      await engineFor(
        recallGraph({ category: 'user', key: 'so_thich_mau', valuesFrom: 'mau_sac' }),
      ).start();
      expect(played).toEqual(['https://cdn.example.com/known.mp3']);

      played = [];
      await data.save('user', 'so_thich_mau', 'nau');
      await engineFor(
        recallGraph({ category: 'user', key: 'so_thich_mau', valuesFrom: 'mau_sac' }),
      ).start();
      expect(played).toEqual(['https://cdn.example.com/odd.mp3']);
    });

    it('skips rather than guessing when the shared list did not load', async () => {
      vi.spyOn(data, 'categoryValues').mockReturnValue(undefined);

      const graph = graphOf(
        index('40', {
          type: 'đọc giá trị đã lưu',
          recall: { category: 'user', key: 'so_thich_mau', valuesFrom: 'mau_sac' },
          branches: [index('40.1', { branchType: 'match', audio: [voice('known')] })],
          next: '41',
        }),
        index('41', { audio: [voice('onward')] }),
      );

      await engineFor(graph).start();
      expect(played).toEqual(['https://cdn.example.com/onward.mp3']);
    });
  });

  describe('skip and dispose', () => {
    it('does not resume a lesson it has already ended', async () => {
      const graph = graphOf(
        index('50', {
          audio: [voice('Q', { type: 'câu hỏi chạm', touch: { layout: 'tap4', timeoutMs: 60_000 } })],
          branches: [index('50.1', { branchType: 'cham_khac', audio: [voice('other')] })],
          next: null,
        }),
      );

      const engine = engineFor(graph);
      const done = engine.start();
      await vi.waitUntil(() => patches.some((p) => p.phase === 'touching'));

      await engine.skipNext();
      await done;
      await new Promise((r) => setTimeout(r, 20));

      // Skipping past the last index ends the lesson. The abandoned question
      // must not come back and play its branch afterwards.
      expect(played).toEqual(['https://cdn.example.com/Q.mp3']);
      expect(patches.filter((p) => p.phase === 'finished')).toHaveLength(1);
    });

    it('releases a pending question on dispose', async () => {
      const graph = graphOf(
        index('60', {
          audio: [voice('Q', { type: 'câu hỏi chạm', touch: { layout: 'tap4', timeoutMs: 60_000 } })],
          branches: [index('60.1', { branchType: 'cham_khac', audio: [voice('other')] })],
        }),
      );

      const engine = engineFor(graph);
      const done = engine.start();
      await vi.waitUntil(() => patches.some((p) => p.phase === 'touching'));

      engine.dispose();
      // Resolves rather than hanging: an abandoned promise here would leave the
      // audio track awaiting an answer that can never arrive.
      await done;
    });
  });
});
