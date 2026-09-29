/**
 * Virtual microSD Card Storage Engine for Bống AI Offline-First v3.
 *
 * Implements client-side FAT32 filesystem simulation using IndexedDB.
 * Stores encrypted BONG_ENVELOPE binaries (/sdcard/scenes/..., /sdcard/assets/...).
 * Provides full offline persistence when internet/WiFi is disconnected.
 */

import { decryptBongAsset, encryptBongAsset, isBongEncrypted } from './crypto-client';
import { SAMPLE_LESSON_TEST, SAMPLE_START_SCENE, SAMPLE_END_SCENE } from './sample-scenes';
import { convertMetadataToV3Scene } from './metadata-converter';
import type { V3DeviceManifest } from './types';

export interface SdFileInfo {
  path: string;
  size: number;
  mimeType: string;
  updatedAt: string;
  isEncrypted: boolean;
}

export interface SdStorageStats {
  fileCount: number;
  totalBytes: number;
}

const DB_NAME = 'bong_virtual_sdcard_db';
const DB_VERSION = 1;
const STORE_NAME = 'sdcard_files';

/**
 * Generates a clean 16-bit mono PCM WAV audio buffer in memory.
 * Used to create factory sample audio without external network calls.
 */
export function generateSyntheticWav(frequencyHz: number = 440, durationSec: number = 1.0): Uint8Array {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // file length - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt subchunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign (2 bytes)
  view.setUint16(34, 16, true); // BitsPerSample (16 bits)

  // data subchunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Generate sine wave with gentle fade in and fade out
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin((Math.PI * i) / numSamples); // smooth bell envelope
    const sample = Math.sin(2 * Math.PI * frequencyHz * t) * envelope;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 24000)));
    view.setInt16(44 + i * 2, intSample, true);
  }

  return new Uint8Array(buffer);
}

export class VirtualSdCard {
  private static memStore = new Map<string, { data: Uint8Array; mimeType: string; updatedAt: string }>();

