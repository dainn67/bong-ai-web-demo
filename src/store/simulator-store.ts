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
import { reportButtonPress, sendTelemetry } from '../protocol/telemetry-client';
import {
  classifyPress,
  pruneHistory,
  stepVolume,
  throttlePress,
  type ButtonAction,
} from '../hardware/button-press';
import { MicCapture } from '../audio/mic-capture';
import { OpusPlayer } from '../audio/opus-player';
import {
  toDisplayCommand,
  type IncomingMessage,
  type LessonQuestionIn,
} from '../protocol/message-types';
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
  reduceMenu,
  rowsFor,
  type DeviceMode,
  type MenuAction,
  type MenuState,
} from '../screen/menu-state';
import { IDLE_ACTIVITY, type ActivityState } from '../screen/activity-state';
import {
  parseTouchLayout,
  type TouchClassificationResult,
  type TouchDetail,
  type TouchLayoutType,
} from '../screen/touch-layout';
import { DEFAULT_TOUCH_TIMEOUT_MS } from '../lessons/lesson-v2-types';
import { parseCatalog, type LessonSummary } from '../lessons/catalog';
import { StoryPlayer, loadStory } from '../content/story';
import { LessonRunner } from '../lessons/lesson-runner';

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
const BARGE_IN_LEVEL = 0.65;

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
  /** Result of the last telemetry post, so the panel can say whether it landed. */
  telemetry: 'off' | 'sending' | 'ok' | 'error';
  telemetryError: string | null;
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
  catalog: LessonSummary[];
  catalogLoading: boolean;
  catalogError: string | null;
  /** A story or lesson currently running on the device. */
  activity: ActivityState;
  /**
   * Where a running lesson is, as one line — the app's `debugStatus`.
   *
   * Instrumentation, not device state: no badge reports its position in a
   * lesson to anyone. It lives here only so the drawer can show it.
   */
  lessonDebug: string | null;
  /** The same position, short enough for the glass: `2/3`. */
  lessonPosition: string | null;
  childName: string | null;
  loginModalOpen: boolean;
  setLoginModalOpen: (open: boolean) => void;

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
  /**
   * Hands a classified touch/swipe to whoever is waiting for one.
   *
   * That is the local lesson engine, the server, or the dev drawer, depending on
   * who opened the window — the caller does not need to know which.
   */
  dispatchTouch: (result: TouchClassificationResult, detail?: TouchDetail) => void;
  /**
   * The last classified touch, for the dev drawer.
   *
   * Instrumentation only — no device reports this to anyone. `at` is what makes
   * two identical results in a row distinguishable to a subscriber.
   */
  lastTouch: ({ result: TouchClassificationResult; at: number } & Partial<TouchDetail>) | null;
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
   * Back — up one level: out of an activity, then up the menu, then closed.
   *
   * With nothing open it opens the menu, so a press always does something.
   */
  pressBack: () => void;
  /** Home — the bail-out: close everything and show the idle face. */
  pressHome: () => void;
  /** The volume rocker. Shows the new level briefly on the glass. */
  pressVolume: (delta: number) => void;

  /** Drives the mode picker. `rowCount` comes from the reducer's own `rowsFor`. */
  menuDispatch: (action: MenuAction) => void;
  loadCatalog: () => Promise<void>;
  /** Picks a mode: free talk starts immediately, the others open a picker. */
  chooseMode: (mode: DeviceMode) => void;
  /** Starts the catalog entry the picker is showing. */
  startEntry: (entry: LessonSummary) => void;
  /** Leaves a running story or lesson and returns the screen to the face. */
  exitActivity: () => void;
  toggleActivityPause: () => void;
  setActivity: (patch: Partial<ActivityState>) => void;
  /** Dev/tester only: jump to the next node, skipping the clip or the mic. */
  skipLessonNode: () => void;
  /** The metadata the running lesson was built from, or null. */
  lessonMetadataUrl: () => string | null;
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
/** Whichever activity owns the speaker. Only ever one — see `stopActivity`. */
let story: StoryPlayer | null = null;
let lesson: LessonRunner | null = null;
/** Aborts an in-flight catalog or metadata fetch when the child moves on. */
let activityFetch: AbortController | null = null;
let noticeClearTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let telemetryTimer: ReturnType<typeof setInterval> | null = null;
let drainTimer: ReturnType<typeof setInterval> | null = null;
let lastDrainAt = Date.now();
/** Timestamps of presses the device accepted, for debounce and rate limiting. */
let pressHistory: number[] = [];
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
/** Fixed at load: the badge has been "on" for as long as the page has. */
const bootedAt = Date.now();
let unmuteTimer: ReturnType<typeof setTimeout> | null = null;
let lastBargeIn = 0;
let nextPacketId = 0;
/**
 * The layout of a touch window the *server* opened, or null.
 *
 * Doubles as the flag for whether an answer goes back on the wire. A local
 * lesson and the dev drawer both open windows too, and firing `lesson_touch` at
 * a backend that never asked would have it grading answers to questions it did
 * not set.
 */
