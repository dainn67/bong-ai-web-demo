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
import { clampBattery, drainBattery, LOW_BATTERY } from '../hardware/hardware-state';
import {
  classifyPress,
  pruneHistory,
  stepVolume,
  throttlePress,
  type ButtonAction,
} from '../hardware/button-press';
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
import {
  INITIAL_MENU_STATE,
  MODE_INTENTS,
  MODE_ORDER,
  reduceMenu,
  type DeviceMode,
  type MenuAction,
  type MenuState,
} from '../screen/menu-state';

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

/** The badge's physical condition, as the parent app would eventually see it. */
export interface HardwareState {
  battery: number;
  charging: boolean;
  /** dBm. Closer to zero is stronger. */
  wifiRssi: number;
  /** Whether the battery moves on its own. Off by default so a demo holds still. */
  autoDrain: boolean;
  /** An injected fault, reported until cleared. */
  faultCode: string | null;
  /**
   * Why the last press was ignored, if it was.
   *
   * Shown on the badge rather than logged: a child mashing the button needs to
   * see that something happened, or they press harder.
   */
  buttonNotice: string | null;
}

/** How often condition is reported while connected. */
const TELEMETRY_INTERVAL_MS = 30_000;

/** How often the battery is re-computed when draining. */
const DRAIN_TICK_MS = 5_000;

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

  hardware: HardwareState;

  /** The mode picker on the glass. Test instrumentation — see `menu-state.ts`. */
  menu: MenuState;

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

  setHardware: (patch: Partial<HardwareState>) => void;
  /**
   * Presses the badge's physical button, having held it for `heldMs`.
   *
   * One button, so how long it was held is what decides the meaning.
   */
  pressButton: (heldMs: number) => void;
  /** Reports condition now, rather than waiting for the next interval. */
  reportCondition: () => void;

  /**
   * Back — closes the menu, or opens it when nothing is open.
   *
   * A press always does something, which is what makes the button
   * discoverable at all.
   */
  pressBack: () => void;
  /** Home — the bail-out: close the menu and show the idle face. */
  pressHome: () => void;
  /** The volume rocker. Shows the new level briefly on the glass. */
  pressVolume: (delta: number) => void;

  /** Drives the mode picker. */
  menuDispatch: (action: MenuAction) => void;
  /**
   * Picks a mode by saying so.
   *
   * There is no start-lesson frame in the protocol — see `MODE_INTENTS`.
   */
  chooseMode: (mode: DeviceMode) => void;
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
let telemetryTimer: ReturnType<typeof setInterval> | null = null;
let drainTimer: ReturnType<typeof setInterval> | null = null;
let lastDrainAt = Date.now();
/** Timestamps of presses the device accepted, for debounce and rate limiting. */
let pressHistory: number[] = [];
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
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

  hardware: {
    battery: 82,
    charging: false,
    wifiRssi: -55,
    autoDrain: false,
    faultCode: null,
    buttonNotice: null,
  },

  menu: INITIAL_MENU_STATE,

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
    startHardwareTimers(set, get);
  },

  disconnect: () => {
    client?.disconnect();
    client = null;
    get().stopListening();
    void player?.close();
    player = null;
    clearIdleTimer();
    clearUnmuteTimer();
    stopHardwareTimers();
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
    // One speaker, and now only one thing that can own it: everything audible
    // arrives as Opus on the socket, lesson clips included.
    player?.setVolume(volume);
    set({ volume });
  },

  setHardware: (patch) => {
    const hardware = { ...get().hardware, ...patch };
    if (patch.battery !== undefined) hardware.battery = clampBattery(patch.battery);
    set({ hardware });
    // Report straight away: a slider moved by hand is a deliberate act, and
    // waiting up to thirty seconds to see it land makes the panel feel broken.
    get().reportCondition();
  },

  pressButton: (heldMs) => {
    const now = Date.now();
    const awake = get().status === 'connected';

    // Debounced in the device, the way firmware does, so mashing behaves the
    // same whether or not a backend is reachable.
    const verdict = throttlePress(pressHistory, now);
    if (!verdict.allowed) {
      setButtonNotice(set, get, verdict.message ?? 'Bé đợi Bống một chút nhé!');
      return;
    }
    pressHistory = [...pruneHistory(pressHistory, now), now];
    setButtonNotice(set, get, null);

    const action: ButtonAction = classifyPress(heldMs, awake);
    if (action === 'wake_up') {
      get().connect();
      return;
    }
    client?.sendButton(action);
    if (action === 'goodbye') get().disconnect();
  },

  reportCondition: () => {
    const { hardware } = get();
    // Over the socket, because that is the only link a badge has. The server
    // forwards it to /internal/device-proxy/telemetry, which is where battery
    // and RSSI land in the row the parent app reads.
    client?.sendBattery(hardware.battery, hardware.charging);
    if (hardware.faultCode) {
      client?.sendError(hardware.faultCode, `Giả lập: ${hardware.faultCode}`);
    }
  },

  pressBack: () => {
    const { menu } = get();

    // Nothing open, so there is nothing to go back from. Opening the menu is
    // the only sensible thing a press can do, and it means the button always
    // does *something* — which is what makes it discoverable at all.
    if (menu.view.screen === 'closed') {
      get().menuDispatch({ type: 'open' });
      return;
    }

    get().menuDispatch({ type: 'back' });
  },

  pressHome: () => {
    // Home is the idle face, the way it is the home screen on a phone. This is
    // the bail-out: whatever is open, close it.
    //
    // It no longer stops anything. Leaving a lesson is telling the server you
    // want to leave — say "con muốn dừng bài học", or hold ⏻ for goodbye, which
    // drops the socket and ends the session the way a real badge does.
    get().menuDispatch({ type: 'close' });
  },

  pressVolume: (delta) => {
    const volume = stepVolume(get().volume, delta);
    get().setVolume(volume);
    // Volume with no feedback is guesswork — on a device with no numbers
    // anywhere else, the only way to know a press registered is to show it.
    setButtonNotice(set, get, `🔊 ${Math.round(volume * 100)}%`);
  },

  menuDispatch: (action) => {
    const menu = reduceMenu(get().menu, action, MODE_ORDER.length);
    if (menu === get().menu) return;
    set({ menu });
  },

  /**
   * Enters a mode by saying its name out loud.
   *
   * All three arms close the menu and make sure the socket is up, because that
   * is all any of them can do — the badge has no other lever. Free talk is what
   * the socket already is, so it stops there; the other two put a sentence on
   * the wire and hand over.
   *
   * Deliberately fire-and-forget. Whether the server understood is answered by
   * what comes back, not by anything decidable here, and pretending otherwise
   * would mean inventing a "starting lesson…" state the device cannot know is
   * true. If nothing happens, the packet inspector is where to look.
   */
  chooseMode: (mode) => {
    set({ menu: INITIAL_MENU_STATE });
    if (get().status === 'disconnected') {
      get().connect();
      // The socket is not open yet, so there is nothing to say into. Free talk
      // needed no phrase anyway; for the others this connects and the tester
      // picks again, which is one click and honest about what happened.
      return;
    }
    const intent = MODE_INTENTS[mode];
    if (intent) get().sendText(intent);
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
  // expression briefly, then settles.
  //
  // Only speech frames touch the timer. Clearing it on *every* message was a
  // bug: any frame arriving inside the one-second linger — a heartbeat, an
  // `iot` command, a `display` update — cancelled the pending drop and left the
  // face stuck mid-expression until the next reply. Rare at chat frame rates,
  // routine once a lesson is pushing frames through the same path.
  if (message.type !== 'tts') return;
  clearIdleTimer();
  if (message.state === 'stop') {
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

/**
 * Runs the battery down and reports condition while the badge is on.
 *
 * Both tick on a wall clock rather than counting ticks, so a backgrounded tab —
 * where browsers throttle timers hard — comes back with a battery that moved by
 * the time that actually passed.
 */
function startHardwareTimers(set: Setter, get: Getter): void {
  stopHardwareTimers();
  lastDrainAt = Date.now();

  drainTimer = setInterval(() => {
    const { hardware } = get();
    const now = Date.now();
    const elapsed = now - lastDrainAt;
    lastDrainAt = now;
    if (!hardware.autoDrain) return;

    const battery = drainBattery(hardware.battery, hardware.charging, elapsed);
    if (battery === hardware.battery) return;
    set({ hardware: { ...hardware, battery } });

    // Flat battery is the end of the session, which is exactly the state the
    // parent app's "device offline" path needs to be tested against.
    if (battery === 0) get().disconnect();
  }, DRAIN_TICK_MS);

  telemetryTimer = setInterval(() => get().reportCondition(), TELEMETRY_INTERVAL_MS);
  get().reportCondition();
}

/** Shows why a press was ignored, and clears it again so it does not linger. */
function setButtonNotice(set: Setter, get: Getter, message: string | null): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  set({ hardware: { ...get().hardware, buttonNotice: message } });
  if (!message) return;
  noticeTimer = setTimeout(
    () => set({ hardware: { ...get().hardware, buttonNotice: null } }),
    2500,
  );
}

function stopHardwareTimers(): void {
  if (drainTimer) clearInterval(drainTimer);
  if (telemetryTimer) clearInterval(telemetryTimer);
  drainTimer = null;
  telemetryTimer = null;
}

export { LOW_BATTERY };
