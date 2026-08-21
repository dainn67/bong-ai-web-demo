/**
 * Simulator state, in one Zustand store.
 *
 * Zustand rather than context on purpose: the packet log updates many times a
 * second, and with a context every one of those would re-render the screen and
 * the controls too. Here a component subscribes to the one slice it draws.
 */

import { create } from 'zustand';
import { loadConfig, saveConfig, type DeviceConfig } from '../config/device-config';
import type { IncomingMessage } from '../protocol/message-types';
import type { ConnectionStatus } from '../protocol/ws-client';
import { WsClient } from '../protocol/ws-client';
import {
  INITIAL_FACE_STATE,
  IDLE_DELAY_MS,
  reduceFace,
  toIdle,
  type FaceState,
} from '../screen/face-state-machine';

export interface PacketLogEntry {
  id: number;
  direction: 'in' | 'out';
  type: string;
  payload: unknown;
  at: number;
}

/** Trimmed aggressively: an idle session still logs a heartbeat every 30s. */
const MAX_LOG_ENTRIES = 200;

interface SimulatorState {
  config: DeviceConfig;
  status: ConnectionStatus;
  sessionId: string | null;
  face: FaceState;
  packets: PacketLogEntry[];

  updateConfig: (patch: Partial<DeviceConfig>) => void;
  connect: () => void;
  disconnect: () => void;
  sendText: (text: string) => void;
  abort: () => void;
  clearPackets: () => void;
}

/**
 * The live client, held outside the store.
 *
 * It owns sockets and timers, which are not state — putting it in the store
 * would make every subscriber re-render whenever the socket ticked.
 */
let client: WsClient | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextPacketId = 0;

export const useSimulatorStore = create<SimulatorState>((set, get) => ({
  config: loadConfig(),
  status: 'disconnected',
  sessionId: null,
  face: INITIAL_FACE_STATE,
  packets: [],

  updateConfig: (patch) => {
    const config = { ...get().config, ...patch };
    saveConfig(config);
    set({ config });
  },

  connect: () => {
    // Tear down any previous client first, or its reconnect timer keeps firing
    // in the background and fights the new connection for the session.
    client?.disconnect();

    client = new WsClient(get().config, {
      onStatus: (status) => set({ status, sessionId: client?.currentSessionId ?? null }),
      onMessage: (message) => handleMessage(set, get, message),
      onAudio: () => {
        // Playback lands here once the audio pipeline exists. Dropping frames
        // until then is correct: the screen and protocol still work without it.
      },
      onLog: (direction, type, payload) => appendPacket(set, get, direction, type, payload),
    });
    void client.connect();
  },

  disconnect: () => {
    client?.disconnect();
    client = null;
    clearIdleTimer();
    set({ status: 'disconnected', sessionId: null, face: INITIAL_FACE_STATE });
  },

  sendText: (text) => {
    if (!text.trim()) return;
    client?.send({ type: 'listen', state: 'detect', text });
  },

  abort: () => client?.abort(),

  clearPackets: () => set({ packets: [] }),
}));

type Setter = (partial: Partial<SimulatorState>) => void;
type Getter = () => SimulatorState;

function handleMessage(set: Setter, get: Getter, message: IncomingMessage): void {
  const face = reduceFace(get().face, message);
  set({ face, sessionId: client?.currentSessionId ?? null });

  // `tts.stop` is the one transition that needs a clock: the face holds its
  // expression briefly, then settles. Restarting the timer on each stop means
  // a fast follow-up sentence cancels the pending drop instead of stacking.
  clearIdleTimer();
  if (message.type === 'tts' && message.state === 'stop') {
    idleTimer = setTimeout(() => set({ face: toIdle(get().face) }), IDLE_DELAY_MS);
  }
}

function appendPacket(
  set: Setter,
  get: Getter,
  direction: 'in' | 'out',
  type: string,
  payload: unknown,
): void {
  const entry: PacketLogEntry = { id: nextPacketId++, direction, type, payload, at: Date.now() };
  set({ packets: [entry, ...get().packets].slice(0, MAX_LOG_ENTRIES) });
}

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}