let serverQuestion: TouchLayoutType | null = null;
/** Closes a server-opened question window when `timeout_ms` runs out. */
let questionTimer: ReturnType<typeof setTimeout> | null = null;

function clearQuestionTimer(): void {
  if (questionTimer) clearTimeout(questionTimer);
  questionTimer = null;
}

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
    telemetry: 'off',
    telemetryError: null,
    buttonNotice: null,
  },

  menu: INITIAL_MENU_STATE,
  catalog: [],
  catalogLoading: false,
  catalogError: null,
  activity: IDLE_ACTIVITY,
  lessonDebug: null,
  lessonPosition: null,
  lastTouch: null,
  childName: null,
  loginModalOpen: false,
  setLoginModalOpen: (open) => set({ loginModalOpen: open }),

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
    //
    // Nothing here needs to guard against a running activity — while one owns
    // the glass `RoundScreen` does not arm this at all, and the touch that
    // matters then is a question's, which `ActivityView` handles.
  },

  dispatchTouch: (result, detail) => {
    set({ lastTouch: { result, at: Date.now(), ...detail } });

    // Answered, so the window's own clock is done with.
    clearQuestionTimer();

    // Only a question the server opened gets an answer on the wire. A local
    // lesson's question is the engine's business and the server was never told
    // it existed; the dev drawer's is not a question at all.
    if (serverQuestion) {
      client?.sendTouch(serverQuestion, result, detail);
      serverQuestion = null;
    }

    lesson?.dispatchTouch(result);
  },

  setVolume: (volume) => {
    // One speaker, three things that might own it. The volume control is on
    // the device, so it has to reach whichever one is currently playing.
    player?.setVolume(volume);
    story?.setVolume(volume);
    lesson?.setVolume(volume);
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

    // The backend keeps its own count. Asking it as well is how the two are
    // ever seen to disagree; it cannot veto a press the device already took.
    void reportButtonPress(get().config)
      .then((result) => {
        if (result && !result.allowed) {
          setButtonNotice(set, get, result.message ?? 'Máy chủ chặn bớt nút bấm');
        }
      })
      .catch(() => {
        // No backend, or it is unhappy. The button still worked.
      });

    const action: ButtonAction = classifyPress(heldMs, awake);
    if (action === 'wake_up') {
      get().connect();
      return;
    }
    client?.sendButton(action);
    if (action === 'goodbye') get().disconnect();
  },

  reportCondition: () => {
    const { config, hardware } = get();
    const reading = {
      battery_level: hardware.battery,
      wifi_rssi: hardware.wifiRssi,
      is_charging: hardware.charging,
      firmware_version: config.firmwareVersion,
      uptime_seconds: Math.floor((Date.now() - bootedAt) / 1000),
      ...(hardware.faultCode
        ? { error_code: hardware.faultCode, error_message: `Giả lập: ${hardware.faultCode}` }
        : {}),
    };

    // The socket carries it too, since a real badge reports over whichever
    // link it already has open rather than dialling a second one.
    client?.sendBattery(hardware.battery, hardware.charging);
    if (hardware.faultCode) client?.sendError(hardware.faultCode, reading.error_message ?? '');

    if (!config.apiUrl) {
      set({ hardware: { ...get().hardware, telemetry: 'off', telemetryError: null } });
      return;
    }

    set({ hardware: { ...get().hardware, telemetry: 'sending' } });
    void sendTelemetry(config, reading)
      .then(() => set({ hardware: { ...get().hardware, telemetry: 'ok', telemetryError: null } }))
      .catch((error) => {
        const errStr = String(error?.message || error);
        set({
          hardware: { ...get().hardware, telemetry: 'error', telemetryError: errStr },
        });
        if (errStr.includes('DEVICE_NOT_FOUND') || errStr.includes('404')) {
          if (!get().loginModalOpen) {
            set({ loginModalOpen: true });
          }
        }
      });
  },

  pressBack: () => {
    const { activity, menu } = get();

    // Out of a story or lesson, and into the mode list rather than all the way
    // to the face — a child leaving one story is usually after another.
    if (activity.kind) {
      get().exitActivity();
      get().menuDispatch({ type: 'open' });
      return;
    }

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
    if (get().activity.kind) get().exitActivity();
    get().menuDispatch({ type: 'close' });
  },

  pressVolume: (delta) => {
    const volume = stepVolume(get().volume, delta);
    get().setVolume(volume);
    // Volume with no feedback is guesswork — on a device with no numbers
    // anywhere else, the only way to know a press registered is to show it.
    setButtonNotice(set, get, `🔊 ${Math.round(volume * 100)}%`);
  },

  skipLessonNode: () => {
    void lesson?.skipNext();
  },

  lessonMetadataUrl: () => lesson?.metadataUrl ?? null,

  menuDispatch: (action) => {
    const state = get();
    const rowCount = rowsFor(state.menu, state.catalog).length;
    const menu = reduceMenu(state.menu, action, rowCount);
    if (menu === state.menu) return;
    set({ menu });
    // If opening the menu and socket is disconnected, connect to receive content_catalog
    if (action.type === 'open' && state.catalog.length === 0 && get().status === 'disconnected') {
      get().connect();
    }
  },

  loadCatalog: async () => {
    // Catalog is delivered exclusively via WebSocket content_catalog frame upon connect.
    if (get().catalog.length === 0 && get().status === 'disconnected') {
      get().connect();
    }
  },

  chooseMode: (mode) => {
    if (mode === 'freetalk') {
      // Free talk is the socket the badge already speaks. There is nothing to
      // build here and nothing to pick — close the menu and make sure the
      // device is awake.
      stopActivity(set, get);
      set({ menu: INITIAL_MENU_STATE });
      if (get().status === 'disconnected') get().connect();
      return;
    }
    get().menuDispatch({ type: 'choose-mode', mode });
  },

  startEntry: (entry) => {
    if (entry.category === 'stories') void startStory(set, get, entry);
    else if (entry.category === 'topics') void startTopic(set, get, entry);
    else void startLesson(set, get, entry);
  },

  exitActivity: () => {
    const { activity } = get();
    stopActivity(set, get);
    if (activity.kind === 'story') client?.stopStory();
    else if (activity.kind === 'lesson') client?.stopLesson();
    client?.abort('exit_activity');
    set({
      activity: IDLE_ACTIVITY,
      menu: INITIAL_MENU_STATE,
      lessonDebug: null,
      lessonPosition: null,
      lastTouch: null,
    });
  },

  toggleActivityPause: () => {
    const { activity } = get();
    if (!activity.kind) return;

    // A local lesson is driven from `LessonRunner`, not from the socket, so its
    // engine has to be told directly. Without this the button moved the label
    // and nothing else: the clips kept playing.
    if (lesson) {
      void lesson.togglePause();
      return;
    }

    if (activity.phase === 'paused') {
      void ensurePlayer(set, get).resume();
      if (activity.kind === 'story') client?.resumeStory();
      else client?.resumeLesson();
      set({ activity: { ...activity, phase: 'playing' } });
    } else if (activity.phase === 'playing' || activity.phase === 'listening') {
      if (activity.kind === 'story') client?.pauseStory();
      else client?.pauseLesson();
      player?.stop();
      set({ activity: { ...activity, phase: 'paused' } });
    }
  },

  setActivity: (patch) => {
    const activity = { ...get().activity, ...patch };
    // Read the position back off the engine on every change rather than having
    // the engine push it: the engine already emits on every transition, so this
    // cannot fall behind, and the engine stays unaware that a drawer exists.
    set({
      activity,
      lessonDebug: lesson?.debugStatus ?? null,
      lessonPosition: lesson?.debugPosition ?? null,
    });
    // A grader's reason is a one-off. Leaving it on the glass would let it
    // outlive the answer it described.
    if (patch.notice) {
      if (noticeClearTimer) clearTimeout(noticeClearTimer);
      noticeClearTimer = setTimeout(
        () => set({ activity: { ...get().activity, notice: null } }),
        4_000,
      );
    }
  },
}));

