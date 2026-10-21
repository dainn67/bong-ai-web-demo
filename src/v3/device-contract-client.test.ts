import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SimulatedDeviceSecurity,
  unwrapContentKeyHex,
  encryptBongAsset,
  decryptBongAsset,
  uint8ArrayToBase64,
} from './crypto-client';
import {
  fetchDeviceManifest,
  postDeviceListen,
  postDeviceTalkStart,
  postDeviceTalkTurn,
  postDeviceTalkEnd,
  postDeviceSync,
} from './device-contract-client';

// Known RFC 3394 test vector or WebCrypto AES-KW wrap helper
async function wrapKeyWithKDevHex(plainKey32: Uint8Array, kDevHex: string): Promise<string> {
  const kekBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    kekBytes[i] = parseInt(kDevHex.slice(i * 2, i * 2 + 2), 16);
  }
  const kek = await crypto.subtle.importKey('raw', kekBytes, { name: 'AES-KW' }, false, ['wrapKey']);
  const targetKey = await crypto.subtle.importKey(
    'raw',
    plainKey32.buffer.slice(plainKey32.byteOffset, plainKey32.byteOffset + plainKey32.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt']
  );
  const wrappedBuf = await crypto.subtle.wrapKey('raw', targetKey, kek, 'AES-KW');
  return Array.from(new Uint8Array(wrappedBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('device-contract-client & RFC 3394 AES-KW security', () => {
  beforeEach(() => {
    SimulatedDeviceSecurity.resetSimulatedKeys();
  });

  it('unwraps 80-hex AES-KW content_key using k_dev and never persists plaintext K_content to localStorage', async () => {
    const kDevHex = SimulatedDeviceSecurity.getDeviceRootKey0Hex();
    const rawKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) rawKey[i] = (i * 7 + 3) & 0xff;

    const wrappedHex = await wrapKeyWithKDevHex(rawKey, kDevHex);
    expect(wrappedHex).toHaveLength(80);

    const unwrapped = await unwrapContentKeyHex(wrappedHex, kDevHex);
    expect(Array.from(unwrapped)).toEqual(Array.from(rawKey));

    await SimulatedDeviceSecurity.unwrapAndStoreManifestKey(wrappedHex, 2, 'KEY_2');
    const activeBytes = SimulatedDeviceSecurity.getActiveContentKeyBytes();
    expect(activeBytes).not.toBeNull();
    expect(Array.from(activeBytes!)).toEqual(Array.from(rawKey));

    // Verify localStorage does not contain the raw base64 or hex of rawKey
    const rawBase64 = uint8ArrayToBase64(rawKey);
    const rawHex = Array.from(rawKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        const v = localStorage.getItem(k) || '';
        expect(v).not.toContain(rawBase64);
        expect(v).not.toContain(rawHex);
      }
    }

    // Verify BONG asset encrypted with rawKey decrypts cleanly with active key
    const sample = new TextEncoder().encode('{"id":"HAHA","entry":"intro","steps":[]}');
    const env = await encryptBongAsset(sample, rawBase64, 2);
    const dec = await decryptBongAsset(env, SimulatedDeviceSecurity.getActiveContentKeyBase64()!);
    expect(new TextDecoder().decode(dec)).toBe('{"id":"HAHA","entry":"intro","steps":[]}');
  });

  it('fetches manifest with caps=bong&fw=1.0.18 and unwraps keys.content_key automatically', async () => {
    const kDevHex = SimulatedDeviceSecurity.getDeviceRootKey0Hex();
    const rawKey = new Uint8Array(32).fill(0x42);
    const wrappedHex = await wrapKeyWithKDevHex(rawKey, kDevHex);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        fmt: 1,
        ver: 3,
        key_version: 1,
        key_alias: 'KEY_1',
        keys: { content_key: wrappedHex },
        cfg: {
          listen_timeout: 10000,
          touch_timeout: 10000,
          vad_end: 800,
          silent_streak: 4,
          no_reply_min: 10,
          loop_guard: 25,
          think_ms: 500,
          server_timeout: 8000,
        },
        profile: { child_name: 'Bé Bống', bong_name: 'Bống' },
        wanted: ['START', 'HAHA', 'MAGIC_BOOK', 'END'],
        scenes: [],
        files: [],
        prompts: {},
        lists: {},
      }),
    });

    const manifest = await fetchDeviceManifest({
      deviceId: 'simulator_v3_dev',
      fetchImpl: mockFetch as any,
    });
    expect(manifest.ver).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('caps=bong');
    expect(calledUrl).toContain('fw=1.0.18');
    expect(SimulatedDeviceSecurity.getActiveContentKeyBytes()).not.toBeNull();
  });

  it('sends canonical multipart fields on /listen and /talk/*', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/device/listen')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            reply: 'question',
            transcript: 'Con mèo ạ, tại sao mèo kêu meo meo?',
            handoff: { kind: 'question', seed: 'tại sao mèo kêu meo meo?' },
            diagnostics: { stt_ms: 110, llm_ms: 210, provider: 'gemini', model: 'gemini-2.5-flash' },
          }),
        };
      }
      if (url.endsWith('/device/talk/start')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: 'ts_123',
            audio: 'QUJD',
            branch: 'continue',
            topic: 'cats',
            assistant_text: 'Mèo kêu meo meo để nói chuyện đó!',
          }),
        };
      }
      if (url.endsWith('/device/talk/turn')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            audio: 'QUJD',
            branch: 'done',
            topic: 'cats',
            transcript: 'Hay quá ạ',
            assistant_text: 'Mình quay lại bài học nhé!',
            handoff: { kind: 'question', seed: 'Hay quá ạ', source_transcript: 'Hay quá ạ' },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, ack_seq: 1 }),
      };
    });

    const clip = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
    const listenRes = await postDeviceListen(
      {
        deviceId: 'sim_1',
        scene: 'HAHA',
        step: 'quiz',
        mode: 'voice',
        prompt: 'Phân loại: {transcript}',
        options: [{ name: 'cat', desc: 'Con mèo' }, { name: 'question', desc: 'Bé hỏi thêm' }],
        clip,
        sid: 's_1',
        seq: 2,
        lan: 1,
        sceneVer: 1,
        mver: 3,
      },
      mockFetch as any
    );
    expect(listenRes.reply).toBe('question');
    expect(listenRes.handoff?.seed).toContain('mèo kêu meo meo');
    const listenForm = calls[0].init.body as FormData;
    expect(listenForm.get('clip')).toBeTruthy();
    expect(listenForm.get('mode')).toBe('voice');

    const startRes = await postDeviceTalkStart(
      {
        deviceId: 'sim_1',
        scene: 'MAGIC_BOOK',
        step: 'step_talk',
        voice: 'sach',
        prompt: 'Sách kỳ diệu',
        seed: listenRes.handoff!.seed,
        options: [{ name: 'haha_return', desc: 'Quay lại HAHA' }],
        turns: 3,
        sec: 90,
        sid: 's_1',
        seq: 3,
        sceneVer: 1,
        mver: 3,
      },
      mockFetch as any
    );
    expect(startRes.session).toBe('ts_123');

    const turnRes = await postDeviceTalkTurn(
      {
        session: 'ts_123',
        clip,
        lan: 1,
        sid: 's_1',
        seq: 3,
        sceneVer: 1,
        mver: 3,
      },
      mockFetch as any
    );
    expect(turnRes.handoff?.seed).toBe('Hay quá ạ');
    const turnForm = calls[2].init.body as FormData;
    expect(turnForm.get('clip')).toBeTruthy();
    expect(turnForm.get('lan')).toBe('1');

    const endRes = await postDeviceTalkEnd(
      {
        session: 'ts_123',
        end: 'branch:haha_return',
        sid: 's_1',
        seq: 3,
        sceneVer: 1,
        mver: 3,
      },
      mockFetch as any
    );
    expect(endRes.ok).toBe(true);

    const syncRes = await postDeviceSync(
      {
        deviceId: 'sim_1',
        seq: 1,
        logs: ['{"sid":"s_1","seq":0,"t":1700000000,"ev":"start","mver":3,"bat":90}'],
      },
      mockFetch as any
    );
    expect(syncRes.ack_seq).toBe(1);
  });
});
