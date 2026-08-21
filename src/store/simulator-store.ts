/**
 * Simulator state, in one Zustand store.
 *
 * Zustand rather than context on purpose: the packet log updates many times a
 * second, and with a context every one of those would re-render the screen and
 * the controls too. Here a component subscribes to the one slice it draws.
 */

import { create } from 'zustand';
import { loadConfig, saveConfig, type DeviceConfig } from '../config/device-config';
import { audioSupport } from '../audio/audio-format';
import { MicCapture } from '../audio/mic-capture';
import { OpusPlayer } from '../audio/opus-player';
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

/**
 * How long the uplink stays muted after the badge stops talking.
 *
 * A room reverberates, and the tail of the badge's own sentence reaching the
 * mic reads as the child starting to speak.
 */
const ECHO_HANGOVER_MS = 600;

/** Mic loudness that counts as the child talking over the reply. */
const BARGE_IN_LEVEL = 0.35;

/** Ignore repeat barge-ins inside this window, so one sentence cuts in once. */
const BARGE_IN_DEBOUNCE_MS = 1500;

/** Whether the mic is off, or open and streaming to the backend. */
export type MicState = 'off' | 'listening';

interface SimulatorState {
  config: DeviceConfig;
  status: ConnectionStatus;
  sessionId: string | null;
  face: FaceState;
  packets: PacketLogEntry[];

  micState: MicState;
  /** Mic loudness, 0..1, for the level meter. */
  micLevel: number;
  /** True while the speaker is actually producing sound. */
  speaking: boolean;
  volume: number;
  audioError: string | null;
  /** Opus frames in each direction. The only proof audio is moving at all. */
  framesIn: number;
  framesOut: number;

  updateConfig: (patch: Partial<DeviceConfig>) => void;
  connect: () => void;
  disconnect: () => void;
  sendText: (text: string) => void;
  abort: () => void;
  clearPackets: () => void;

  startListening: () => Promise<void>;
  stopListening: () => void;
  toggleListening: () => void;
  /** What a tap on the glass does, which depends on whether the badge is awake. */
  tapScreen: () => void;
  setVolume: (volume: number) => void;
}

/**
 * The live client, held outside the store.
 *
 * It owns sockets and timers, which are not state — putting it in the store
 * would make every subscriber re-render whenever the socket ticked. The audio
 * objects are here for the same reason: they own hardware, not data.
 */
let client: WsClient | null = null;
let player: OpusPlayer | null = null;
let mic: MicCapture | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let unmuteTimer: ReturnType<typeof setTimeout> | null = null;
let lastBargeIn = 0;
let nextPacketId = 0;

