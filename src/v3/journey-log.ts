/**
 * Journey Log writer + persistent outbox (spec v3.1 §1–2.1).
 *
 * Two independent sequence spaces (D14):
 *   - `seq` inside a line — per-session, resets to 1 at every session_start.
 *   - `body.seq` of /device/sync packets — monotonic across packets, persisted
 *     in localStorage, acked by `ack_seq` from the BE.
 *
 * Lines are written to the virtual SD (`/sd/log/<yyyy-mm-dd>.jsonl`) AND a
 * persistent outbox (localStorage) BEFORE they enter the sync queue — a
 * reload resends whatever was never acked (t stays immutable, D19).
 */

import type { V3Scene } from './types';
import { VirtualSdCard } from './virtual-sd-card';

export const JOURNEY_LOAI = [
  'session_start', 'step', 'save', 'listen', 'branch', 'talk', 'error', 'session_end',
] as const;
export type JourneyLoai = (typeof JOURNEY_LOAI)[number];

export interface JourneyLine {
  loai: JourneyLoai | string;
  sid: string;
  seq: number;
  t: number; // epoch ms — immutable on resend
  scene?: string;
  scene_ver?: number;
  mver?: number;
  step?: string;
  [k: string]: unknown;
}

interface OutboxEntry {
  line: JourneyLine;
  /** packet seq this line was last sent in (null = never sent). */
  pkt: number | null;
}

const OUTBOX_KEY = 'v3_journey_outbox';
const PACKET_SEQ_KEY = 'v3_journey_packet_seq';
const SID_KEY = 'v3_journey_sid';
const FLUSH_AT = 500;      // pending lines
const CHUNK = 1500;        // lines per sync packet (contract cap 2000 − headroom)

export interface SyncResult {
  ok: boolean;
  ack_seq?: number;
  http?: number;
  error?: string;
}

// localStorage shim — vitest runs in node (no DOM), memory store suffices.
const _memStore = new Map<string, string>();
const _ls = {
  getItem: (k: string): string | null =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(k) : _memStore.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    else _memStore.set(k, v);
  },
};

