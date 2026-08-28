import { describe, expect, it } from 'vitest';
import { closeWaitWindow, IDLE_ACTIVITY, type ActivityState } from './activity-state';

const openTouch: ActivityState = {
  ...IDLE_ACTIVITY,
  kind: 'lesson',
  phase: 'touching',
  waitingFor: 'touch',
  touchLayout: 'tap4',
};

const openSpeech: ActivityState = {
  ...IDLE_ACTIVITY,
  kind: 'lesson',
  phase: 'listening',
  waitingFor: 'speech',
};

/**
 * The regression this guards.
 *
 * A server-opened question had no owner on the device side: `V2Engine` closes
 * the windows it opens and the dev drawer closes its own, but a `lesson_question`
 * from the backend was only ever closed by its timeout. Answer it and the wait
 * ring stayed lit, the glass stayed armed, and every further tap went nowhere —
 * the opposite of §4 of `docs/Bong-AI-Touch-Protocol-V2.md`, which has the ring
 * go out the moment the answer is sent.
 */
describe('closeWaitWindow', () => {
  it('closes an answered touch window and rewinds the phase', () => {
    expect(closeWaitWindow(openTouch, 'touch', 'touching')).toEqual({
      phase: 'playing',
      waitingFor: null,
      touchLayout: null,
    });
  });

  it('closes an answered speech window when the mic shuts', () => {
    expect(closeWaitWindow(openSpeech, 'speech', 'listening')).toEqual({
      phase: 'playing',
      waitingFor: null,
      touchLayout: null,
    });
  });

  /**
   * The mic is closed on every path out of an activity, including while a touch
   * question is open. Clearing `touchLayout` there would disarm the glass under
   * a question the child is still looking at.
   */
  it('leaves a window of the other kind alone', () => {
    expect(closeWaitWindow(openTouch, 'speech', 'listening')).toBeNull();
    expect(closeWaitWindow(openSpeech, 'touch', 'touching')).toBeNull();
  });

  it('does nothing when no window is open', () => {
    expect(closeWaitWindow(IDLE_ACTIVITY, 'touch', 'touching')).toBeNull();
    expect(closeWaitWindow(IDLE_ACTIVITY, 'speech', 'listening')).toBeNull();
  });

  /**
   * A lesson can end while a finger is still down — the socket drops, the
   * script hits its last index, a clip 404s. The answer still has to close the
   * window, but rewinding to `playing` would paint over what actually happened.
   */
  it('keeps a phase the window did not open', () => {
    for (const phase of ['error', 'finished', 'paused'] as const) {
      expect(closeWaitWindow({ ...openTouch, phase }, 'touch', 'touching')).toEqual({
        waitingFor: null,
        touchLayout: null,
      });
    }
  });
});
