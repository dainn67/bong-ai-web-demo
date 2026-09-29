import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VirtualSdCard, generateSyntheticWav } from './virtual-sd-card';
import { uint8ArrayToBase64, decryptBongAsset, isBongEncrypted } from './crypto-client';
import { V3DeviceManifest } from './types';

describe('Virtual microSD Card Storage Engine', () => {
  const sampleKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) sampleKey[i] = i + 1;
  const sampleKeyBase64 = uint8ArrayToBase64(sampleKey);

  beforeEach(async () => {
    await VirtualSdCard.formatCard();
  });

  it('generates valid synthetic WAV audio binary', () => {
    const wav = generateSyntheticWav(440, 0.5);
    expect(wav.length).toBeGreaterThan(44);
    // Check "RIFF" magic bytes
    expect(wav[0]).toBe(0x52); // R
    expect(wav[1]).toBe(0x49); // I
    expect(wav[2]).toBe(0x46); // F
    expect(wav[3]).toBe(0x46); // F
  });

  it('writes and reads file correctly', async () => {
    const data = new TextEncoder().encode('Test file content on SD card');
    await VirtualSdCard.writeFile('/sdcard/test.txt', data, 'text/plain');

    const exists = await VirtualSdCard.hasFile('/sdcard/test.txt');
    expect(exists).toBe(true);

    const readBack = await VirtualSdCard.readFile('/sdcard/test.txt');
    expect(readBack).not.toBeNull();
    const text = new TextDecoder().decode(readBack!);
    expect(text).toBe('Test file content on SD card');
  });

  it('lists files and tracks storage stats accurately', async () => {
    await VirtualSdCard.writeFile('/sdcard/f1.bin', new Uint8Array([1, 2, 3]));
    await VirtualSdCard.writeFile('/sdcard/f2.bin', new Uint8Array([4, 5, 6, 7]));

    const files = await VirtualSdCard.listFiles();
    expect(files.length).toBe(2);
    expect(files[0].path).toBe('/sdcard/f1.bin');
    expect(files[0].size).toBe(3);

    const stats = await VirtualSdCard.getStorageStats();
    expect(stats.fileCount).toBe(2);
    expect(stats.totalBytes).toBe(7);
  });

  it('formats SD card cleanly', async () => {
    await VirtualSdCard.writeFile('/sdcard/del.bin', new Uint8Array([1]));
    expect(await VirtualSdCard.hasFile('/sdcard/del.bin')).toBe(true);

    await VirtualSdCard.formatCard();
    expect(await VirtualSdCard.hasFile('/sdcard/del.bin')).toBe(false);
    const stats = await VirtualSdCard.getStorageStats();
    expect(stats.fileCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it('pre-loads factory default pack with valid encrypted assets', async () => {
    const loadedCount = await VirtualSdCard.loadFactoryDefaultPack(sampleKeyBase64, 1);
    expect(loadedCount).toBeGreaterThan(5);

    const files = await VirtualSdCard.listFiles();
    expect(files.length).toBe(loadedCount);

    // Verify all files in factory pack are BONG_ENVELOPE encrypted
    for (const f of files) {
      expect(f.isEncrypted).toBe(true);
    }

    // Verify that scene can be read from SD card and decrypted
    const sceneEncrypted = await VirtualSdCard.readFile('/sdcard/scenes/LESSON_TEST.json');
    expect(sceneEncrypted).not.toBeNull();
    expect(isBongEncrypted(sceneEncrypted!)).toBe(true);

    const decryptedSceneBuffer = await decryptBongAsset(sceneEncrypted!, sampleKeyBase64);
    const sceneJson = JSON.parse(new TextDecoder().decode(decryptedSceneBuffer));
    expect(sceneJson.id).toBe('LESSON_TEST');

    // Verify audio file can be read and decrypted to valid WAV
    const audioEncrypted = await VirtualSdCard.readFile('/sdcard/assets/audio/welcome.opus');
    expect(audioEncrypted).not.toBeNull();
    const decryptedAudioBuffer = await decryptBongAsset(audioEncrypted!, sampleKeyBase64);
    const u8Audio = new Uint8Array(decryptedAudioBuffer);
    expect(u8Audio[0]).toBe(0x52); // 'R'
    expect(u8Audio[1]).toBe(0x49); // 'I'
    expect(u8Audio[2]).toBe(0x46); // 'F'
    expect(u8Audio[3]).toBe(0x46); // 'F'
  });

  it('caches and loads database catalog for offline use', async () => {
    const mockCatalog = {
      config: { version: '1.0.0' },
      stories: [{ id: 'S_001', title: 'Rùa và Thỏ' }],
      learning: [{ id: 'L_002', title: 'Animal' }],
    };

    await VirtualSdCard.saveCatalogCache(mockCatalog);
    const loaded = await VirtualSdCard.loadCatalogCache();
    expect(loaded).toEqual(mockCatalog);
    expect(loaded.stories[0].title).toBe('Rùa và Thỏ');
  });

  it('syncs and encrypts database story (S_001) into SD card for offline play', async () => {
    const storyMeta = {
      id: 'S_001',
      title: 'Rùa và Thỏ',
      parts: [
        { id: 0, type: 'play', audio_url: 'lessions/S_001/part_0.mp3' },
        { id: 1, type: 'question', audio_url: 'lessions/S_001/part_1.mp3', expected_answer: 'thỏ' },
      ],
    };

    const res = await VirtualSdCard.syncLessonToSdCard(
      'S_001',
      'Rùa và Thỏ',
      storyMeta,
      sampleKeyBase64,
      1
    );

    expect(res.scenePath).toBe('/sdcard/scenes/S_001.json');
    expect(res.audioCount).toBe(2);

    // Verify scene exists on SD Card
    const hasScene = await VirtualSdCard.hasSceneOnSdCard('S_001');
    expect(hasScene).toBe(true);

    // Read and decrypt scene
    const encScene = await VirtualSdCard.readFile('/sdcard/scenes/S_001.json');
    expect(encScene).not.toBeNull();
    const decScene = await decryptBongAsset(encScene!, sampleKeyBase64);
    const sceneJson = JSON.parse(new TextDecoder().decode(decScene));
    expect(sceneJson.id).toBe('S_001');
    expect(sceneJson.steps.length).toBe(2);

    // Verify audio files were encrypted and stored
    const audio0 = await VirtualSdCard.readFile('/sdcard/assets/audio/part_0.mp3');
    expect(audio0).not.toBeNull();
    expect(isBongEncrypted(audio0!)).toBe(true);
  });

  it('manages content-addressed blob storage with writeBlob, readBlob, and hasBlob', async () => {
    const dummyHash = 'ceb2989fe692e045780bdb50b164d405008e473e';
    const blobContent = new TextEncoder().encode('{"id":"START","steps":[]}');

    expect(await VirtualSdCard.hasBlob(dummyHash)).toBe(false);
    await VirtualSdCard.writeBlob(dummyHash, blobContent, 'application/json');
    expect(await VirtualSdCard.hasBlob(dummyHash)).toBe(true);

    const read = await VirtualSdCard.readBlob(dummyHash);
    expect(read).not.toBeNull();
    expect(new TextDecoder().decode(read!)).toBe('{"id":"START","steps":[]}');
  });

  it('caches and retrieves device manifest, prompts, and timing config', async () => {
    const mockManifest: V3DeviceManifest = {
      fmt: 1,
      ver: 1,
      key_version: 1,
      key_alias: 'k2026_09',
      blob_base: 'http://localhost:8000/api/v1/o',
      cfg: {
        listen_timeout: 4500,
        touch_timeout: 6000,
        vad_end: 1200,
        silent_streak: 2,
        no_reply_min: 3,
        loop_guard: 5,
        think_ms: 1200,
        server_timeout: 10000,
      },
      profile: {
        child_name: 'Bé Bống',
        bong_name: 'Bống',
      },
      wanted: ['START', 'END'],
      scenes: [
        { id: 'START', ver: 1, hash: 'ceb2989fe692e045780bdb50b164d405008e473e', pin: true },
      ],
      files: [],
      prompts: {
        classify_word: 'Phân loại từ: "{transcript}"',
      },
    };

    await VirtualSdCard.saveManifestCache(mockManifest);
    const loadedManifest = await VirtualSdCard.loadManifestCache();
    expect(loadedManifest).toEqual(mockManifest);

    await VirtualSdCard.savePromptsCache(mockManifest.prompts!);
    const loadedPrompts = await VirtualSdCard.loadPromptsCache();
    expect(loadedPrompts).toEqual({ classify_word: 'Phân loại từ: "{transcript}"' });

    await VirtualSdCard.saveConfigCache(mockManifest.cfg!);
    const loadedCfg = await VirtualSdCard.loadConfigCache();
    expect(loadedCfg?.listen_timeout).toBe(4500);
    expect(loadedCfg?.server_timeout).toBe(10000);
  });

  it('checks missing blobs on backend using checkBackendBlobs', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        expect(url).toContain('/o/check');
        const body = JSON.parse(init?.body as string);
        expect(body.hashes).toEqual(['hash1', 'hash2']);
        return {
          ok: true,
          status: 200,
          json: async () => ({ missing: ['hash2'] }),
        };
      });

      const res = await VirtualSdCard.checkBackendBlobs(['hash1', 'hash2'], 'http://localhost:8000/api/v1');
      expect(res.missing).toEqual(['hash2']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('syncs manifest scenes and file assets using syncFromManifest', async () => {
    const originalFetch = globalThis.fetch;
    const testSceneJson = JSON.stringify({
      id: 'START',
      version: 1,
      title: 'Bống Chào Bé',
      steps: [
        {
          id: 'step_1',
          orb: 'happy',
          audio: [{ src: 'welcome.opus' }],
        },
      ],
    });

    try {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('scene_hash_start')) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode(testSceneJson).buffer,
          };
        }
        if (url.includes('file_hash_welcome')) {
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
          };
        }
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        };
      });

      const manifest: V3DeviceManifest = {
        fmt: 1,
        ver: 2,
        key_version: 1,
        key_alias: 'k2026_09',
        blob_base: 'http://localhost:8000/api/v1/o',
        cfg: {
          listen_timeout: 4500,
          touch_timeout: 6000,
          vad_end: 1200,
          silent_streak: 2,
          no_reply_min: 3,
          loop_guard: 5,
          think_ms: 1200,
          server_timeout: 10000,
        },
        profile: { child_name: 'Bé Bống', bong_name: 'Bống' },
        wanted: ['START'],
        scenes: [{ id: 'START', ver: 1, hash: 'scene_hash_start', pin: true }],
        files: [{ id: 'audio/welcome.opus', hash: 'file_hash_welcome', size: 4, kind: 'audio' }],
        prompts: { test: 'Test template' },
      };

      const result = await VirtualSdCard.syncFromManifest(manifest, 'http://localhost:8000/api/v1');
      expect(result.syncedScenes).toBe(1);
      expect(result.syncedFiles).toBe(1);
      expect(result.errors.length).toBe(0);

      // Verify scene file was written
      expect(await VirtualSdCard.hasSceneOnSdCard('START')).toBe(true);
      const sceneBytes = await VirtualSdCard.readFile('/sdcard/scenes/START.json');
      expect(sceneBytes).not.toBeNull();
      const loadedScene = JSON.parse(new TextDecoder().decode(sceneBytes!));
      expect(loadedScene.title).toBe('Bống Chào Bé');

      // Verify blobs exist
      expect(await VirtualSdCard.hasBlob('scene_hash_start')).toBe(true);
      expect(await VirtualSdCard.hasBlob('file_hash_welcome')).toBe(true);

      // Verify file asset exists
      expect(await VirtualSdCard.hasFile('/sdcard/assets/audio/welcome.opus')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