type Setter = (partial: Partial<SimulatorState>) => void;
type Getter = () => SimulatorState;

/**
 * Tears down whatever owns the speaker.
 *
 * The device has one speaker, so the modes are mutually exclusive. Skipping
 * this would let a lesson play over a story, or over free talk, and the
 * resulting mess reads as an audio bug rather than as two sessions running at
 * once — which is exactly the kind of thing that eats an afternoon.
 */
function stopActivity(set: Setter, get: Getter): void {
  activityFetch?.abort();
  activityFetch = null;
  story?.stop();
  story = null;
  lesson?.dispose();
  lesson = null;
  if (noticeClearTimer) clearTimeout(noticeClearTimer);
  noticeClearTimer = null;
  // Any question window dies with the activity that posed it, and an answer
  // arriving afterwards belongs to nobody.
  clearQuestionTimer();
  serverQuestion = null;
  // The mic belongs to the lesson while one is running; hand it back.
  if (get().micState === 'listening') get().stopListening();
  set({ micLevel: 0, face: { ...get().face, said: '', heard: '' } });
}

/** Starts a story. Plays via StoryPlayer if metadata is available, and informs server. */
async function startStory(set: Setter, get: Getter, entry: LessonSummary): Promise<void> {
  stopActivity(set, get);
  set({
    menu: INITIAL_MENU_STATE,
    activity: { ...IDLE_ACTIVITY, kind: 'story', title: entry.title, imageUrl: entry.coverUrl ?? null, phase: 'playing' },
  });

  if (entry.metadataUrl) {
    try {
      const controller = new AbortController();
      activityFetch = controller;
      const loaded = await loadStory(entry.metadataUrl, controller.signal);
      activityFetch = null;
      story = new StoryPlayer(loaded, {
        onCue: (_index, text) => {
          set({ activity: { ...get().activity, caption: text } });
        },
        onEnded: () => {
          set({ activity: { ...get().activity, phase: 'finished' } });
        },
        onError: (err) => {
          set({ activity: { ...get().activity, phase: 'error', error: err } });
        },
      });
      await story.play();
      return;
    } catch {
      // If fetching fails or it's a websocket-only story, fall back to websocket stream
    }
  }

  if (get().status === 'disconnected') {
    await get().connect();
  }
  client?.startStory(entry.id);
}

