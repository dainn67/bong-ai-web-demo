/**
 * TypeScript types for Offline-First Script Engine v3.
 * Reference: docs/kien-truc-offline-first-va-script-engine-v3.md
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
  wait?: number; // Gap before playing in ms (0-60000)
  volume?: number; // 0-100 override
}

export interface V3VisualNode {
  src: string | string[];
  duration?: number; // ms to display (for static images)
  repeat?: 'once' | 'loop' | number;
  hold?: boolean; // Keep last frame visible until next visual node
}

export type V3TouchLayout = 'tb2' | 'lr2' | 'pie3' | 'pie4' | 'swipe';

export interface V3TouchConfig {
  layout: V3TouchLayout;
  timeout?: number; // ms (default 10000)
}

export interface V3VoiceConfig {
  options: 'any' | string[]; // 'any' runs locally, string[] calls POST /listen
  expect?: string[];
  desc?: string[];
  hints?: string[];
  prompt?: string;
  prompt_ref?: string;
  min_conf?: number; // 0.0 - 1.0 (default 0.6)
  timeout?: number;
  vad_end?: number;
}

export interface V3RetryConfig {
  on: ('silent' | 'unclear')[];
  max: number; // max 2
  audio?: V3AudioNode[];
}

export interface V3ListenConfig {
  mode: 'voice' | 'touch' | 'none';
  voice?: V3VoiceConfig;
  touch?: V3TouchConfig;
  retry?: V3RetryConfig;
  optional?: boolean;
}

export interface V3BranchCondition {
  // Key = field to check (e.g. "reply", "sys.attempt", "learn.word.cat")
  // Value = expected match or comparison object
  [key: string]: any;
}

export interface V3Branch {
  when?: V3BranchCondition | 'default';
  go?: string; // Target step id or scene#step
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
  prompts?: Record<string, string>;
  save?: Record<string, any>; // Scene-level save on entry
  steps: V3Step[];
}

export interface MemorySpaces {
  sys: {
    rnd: number;
    attempt: number;
    match: string | null;
    silent_streak: number;
    net: boolean;
    time: string;
    battery: number;
    first_run: boolean;
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
    [key: string]: any;
  };
  tmp: Record<string, any>; // Cleared when device sleeps
}
