/**
 * Unified Device V3 Contract Client for Web Demo Simulator.
 *
 * Centralizes all `/api/v1/device/*`, `/api/v1/o/*`, and `/api/journeys/*` calls
 * so `bong-ai-web-demo` speaks the exact firmware wire contract with:
 * - In-memory Bearer token management (`POST /api/v1/device/auth`)
 * - RFC 3394 AES-KW content-key unwrapping (`GET /api/v1/device/key` & `manifest.keys.content_key`)
 * - `AbortController` timeout enforcement
 * - Zero raw key or token persistence in `localStorage`
 */

import { SimulatedDeviceSecurity } from './crypto-client';
import type {
  ListenResponse,
  TalkResponse,
  V3DeviceManifest,
  V3Option,
} from './types';

let inMemoryDeviceToken: string | null = null;

export function getInMemoryDeviceToken(): string | null {
  return inMemoryDeviceToken;
}

export function setInMemoryDeviceToken(token: string | null): void {
  inMemoryDeviceToken = token;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10000
): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const headers = new Headers(init.headers || {});
    if (inMemoryDeviceToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${inMemoryDeviceToken}`);
    }
    return await fetchImpl(url, {
      ...init,
      headers: Object.keys(init.headers || {}).length > 0 || inMemoryDeviceToken ? headers : init.headers,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface AuthDeviceParams {
  deviceId?: string;
  sig?: string;
  ts?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function authDevice(
  params: AuthDeviceParams = {}
): Promise<{ token: string; sync_hint: number }> {
  const {
    deviceId = 'simulator_v3_dev',
    sig = 'dev_bypass',
    ts = Math.floor(Date.now() / 1000),
    baseUrl = '',
    fetchImpl = fetch,
  } = params;

  const res = await fetchWithTimeout(
    `${baseUrl}/api/v1/device/auth`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, ts, sig }),
    },
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Device auth HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (data.token) {
    inMemoryDeviceToken = data.token;
  }
  return data;
}

export interface FetchDeviceKeyParams {
  deviceId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchDeviceKey(
  params: FetchDeviceKeyParams = {}
): Promise<{ key_alias: string; key_version: number; wrapped_key?: string; key_bytes?: string }> {
  const {
    deviceId = 'simulator_v3_dev',
    baseUrl = '',
    fetchImpl = fetch,
  } = params;

  if (!inMemoryDeviceToken) {
    try {
      await authDevice({ deviceId, baseUrl, fetchImpl });
    } catch {
      // Proceed even if auth endpoint is mocked or unavailable
    }
  }

  const res = await fetchWithTimeout(
    `${baseUrl}/api/v1/device/key?device_id=${encodeURIComponent(deviceId)}`,
    {},
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Device key HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (data.wrapped_key) {
    await SimulatedDeviceSecurity.unwrapAndStoreManifestKey(
      data.wrapped_key,
      data.key_version ?? 1,
      data.key_alias ?? `KEY_${data.key_version ?? 1}`
    );
  } else if (data.key_bytes) {
    SimulatedDeviceSecurity.saveWrappedContentKey(
      data.key_alias ?? 'KEY_1',
      data.key_version ?? 1,
      data.key_bytes
    );
  }
  return data;
}

export interface FetchManifestParams {
  deviceId?: string;
  fw?: string;
  caps?: string;
  ver?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchDeviceManifest(
  params: FetchManifestParams = {}
): Promise<V3DeviceManifest> {
  const {
    deviceId = 'simulator_v3_dev',
    fw = '1.0.18',
    caps = 'bong',
    ver,
    baseUrl = '',
    fetchImpl = fetch,
  } = params;

  const qs = new URLSearchParams({
    device_id: deviceId,
    fw,
    caps,
  });
  if (typeof ver === 'number') {
    qs.set('ver', String(ver));
  }

  const res = await fetchWithTimeout(
    `${baseUrl}/api/v1/device/manifest?${qs.toString()}`,
    {},
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Manifest HTTP ${res.status}: ${res.statusText}`);
  }
  const manifest: V3DeviceManifest = await res.json();

  if (manifest.keys?.content_key) {
    try {
      await SimulatedDeviceSecurity.unwrapAndStoreManifestKey(
        manifest.keys.content_key,
        manifest.key_version ?? 1,
        manifest.key_alias ?? `KEY_${manifest.key_version ?? 1}`
      );
    } catch (err) {
      console.warn('AES-KW unwrap skipped (k_dev mismatch or unprovisioned device):', err);
    }
  }

  return manifest;
}

