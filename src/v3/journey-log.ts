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

/** Test hook: clear persisted journey storage (outbox, packet seq, sid). */
export function __clearJourneyStorage(): void {
  _memStore.clear();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(OUTBOX_KEY);
    localStorage.removeItem(PACKET_SEQ_KEY);
    localStorage.removeItem(SID_KEY);
  }
}

export class JourneyLog {
  readonly deviceId: string;
  sid: string | null = null;
  private lineSeq = 0;
  private outbox: OutboxEntry[];
  private flushing = false;
  private onLog?: (msg: string) => void;

  constructor(deviceId: string, onLog?: (msg: string) => void) {
    this.deviceId = deviceId;
    this.onLog = onLog;
    this.outbox = loadOutbox();
  }

  /** Pending lines never acked — resend on boot. */
  get pendingCount(): number {
    return this.outbox.length;
  }

  private nextPacketSeq(): number {
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
    this.lineSeq = 0;
    _ls.setItem(SID_KEY, this.sid);
    this.append({ loai: 'session_start', ...extra });
    return this.sid;
  }

  sessionEnd(reason: string, dur_s: number, extra: Record<string, unknown> = {}): void {
    this.append({ loai: 'session_end', reason, dur_s, ...extra });
  }

  /**
   * Append one line. `seq` auto-increments per session; `t` stamped now and
   * frozen for the life of the line.
   */
  append(line: Omit<JourneyLine, 'sid' | 'seq' | 't'> & { sid?: string; seq?: number; t?: number }): JourneyLine {
    const full: JourneyLine = {
      ...line,
      sid: line.sid ?? this.sid ?? `${this.deviceId}-0`,
      seq: line.seq ?? ++this.lineSeq,
      t: line.t ?? Date.now(),
    };
    // A caller-supplied seq (reserved talk line, D18) must still advance the
    // counter — otherwise the next auto seq collides with it.
    if (line.seq !== undefined && line.seq > this.lineSeq) {
      this.lineSeq = line.seq;
    }
    this.outbox.push({ line: full, pkt: null });
    this.saveSd(full);
    this.persist();
    if (full.loai === 'session_end' || this.outbox.length >= FLUSH_AT) {
      void this.flush();
    }
    return full;
  }

  /** Reserve the seq a `talk` line will use (D18): peek, don't consume. */
  peekSeq(): number {
    return this.lineSeq + 1;
  }

  /** Flush pending lines, chunked ≤1500, ordered by insert order. */
  async flush(syncUrl = '/api/v1/device/sync'): Promise<SyncResult> {
    if (this.flushing) return { ok: true };
    this.flushing = true;
    try {
      while (this.outbox.length > 0) {
        const batch = this.outbox.slice(0, CHUNK);
        const pkt = this.nextPacketSeq();
        const res = await fetch(syncUrl, {
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
        // Mark the batch with its packet seq, then prune everything the BE
        // cumulatively acked (pkt ≤ ack_seq covers retries too).
        batch.forEach((e) => { e.pkt = pkt; });
        this.outbox = this.outbox.filter((e) => e.pkt === null || e.pkt > ack);
        this.persist();
      }
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: String(err) };
    } finally {
      this.flushing = false;
    }
  }

  /** Boot-time resend — call once on engine init. */
  async bootResend(): Promise<SyncResult | null> {
    return this.outbox.length ? this.flush() : null;
  }

  /** All lines of the current session (for the Preview submit). */
  sessionLines(): JourneyLine[] {
    if (!this.sid) return [];
    return this.outbox.map((e) => e.line).filter((l) => l.sid === this.sid);
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
