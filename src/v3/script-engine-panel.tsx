/**
 * Script Engine v3 Studio Panel.
 * Complete interactive simulator for Offline-First Script Engine v3 (Phase 1).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useScriptEngine } from './use-script-engine';
import { validateV3Scene } from './script-parser';
import {
  SAMPLE_LESSON_TEST,
  SAMPLE_START_SCENE,
  SAMPLE_END_SCENE,
} from './sample-scenes';
import type { V3Scene } from './types';
import { useSimulatorStore } from '../store/simulator-store';
import type { TouchLayoutType } from '../screen/touch-layout';
import {
  SimulatedDeviceSecurity,
  encryptBongAsset,
  decryptBongAsset,
  isBongEncrypted,
  uint8ArrayToBase64,
} from './crypto-client';
import { VirtualSdCard } from './virtual-sd-card';
import type { SdFileInfo, SdStorageStats } from './virtual-sd-card';
import { fetchCdnCatalog, type LessonSummary } from '../lessons/catalog';
import { convertMetadataToV3Scene } from './metadata-converter';

export const ScriptEnginePanel: React.FC = () => {
  const {
    scene,
    currentStep,
    activeOrb,
    memory,
    executionLog,
    isPlayingAudio,
    isAwaitingInput,
    currentReply,
    loadScene,
    handleInputReply,
    jumpToStep,
  } = useScriptEngine();

  const setV3ScreenState = useSimulatorStore((state) => state.setV3ScreenState);
  const setV3TouchHandler = useSimulatorStore((state) => state.setV3TouchHandler);

  const [activeTab, setActiveTab] = useState<'steps' | 'memory' | 'logs' | 'manifest' | 'security' | 'sdcard'>('steps');
  const [testSpeechText, setTestSpeechText] = useState('cat');
  const [isCallingBackend, setIsCallingBackend] = useState(false);
  const [backendListenResult, setBackendListenResult] = useState<any>(null);
  const [backendManifest, setBackendManifest] = useState<any>(null);
  const [isFetchingManifest, setIsFetchingManifest] = useState(false);

  // Security & 2-tier Key Management state
  const [key0Hex, setKey0Hex] = useState(() => SimulatedDeviceSecurity.getDeviceRootKey0Hex());
  const [storedContentKey, setStoredContentKey] = useState(() => SimulatedDeviceSecurity.getStoredContentKey());
  const [isFetchingKey, setIsFetchingKey] = useState(false);
  const [cryptoTestText, setCryptoTestText] = useState('Bống AI: Kịch bản và âm thanh Opus bài học v3!');
  const [cryptoEnvelope, setCryptoEnvelope] = useState<Uint8Array | null>(null);
  const [cryptoDecryptedText, setCryptoDecryptedText] = useState<string | null>(null);
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  // Virtual SD Card state
  const [sdFiles, setSdFiles] = useState<SdFileInfo[]>([]);
  const [sdStats, setSdStats] = useState<SdStorageStats>({ fileCount: 0, totalBytes: 0 });
  const [isSyncingSd, setIsSyncingSd] = useState(false);
  const [isSimulatingOffline, setIsSimulatingOffline] = useState(false);

  // Database Lesson Catalog & SD sync state
  const [catalog, setCatalog] = useState<LessonSummary[]>([]);
  const [selectedLessonId, setSelectedLessonId] = useState<string>('LESSON_TEST');
  const [isDownloadingLesson, setIsDownloadingLesson] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [syncedSceneIds, setSyncedSceneIds] = useState<Set<string>>(new Set());

  // Initialize with sample scene if none loaded
  useEffect(() => {
    if (!scene) {
      loadScene(SAMPLE_LESSON_TEST);
    }
  }, [loadScene, scene]);

  // Register touch handler to bridge RoundScreen taps into useScriptEngine
  useEffect(() => {
    setV3TouchHandler((result) => {
      const reply = result === 'cham_khac' ? 'miss' : result;
      handleInputReply(reply);
    });

    return () => {
      setV3TouchHandler(null);
    };
  }, [handleInputReply, setV3TouchHandler]);

  // Synchronize v3 state with the main hardware screen (RoundScreen) on the left
  useEffect(() => {
    const rawLayout = currentStep?.listen?.mode === 'touch' ? currentStep.listen.touch?.layout : undefined;
    const mappedLayout: TouchLayoutType | null =
      rawLayout === 'pie4'
        ? 'tap4'
        : rawLayout === 'tb2'
          ? 'tap2_tren_duoi'
          : rawLayout === 'lr2'
            ? 'tap2_trai_phai'
            : rawLayout === 'pie3'
              ? 'tap3'
              : rawLayout === 'swipe'
                ? 'swipe'
                : null;

    setV3ScreenState({
      expression: activeOrb,
      mode: isPlayingAudio ? 'speaking' : 'idle',
      waitingFor: isAwaitingInput
        ? currentStep?.listen?.mode === 'touch'
          ? 'touch'
          : currentStep?.listen?.mode === 'voice'
            ? 'speech'
            : null
        : null,
      touchLayout: isAwaitingInput && currentStep?.listen?.mode === 'touch' ? mappedLayout : null,
      caption: currentStep ? `Step: ${currentStep.id}` : null,
    });
  }, [activeOrb, currentStep, isAwaitingInput, isPlayingAudio, setV3ScreenState]);

  // Clean up hardware screen on unmount
  useEffect(() => {
    return () => {
      setV3ScreenState({
        expression: 'idle',
        mode: 'idle',
        waitingFor: null,
        touchLayout: null,
        caption: null,
      });
      setV3TouchHandler(null);
    };
  }, [setV3ScreenState, setV3TouchHandler]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const { valid, issues } = validateV3Scene(json);
        if (!valid) {
          alert(`Lỗi cấu trúc kịch bản:\n${issues.map((i) => `- ${i.message}`).join('\n')}`);
          return;
        }
        loadScene(json as V3Scene);
      } catch (err: any) {
        alert(`Không thể đọc JSON: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const fetchManifestFromBackend = async () => {
    setIsFetchingManifest(true);
    setActiveTab('manifest');
    try {
      const res = await fetch('http://localhost:8000/api/v1/device/manifest?device_id=simulator_v3_dev');
      if (res.ok) {
        const data = await res.json();
        setBackendManifest(data);
      } else {
        setBackendManifest({ error: `Backend returned ${res.status}: ${res.statusText}` });
      }
    } catch (err: any) {
      setBackendManifest({ error: `Không thể kết nối Backend (port 8000): ${err.message}` });
    } finally {
      setIsFetchingManifest(false);
    }
  };

  const fetchKeyFromBackend = async () => {
    setIsFetchingKey(true);
    setCryptoError(null);
    try {
      const res = await fetch('http://localhost:8000/api/v1/device/key?device_id=simulator_v3_dev');
      if (res.ok) {
        const data = await res.json();
        SimulatedDeviceSecurity.saveWrappedContentKey(data.key_alias, data.key_version, data.key_bytes);
        setStoredContentKey(SimulatedDeviceSecurity.getStoredContentKey());
      } else {
        setCryptoError(`Backend returned ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      setCryptoError(`Không thể kết nối Backend (port 8000): ${err.message}`);
    } finally {
      setIsFetchingKey(false);
    }
  };

  const handleResetKey0 = () => {
    SimulatedDeviceSecurity.resetSimulatedKeys();
    setKey0Hex(SimulatedDeviceSecurity.getDeviceRootKey0Hex());
    setStoredContentKey(null);
    setCryptoEnvelope(null);
    setCryptoDecryptedText(null);
    setCryptoError(null);
  };

  const handleEncryptTest = async () => {
    setCryptoError(null);
    setCryptoDecryptedText(null);
    try {
      let activeKeyBase64 = storedContentKey?.rawKeyBase64;
      if (!activeKeyBase64) {
        // Fallback default test key if backend key not yet fetched
        const fallbackBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) fallbackBytes[i] = i + 1;
        activeKeyBase64 = uint8ArrayToBase64(fallbackBytes);
      }

      const plainBytes = new TextEncoder().encode(cryptoTestText);
      const envelope = await encryptBongAsset(
        plainBytes,
        activeKeyBase64,
        storedContentKey?.version || 1
      );
      setCryptoEnvelope(envelope);
    } catch (err: any) {
      setCryptoError(`Lỗi mã hóa: ${err.message}`);
    }
  };

  const handleDecryptTest = async () => {
    if (!cryptoEnvelope) return;
    setCryptoError(null);
    try {
      let activeKeyBase64 = storedContentKey?.rawKeyBase64;
      if (!activeKeyBase64) {
        const fallbackBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) fallbackBytes[i] = i + 1;
        activeKeyBase64 = uint8ArrayToBase64(fallbackBytes);
      }

      const decBuffer = await decryptBongAsset(cryptoEnvelope, activeKeyBase64);
      const text = new TextDecoder().decode(decBuffer);
      setCryptoDecryptedText(text);
    } catch (err: any) {
      setCryptoError(`Lỗi giải mã: ${err.message}`);
    }
  };

  const handleTamperTest = async () => {
    if (!cryptoEnvelope) return;
    setCryptoError(null);
    setCryptoDecryptedText(null);
    try {
      const tampered = new Uint8Array(cryptoEnvelope);
      // Flip bits in the last byte of payload
      tampered[tampered.length - 1] ^= 0xaa;
      setCryptoEnvelope(tampered);

      let activeKeyBase64 = storedContentKey?.rawKeyBase64;
      if (!activeKeyBase64) {
        const fallbackBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) fallbackBytes[i] = i + 1;
        activeKeyBase64 = uint8ArrayToBase64(fallbackBytes);
      }

      await decryptBongAsset(tampered, activeKeyBase64);
      setCryptoDecryptedText('Giải mã thành công (không mong đợi!)');
    } catch (err: any) {
      setCryptoError(`🔒 XÁC THỰC THẤT BẠI (ĐÚNG THIẾT KẾ): ${err.message}`);
    }
  };

  const refreshSdStats = useCallback(async () => {
    try {
      const files = await VirtualSdCard.listFiles();
      const stats = await VirtualSdCard.getStorageStats();
      setSdFiles(files);
      setSdStats(stats);
    } catch (e) {
      console.warn('Failed to refresh SD card stats', e);
    }
  }, []);

  const refreshCatalogAndSd = useCallback(async () => {
    try {
      const items = await fetchCdnCatalog();
      setCatalog(items);

      // Check which scenes exist on SD Card
      const files = await VirtualSdCard.listFiles();
      const onSd = new Set<string>();
      for (const f of files) {
        if (f.path.startsWith('/sdcard/scenes/') && f.path.endsWith('.json')) {
          const id = f.path.replace('/sdcard/scenes/', '').replace('.json', '');
          onSd.add(id);
        }
      }
      setSyncedSceneIds(onSd);
    } catch (err) {
      console.warn('Failed to fetch catalog:', err);
    }
  }, []);

  useEffect(() => {
    void refreshSdStats();
    void refreshCatalogAndSd();
  }, [refreshSdStats, refreshCatalogAndSd]);

  const handleSelectScene = async (id: string) => {
    setSelectedLessonId(id);
    setDownloadNotice(null);

    // 1. Built-in sample scenes
    if (id === 'LESSON_TEST') {
      loadScene(SAMPLE_LESSON_TEST);
      return;
    }
    if (id === 'START') {
      loadScene(SAMPLE_START_SCENE);
      return;
    }
    if (id === 'END') {
      loadScene(SAMPLE_END_SCENE);
      return;
    }

    // 2. Check if already on SD card (Offline first!)
    const existsOnSd = await VirtualSdCard.hasSceneOnSdCard(id);
    if (existsOnSd) {
      try {
        const rawBytes = await VirtualSdCard.readFile(`/sdcard/scenes/${id}.json`);
        if (rawBytes) {
          let plainBytes = rawBytes;
          if (isBongEncrypted(rawBytes)) {
            const key = SimulatedDeviceSecurity.getStoredContentKey();
            if (key) {
              plainBytes = await decryptBongAsset(rawBytes, key.rawKeyBase64);
            }
          }
          const text = new TextDecoder().decode(plainBytes);
          const parsed = JSON.parse(text) as V3Scene;
          loadScene(parsed);
          setDownloadNotice(`✅ Đang phát kịch bản từ Thẻ SD ảo (Trạng thái mạng: ${isSimulatingOffline ? '📴 Offline' : '📡 Online'})`);
          return;
        }
      } catch (err) {
        console.warn('Error reading scene from SD card:', err);
      }
    }

    // 3. Not on SD card
    if (isSimulatingOffline) {
      setDownloadNotice(`⚠️ Bài học "${id}" chưa được tải về Thẻ SD! Hãy bật Online để tải về thẻ trước.`);
      return;
    }

    // Online fetch from database via backend API
    const item = catalog.find((c) => c.id === id);
    const metaUrl = item?.metadataUrl || `/cdn/lessions/${id}/metadata.json`;
    try {
      setDownloadNotice(`⏳ Đang tải kịch bản từ CSDL...`);
      const res = await fetch(metaUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rawMeta = await res.json();
      const v3Scene = convertMetadataToV3Scene(id, item?.title || id, rawMeta);
      loadScene(v3Scene);
      setDownloadNotice(`☁️ Đã nạp kịch bản từ CSDL PostgreSQL. Bấm "Tải về Thẻ SD" để lưu offline.`);
    } catch (e: any) {
      setDownloadNotice(`❌ Lỗi tải kịch bản từ server: ${e?.message || e}`);
    }
  };

  const handleDownloadSelectedLesson = async () => {
    if (!selectedLessonId) return;
    setIsDownloadingLesson(true);
    setDownloadNotice(null);
    try {
      const activeKey = SimulatedDeviceSecurity.getStoredContentKey();
      let keyBase64 = activeKey?.rawKeyBase64;
      if (!keyBase64) {
        const fallbackBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) fallbackBytes[i] = i + 1;
        keyBase64 = uint8ArrayToBase64(fallbackBytes);
      }
      const keyVer = activeKey?.version || 1;

      // Built-in scenes
      if (selectedLessonId === 'LESSON_TEST' || selectedLessonId === 'START' || selectedLessonId === 'END') {
        const sc = selectedLessonId === 'LESSON_TEST' ? SAMPLE_LESSON_TEST : selectedLessonId === 'START' ? SAMPLE_START_SCENE : SAMPLE_END_SCENE;
        await VirtualSdCard.syncLessonToSdCard(sc.id, sc.id, sc, keyBase64, keyVer);
        await refreshSdStats();
        await refreshCatalogAndSd();
        setDownloadNotice(`✅ Đã lưu kịch bản ${sc.id} vào thẻ SD!`);
        return;
      }

      // DB lesson
      const item = catalog.find((c) => c.id === selectedLessonId);
      const metaUrl = item?.metadataUrl || `/cdn/lessions/${selectedLessonId}/metadata.json`;
      const res = await fetch(metaUrl);
      if (!res.ok) throw new Error(`Không thể lấy metadata: HTTP ${res.status}`);
      const rawMeta = await res.json();

      const syncResult = await VirtualSdCard.syncLessonToSdCard(
        selectedLessonId,
        item?.title || selectedLessonId,
        rawMeta,
        keyBase64,
        keyVer
      );

      await refreshSdStats();
      await refreshCatalogAndSd();
      setDownloadNotice(`✅ Đã tải về và mã hóa thành công bài vào Thẻ SD! (${syncResult.audioCount} assets âm thanh)`);
    } catch (err: any) {
      setDownloadNotice(`❌ Lỗi đồng bộ thẻ SD: ${err?.message || err}`);
    } finally {
      setIsDownloadingLesson(false);
    }
  };

  const handleLoadFactoryPack = async () => {
    setIsSyncingSd(true);
    try {
      let activeKeyBase64 = storedContentKey?.rawKeyBase64;
      if (!activeKeyBase64) {
        const fallbackBytes = new Uint8Array(32);
        for (let i = 0; i < 32; i++) fallbackBytes[i] = i + 1;
        activeKeyBase64 = uint8ArrayToBase64(fallbackBytes);
      }
      const count = await VirtualSdCard.loadFactoryDefaultPack(
        activeKeyBase64,
        storedContentKey?.version || 1
      );
      await refreshSdStats();
      alert(`Đã nạp thành công ${count} file bài học và âm thanh xuất xưởng vào thẻ nhớ SD ảo!`);
    } catch (err: any) {
      alert(`Lỗi nạp gói xuất xưởng: ${err.message}`);
    } finally {
      setIsSyncingSd(false);
    }
  };

  const handleFormatSd = async () => {
    if (confirm('Bạn có chắc muốn format xóa toàn bộ dữ liệu trên thẻ nhớ SD ảo?')) {
      await VirtualSdCard.formatCard();
      await refreshSdStats();
    }
  };

  const handleSyncFromBackend = async () => {
    if (isSimulatingOffline) {
      alert('Đang ở chế độ Offline mô phỏng! Hãy chuyển sang Online để kết nối Backend.');
      return;
    }
    setIsSyncingSd(true);
    try {
      // 1. Fetch Key
      const keyRes = await fetch('http://localhost:8000/api/v1/device/key?device_id=simulator_v3_dev');
      let activeKeyBase64 = storedContentKey?.rawKeyBase64;
      if (keyRes.ok) {
        const keyData = await keyRes.json();
        SimulatedDeviceSecurity.saveWrappedContentKey(keyData.key_alias, keyData.key_version, keyData.key_bytes);
        setStoredContentKey(SimulatedDeviceSecurity.getStoredContentKey());
        activeKeyBase64 = keyData.key_bytes;
      }

      // 2. Fetch Manifest
      const manRes = await fetch('http://localhost:8000/api/v1/device/manifest?device_id=simulator_v3_dev');
      if (manRes.ok) {
        const manData = await manRes.json();
        setBackendManifest(manData);

        // Pre-save manifest scenes & default assets if not present
        if (activeKeyBase64) {
          await VirtualSdCard.loadFactoryDefaultPack(activeKeyBase64, manData.key_version || 1);
        }
        await refreshSdStats();
        alert(`Đồng bộ thành công! Thẻ nhớ SD ảo đã cập nhật bài học cho Manifest v${manData.ver}.`);
      } else {
        alert(`Lỗi Backend: ${manRes.statusText}`);
      }
    } catch (err: any) {
      alert(`Không thể kết nối Backend (port 8000): ${err.message}`);
    } finally {
      setIsSyncingSd(false);
    }
  };

  const handleVoiceTest = async (optionOrText: string) => {
    if (!currentStep?.listen?.voice) return;

    setIsCallingBackend(true);
    setBackendListenResult(null);

    try {
      // Create a dummy WAV header + bytes to test POST /api/v1/device/listen
      const wavHeader = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
        0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
        0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
      ]);
      const blob = new Blob([wavHeader], { type: 'audio/wav' });

      const formData = new FormData();
      formData.append('device_id', 'simulator_v3_dev');
      formData.append('scene', scene?.id || 'LESSON_TEST');
      formData.append('step', currentStep.id);
      formData.append(
        'prompt',
        currentStep.listen.voice.prompt ||
          scene?.prompts?.[currentStep.listen.voice.prompt_ref || ''] ||
          `Phân loại: "{transcript}"`,
      );
      formData.append('clip', blob, 'test.wav');
      formData.append('option_names', JSON.stringify(currentStep.listen.voice.options));
      formData.append('hints', JSON.stringify(currentStep.listen.voice.hints || []));
      formData.append('min_conf', String(currentStep.listen.voice.min_conf || 0.6));

      // Call Backend API
      const res = await fetch('http://localhost:8000/api/v1/device/listen', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setBackendListenResult(data);
        handleInputReply(data.reply);
      } else {
        // Fallback simulate locally if backend STT unavailable
        setBackendListenResult({ reply: optionOrText, local_fallback: true });
        handleInputReply(optionOrText);
      }
    } catch {
      // Local fallback
      setBackendListenResult({ reply: optionOrText, local_fallback: true });
      handleInputReply(optionOrText);
    } finally {
      setIsCallingBackend(false);
    }
  };

  const rawTouchLayout = currentStep?.listen?.mode === 'touch' ? currentStep.listen.touch?.layout : undefined;

  return (
    <div className="flex flex-col gap-4 w-full bg-slate-900/60 p-5 rounded-2xl border border-slate-800 backdrop-blur-md shadow-xl">
      {/* 1. Header: Scene Selector + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Chọn Bài:</span>
          <select
            value={selectedLessonId}
            onChange={(e) => handleSelectScene(e.target.value)}
            className="bg-slate-800 text-white text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-700 outline-none focus:ring-1 focus:ring-indigo-500 max-w-[280px] truncate"
          >
            {catalog.some((it) => it.category === 'stories') && (
              <optgroup label="📖 Câu chuyện từ CSDL (Stories)">
                {catalog
                  .filter((it) => it.category === 'stories')
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {syncedSceneIds.has(it.id) ? '💾 ' : '☁️ '} {it.title} ({it.id})
                    </option>
                  ))}
              </optgroup>
            )}
            {catalog.some((it) => it.category === 'learning') && (
              <optgroup label="📚 Bài học từ CSDL (Learning)">
                {catalog
                  .filter((it) => it.category === 'learning')
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {syncedSceneIds.has(it.id) ? '💾 ' : '☁️ '} {it.title} ({it.id})
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="⚡ Kịch bản mẫu v3">
              <option value="LESSON_TEST">
                {syncedSceneIds.has('LESSON_TEST') ? '💾 ' : '⚡ '} LESSON_TEST (Chạm pie4 + Giọng nói)
              </option>
              <option value="START">
                {syncedSceneIds.has('START') ? '💾 ' : '⚡ '} START (Kiểm tra sys.first_run)
              </option>
              <option value="END">
                {syncedSceneIds.has('END') ? '💾 ' : '⚡ '} END (Đi ngủ - finished & idle)
              </option>
            </optgroup>
          </select>

          {/* Download to SD Card Button */}
          <button
            type="button"
            onClick={handleDownloadSelectedLesson}
            disabled={isDownloadingLesson}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition active:scale-95 disabled:opacity-50 shadow-sm ${
              syncedSceneIds.has(selectedLessonId)
                ? 'bg-sky-600/30 border border-sky-500/50 text-sky-200 hover:bg-sky-600/50'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
            title="Lưu và mã hóa kịch bản + âm thanh của bài này vào Thẻ nhớ SD để phát offline"
          >
            <span>{isDownloadingLesson ? '⏳' : syncedSceneIds.has(selectedLessonId) ? '💾' : '📥'}</span>
            <span>
              {isDownloadingLesson
                ? 'Đang tải...'
                : syncedSceneIds.has(selectedLessonId)
                ? 'Đã Lưu SD (Tải lại)'
                : 'Tải Về Thẻ SD'}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Online/Offline */}
          <button
            type="button"
            onClick={() => setIsSimulatingOffline(!isSimulatingOffline)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold transition active:scale-95 ${
              isSimulatingOffline
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 shadow-sm animate-pulse'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
            }`}
            title="Chuyển đổi chế độ mô phỏng Mạng Online / Offline"
          >
            <span>{isSimulatingOffline ? '📴' : '📡'}</span>
            <span>{isSimulatingOffline ? 'Offline (Ngắt mạng)' : 'Online (Có mạng)'}</span>
          </button>

          {/* Badge Virtual SD Card */}
          <button
            type="button"
            onClick={() => setActiveTab('sdcard')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs font-semibold hover:bg-sky-500/20 transition"
            title="Xem chi tiết Thẻ Nhớ SD Ảo (microSD IndexedDB)"
          >
            <span>💾</span>
            <span className="font-mono text-[11px]">
              SD: {sdStats.fileCount} files
            </span>
          </button>

          {/* Badge Encryption */}
          <button
            type="button"
            onClick={() => setActiveTab('security')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition"
            title="Xem chi tiết mã hóa 2 tầng KEY_0 / KEY_N"
          >
            <span>🔒</span>
            <span className="font-mono text-[11px]">
              AES-GCM ({storedContentKey?.alias || 'KEY_1'})
            </span>
          </button>

          <button
            type="button"
            onClick={fetchManifestFromBackend}
            disabled={isFetchingManifest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs font-bold transition active:scale-95 disabled:opacity-50"
            title="Gọi GET /api/v1/device/manifest từ Backend FastAPI"
          >
            <span>🔄</span>
            <span>{isFetchingManifest ? 'Đang tải...' : 'Manifest Backend'}</span>
          </button>

          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition active:scale-95">
            <span>📥 Nạp JSON</span>
            <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </div>

      {/* Download and Sync Notification Banner */}
      {downloadNotice && (
        <div className="text-xs px-3.5 py-2 rounded-xl bg-slate-800/90 border border-slate-700 font-medium text-slate-200 flex items-center justify-between shadow-sm">
          <span>{downloadNotice}</span>
          <button
            type="button"
            onClick={() => setDownloadNotice(null)}
            className="text-slate-400 hover:text-white ml-2 text-xs font-bold px-1.5 py-0.5 rounded hover:bg-slate-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* 2. Active Step Hero Card */}
      {currentStep && (
        <div className="bg-gradient-to-r from-indigo-950/60 to-slate-900/90 border border-indigo-500/40 rounded-xl p-4 shadow-lg flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Step hiện tại:</span>
              <span className="font-mono text-sm font-black text-white px-2.5 py-0.5 bg-indigo-900/80 rounded border border-indigo-400/50">
                {currentStep.id}
              </span>
              {activeOrb && (
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Orb: {activeOrb}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              {isPlayingAudio && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
                  🔊 Đang phát loa
                </span>
              )}
              {isAwaitingInput && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                  🎯 Đang chờ phản hồi ({currentStep.listen?.mode})
                </span>
              )}
            </div>
          </div>

          {/* Interactive controls for Touch */}
          {currentStep.listen?.mode === 'touch' && (
            <div className="bg-slate-900/90 border border-amber-500/40 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-300">
                  👉 <strong>Chạm màn hình:</strong> Bấm trực tiếp vào mặt Bống ở bên trái (đang hiển thị 4 vùng {rawTouchLayout}) hoặc bấm phím tắt:
                </p>
                <span className="text-[10px] text-slate-400 font-mono">timeout: {currentStep.listen.touch?.timeout || 10000}ms</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleInputReply('zone1')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-95 shadow-sm"
                >
                  👆 Vùng 1 (Đúng - learn.word.cat: +1)
                </button>
                <button
                  type="button"
                  onClick={() => handleInputReply('zone2')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 shadow-sm"
                >
                  👆 Vùng 2 (Sai)
                </button>
                <button
                  type="button"
                  onClick={() => handleInputReply('zone3')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 shadow-sm"
                >
                  👆 Vùng 3 (Sai)
                </button>
                <button
                  type="button"
                  onClick={() => handleInputReply('zone4')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition active:scale-95 shadow-sm"
                >
                  👆 Vùng 4 (Sai)
                </button>
                <button
                  type="button"
                  onClick={() => handleInputReply('miss')}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition active:scale-95 shadow-sm"
                >
                  🎯 Tâm 45px (Lệch - miss)
                </button>
              </div>
            </div>
          )}

          {/* Interactive controls for Voice */}
          {currentStep.listen?.mode === 'voice' && (
            <div className="bg-slate-900/90 border border-amber-500/40 rounded-xl p-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-300">
                  🎤 <strong>Giọng nói:</strong> Đang chờ bé nói (gọi trực tiếp <code>POST /api/v1/device/listen</code>):
                </p>
                {backendListenResult && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/50">
                    Phân loại: "{backendListenResult.reply}" (conf: {backendListenResult.confidence ?? 0.9})
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {Array.isArray(currentStep.listen.voice?.options) &&
                  currentStep.listen.voice?.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      disabled={isCallingBackend}
                      onClick={() => handleVoiceTest(opt)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-95 disabled:opacity-50 shadow-sm"
                    >
                      Nói "{opt}"
                    </button>
                  ))}
                <button
                  type="button"
                  disabled={isCallingBackend}
                  onClick={() => handleVoiceTest('con mèo')}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-500 text-white transition active:scale-95 disabled:opacity-50"
                >
                  Nói "con mèo"
                </button>
                <button
                  type="button"
                  disabled={isCallingBackend}
                  onClick={() => handleInputReply('unclear')}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
                >
                  Nói lí nhí (unclear)
                </button>
                <button
                  type="button"
                  disabled={isCallingBackend}
                  onClick={() => handleInputReply('silent')}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
                >
                  Im lặng (silent)
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
                <input
                  type="text"
                  value={testSpeechText}
                  onChange={(e) => setTestSpeechText(e.target.value)}
                  placeholder="Nhập câu bé nói để Backend STT + LLM phân loại..."
                  className="flex-1 bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  disabled={isCallingBackend || !testSpeechText.trim()}
                  onClick={() => handleVoiceTest(testSpeechText.trim())}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50 shadow-sm"
                >
                  {isCallingBackend ? 'Đang gọi Backend...' : 'Gửi Backend'}
                </button>
              </div>
            </div>
          )}

          {currentReply && (
            <div className="text-[11px] text-slate-400 font-mono">
              Phản hồi gần nhất: <span className="font-bold text-emerald-400">{currentReply}</span>
            </div>
          )}
        </div>
      )}

      {/* 3. Tab Navigation */}
      <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('steps')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
            activeTab === 'steps' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          📋 Danh Sách Steps ({scene?.steps.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('memory')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
            activeTab === 'memory' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          🧠 6 Vùng Bộ Nhớ
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
            activeTab === 'logs' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          📜 Nhật Ký Chạy ({executionLog.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('manifest')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
            activeTab === 'manifest' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          📦 Manifest v3
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
            activeTab === 'security' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <span>🔒 Khóa &amp; Mã Hóa</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-black/30 rounded font-mono">
            {storedContentKey?.alias || 'KEY_1'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('sdcard')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
            activeTab === 'sdcard' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <span>💾 Thẻ Nhớ SD</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-black/30 rounded font-mono">
            {sdStats.fileCount}
          </span>
        </button>
      </div>

      {/* 4. Tab 1: Steps List & Flow */}
      {activeTab === 'steps' && (
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[380px] pr-1">
          {scene?.steps.map((st) => {
            const isCurrent = st.id === currentStep?.id;
            return (
              <div
                key={st.id}
                onClick={() => jumpToStep(st.id)}
                className={`flex flex-col gap-1.5 p-3 rounded-xl border transition cursor-pointer ${
                  isCurrent
                    ? 'bg-indigo-950/50 border-indigo-500 shadow-md ring-1 ring-indigo-500/50'
                    : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-white">{st.id}</span>
                    {st.orb && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700 text-slate-300">
                        orb: {st.orb}
                      </span>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-500 text-white uppercase tracking-wider">
                      Đang chạy
                    </span>
                  )}
                </div>

                {/* Summary of Audio / Listen */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  {st.audio && <span>🔊 {st.audio.map((a) => a.src).join(' + ')}</span>}
                  {st.listen && (
                    <span className="text-amber-400 font-medium">
                      🎯 Listen: {st.listen.mode}
                      {st.listen.mode === 'touch' && ` (${st.listen.touch?.layout})`}
                    </span>
                  )}
                  {st.next && <span>➡️ Next: {st.next}</span>}
                </div>

                {/* Branches detail if current */}
                {isCurrent && st.branches && (
                  <div className="mt-2 pt-2 border-t border-slate-700/50 flex flex-col gap-1 text-xs">
                    <span className="font-bold text-slate-300">Các nhánh rẽ (branches):</span>
                    {st.branches.map((br, idx) => (
                      <div key={idx} className="flex items-center justify-between font-mono text-[11px] text-slate-400">
                        <span>
                          when: {typeof br.when === 'object' ? JSON.stringify(br.when) : String(br.when)}
                        </span>
                        <span className="text-emerald-400">➡️ {br.go || br.next}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Tab 2: 6 Memory Spaces */}
      {activeTab === 'memory' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <span className="font-bold text-indigo-400 uppercase tracking-wider block mb-1">sys (Thiết bị)</span>
            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(memory.sys, null, 2)}
            </pre>
          </div>
          <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <span className="font-bold text-indigo-400 uppercase tracking-wider block mb-1">profile (Phụ huynh)</span>
            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(memory.profile, null, 2)}
            </pre>
          </div>
          <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <span className="font-bold text-indigo-400 uppercase tracking-wider block mb-1">learn (Tiến độ bài học)</span>
            <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap font-bold">
              {JSON.stringify(memory.learn, null, 2)}
            </pre>
          </div>
          <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <span className="font-bold text-indigo-400 uppercase tracking-wider block mb-1">user (Sở thích)</span>
            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(memory.user, null, 2)}
            </pre>
          </div>
          <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <span className="font-bold text-indigo-400 uppercase tracking-wider block mb-1">stat (Thống kê)</span>
            <pre className="text-[11px] font-mono text-amber-300 whitespace-pre-wrap font-bold">
              {JSON.stringify(memory.stat, null, 2)}
            </pre>
          </div>
          <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
            <span className="font-bold text-indigo-400 uppercase tracking-wider block mb-1">tmp (Biến tạm - mất khi ngủ)</span>
            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
              {JSON.stringify(memory.tmp, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* 4. Tab 3: Execution Log */}
      {activeTab === 'logs' && (
        <div className="flex flex-col gap-1 p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-[11px] text-slate-300 overflow-y-auto max-h-[380px]">
          {executionLog.length === 0 ? (
            <span className="text-slate-600">Chưa có nhật ký...</span>
          ) : (
            executionLog.map((log, i) => (
              <div key={i} className="leading-relaxed">
                {log}
              </div>
            ))
          )}
        </div>
      )}

      {/* 4. Tab 4: Manifest v3 */}
      {activeTab === 'manifest' && (
        <div className="flex flex-col gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
            <span className="font-bold text-slate-300">
              API: <code>GET /api/v1/device/manifest?device_id=simulator_v3_dev</code>
            </span>
            <button
              type="button"
              onClick={fetchManifestFromBackend}
              className="px-2.5 py-1 text-xs font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              Làm mới
            </button>
          </div>
          <pre className="font-mono text-[11px] text-emerald-400 whitespace-pre-wrap overflow-y-auto max-h-[340px]">
            {backendManifest
              ? JSON.stringify(backendManifest, null, 2)
              : 'Nhấn nút "Manifest Backend" ở trên để tải manifest từ Backend (port 8000)...'}
          </pre>
        </div>
      )}

      {/* 4. Tab 5: Security & 2-tier Key Management */}
      {activeTab === 'security' && (
        <div className="flex flex-col gap-3 p-4 bg-slate-950 rounded-xl border border-amber-500/30 overflow-y-auto max-h-[460px]">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div>
              <h3 className="text-xs font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>🛡️</span> Kiến Trúc Khóa 2 Tầng (Firmware eFuse &amp; Master Content Keys)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tất cả assets (.opus, .json, .eaf) được mã hóa AES-256-GCM ở Backend và giải mã ngay trước khi phát.
              </p>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              BONG_ENVELOPE v1
            </span>
          </div>

          {/* Architecture Pipeline Banner */}
          <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800 text-[11px] text-slate-300 flex flex-col gap-1.5 font-mono">
            <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Luồng bảo mật 2 tầng:</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700">Cloudflare R2 / S3</span>
              <span className="text-slate-500">→ (Mã hóa KEY_N) →</span>
              <span className="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700">SD Card / Flash</span>
              <span className="text-slate-500">→</span>
              <span className="px-2 py-1 rounded bg-indigo-950 text-indigo-300 border border-indigo-700 font-bold">KEY_0 Unwraps KEY_N</span>
              <span className="text-slate-500">→</span>
              <span className="px-2 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold">Web Audio Context / Loa</span>
            </div>
          </div>

          {/* Grid: KEY_0 and KEY_N */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Card 1: KEY_0 Hardware eFuse */}
            <div className="flex flex-col gap-2 p-3 bg-slate-900/80 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1">
                  <span>🔒</span> Tầng 1: Khóa Gốc Phần Cứng (KEY_0)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-mono font-bold">
                  eFuse chip
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Ghi 1 lần tại xưởng sản xuất, read-protected bằng phần cứng. Backend hoàn toàn không nắm giữ key này.
              </p>
              <div className="bg-slate-950 rounded p-2 border border-slate-800 font-mono text-[10px] text-slate-300 break-all select-all">
                {key0Hex}
              </div>
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={handleResetKey0}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  title="Mô phỏng thay chip phần cứng mới"
                >
                  🔄 Tái tạo Key 0 mới
                </button>
              </div>
            </div>

            {/* Card 2: Master Content Key (KEY_N) */}
            <div className="flex flex-col gap-2 p-3 bg-slate-900/80 rounded-lg border border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1">
                  <span>🔑</span> Tầng 2: Master Content Key (KEY_N)
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-mono font-bold">
                  NVS Flash
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Backend quản lý 1 khóa active duy nhất tại một thời điểm, xoay vòng định kỳ mỗi tháng.
              </p>

              {storedContentKey ? (
                <div className="bg-slate-950 rounded p-2.5 border border-emerald-500/30 font-mono text-[11px] flex flex-col gap-1 text-slate-300">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Alias:</span>
                    <span className="font-bold text-emerald-400">{storedContentKey.alias} (v{storedContentKey.version})</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Thuật toán:</span>
                    <span className="text-slate-200">AES-256-GCM</span>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-500">
                    <span>Đã bọc và lưu NVS:</span>
                    <span>{new Date(storedContentKey.updatedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950/60 rounded p-2.5 border border-dashed border-slate-700 text-[11px] text-amber-300">
                  Chưa nạp Content Key từ Backend. Hãy nhấn &quot;Bắt tay lấy Khóa&quot; bên dưới.
                </div>
              )}

              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={fetchKeyFromBackend}
                  disabled={isFetchingKey}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
                >
                  <span>🔄</span>
                  <span>{isFetchingKey ? 'Đang tải key...' : 'Bắt tay lấy Khóa (GET /device/key)'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Card 3: Live Cryptographic Sandbox */}
          <div className="flex flex-col gap-2.5 p-3.5 bg-slate-900/90 rounded-lg border border-amber-500/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                <span>🧪</span> Hộp Thử Nghiệm Giải Mã BONG_ENVELOPE (Live Web Crypto AES-GCM)
              </span>
              <span className="text-[10px] text-slate-400 font-mono">SubtleCrypto AES-256-GCM</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-slate-300 font-semibold">Nội dung mẫu cần mã hóa / giải mã:</label>
              <input
                type="text"
                value={cryptoTestText}
                onChange={(e) => setCryptoTestText(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleEncryptTest}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition active:scale-95 shadow-sm"
              >
                🔒 1. Mã hóa Envelope (36-byte BONG)
              </button>
              <button
                type="button"
                disabled={!cryptoEnvelope}
                onClick={handleDecryptTest}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 active:scale-95 shadow-sm"
              >
                🔓 2. Giải mã Web Crypto
              </button>
              <button
                type="button"
                disabled={!cryptoEnvelope}
                onClick={handleTamperTest}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition disabled:opacity-50 active:scale-95 shadow-sm"
                title="Làm biến đổi 1 byte trong ciphertext để kiểm tra tính toàn vẹn của GCM Auth Tag"
              >
                ⚠️ 3. Test Tamper Payload (Hỏng 1 byte)
              </button>
            </div>

            {/* Envelope Breakdown */}
            {cryptoEnvelope && (
              <div className="bg-slate-950 rounded-lg p-2.5 border border-slate-800 flex flex-col gap-1 text-[11px] font-mono">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Cấu trúc gói BONG_ENVELOPE ({cryptoEnvelope.length} bytes):
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] pt-1 text-slate-300">
                  <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                    <span className="text-slate-500 block">Magic (4B):</span>
                    <span className="text-emerald-400 font-bold">BONG</span>
                  </div>
                  <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                    <span className="text-slate-500 block">Version (2B):</span>
                    <span className="text-amber-400 font-bold">v{storedContentKey?.version || 1}</span>
                  </div>
                  <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                    <span className="text-slate-500 block">Nonce / IV:</span>
                    <span className="text-indigo-300 font-bold">12 bytes CSPRNG</span>
                  </div>
                  <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                    <span className="text-slate-500 block">GCM Tag (16B):</span>
                    <span className="text-indigo-300 font-bold">128-bit MAC</span>
                  </div>
                </div>
              </div>
            )}

            {/* Decrypted Output */}
            {cryptoDecryptedText && (
              <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-lg p-2.5 text-xs text-emerald-300 flex items-center gap-2">
                <span className="text-base">✅</span>
                <div>
                  <strong className="block text-[10px] text-emerald-400 uppercase tracking-wider">Kết quả giải mã thành công:</strong>
                  <span>{cryptoDecryptedText}</span>
                </div>
              </div>
            )}

            {/* Error / Tamper Output */}
            {cryptoError && (
              <div className="bg-rose-950/40 border border-rose-500/40 rounded-lg p-2.5 text-xs text-rose-300 flex items-center gap-2">
                <span className="text-base">🛡️</span>
                <div>
                  <strong className="block text-[10px] text-rose-400 uppercase tracking-wider">Cảnh báo bảo mật / Toàn vẹn:</strong>
                  <span>{cryptoError}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Tab 6: Virtual microSD Card Manager */}
      {activeTab === 'sdcard' && (
        <div className="flex flex-col gap-3.5 p-4 bg-slate-950 rounded-xl border border-sky-500/30 overflow-y-auto max-h-[460px]">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div>
              <h3 className="text-xs font-black text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>💾</span> Thẻ Nhớ microSD Ảo (Local FAT32 Storage)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Mô phỏng bộ nhớ thẻ SD thật của ESP32. Cho phép chạy kịch bản &amp; phát âm thanh 100% Offline khi ngắt mạng.
              </p>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
              IndexedDB ({sdStats.fileCount} files • {(sdStats.totalBytes / 1024).toFixed(1)} KB)
            </span>
          </div>

          {/* Offline/Online Status Banner */}
          <div
            className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
              isSimulatingOffline
                ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">{isSimulatingOffline ? '📴' : '📡'}</span>
              <div>
                <strong>{isSimulatingOffline ? 'Chế độ Offline (Ngắt mạng)' : 'Chế độ Online (Có mạng)'}</strong>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isSimulatingOffline
                    ? 'Simulator hoàn toàn ngắt kết nối Backend. Tất cả bài học và âm thanh đang được đọc & giải mã từ thẻ nhớ SD ảo.'
                    : 'Simulator đang kết nối bình thường với Backend FastAPI (port 8000).'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSimulatingOffline(!isSimulatingOffline)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm ${
                isSimulatingOffline
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
              }`}
            >
              {isSimulatingOffline ? 'Bật Lại Mạng' : 'Ngắt Mạng Thử Nghiệm'}
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isSyncingSd}
              onClick={handleLoadFactoryPack}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50 shadow-sm"
              title="Nạp sẵn các bài học và file âm thanh WAV/Opus mã hóa BONG_ENVELOPE vào thẻ nhớ"
            >
              <span>📦</span>
              <span>{isSyncingSd ? 'Đang nạp...' : 'Nạp Gói Xuất Xưởng (Factory Default Pack)'}</span>
            </button>

            <button
              type="button"
              disabled={isSyncingSd}
              onClick={handleSyncFromBackend}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 shadow-sm"
              title="Đồng bộ Manifest & Khóa từ Backend FastAPI vào thẻ nhớ"
            >
              <span>📥</span>
              <span>Đồng Bộ Manifest</span>
            </button>

            <button
              type="button"
              disabled={isSyncingSd}
              onClick={async () => {
                setIsSyncingSd(true);
                try {
                  const activeKey = SimulatedDeviceSecurity.getStoredContentKey();
                  let keyBase64 = activeKey?.rawKeyBase64;
                  if (!keyBase64) {
                    const fallbackBytes = new Uint8Array(32);
                    for (let i = 0; i < 32; i++) fallbackBytes[i] = i + 1;
                    keyBase64 = uint8ArrayToBase64(fallbackBytes);
                  }
                  const keyVer = activeKey?.version || 1;

                  // Sync sample scenes first
                  for (const sc of [SAMPLE_LESSON_TEST, SAMPLE_START_SCENE, SAMPLE_END_SCENE]) {
                    await VirtualSdCard.syncLessonToSdCard(sc.id, sc.id, sc, keyBase64, keyVer);
                  }

                  // Sync stories and first 10 lessons from database
                  let syncCount = 0;
                  const targets = [
                    ...catalog.filter((c) => c.category === 'stories'),
                    ...catalog.filter((c) => c.category === 'learning').slice(0, 10),
                  ];

                  for (const item of targets) {
                    try {
                      const res = await fetch(item.metadataUrl || `/cdn/lessions/${item.id}/metadata.json`);
                      if (res.ok) {
                        const raw = await res.json();
                        await VirtualSdCard.syncLessonToSdCard(item.id, item.title, raw, keyBase64, keyVer);
                        syncCount++;
                      }
                    } catch {
                      // skip failed item
                    }
                  }
                  await refreshSdStats();
                  await refreshCatalogAndSd();
                  alert(`Đã đồng bộ thành công ${syncCount} bài học & câu chuyện CSDL vào thẻ nhớ SD ảo! Giờ đây bạn có thể ngắt mạng và phát hoàn toàn offline.`);
                } catch (err: any) {
                  alert(`Lỗi đồng bộ: ${err.message}`);
                } finally {
                  setIsSyncingSd(false);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition disabled:opacity-50 shadow-sm"
              title="Tự động kéo tất cả Truyện và Bài học từ PostgreSQL vào Thẻ nhớ SD ảo"
            >
              <span>⚡</span>
              <span>{isSyncingSd ? 'Đang nạp...' : 'Tải Loạt Bài CSDL Vào SD'}</span>
            </button>

            <button
              type="button"
              onClick={handleFormatSd}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-700/80 hover:bg-rose-700 text-white transition shadow-sm ml-auto"
              title="Xóa toàn bộ file trên thẻ nhớ ảo"
            >
              <span>🗑️</span>
              <span>Format Thẻ Nhớ</span>
            </button>
          </div>

          {/* Quick Offline Playable Scenes Section */}
          {sdFiles.some((f) => f.path.startsWith('/sdcard/scenes/')) && (
            <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <span>🎮</span> Kịch bản sẵn sàng phát Offline ({sdFiles.filter((f) => f.path.startsWith('/sdcard/scenes/')).length} bài):
              </span>
              <div className="flex flex-wrap gap-2 pt-1">
                {sdFiles
                  .filter((f) => f.path.startsWith('/sdcard/scenes/') && f.path.endsWith('.json'))
                  .map((f) => {
                    const sceneId = f.path.replace('/sdcard/scenes/', '').replace('.json', '');
                    const catItem = catalog.find((c) => c.id === sceneId);
                    const label = catItem ? `${catItem.category === 'stories' ? '📖' : '📚'} ${catItem.title}` : `⚡ ${sceneId}`;
                    const isCurrent = scene?.id === sceneId;
                    return (
                      <button
                        key={sceneId}
                        type="button"
                        onClick={() => handleSelectScene(sceneId)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          isCurrent
                            ? 'bg-indigo-600/40 border-indigo-500 text-indigo-200 font-bold shadow-sm'
                            : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <span>▶️</span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Files Explorer Table */}
          <div className="bg-slate-900/90 rounded-lg border border-slate-800 overflow-hidden flex flex-col">
            <div className="p-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
              <span className="font-bold flex items-center gap-1.5">
                <span>📁</span> Danh sách file trên thẻ SD ({sdFiles.length})
              </span>
              <button
                type="button"
                onClick={refreshSdStats}
                className="text-[11px] text-sky-400 hover:underline"
              >
                🔄 Quét lại
              </button>
            </div>

            {sdFiles.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <span className="text-2xl">📭</span>
                <span>Thẻ nhớ SD ảo đang trống.</span>
                <span className="text-[11px] text-slate-600">
                  Hãy nhấn nút &quot;Nạp Gói Xuất Xưởng&quot; ở trên để nạp kịch bản và âm thanh mã hóa mẫu!
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[220px]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/80 text-slate-400 text-[10px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="p-2">Đường dẫn</th>
                      <th className="p-2">Kích thước</th>
                      <th className="p-2">Trạng thái</th>
                      <th className="p-2">Thời gian</th>
                      <th className="p-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300 text-[11px]">
                    {sdFiles.map((file) => (
                      <tr key={file.path} className="hover:bg-slate-800/40 transition">
                        <td className="p-2 font-bold text-slate-200">{file.path}</td>
                        <td className="p-2">{file.size} B</td>
                        <td className="p-2">
                          {file.isEncrypted ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              🔒 BONG_ENVELOPE
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400">
                              Plain
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-[10px] text-slate-500">
                          {new Date(file.updatedAt).toLocaleTimeString()}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              await VirtualSdCard.deleteFile(file.path);
                              await refreshSdStats();
                            }}
                            className="text-rose-400 hover:text-rose-300 text-[11px]"
                            title="Xóa file này"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