export async function fetchDeviceBlob(
  hashOrUrl: string,
  blobBase = '/api/v1/o',
  fetchImpl: typeof fetch = fetch
): Promise<ArrayBuffer> {
  const cleanBase = blobBase.replace(/\/$/, '').replace(/^https?:\/\/[^/]+\/api\/v1\/o/, '/api/v1/o');
  const url =
    hashOrUrl.startsWith('/') || hashOrUrl.startsWith('http')
      ? hashOrUrl.replace(/^https?:\/\/[^/]+\/api\/v1\/o\//, '/api/v1/o/')
      : `${cleanBase}/${hashOrUrl}`;
  const res = await fetchWithTimeout(url, {}, fetchImpl);
  if (!res.ok) {
    throw new Error(`Blob HTTP ${res.status}: ${res.statusText}`);
  }
  return res.arrayBuffer();
}

export async function fetchJsonUrl<T = any>(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const res = await fetchWithTimeout(url, {}, fetchImpl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export interface PostListenParams {
  deviceId?: string;
  scene: string;
  step: string;
  mode?: string;
  prompt: string;
  options: Array<string | V3Option>;
  clip: Blob;
  sid?: string;
  seq?: number;
  lan?: number;
  sceneVer?: number;
  mver?: number;
  baseUrl?: string;
}

export async function postDeviceListen(
  params: PostListenParams,
  fetchImpl: typeof fetch = fetch
): Promise<ListenResponse> {
  const fd = new FormData();
  fd.append('device_id', params.deviceId || 'simulator_v3_dev');
  fd.append('scene', params.scene);
  fd.append('step', params.step);
  fd.append('mode', params.mode || 'voice');
  fd.append('prompt', params.prompt);
  fd.append('options', JSON.stringify(params.options));
  if (params.sid) fd.append('sid', params.sid);
  if (params.seq !== undefined) fd.append('seq', String(params.seq));
  if (params.lan !== undefined) fd.append('lan', String(params.lan));
  if (params.sceneVer !== undefined) fd.append('scene_ver', String(params.sceneVer));
  if (params.mver !== undefined) fd.append('mver', String(params.mver));
  fd.append('clip', params.clip, 'listen.wav');

  const res = await fetchWithTimeout(
    `${params.baseUrl || ''}/api/v1/device/listen`,
    { method: 'POST', body: fd },
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Listen HTTP ${res.status}`);
  }
  return res.json();
}

export interface PostTalkStartParams {
  deviceId?: string;
  scene: string;
  step: string;
  voice: string;
  prompt: string;
  seed?: string;
  options?: Array<string | V3Option>;
  turns: number;
  sec: number;
  sid?: string;
  seq?: number;
  sceneVer?: number;
  mver?: number;
  baseUrl?: string;
}

export async function postDeviceTalkStart(
  params: PostTalkStartParams,
  fetchImpl: typeof fetch = fetch
): Promise<TalkResponse> {
  const fd = new FormData();
  fd.append('device_id', params.deviceId || 'simulator_v3_dev');
  fd.append('scene', params.scene);
  fd.append('step', params.step);
  fd.append('voice', params.voice);
  fd.append('prompt', params.prompt);
  fd.append('seed', params.seed || '');
  fd.append('options', JSON.stringify(params.options || []));
  fd.append('turns', String(params.turns));
  fd.append('sec', String(params.sec));
  if (params.sid) fd.append('sid', params.sid);
  if (params.seq !== undefined) fd.append('seq', String(params.seq));
  if (params.sceneVer !== undefined) fd.append('scene_ver', String(params.sceneVer));
  if (params.mver !== undefined) fd.append('mver', String(params.mver));

  const res = await fetchWithTimeout(
    `${params.baseUrl || ''}/api/v1/device/talk/start`,
    { method: 'POST', body: fd },
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Talk start HTTP ${res.status}`);
  }
  return res.json();
}

export interface PostTalkTurnParams {
  session: string;
  clip: Blob;
  lan?: number;
  sid?: string;
  seq?: number;
  sceneVer?: number;
  mver?: number;
  textHint?: string;
  baseUrl?: string;
}

export async function postDeviceTalkTurn(
  params: PostTalkTurnParams,
  fetchImpl: typeof fetch = fetch
): Promise<TalkResponse> {
  const fd = new FormData();
  fd.append('session', params.session);
  fd.append('clip', params.clip, 'turn.wav');
  if (params.lan !== undefined) fd.append('lan', String(params.lan));
  if (params.sid) fd.append('sid', params.sid);
  if (params.seq !== undefined) fd.append('seq', String(params.seq));
  if (params.sceneVer !== undefined) fd.append('scene_ver', String(params.sceneVer));
  if (params.mver !== undefined) fd.append('mver', String(params.mver));
  if (params.textHint) fd.append('text', params.textHint);

  const res = await fetchWithTimeout(
    `${params.baseUrl || ''}/api/v1/device/talk/turn`,
    { method: 'POST', body: fd },
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Talk turn HTTP ${res.status}`);
  }
  return res.json();
}

export interface PostTalkEndParams {
  session: string;
  end: string;
  sid?: string;
  seq?: number;
  sceneVer?: number;
  mver?: number;
  baseUrl?: string;
}

export async function postDeviceTalkEnd(
  params: PostTalkEndParams,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean }> {
  const fd = new FormData();
  fd.append('session', params.session);
  fd.append('end', params.end);
  if (params.sid) fd.append('sid', params.sid);
  if (params.seq !== undefined) fd.append('seq', String(params.seq));
  if (params.sceneVer !== undefined) fd.append('scene_ver', String(params.sceneVer));
  if (params.mver !== undefined) fd.append('mver', String(params.mver));

  const res = await fetchWithTimeout(
    `${params.baseUrl || ''}/api/v1/device/talk/end`,
    { method: 'POST', body: fd },
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Talk end HTTP ${res.status}`);
  }
  return res.json();
}

export interface PostDeviceSyncParams {
  deviceId?: string;
  seq: number;
  logs: Array<string | Record<string, any>>;
  state?: Record<string, any>;
  baseUrl?: string;
}

export async function postDeviceSync(
  params: PostDeviceSyncParams,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok?: boolean; ack_seq: number }> {
  const res = await fetchWithTimeout(
    `${params.baseUrl || ''}/api/v1/device/sync`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: params.deviceId || 'simulator_v3_dev',
        seq: params.seq,
        logs: params.logs,
        ...(params.state ? { state: params.state } : {}),
      }),
    },
    fetchImpl
  );
  if (!res.ok) {
    throw new Error(`Sync HTTP ${res.status}`);
  }
  return res.json();
}

export async function postJourneyPreview(
  payload: Record<string, any>,
  baseUrl = '',
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetchWithTimeout(
    `${baseUrl}/api/journeys/preview`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    fetchImpl
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