  private static async getDb(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'path' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Save a binary file into Virtual SD Card.
   */
  public static async writeFile(
    path: string,
    data: ArrayBuffer | Uint8Array,
    mimeType: string = 'application/octet-stream'
  ): Promise<void> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const updatedAt = new Date().toISOString();

    const db = await this.getDb();
    if (!db) {
      // Memory fallback for Node / test environment
      this.memStore.set(path, { data: bytes, mimeType, updatedAt });
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({
        path,
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        size: bytes.byteLength,
        mimeType,
        updatedAt,
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Read binary file from Virtual SD Card.
   */
  public static async readFile(path: string): Promise<ArrayBuffer | null> {
    const db = await this.getDb();
    if (!db) {
      const item = this.memStore.get(path);
      return item ? (item.data.buffer.slice(item.data.byteOffset, item.data.byteOffset + item.data.byteLength) as ArrayBuffer) : null;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(path);
      req.onsuccess = () => {
        if (!req.result) resolve(null);
        else resolve(req.result.data);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Check if a file exists on the SD Card.
   */
  public static async hasFile(path: string): Promise<boolean> {
    const data = await this.readFile(path);
    return data !== null;
  }

  /**
   * Delete a file from the SD Card.
   */
  public static async deleteFile(path: string): Promise<void> {
    const db = await this.getDb();
    if (!db) {
      this.memStore.delete(path);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * List all files stored on the SD Card with metadata.
   */
  public static async listFiles(): Promise<SdFileInfo[]> {
    const db = await this.getDb();
    if (!db) {
      const list: SdFileInfo[] = [];
      for (const [path, val] of this.memStore.entries()) {
        list.push({
          path,
          size: val.data.byteLength,
          mimeType: val.mimeType,
          updatedAt: val.updatedAt,
          isEncrypted: isBongEncrypted(val.data),
        });
      }
      return list.sort((a, b) => a.path.localeCompare(b.path));
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        const files: SdFileInfo[] = rows.map((r: any) => {
          const u8 = new Uint8Array(r.data);
          return {
            path: r.path,
            size: r.size || u8.byteLength,
            mimeType: r.mimeType || 'application/octet-stream',
            updatedAt: r.updatedAt,
            isEncrypted: isBongEncrypted(u8),
          };
        });
        resolve(files.sort((a, b) => a.path.localeCompare(b.path)));
      };
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Format the SD Card (delete all files).
   */
  public static async formatCard(): Promise<void> {
    const db = await this.getDb();
    if (!db) {
      this.memStore.clear();
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Get total storage metrics of the SD Card.
   */
  public static async getStorageStats(): Promise<SdStorageStats> {
    const files = await this.listFiles();
    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    return {
      fileCount: files.length,
      totalBytes,
    };
  }

  /**
   * Pre-loads the Factory Default Pack into the SD Card.
   * Encrypts all scenes and audio files with the device's Master Content Key.
   */
  public static async loadFactoryDefaultPack(
    activeKeyBase64: string,
    keyVersion: number = 1
  ): Promise<number> {
    let count = 0;

    // 1. Pack Scenes (JSON format encrypted into BONG_ENVELOPE)
    const scenesToPack = [
      { id: 'LESSON_TEST', data: SAMPLE_LESSON_TEST },
      { id: 'START', data: SAMPLE_START_SCENE },
      { id: 'END', data: SAMPLE_END_SCENE },
    ];

    for (const sc of scenesToPack) {
      const jsonStr = JSON.stringify(sc.data);
      const plainBytes = new TextEncoder().encode(jsonStr);
      const envelope = await encryptBongAsset(plainBytes, activeKeyBase64, keyVersion);
      await this.writeFile(`/sdcard/scenes/${sc.id}.json`, envelope, 'application/json');
      count++;
    }

    // 2. Pack Essential Audio files (Synthesized WAV audio encrypted into BONG_ENVELOPE)
    const audioPacks = [
      { path: '/sdcard/assets/audio/welcome.opus', freq: 523.25, dur: 1.2 }, // C5
      { path: '/sdcard/assets/audio/success.opus', freq: 659.25, dur: 0.8 }, // E5
      { path: '/sdcard/assets/audio/wrong.opus', freq: 329.63, dur: 0.6 }, // E4
      { path: '/sdcard/assets/audio/chime.opus', freq: 783.99, dur: 1.0 }, // G5
      { path: '/sdcard/assets/audio/cat_sound.opus', freq: 587.33, dur: 0.9 }, // D5
    ];

    for (const aud of audioPacks) {
      const wavBytes = generateSyntheticWav(aud.freq, aud.dur);
      const envelope = await encryptBongAsset(wavBytes, activeKeyBase64, keyVersion);
      await this.writeFile(aud.path, envelope, 'audio/wav');
      count++;
    }

    return count;
  }

  /**
   * Caches the database catalog JSON on SD Card for offline browsing.
   */
  public static async saveCatalogCache(catalog: any): Promise<void> {
    const jsonStr = JSON.stringify(catalog);
    const bytes = new TextEncoder().encode(jsonStr);
    await this.writeFile('/sdcard/catalog.json', bytes, 'application/json');
  }

  /**
   * Loads the cached catalog JSON from SD Card when offline.
   */
  public static async loadCatalogCache(): Promise<any | null> {
    const bytes = await this.readFile('/sdcard/catalog.json');
    if (!bytes) return null;
    try {
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Checks whether a lesson scene exists on SD Card.
   */
  public static async hasSceneOnSdCard(lessonId: string): Promise<boolean> {
    return this.hasFile(`/sdcard/scenes/${lessonId}.json`);
  }

  /**
   * Syncs and encrypts a database lesson/story into Virtual SD Card.
   * Downloads and encrypts audio assets so it can be played completely offline.
   */
  public static async syncLessonToSdCard(
    lessonId: string,
    title: string,
    rawMetadata: any,
    activeKeyBase64: string,
    keyVersion: number = 1
  ): Promise<{ scenePath: string; audioCount: number }> {
    // 1. Convert to validated V3Scene
    const scene = convertMetadataToV3Scene(lessonId, title, rawMetadata);

    // 2. Encrypt and save V3Scene to /sdcard/scenes/{lessonId}.json
    const sceneBytes = new TextEncoder().encode(JSON.stringify(scene));
    const encryptedScene = await encryptBongAsset(sceneBytes, activeKeyBase64, keyVersion);
    const scenePath = `/sdcard/scenes/${lessonId}.json`;
    await this.writeFile(scenePath, encryptedScene, 'application/json');

    // 3. Save raw metadata in /sdcard/metadata/{lessonId}.json (for DirectLessonPlayer offline)
    const rawMetaBytes = new TextEncoder().encode(JSON.stringify(rawMetadata));
    await this.writeFile(`/sdcard/metadata/${lessonId}.json`, rawMetaBytes, 'application/json');

    // 4. Extract and sync all audio assets
    const audioUrls: string[] = [];
    for (const step of scene.steps) {
      if (step.audio) {
        for (const a of step.audio) {
          const src = Array.isArray(a.src) ? a.src[0] : a.src;
          if (src && !audioUrls.includes(src)) {
            audioUrls.push(src);
          }
        }
      }
    }

    let audioCount = 0;
    for (const url of audioUrls) {
      const parts = url.split('/');
      const cleanFileName = parts[parts.length - 1] || `audio_${audioCount}.wav`;
      const targetSdPath = `/sdcard/assets/audio/${cleanFileName}`;

      let audioBytes: Uint8Array | null = null;

      // Try fetching real audio bytes if online and URL is valid
      if (typeof window !== 'undefined' && window.fetch && (url.startsWith('http') || url.startsWith('/cdn') || url.startsWith('lessions/'))) {
        try {
          const fetchUrl = url.startsWith('lessions/') ? `/cdn/${url}` : url;
          const resp = await window.fetch(fetchUrl);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            audioBytes = new Uint8Array(buf);
          }
        } catch {
          // fetch failed, fallback to synthetic wav below
        }
      }

      // Fallback: generate high quality synthetic tone if remote audio is 404 or unreachable
      if (!audioBytes || audioBytes.byteLength === 0) {
        const freq = 440 + (audioCount % 7) * 60;
        audioBytes = generateSyntheticWav(freq, 1.2);
      }

      // Encrypt and write to SD card
      const encEnvelope = await encryptBongAsset(audioBytes, activeKeyBase64, keyVersion);
      await this.writeFile(targetSdPath, encEnvelope, 'audio/wav');
      // Also register under base filename without extension
      const baseName = cleanFileName.replace(/\.[^/.]+$/, '');
      if (baseName !== cleanFileName) {
        await this.writeFile(`/sdcard/assets/audio/${baseName}`, encEnvelope, 'audio/wav');
      }
      audioCount++;
    }

    return { scenePath, audioCount };
  }

  /**
   * Save a content-addressed binary blob into /sdcard/blobs/{hash}.
   */
  public static async writeBlob(
    hash: string,
    data: ArrayBuffer | Uint8Array,
    mimeType: string = 'application/octet-stream'
  ): Promise<void> {
    const cleanHash = hash.trim().toLowerCase();
    await this.writeFile(`/sdcard/blobs/${cleanHash}`, data, mimeType);
  }

  /**
   * Read binary blob by its hash from /sdcard/blobs/{hash}.
   */
  public static async readBlob(hash: string): Promise<Uint8Array | null> {
    const cleanHash = hash.trim().toLowerCase();
    return this.readFile(`/sdcard/blobs/${cleanHash}`);
  }

  /**
   * Check whether a blob exists on SD Card.
   */
  public static async hasBlob(hash: string): Promise<boolean> {
    const cleanHash = hash.trim().toLowerCase();
    return this.hasFile(`/sdcard/blobs/${cleanHash}`);
  }

  /**
   * Caches the V3DeviceManifest JSON on SD Card.
   */
  public static async saveManifestCache(manifest: V3DeviceManifest): Promise<void> {
    const jsonStr = JSON.stringify(manifest, null, 2);
    const bytes = new TextEncoder().encode(jsonStr);
    await this.writeFile('/sdcard/manifest.json', bytes, 'application/json');
  }

  /**
   * Loads the cached V3DeviceManifest from SD Card when offline.
   */
  public static async loadManifestCache(): Promise<V3DeviceManifest | null> {
    const bytes = await this.readFile('/sdcard/manifest.json');
    if (!bytes) return null;
    try {
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text) as V3DeviceManifest;
    } catch {
      return null;
    }
  }

  /**
   * Caches the prompts dictionary on SD Card.
   */
  public static async savePromptsCache(prompts: Record<string, string>): Promise<void> {
    const jsonStr = JSON.stringify(prompts, null, 2);
    const bytes = new TextEncoder().encode(jsonStr);
    await this.writeFile('/sdcard/prompts.json', bytes, 'application/json');
  }

  /**
   * Loads cached prompts dictionary from SD Card.
   */
  public static async loadPromptsCache(): Promise<Record<string, string>> {
    const bytes = await this.readFile('/sdcard/prompts.json');
    if (!bytes) return {};
    try {
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  /**
   * Caches runtime config on SD Card.
   */
  public static async saveConfigCache(cfg: any): Promise<void> {
    const jsonStr = JSON.stringify(cfg, null, 2);
    const bytes = new TextEncoder().encode(jsonStr);
    await this.writeFile('/sdcard/config.json', bytes, 'application/json');
  }

  /**
   * Loads cached runtime config from SD Card.
   */
  public static async loadConfigCache(): Promise<any | null> {
    const bytes = await this.readFile('/sdcard/config.json');
    if (!bytes) return null;
    try {
      const text = new TextDecoder().decode(bytes);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Check which blobs are missing on Backend via POST /api/v1/o/check.
   */
  public static async checkBackendBlobs(
    hashes: string[],
    apiBase: string = 'http://localhost:8000/api/v1',
    internalSecret?: string
  ): Promise<{ missing: string[] }> {
    const cleanHashes = hashes.map((h) => h.trim().toLowerCase()).filter(Boolean);
    const fetchFn = typeof window !== 'undefined' && window.fetch ? window.fetch : globalThis.fetch;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (internalSecret) {
      headers['X-Internal-Secret'] = internalSecret;
    }
    const resp = await fetchFn(`${apiBase.replace(/\/$/, '')}/o/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ hashes: cleanHashes }),
    });
    if (!resp.ok) {
      throw new Error(`POST /o/check failed: HTTP ${resp.status} ${resp.statusText}`);
    }
    return (await resp.json()) as { missing: string[] };
  }

  /**
   * Fully syncs scenes, assets, prompts, cfg and profile from a V3DeviceManifest into the Virtual SD Card.
   * Downloads blobs directly from /api/v1/o/<hash> (or manifest.blob_base).
   */
  public static async syncFromManifest(
    manifest: V3DeviceManifest,
    apiBase: string = 'http://localhost:8000/api/v1',
    activeKeyBase64?: string,
    onProgress?: (msg: string) => void
  ): Promise<{ syncedScenes: number; syncedFiles: number; errors: string[] }> {
    const errors: string[] = [];
    let syncedScenes = 0;
    let syncedFiles = 0;

    const baseClean = apiBase.replace(/\/$/, '');
    const blobBase = manifest.blob_base ? manifest.blob_base.replace(/\/$/, '') : `${baseClean}/o`;
    const fetchFn = typeof window !== 'undefined' && window.fetch ? window.fetch : globalThis.fetch;

    onProgress?.(`Bắt đầu đồng bộ Manifest v${manifest.ver}...`);

    // 1. Cache manifest, prompts, config, profile
    await this.saveManifestCache(manifest);
    if (manifest.prompts) {
      await this.savePromptsCache(manifest.prompts);
    }
    if (manifest.cfg) {
      await this.saveConfigCache(manifest.cfg);
    }
    if (manifest.profile) {
      await this.writeFile(
        '/sdcard/profile.json',
        new TextEncoder().encode(JSON.stringify(manifest.profile, null, 2)),
        'application/json'
      );
    }

    // 2. Download and write all Scene blobs
    const scenes = manifest.scenes || [];
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      onProgress?.(`Tải kịch bản ${sc.id} (${i + 1}/${scenes.length})...`);
      try {
        const blobUrl = `${blobBase}/${sc.hash}`;
        const resp = await fetchFn(blobUrl);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} tải blob scene ${sc.id} (${sc.hash})`);
        }
        const arrayBuf = await resp.arrayBuffer();
        const rawBytes = new Uint8Array(arrayBuf);

        // Store raw blob
        await this.writeBlob(sc.hash, rawBytes, 'application/json');

        // Parse and save as /sdcard/scenes/{id}.json
        let plainBytes = rawBytes;
        if (isBongEncrypted(rawBytes)) {
          if (activeKeyBase64) {
            plainBytes = await decryptBongAsset(rawBytes, activeKeyBase64);
          } else {
            throw new Error(`Kịch bản ${sc.id} bị mã hóa nhưng chưa có activeKey`);
          }
        }

        // Validate JSON
        const text = new TextDecoder().decode(plainBytes);
        JSON.parse(text); // verify valid json

        await this.writeFile(`/sdcard/scenes/${sc.id}.json`, plainBytes, 'application/json');
        syncedScenes++;
      } catch (err: any) {
        errors.push(`Scene ${sc.id}: ${err?.message || err}`);
      }
    }

    // 3. Download and write all File assets
    const files = manifest.files || [];
    for (let i = 0; i < files.length; i++) {
      const fl = files[i];
      onProgress?.(`Tải asset ${fl.id} (${i + 1}/${files.length})...`);
      try {
        const blobUrl = `${blobBase}/${fl.hash}`;
        const resp = await fetchFn(blobUrl);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} tải asset ${fl.id} (${fl.hash})`);
        }
        const arrayBuf = await resp.arrayBuffer();
        const rawBytes = new Uint8Array(arrayBuf);

        // Store by hash and by file ID path
        await this.writeBlob(fl.hash, rawBytes, fl.kind === 'audio' ? 'audio/wav' : 'application/octet-stream');
        await this.writeFile(`/sdcard/assets/${fl.id}`, rawBytes, fl.kind === 'audio' ? 'audio/wav' : 'application/octet-stream');
        syncedFiles++;
      } catch (err: any) {
        errors.push(`File ${fl.id}: ${err?.message || err}`);
      }
    }

    onProgress?.(`Đồng bộ hoàn tất: ${syncedScenes} kịch bản, ${syncedFiles} assets.`);
    return { syncedScenes, syncedFiles, errors };
  }
}

