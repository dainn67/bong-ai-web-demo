import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JourneyLog } from './journey-log';
import { VirtualSdCard } from './virtual-sd-card';
import { SAMPLE_INLIST_SCENE } from './sample-scenes';
import { runCanonicalStartHahaMagicBookE2E } from './e2e-runner';
import { SimulatedDeviceSecurity } from './crypto-client';

describe('Phase 3 E2E Acceptance & Red Team Safeguards', () => {
  beforeEach(async () => {
    SimulatedDeviceSecurity.resetSimulatedKeys();
    await VirtualSdCard.formatCard();
  });

  it('SAMPLE_INLIST_SCENE step 6 transitions to END#finished instead of END#idle', () => {
    const step6 = SAMPLE_INLIST_SCENE.steps.find((s) => s.id === '6');
    expect(step6?.next).toBe('END#finished');
  });

  it('JourneyLog emits at most one session_end line per sid and deduplicates concurrent flush() calls', async () => {
    let fetchResolvers: Array<(v: any) => void> = [];
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          fetchResolvers.push(resolve);
        })
    );

    const j = new JourneyLog({
      deviceId: 'sim_e2e',
      endpoint: '/api/v1/device/sync',
      storage: null,
      fetchImpl: mockFetch as any,
    });

    const sid = j.sessionStart({ mver: 3, battery: 95 });
    expect(sid).toContain('sim_e2e-');

    // Calling sessionEnd twice for the same sid must only append one ev="end" line
    j.sessionEnd('end_scene', 94);
    j.sessionEnd('sleep_idle', 94);

    const endLines = j.sessionLines().filter((l) => l.ev === 'end');
    expect(endLines).toHaveLength(1);
    expect(endLines[0].by).toBe('end_scene');

    // Concurrent flush() calls must share the in-flight request
    const p1 = j.flush();
    const p2 = j.flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    let p2Resolved = false;
    void p2.then(() => {
      p2Resolved = true;
    });
    expect(p2Resolved).toBe(false);

    fetchResolvers[0]({
      ok: true,
      status: 200,
      json: async () => ({ ack_seq: 1 }),
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(j.pendingCount).toBe(0);
  });

  it('VirtualSdCard.syncFromManifest stages blobs first and aborts commit if any blob fails', async () => {
    // Seed an existing scene on SD card
    const originalBytes = new TextEncoder().encode('{"id":"START","entry":"old","steps":[]}');
    await VirtualSdCard.writeFile('/sdcard/scenes/START.json', originalBytes, 'application/json');

    const failingManifest: any = {
      fmt: 1,
      ver: 9,
      cfg: {},
      profile: { child_name: 'Bống', bong_name: 'Bống' },
      wanted: ['START'],
      scenes: [{ id: 'START', ver: 2, hash: 'a'.repeat(64), pin: true }],
      files: [{ id: 'missing_audio', hash: 'b'.repeat(64), size: 10, kind: 'audio' }],
      prompts: {},
    };

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('a'.repeat(64))) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode('{"id":"START","entry":"new","steps":[]}').buffer,
        };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await VirtualSdCard.syncFromManifest(failingManifest, '/api/v1');
      expect(res.errors.length).toBeGreaterThan(0);

      // Active /sdcard/scenes/START.json must still contain originalBytes (not overwritten by partial sync)
      const afterBytes = await VirtualSdCard.readFile('/sdcard/scenes/START.json');
      expect(new TextDecoder().decode(afterBytes!)).toBe('{"id":"START","entry":"old","steps":[]}');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('runs canonical START#kiemtra -> HAHA#quiz -> SACH_KY_DIEU#answer -> END#idle -> END#finished E2E flow with handoffs', async () => {
    const report = await runCanonicalStartHahaMagicBookE2E({ mode: 'mock' });
    expect(report.passed).toBe(true);
    expect(report.visitedSteps).toEqual([
      'START#kiemtra',
      'HAHA#quiz',
      'SACH_KY_DIEU#answer',
      'END#idle',
      'END#finished',
    ]);
    expect(report.listenReply).toBe('correct');
    expect(report.listenHandoffSeed).toBe('tại sao trời lại có mưa?');
    expect(report.talkBranch).toBe('done');
    expect(report.endEventsCount).toBe(1);
    expect(report.endReason).toBe('end_scene');
  });
});