/** Starts a lesson via server WebSocket stream. */
async function startLesson(set: Setter, get: Getter, entry: LessonSummary): Promise<void> {
  stopActivity(set, get);
  set({
    menu: INITIAL_MENU_STATE,
    activity: { ...IDLE_ACTIVITY, kind: 'lesson', title: entry.title, phase: 'playing' },
  });

  if (get().status === 'disconnected') {
    await get().connect();
  }
  client?.startLesson(entry.id);
}

/** Starts a topic conversation via server WebSocket stream. */
async function startTopic(set: Setter, get: Getter, entry: LessonSummary): Promise<void> {
  stopActivity(set, get);
  set({
    menu: INITIAL_MENU_STATE,
    activity: { ...IDLE_ACTIVITY, kind: 'lesson', title: entry.title, phase: 'playing' },
  });

  if (get().status === 'disconnected') {
    await get().connect();
  }
  client?.startTopic(entry.id);
}

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

  if (message.type === 'content_catalog') {
    const catalog = parseCatalog(message);
    set({
      catalog,
      catalogLoading: false,
      catalogError: null,
      childName: message.child_name || get().childName,
    });
    return;
  }

  if (message.type === 'lesson_question') {
    openServerQuestion(get, message);
    return;
  }

  if (message.type === 'activity_state') {
    const actState = message.state;
    if (actState === 'paused') {
      player?.stop();
      set({ activity: { ...get().activity, phase: 'paused' } });
    } else if (actState === 'playing') {
      set({ activity: { ...get().activity, phase: 'playing' } });
    } else if (actState === 'idle') {
      stopActivity(set, get);
      set({ activity: IDLE_ACTIVITY, menu: INITIAL_MENU_STATE });
    }
    return;
  }

  // Update activity state based on server events during streaming
  const { activity } = get();
  if (activity.kind) {
    if (message.type === 'tts' && message.text) {
      set({
        activity: { ...activity, caption: message.text, phase: 'playing' },
      });
    } else if (message.type === 'stt' && message.text) {
      set({
        activity: { ...activity, notice: `Bé: "${message.text}"` },
      });
    } else if (message.type === 'listen') {
      if (message.state === 'start') {
        set({ activity: { ...activity, phase: 'listening' } });
      } else if (message.state === 'stop') {
        set({ activity: { ...activity, phase: 'evaluating' } });
      }
    }

    const displayCmd = toDisplayCommand(message);
    if (displayCmd?.kind === 'image') {
      // Sequence bumped alongside the url, so the server re-sending the same
      // GIF for a second branch plays it again instead of showing a frozen
      // last frame. §3.3 of the touch protocol leans on this.
      const previous = get().activity;
      set({
        activity: {
          ...previous,
          imageUrl: displayCmd.url,
          imageSeq: (previous.imageSeq ?? 0) + 1,
        },
      });
    } else if (displayCmd?.kind === 'clear' || displayCmd?.kind === 'expression') {
      set({ activity: { ...get().activity, imageUrl: null } });
    }

  }

  if (message.type === 'tts' && message.state === 'sentence_start') {
    // The decoder's synthesised timestamps restart with every sentence, or a
    // long reply drifts out of sync and goes silent partway through.
    player?.startSentence();
  }

  // `tts.stop` is the one transition that needs a clock: the face holds its
  // expression briefly, then settles.
  if (message.type !== 'tts') return;
  clearIdleTimer();
  if (message.state === 'stop') {
    idleTimer = setTimeout(() => set({ face: toIdle(get().face) }), IDLE_DELAY_MS);
  }
}

