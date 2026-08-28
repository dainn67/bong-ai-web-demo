import { afterEach, describe, expect, it, vi } from 'vitest';
import { GroupPlayer } from './group-player';

/**
 * The waiting side of the player, which needs no audio hardware.
 *
 * Version 2 runs two tracks against one player at the same time, and both of
 * them spend most of an index waiting — so how waits are registered, cut short
 * and frozen is the part worth pinning down.
 */
describe('GroupPlayer waits', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases every concurrent wait when stopped, not just the newest', async () => {
    const player = new GroupPlayer();

    // As an index does: the audio track and the visual track each waiting.
    const audioWait = player.waitDelay(60_000);
    const visualWait = player.waitDelay(60_000);

    player.stop();

    // With a single abort slot the first of these hung forever, and with it the
    // track that was waiting on it — the index never ended.
    expect(await Promise.all([audioWait, visualWait])).toEqual([true, true]);
  });

  it('resolves false when a wait runs its course', async () => {
    vi.useFakeTimers();
    const player = new GroupPlayer();

    const wait = player.waitDelay(500);
    await vi.advanceTimersByTimeAsync(500);

    expect(await wait).toBe(false);
  });

  it('freezes a wait while paused and finishes the remainder on resume', async () => {
    vi.useFakeTimers();
    const player = new GroupPlayer();

    let settled = false;
    const wait = player.waitDelay(1_000).then((aborted) => {
      settled = true;
      return aborted;
    });

    await vi.advanceTimersByTimeAsync(400);
    await player.pause();

    // A gap left on wall time would burn straight through here, and the two
    // tracks would come back from the pause out of step with each other.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(false);

    await player.resume();
    await vi.advanceTimersByTimeAsync(599);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(await wait).toBe(false);
  });

  it('cuts a frozen wait short too', async () => {
    vi.useFakeTimers();
    const player = new GroupPlayer();

    const wait = player.waitDelay(1_000);
    await vi.advanceTimersByTimeAsync(100);
    await player.pause();
    player.stop();

    expect(await wait).toBe(true);
  });
});