function loadOutbox(): OutboxEntry[] {
  try {
    const raw = _ls.getItem(OUTBOX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveOutbox(entries: OutboxEntry[]): void {
  try {
    _ls.setItem(OUTBOX_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('[journey] outbox persist failed (quota?)', e);
  }
}

let _sharedJourney: JourneyLog | null = null;

/** Test hook: clear persisted journey storage (outbox, packet seq, sid). */
export function __clearJourneyStorage(): void {
  _sharedJourney = null;
  _memStore.clear();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(OUTBOX_KEY);
    localStorage.removeItem(PACKET_SEQ_KEY);
    localStorage.removeItem(SID_KEY);
  }
}

export function getSharedJourneyLog(deviceId = 'simulator_v3_dev', onLog?: (msg: string) => void): JourneyLog {
  if (!_sharedJourney) {
    _sharedJourney = new JourneyLog(deviceId, onLog);
    void _sharedJourney.bootResend();
  } else if (onLog) {
    _sharedJourney.setLogger(onLog);
  }
  return _sharedJourney;
}

export interface JourneyLogOptions {
  deviceId?: string;
  endpoint?: string;
  storage?: Storage | null;
  fetchImpl?: typeof fetch;
  onLog?: (msg: string) => void;
}

export class JourneyLog {
  readonly deviceId: string;
  sid: string | null = null;
  private endedSid: string | null = null;
  private lineSeq = 0;
  private startedAtSec = 0;
  private outbox: OutboxEntry[];
  private currentSessionLines: JourneyLine[] = [];
  private flushPromise: Promise<SyncResult> | null = null;
  private onLog?: (msg: string) => void;
  private flushTimer: any = null;
  private defaultEndpoint = '/api/v1/device/sync';
  private fetchFn: typeof fetch = (...args) => fetch(...args);
  private usePersistentStorage = true;
  private localPacketSeq = 0;

  constructor(deviceIdOrOpts: string | JourneyLogOptions = 'simulator_v3_dev', onLog?: (msg: string) => void) {
    if (typeof deviceIdOrOpts === 'string') {
      this.deviceId = deviceIdOrOpts;
      this.onLog = onLog;
      this.outbox = loadOutbox();
    } else {
      this.deviceId = deviceIdOrOpts.deviceId || 'simulator_v3_dev';
      this.onLog = deviceIdOrOpts.onLog || onLog;
      if (deviceIdOrOpts.endpoint) this.defaultEndpoint = deviceIdOrOpts.endpoint;
      if (deviceIdOrOpts.fetchImpl) this.fetchFn = deviceIdOrOpts.fetchImpl;
      if (deviceIdOrOpts.storage === null) {
        this.usePersistentStorage = false;
        this.outbox = [];
      } else {
        this.outbox = loadOutbox();
      }
    }
  }

  setLogger(onLog: (msg: string) => void): void {
    this.onLog = onLog;
  }

  /** Pending lines never acked — resend on boot. */
  get pendingCount(): number {
    return this.outbox.length;
  }

  private scheduleDebouncedFlush(delayMs = 600): void {
    if (typeof window === 'undefined') return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
  }

  private nextPacketSeq(): number {
    if (!this.usePersistentStorage) {
      this.localPacketSeq += 1;
      return this.localPacketSeq;
    }
    const cur = Number(_ls.getItem(PACKET_SEQ_KEY) || '0') + 1;
    _ls.setItem(PACKET_SEQ_KEY, String(cur));
    return cur;
  }

  /** Open a new session (device wake / START scene entry). */
  sessionStart(extra: Record<string, unknown> = {}): string {
    let epoch = Math.floor(Date.now() / 1000);
    // Two sessions in the same second must not share a sid — bump the epoch
    // by 1s per collision (cheap for the simulator; firmware adds a nonce).
    while (this.sid === `${this.deviceId}-${epoch}`) epoch += 1;
    this.sid = `${this.deviceId}-${epoch}`;
    this.endedSid = null;
    this.lineSeq = 0;
    this.startedAtSec = epoch;
    this.currentSessionLines = [];
    if (this.usePersistentStorage) {
      _ls.setItem(SID_KEY, this.sid);
    }
    this.append({ loai: 'session_start', ev: 'start', ...extra });
    return this.sid;
  }

  /** Emit `session_end` at most once per `sid` (prevents duplicate END#finished -> END#idle end lines). */
  sessionEnd(reason: string, dur_s = 0, extra: Record<string, unknown> = {}): void {
    const activeSid = this.sid || this.endedSid;
    if (!activeSid || this.endedSid === activeSid) return;
    this.endedSid = activeSid;
    const computedDur = dur_s > 0 ? dur_s : Math.max(0, Math.floor(Date.now() / 1000) - this.startedAtSec);
    this.append({
      loai: 'session_end',
      ev: 'end',
      reason,
      by: reason,
      dur_s: computedDur,
      dur: computedDur,
      ...extra,
    });
  }

  /** Convenience helper for compact step lines (`sc`, `st`, `go`, `m`, `ans`, ...). */
  step(fields: Record<string, unknown>): JourneyLine {
    return this.append({
      loai: (fields.m === 'voice' || fields.m === 'hear' || fields.m === 'touch' || fields.m === 'pet'
        ? 'listen'
        : fields.m === 'talk'
        ? 'talk'
        : 'step') as string,
      scene: (fields.sc || fields.scene) as string,
      step: (fields.st || fields.step) as string,
      ...fields,
    });
  }

  /**
   * Append one line. `seq` auto-increments per session; `t` stamped now and
   * frozen for the life of the line.
   */
  append(line: Omit<JourneyLine, 'sid' | 'seq' | 't'> & { sid?: string; seq?: number; t?: number }): JourneyLine {
    const full: JourneyLine = {
      loai: line.loai as string,
      ...line,
      sid: line.sid ?? this.sid ?? `${this.deviceId}-0`,
      seq: line.seq ?? ++this.lineSeq,
      t: line.t ?? Date.now(),
    };
    this.onLog?.(`[journey] line #${full.seq} ${full.loai}`);
    // A caller-supplied seq (reserved talk line, D18) must still advance the
    // counter — otherwise the next auto seq collides with it.
    if (line.seq !== undefined && line.seq > this.lineSeq) {
      this.lineSeq = line.seq;
    }
    this.outbox.push({ line: full, pkt: null });
    this.currentSessionLines.push(full);
    if (this.usePersistentStorage) {
      this.saveSd(full);
      this.persist();
      if (full.loai === 'session_end' || this.outbox.length >= FLUSH_AT) {
        if (this.flushTimer) {
          clearTimeout(this.flushTimer);
          this.flushTimer = null;
        }
        void this.flush();
      } else {
        this.scheduleDebouncedFlush();
      }
    }
    return full;
  }

  /** Reserve the seq a `talk` line will use (D18): peek, don't consume. */
  peekSeq(): number {
    return this.lineSeq + 1;
  }

  /** Flush pending lines, chunked ≤1500, ordered by insert order. Concurrent calls share the active promise. */
  async flush(syncUrl = this.defaultEndpoint): Promise<SyncResult> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushPromise) return this.flushPromise;
    if (this.outbox.length === 0) return { ok: true };
    const run = async (): Promise<SyncResult> => {
      try {
        let lastAck = 0;
        while (this.outbox.length > 0) {
          const batch = this.outbox.slice(0, CHUNK);
          const pkt = this.nextPacketSeq();
          const res = await this.fetchFn(syncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: this.deviceId,
              seq: pkt,
              logs: batch.map((e) => e.line),
            }),
          });
          if (!res.ok) {
            return { ok: false, http: res.status };
          }
          const data = await res.json().catch(() => ({}));
          const ack = typeof data.ack_seq === 'number' ? data.ack_seq : pkt;
          lastAck = ack;
          if (ack < pkt) {
            return { ok: false, http: res.status, error: `ack_seq ${ack} < pkt ${pkt}` };
          }
          // Mark the batch with its packet seq, then prune everything the BE
          // cumulatively acked (pkt ≤ ack_seq covers retries too).
          batch.forEach((e) => { e.pkt = pkt; });
          this.outbox = this.outbox.filter((e) => e.pkt === null || e.pkt > ack);
          if (this.usePersistentStorage) {
            this.persist();
          }
        }
        return { ok: true, ack_seq: lastAck };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      } finally {
        this.flushPromise = null;
      }
    };
    this.flushPromise = run();
    return this.flushPromise;
  }

  /** Boot-time resend — call once on engine init. */
  async bootResend(): Promise<SyncResult | null> {
    return this.outbox.length ? this.flush() : null;
  }

  /** All lines of the current session (for the Preview submit and E2E verification). */
  sessionLines(): JourneyLine[] {
    if (!this.sid) return [];
    const fromOutbox = this.outbox.map((e) => e.line).filter((l) => l.sid === this.sid);
    return fromOutbox.length >= this.currentSessionLines.length ? fromOutbox : [...this.currentSessionLines];
  }

  private persist(): void {
    saveOutbox(this.outbox.slice(-2000)); // localStorage cap — SD keeps the truth
  }

  private saveSd(line: JourneyLine): void {
    const day = new Date(line.t).toISOString().slice(0, 10);
    const path = `/sd/log/${day}.jsonl`;
    // Read-append-write is fine at simulator write rates; firmware streams.
    void VirtualSdCard.readFile(path).then((cur) => {
      const prev = cur ? new TextDecoder().decode(cur) : '';
      const next = prev + JSON.stringify(line) + '\n';
      void VirtualSdCard.writeFile(path, new TextEncoder().encode(next), 'application/jsonl').catch(() => {});
    }).catch(() => {});
  }

  /** Common fields every line carries (spec §1.1). */
  ctx(scene: V3Scene | null | undefined, sceneVer: number | undefined, mver: number | undefined, step?: string): Record<string, unknown> {
    return {
      scene: scene?.id,
      scene_ver: sceneVer,
      mver,
      step,
    };
  }
}