/**
 * Opens the question window the server asked for — §3.2 of the touch protocol.
 *
 * The server-driven twin of what `V2Engine` does for a local lesson: put the
 * artwork up, light the wait ring, start the clock. Without it a backend-run
 * lesson can show a picture and then wait forever for an answer the glass gave
 * the child no way to give.
 */
function openServerQuestion(get: Getter, message: LessonQuestionIn): void {
  clearQuestionTimer();
  serverQuestion = null;

  const { activity, setActivity } = get();
  // A question can arrive before anything has claimed the glass: a lesson the
  // backend drives never went through `startEntry`. Claim it here, or
  // `ActivityView` renders nothing and the child watches a face while the badge
  // waits for an answer.
  const claim: Partial<ActivityState> = activity.kind
    ? {}
    : { kind: 'lesson', title: 'Bài học Bống', error: null };

  // A fresh url restarts the animation; no url leaves whatever is up alone.
  const artwork: Partial<ActivityState> = message.image_url
    ? { imageUrl: message.image_url, imageSeq: (activity.imageSeq ?? 0) + 1 }
    : {};

  if (message.question_type === 'speech') {
    setActivity({ ...claim, ...artwork, phase: 'listening', waitingFor: 'speech', touchLayout: null });
    // §3.2 describes the speech case as opening the mic, and the mic is ours.
    void get().startListening();
    return;
  }

  const layout = parseTouchLayout(message.touch_layout);
  if (!layout) {
    // Same rule as the lesson parser: never open a window against a grid the
    // artwork was not drawn to. Shown on the glass because in a simulator that
    // is where whoever is testing the backend is already looking.
    setActivity({
      ...claim,
      ...artwork,
      notice: `Layout chạm không hợp lệ: "${String(message.touch_layout)}"`,
    });
    return;
  }

  serverQuestion = layout;
  setActivity({
    ...claim,
    ...artwork,
    phase: 'touching',
    waitingFor: 'touch',
    touchLayout: layout,
    notice: null,
  });

  const timeoutMs =
    typeof message.timeout_ms === 'number' && message.timeout_ms > 0
      ? message.timeout_ms
      : DEFAULT_TOUCH_TIMEOUT_MS;

  questionTimer = setTimeout(() => {
    questionTimer = null;
    // Answered in the meantime — `dispatchTouch` got there first.
    if (serverQuestion !== layout) return;
    serverQuestion = null;

    // Reported rather than dropped: otherwise a child who simply does not touch
    // leaves the badge and the backend each waiting on the other. `silent` is
    // the name the lesson schema already gives that branch.
    client?.sendTouch(layout, 'silent');
    get().setActivity({ phase: 'playing', waitingFor: null, touchLayout: null });
  }, timeoutMs);
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
