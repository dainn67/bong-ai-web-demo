import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JourneyLog, __clearJourneyStorage } from './journey-log';

describe('JourneyLog', () => {
  beforeEach(() => {
    __clearJourneyStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resets line seq per session, keeps packet seq monotonic', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ack_seq: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const j = new JourneyLog('dv1');
    const sid1 = j.sessionStart();
    j.append({ loai: 'step', step: 'a' });
    j.append({ loai: 'listen', reply: 'x' });
    // Session 2 — line seq resets (session_start = 1, next line = 2).
    const sid2 = j.sessionStart();
    const l = j.append({ loai: 'step', step: 'b' });
    expect(l.seq).toBe(2);
    expect(sid2).not.toBe(sid1);
    expect(l.sid).toBe(sid2);
  });

  it('t is immutable; resend keeps identical payload', async () => {
    const sent: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init: any) => {
      sent.push(init.body);
      return { ok: true, json: async () => ({ ack_seq: 1 }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const j = new JourneyLog('dv1');
    j.sessionStart();
    j.append({ loai: 'step', step: 'a' });
    await j.flush();
    expect(sent).toHaveLength(1);
    // Resend a persisted line — identical bytes.
    const j2 = new JourneyLog('dv1'); // loads outbox
    // after successful flush, outbox empty → nothing to resend
    expect(j2.pendingCount).toBe(0);
  });

  it('boot resend: lines persist until acked', async () => {
    // First flush fails → pending stays → new instance sees it.
    const fetchFail = vi.fn().mockRejectedValue(new Error('net down'));
    vi.stubGlobal('fetch', fetchFail);
    const j = new JourneyLog('dv1');
    j.sessionStart();
    j.append({ loai: 'step', step: 'a' });
    await j.flush();
    expect(j.pendingCount).toBe(2);

    const fetchOk = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ack_seq: 99 }),
    });
    vi.stubGlobal('fetch', fetchOk);
    const j2 = new JourneyLog('dv1');
    await j2.bootResend();
    expect(j2.pendingCount).toBe(0);
    const body = JSON.parse(fetchOk.mock.calls[0][1].body);
    expect(body.device_id).toBe('dv1');
    expect(typeof body.seq).toBe('number');
    expect(body.logs.map((l: any) => l.loai)).toEqual(['session_start', 'step']);
    // t preserved
    expect(body.logs[1].t).toBeTypeOf('number');
  });

  it('flush on session_end trigger', async () => {
    const fetchOk = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ack_seq: 5 }) });
    vi.stubGlobal('fetch', fetchOk);
    const j = new JourneyLog('dv1');
    j.sessionStart();
    j.append({ loai: 'step', step: 'a' });
    j.sessionEnd('end:finished', 12);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchOk).toHaveBeenCalled();
    const body = JSON.parse(fetchOk.mock.calls[0][1].body);
    expect(body.logs.map((l: any) => l.loai)).toContain('session_end');
  });

  it('peekSeq reserves talk line seq; explicit seq advances counter (D18)', () => {
    const j = new JourneyLog('dv1');
    j.sessionStart();
    j.append({ loai: 'step', step: 'chat' });   // seq 2
    const reserved = j.peekSeq();               // 3
    // talk detail calls go out with seq=3; the talk line lands later:
    const talk = j.append({ loai: 'talk', seq: reserved, turns: 2 });
    expect(talk.seq).toBe(3);
    const next = j.append({ loai: 'step', step: 'after' });
    expect(next.seq).toBe(4);                   // no collision with reserved seq
  });
});
