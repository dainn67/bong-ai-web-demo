import { describe, expect, it } from 'vitest';
import { HANGOVER_MS, rms, SILENCE_RMS, SPEECH_RMS, SilenceVad } from './vad';
import { TurnController, type TurnOptions } from './turn-controller';

const RATE = 16_000;

/** One 100 ms chunk at a constant amplitude. */
function chunk(amplitude: number, ms = 100): Int16Array {
  return new Int16Array((RATE * ms) / 1000).fill(amplitude);
}

const LOUD = chunk(4000);
const QUIET = chunk(50);
/** Between the two thresholds — neither speech nor silence. */
const MIDDLE = chunk(Math.round((SPEECH_RMS + SILENCE_RMS) / 2));

describe('rms', () => {
  it('is the amplitude for a constant signal', () => {
    expect(rms(new Int16Array(100).fill(1000))).toBeCloseTo(1000);
  });

  it('is zero for silence and for nothing', () => {
    expect(rms(new Int16Array(100))).toBe(0);
    expect(rms(new Int16Array(0))).toBe(0);
  });

  // RMS attenuates a click heavily — a full-scale sample in a 100ms chunk
  // reads as 800 rather than 32000 — but note it does NOT vanish: 800 is still
  // over SPEECH_RMS, so a single sharp bang can open a turn. That is inherited
  // from the app's thresholds and left alone deliberately; the turn's own
  // no-speech cap is what stops a false start from hanging the lesson.
  it('attenuates a lone spike by roughly the chunk length', () => {
    const clicky = new Int16Array(1600);
    clicky[0] = 32_000;
    expect(rms(clicky)).toBeCloseTo(32_000 / Math.sqrt(1600), 0);
    expect(rms(clicky)).toBeLessThan(32_000 / 10);
  });

  it('rates sustained quiet noise below the silence threshold', () => {
    expect(rms(new Int16Array(1600).fill(50))).toBeLessThan(SILENCE_RMS);
  });
});

describe('SilenceVad', () => {
  it('reports speech once a loud chunk arrives', () => {
    const vad = new SilenceVad();
    expect(vad.speechActive).toBe(false);
    vad.process(LOUD, RATE);
    expect(vad.speechActive).toBe(true);
  });

  it('ends the turn after the hangover of silence', () => {
    const vad = new SilenceVad();
    vad.process(LOUD, RATE);
    // 800ms of hangover, fed as 100ms chunks: the eighth is the one that ends it.
    for (let i = 0; i < HANGOVER_MS / 100 - 1; i++) {
      expect(vad.process(QUIET, RATE)).toBe(false);
    }
    expect(vad.process(QUIET, RATE)).toBe(true);
  });

  it('never ends a turn that had no speech in it', () => {
    const vad = new SilenceVad();
    for (let i = 0; i < 50; i++) expect(vad.process(QUIET, RATE)).toBe(false);
  });

  it('fires only once per utterance', () => {
    const vad = new SilenceVad();
    vad.process(LOUD, RATE);
    let fired = 0;
    for (let i = 0; i < 30; i++) if (vad.process(QUIET, RATE)) fired++;
    expect(fired).toBe(1);
  });

  it('restarts the silence count when speech resumes', () => {
    const vad = new SilenceVad();
    vad.process(LOUD, RATE);
    vad.process(QUIET, RATE);
    vad.process(QUIET, RATE);
    vad.process(LOUD, RATE); // a pause mid-sentence, then talking again
    for (let i = 0; i < HANGOVER_MS / 100 - 1; i++) {
      expect(vad.process(QUIET, RATE)).toBe(false);
    }
    expect(vad.process(QUIET, RATE)).toBe(true);
  });

  // The gap between the thresholds is the point: a level in it is ambiguous,
  // so it neither starts speech nor counts toward ending it.
  it('treats a mid-band level as neither speech nor silence', () => {
    const vad = new SilenceVad();
    vad.process(MIDDLE, RATE);
    expect(vad.speechActive).toBe(false);

    vad.process(LOUD, RATE);
    for (let i = 0; i < 20; i++) expect(vad.process(MIDDLE, RATE)).toBe(false);
  });

  it('reset clears the state', () => {
    const vad = new SilenceVad();
    vad.process(LOUD, RATE);
    vad.reset();
    expect(vad.speechActive).toBe(false);
    for (let i = 0; i < 20; i++) expect(vad.process(QUIET, RATE)).toBe(false);
  });
});

describe('TurnController', () => {
  /** A controller on a clock we advance by hand. */
  function makeController(options: TurnOptions = {}) {
    let clock = 0;
    const turn = new TurnController({ ...options, now: () => clock });
    return { turn, tick: (ms: number) => (clock += ms) };
  }

  it('ends on silence', () => {
    const { turn, tick } = makeController();
    turn.begin();
    turn.offer(LOUD, RATE);
    let reason = null;
    for (let i = 0; i < 10 && !reason; i++) {
      tick(100);
      reason = turn.offer(QUIET, RATE);
    }
    expect(reason).toBe('silence');
    expect(turn.speechDetected).toBe(true);
  });

  it('caps a long utterance from the moment speech starts', () => {
    const { turn, tick } = makeController({ maxUtteranceMs: 20_000 });
    turn.begin();
    turn.offer(LOUD, RATE);
    tick(19_900);
    expect(turn.offer(LOUD, RATE)).toBeNull();
    tick(200);
    expect(turn.offer(LOUD, RATE)).toBe('cap');
  });

  // Without this a question waits forever on a child who wandered off, and the
  // lesson just stops. It is the single most important of the three exits.
  it('ends a turn where nothing was ever said', () => {
    const { turn, tick } = makeController({ maxListenMs: 10_000 });
    turn.begin();
    tick(9_900);
    expect(turn.offer(QUIET, RATE)).toBeNull();
    tick(200);
    expect(turn.offer(QUIET, RATE)).toBe('cap');
    expect(turn.speechDetected).toBe(false);
  });

  it('does not apply the listen cap once the child has spoken', () => {
    const { turn, tick } = makeController({ maxListenMs: 1_000, maxUtteranceMs: 60_000 });
    turn.begin();
    turn.offer(LOUD, RATE);
    tick(5_000);
    // Mid-band keeps it alive: speaking, but not silent enough to end.
    expect(turn.offer(MIDDLE, RATE)).toBeNull();
  });

  it('waits indefinitely when the listen cap is disabled', () => {
    const { turn, tick } = makeController({ maxListenMs: null });
    turn.begin();
    tick(600_000);
    expect(turn.offer(QUIET, RATE)).toBeNull();
  });

  // A chunk arriving after the turn ended must not fire a second one into a
  // caller that has already moved on to grading.
  it('latches after ending', () => {
    const { turn, tick } = makeController({ maxListenMs: 500 });
    turn.begin();
    tick(600);
    expect(turn.offer(QUIET, RATE)).toBe('cap');
    tick(600);
    expect(turn.offer(QUIET, RATE)).toBeNull();
  });

  it('begin clears the latch for the next turn', () => {
    const { turn, tick } = makeController({ maxListenMs: 500 });
    turn.begin();
    tick(600);
    expect(turn.offer(QUIET, RATE)).toBe('cap');

    turn.begin();
    tick(600);
    expect(turn.offer(QUIET, RATE)).toBe('cap');
  });
});
