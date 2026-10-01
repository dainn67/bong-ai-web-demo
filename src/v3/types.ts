/**
 * TypeScript types for Offline-First Script Engine v3.
 * Reference: docs/kien-truc-offline-first-va-script-engine-v3.md
 * Contract: Bong-AI-Cap-nhat-doi-ky-thuat-29-09.md (§3) — options {name,desc},
 * Excel `when` strings, `hear` mode, single-object `retry`, `ignore_silence`,
 * talk block, manifest prompt store.
 */

export type OrbExpression =
  | 'idle'
  | 'happy'
  | 'thinking'
  | 'surprised'
  | 'cool'
  | 'delicious'
  | 'crying'
  | 'winking'
  | 'loving'
  | 'sleepy';

export interface V3AudioNode {
  src: string | string[]; // Single id or array for uniform random pick
  url?: string; // Download URL — firmware contract (node without url is skipped on device)
  wait?: number; // Gap before playing in ms (0-60000)
  volume?: number; // 0-100 override
}

export interface V3VisualNode {
  src: string | string[];
  url?: string; // Download URL — firmware contract
  duration?: number; // ms to display (for static images)
  repeat?: 'once' | 'loop' | number;
  hold?: boolean; // Keep last frame visible until next visual node
}

export type V3TouchLayout = 'tb2' | 'lr2' | 'pie3' | 'pie4' | 'swipe';

export interface V3TouchConfig {
  layout: V3TouchLayout;
  timeout?: number; // ms (default 10000)
}

/** A single answer option — LLM returns `name`, firmware maps to `reply`. */
export interface V3Option {
  name: string; // ^[a-z0-9_]+$ or {lists.x.value} placeholder
  desc: string; // free text, may contain placeholders
}

export interface V3VoiceConfig {
  options: V3Option[]; // required, non-empty
  prompt: string; // inline text or "{prompts.x}" token(s)
  timeout?: number;
  vad_end?: number;
}

export interface V3RetryConfig {
  on: string[]; // reply values that trigger the single re-ask
  audio: V3AudioNode[]; // re-ask line(s)
}

export type V3ListenMode = 'hear' | 'voice' | 'touch' | 'pet' | 'none';

export interface V3ListenConfig {
  mode: V3ListenMode;
  voice?: V3VoiceConfig; // required when mode === 'voice'
  touch?: V3TouchConfig; // required when mode === 'touch'
  retry?: V3RetryConfig; // single re-ask, at most once per step
  ignore_silence?: boolean; // don't count silent toward silent_streak
  timeout?: number;
}

export interface V3TalkConfig {
  voice: string; // character voice — never Bống's
  prompt: string; // may contain {prompts.x}, {history}, {today}, {options}
  seed?: string;
  turns: number;
  sec: number;
  timeout?: number;
  ignore_silence?: boolean;
  options: V3Option[]; // exit branches
}

/**
 * `when` is always a STRING — Excel-style expression:
 *   "{reply} = cat"  ·  "AND({reply} = more, {sys.time} >= {profile.bedtime})"
 *   "OR({reply} = silent, {reply} = unclear)"  ·  "NOT({tmp.z} < 3)"
 *   "ISBLANK({stat.guide_done})"
 * or the literal "default" (must be the last branch).
 */
export interface V3Branch {
  when: string; // Excel expr or 'default'
  go?: string; // Target step id, SCENE#step, or SCENE — may contain {placeholders}
  next?: string; // Alias for go
  save?: Record<string, any>;
}

export interface V3Step {
  id: string;
  orb?: OrbExpression;
  screen?: {
    brightness?: number;
    base?: 'orb' | 'custom';
  };
  volume?: number;
  audio?: V3AudioNode[];
  visual?: V3VisualNode[];
  listen?: V3ListenConfig;
  talk?: V3TalkConfig;
  branches?: V3Branch[];
  next?: string; // Direct next step if no listen/branches
  save?: Record<string, any>; // Mutations committed at end of step
}

export interface V3Scene {
  id: string;
  entry: string; // Starting step id
  screen?: {
    base?: 'orb' | 'custom';
    orb?: OrbExpression;
    brightness?: number;
  };
  volume?: number;
  ignore_volume_cap?: boolean;
  save?: Record<string, any>; // Scene-level save on entry
  steps: V3Step[];
}

export interface MemorySpaces {
  sys: {
    rnd: number;
    silent_streak: number;
    net: boolean;
    time: string;
    battery: number;
    first_run: boolean;
    last_utterance?: string;
    sleep_gap?: number;
    plan?: string;
    tts_left?: number;
    cfg?: Partial<DeviceManifestConfig>;
  };
  profile: {
    child_name: string;
    bong_name: string;
    bedtime: string;
    lesson_from: string;
    lesson_to: string;
  };
  learn: Record<string, any>;
  user: Record<string, any>;
  stat: {
    today_min: number;
    sessions: number;
    guide_done?: boolean;
    onboard_done?: boolean;
    [key: string]: any;
  };
  tmp: Record<string, any>; // Cleared when device sleeps
}

/**
 * Device Runtime Config per Phase-1 sync contract — 8 keys.
 */
export interface DeviceManifestConfig {
  listen_timeout: number;
  touch_timeout: number;
  vad_end: number;
  silent_streak: number;
  no_reply_min: number;
  loop_guard: number;
  think_ms: number;
  server_timeout: number;
}

export interface DeviceManifestProfile {
  child_name: string;
  bong_name: string;
}

export interface ManifestSceneItem {
  id: string;
  ver: number;
  hash: string;
  pin?: boolean;
}

export interface ManifestFileItem {
  id: string;
  hash: string;
  size: number;
  kind: 'audio' | 'image' | string;
}

/**
 * Full device manifest response per Phase-1 sync contract.
 * Corresponds to GET /api/v1/device/manifest.
 */
export interface V3DeviceManifest {
  fmt: number;
  ver: number;
  key_version?: number | null;
  key_alias?: string | null;
  blob_base?: string | null;
  cfg: DeviceManifestConfig;
  profile: DeviceManifestProfile;
  wanted: string[];
  scenes: ManifestSceneItem[];
  files: ManifestFileItem[];
  prompts: Record<string, string>;
  lists?: Record<string, Array<{ value: string; say?: string[] }>>;
}

/** /listen response — raw LLM reply + transcript (no match/confidence). */
export interface ListenResponse {
  reply: string;
  transcript?: string;
}

/** /talk/start + /talk/turn response. */
export interface TalkResponse {
  audio: string; // base64 MP3
  branch: string; // continue|<option>|limit|safety|error|silent
  topic?: string;
  tts_left?: number;
  sync_hint?: boolean;
  session?: string;
}

/** One device log line (2.2.6) — no `match`, `retried` instead of `attempt`. */
export interface DeviceLogEntry {
  t: string;
  scene: string;
  step: string;
  mode: string;
  reply: string;
  retried: 0 | 1;
  ms: number;
  seq: number;
}