export const useSimulatorStore = create<SimulatorState>((set, get) => ({
  config: loadConfig(),
  status: 'disconnected',
  sessionId: null,
  face: INITIAL_FACE_STATE,
  packets: [],

  micState: 'off',
  micLevel: 0,
  speaking: false,
  volume: 1,
  audioError: null,
  framesIn: 0,
  framesOut: 0,

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
      onAudio: (frame) => {
        set({ framesIn: get().framesIn + 1 });
        ensurePlayer(set, get).decode(frame);
      },
      onLog: (direction, type, payload) => appendPacket(set, get, direction, type, payload),
    });
    void client.connect();
  },

  disconnect: () => {
    client?.disconnect();
    client = null;
    get().stopListening();
    void player?.close();
    player = null;
    clearIdleTimer();
    clearUnmuteTimer();
    set({
      status: 'disconnected',
      sessionId: null,
      face: INITIAL_FACE_STATE,
      speaking: false,
      framesIn: 0,
      framesOut: 0,
    });
  },

  sendText: (text) => {
    if (!text.trim()) return;
    client?.send({ type: 'listen', state: 'detect', text });
  },

  abort: () => {
    player?.stop();
    set({ speaking: false });
    client?.abort();
  },

  clearPackets: () => set({ packets: [] }),

  /**
   * Opens the mic and starts streaming.
   *
   * `listen`/`start` in auto mode hands turn-taking to the backend's VAD, which
   * is how the real badge works — there is no push-to-talk button on it.
   */
  startListening: async () => {
    const support = audioSupport();
    if (!support.ok) {
      set({ audioError: support.reason });
      return;
    }

    // Opening the speaker here rides the click that started the mic. Deferring
    // it to the first arriving frame means no gesture is in progress and the
    // AudioContext stays suspended, playing nothing.
    await ensurePlayer(set, get).resume();

    mic ??= new MicCapture(get().config.sampleRate, {
      onFrame: (frame) => {
        client?.sendAudio(frame);
        set({ framesOut: get().framesOut + 1 });
      },
      onLevel: (level) => handleLevel(set, get, level),
      onError: (message) => set({ audioError: message }),
    });

    const started = await mic.start();
    if (!started) return;

    client?.send({ type: 'listen', state: 'start', mode: 'auto' });
    set({ micState: 'listening', audioError: null });
  },

  stopListening: () => {
    if (get().micState === 'listening') client?.send({ type: 'listen', state: 'stop' });
    void mic?.stop();
    mic = null;
    clearUnmuteTimer();
    set({ micState: 'off', micLevel: 0 });
  },

  toggleListening: () => {
    const { micState, startListening, stopListening } = get();
    if (micState === 'listening') stopListening();
    else void startListening();
  },

  /**
   * The whole of the badge's physical interface, in one gesture.
   *
   * Asleep, a touch wakes it; awake, it opens and closes the microphone. The
   * hardware has one surface and no labels on it, so what a touch means has to
   * come from what the device is currently doing.
   */
  tapScreen: () => {
    const { status, connect, toggleListening } = get();
    if (status === 'disconnected') connect();
    else if (status === 'connected') toggleListening();
    // Mid-connection a tap is ignored rather than queued: the wake is already
    // under way, and a second one would tear down the socket that is opening.
  },

  setVolume: (volume) => {
    player?.setVolume(volume);
    set({ volume });
  },
}));

type Setter = (partial: Partial<SimulatorState>) => void;
type Getter = () => SimulatorState;

function ensurePlayer(set: Setter, get: Getter): OpusPlayer {
  player ??= new OpusPlayer(get().config.sampleRate, {
    onPlayingChange: (speaking) => {
      set({ speaking });
      // Mute on the way up, release on a delay on the way down.
      if (speaking) {
        clearUnmuteTimer();
        mic?.setMuted(true);
      } else {
        clearUnmuteTimer();
        unmuteTimer = setTimeout(() => mic?.setMuted(false), ECHO_HANGOVER_MS);
      }
    },
    onError: (message) => set({ audioError: message }),
  });
  return player;
}

/**
 * Barge-in: the child talking over a reply cuts it off.
 *
 * Only meaningful while the badge is speaking — the rest of the time the mic
 * level is just a meter. The uplink is muted during playback, so this reads a
 * level that is deliberately not being transmitted.
 */
function handleLevel(set: Setter, get: Getter, level: number): void {
  set({ micLevel: level });
  if (!get().speaking || level < BARGE_IN_LEVEL) return;

  const now = Date.now();
  if (now - lastBargeIn < BARGE_IN_DEBOUNCE_MS) return;
  lastBargeIn = now;

  player?.stop();
  client?.abort('barge_in');
  set({ speaking: false });
}

function handleMessage(set: Setter, get: Getter, message: IncomingMessage): void {
  const face = reduceFace(get().face, message);
  set({ face, sessionId: client?.currentSessionId ?? null });

  if (message.type === 'tts' && message.state === 'sentence_start') {
    // The decoder's synthesised timestamps restart with every sentence, or a
    // long reply drifts out of sync and goes silent partway through.
    player?.startSentence();
  }

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

function clearUnmuteTimer(): void {
  if (unmuteTimer) clearTimeout(unmuteTimer);
  unmuteTimer = null;
}
