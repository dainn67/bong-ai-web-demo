/**
 * V3 Engine Context & Headless Runner.
 *
 * Provides a shared, continuously running V3 Script Engine instance across
 * the application, so that RoundScreen can interact directly like real ESP32
 * hardware even when the technical debug panel is hidden.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useScriptEngine, unlockSharedAudioContext } from './use-script-engine';
import type { V3Scene, V3DeviceManifest, OrbExpression, DeviceLogEntry, MemorySpaces, V3Step } from './types';
import { VirtualSdCard } from './virtual-sd-card';
import {
  SimulatedDeviceSecurity,
  decryptBongAsset,
  isBongEncrypted,
} from './crypto-client';
import { useSimulatorStore } from '../store/simulator-store';
import { parseTouchLayout, type TouchLayoutType } from '../screen/touch-layout';
import { isEafUrl } from '../screen/eaf-view';
import { convertMetadataToV3Scene } from './metadata-converter';
import { fetchCdnCatalog, type LessonSummary } from '../lessons/catalog';
import {
  SAMPLE_LESSON_TEST,
  SAMPLE_TALK_SCENE,
  SAMPLE_START_SCENE,
  SAMPLE_END_SCENE,
  SAMPLE_INLIST_SCENE,
} from './sample-scenes';

export interface V3EngineContextType {
  engine: {
    scene: V3Scene | null;
    currentStep: V3Step | null;
    activeOrb: OrbExpression;
    memory: MemorySpaces;
    executionLog: string[];
    isPlayingAudio: boolean;
    isAwaitingInput: boolean;
    currentReply: string | null;
    retriedThisStep: boolean;
    deviceLogs: DeviceLogEntry[];
    manifestLists: Record<string, Array<{ value: string; [k: string]: unknown }>>;
    setManifestLists: (lists: Record<string, Array<{ value: string; [k: string]: unknown }>>) => void;
    loadScene: (scene: V3Scene, startStepId?: string) => void;
    handleInputReply: (reply: string) => void;
    jumpToStep: (stepId: string) => void;
  };
  backendManifest: V3DeviceManifest | null;
  isFetchingManifest: boolean;
  manifestError: string | null;
  fetchManifestFromBackend: () => Promise<V3DeviceManifest | null>;
  loadSceneById: (sceneId: string) => Promise<void>;
  refreshCatalogAndManifest: () => Promise<void>;
}

const V3EngineContext = createContext<V3EngineContextType | null>(null);

export function useV3EngineContext(): V3EngineContextType {
  const ctx = useContext(V3EngineContext);
  if (!ctx) {
    throw new Error('useV3EngineContext must be used within a V3EngineProvider');
  }
  return ctx;
}

/**
 * Maps hardware touch results to V3 scene reply identifiers.
 */
function mapTouchResultToV3Reply(result: string): string {
  switch (result) {
    case 'cham_khac':
      return 'miss';
    case 'vuot_len':
      return 'swipe_up';
    case 'vuot_xuong':
      return 'swipe_down';
    case 'vuot_trai':
      return 'swipe_left';
    case 'vuot_phai':
      return 'swipe_right';
    default:
      return result; // e.g. zone1, zone2, zone3, zone4
  }
}

export function V3EngineProvider({ children }: { children: ReactNode }) {
  const engine = useScriptEngine();
  const [backendManifest, setBackendManifest] = useState<V3DeviceManifest | null>(null);
  const [isFetchingManifest, setIsFetchingManifest] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  const setStoreCatalog = useSimulatorStore((state) => state.setCatalog);
  const setV3ScreenState = useSimulatorStore((state) => state.setV3ScreenState);
  const setV3TouchHandler = useSimulatorStore((state) => state.setV3TouchHandler);
  const setV3LoadSceneHandler = useSimulatorStore((state) => state.setV3LoadSceneHandler);
  const setV3JumpStepHandler = useSimulatorStore((state) => state.setV3JumpStepHandler);
  const setV3InputHandler = useSimulatorStore((state) => state.setV3InputHandler);

  // Sync manifest lists into script engine evaluator
  useEffect(() => {
    if (backendManifest?.lists) {
      engine.setManifestLists(backendManifest.lists as any);
    }
  }, [backendManifest, engine.setManifestLists]);

  useEffect(() => {
    if (backendManifest?.files) {
      engine.setManifestFiles(backendManifest.files);
    }
  }, [backendManifest, engine.setManifestFiles]);

  const loadSceneById = useCallback(
    async (id: string, startStepId?: string) => {
      unlockSharedAudioContext();

      // 1. Check Virtual SD Card
      try {
        const sdPath = `/sdcard/scenes/${id}.json`;
        const sdData = await VirtualSdCard.readFile(sdPath);
        if (sdData) {
          let plainBytes = new Uint8Array(sdData);
          if (isBongEncrypted(plainBytes)) {
            const key = SimulatedDeviceSecurity.getStoredContentKey();
            if (key) {
              plainBytes = new Uint8Array(await decryptBongAsset(plainBytes, key.rawKeyBase64));
            }
          }
          const text = new TextDecoder().decode(plainBytes);
          const parsed = JSON.parse(text) as V3Scene;
          engine.loadScene(parsed, startStepId);
          return;
        }
      } catch (err) {
        console.warn('Error reading scene from SD card:', err);
      }

      // 2. Manifest scene from Backend Blob Store
      const manifestScene = backendManifest?.scenes?.find((s) => s.id === id);
      if (manifestScene) {
        try {
          const baseClean = '/api/v1';
          let blobBase = backendManifest?.blob_base
            ? backendManifest.blob_base.replace(/\/$/, '')
            : `${baseClean}/o`;
          blobBase = blobBase.replace(/^https?:\/\/[^/]+\/api\/v1\/o/, '/api/v1/o');
          const res = await fetch(`${blobBase}/${manifestScene.hash}`);
          if (res.ok) {
            const rawBytes = new Uint8Array(await res.arrayBuffer());
            let plainBytes = rawBytes;
            if (isBongEncrypted(rawBytes)) {
              const key = SimulatedDeviceSecurity.getStoredContentKey();
              if (key) {
                plainBytes = new Uint8Array(await decryptBongAsset(rawBytes, key.rawKeyBase64));
              }
            }
            const text = new TextDecoder().decode(plainBytes);
            const parsed = JSON.parse(text) as V3Scene;
            void VirtualSdCard.writeFile(`/sdcard/scenes/${id}.json`, plainBytes, 'application/json');
            engine.loadScene(parsed, startStepId);
            return;
          }
        } catch (err) {
          console.warn('Error loading manifest scene blob:', err);
        }
      }

      // Direct fallback for production scenes if manifest is not ready yet
      const PRODUCTION_SCENE_HASHES: Record<string, string> = {
        HAHA: '73e18d0c6d97fab9f190a3872b9e37fe3fe577f2e77708a6c69de3e79cede89b',
        START: 'ec77180aa18b7e4f8a455f73fa43ae3b27c7ebcb61c85defd73e54f231bf3434',
        END: 'd0a9e736acfaae8f16222d5fdbaa0dd8bdc22e9445a61a07d16baa3ef71c29e9',
      };
      if (PRODUCTION_SCENE_HASHES[id]) {
        try {
          const res = await fetch(`/api/v1/o/${PRODUCTION_SCENE_HASHES[id]}`);
          if (res.ok) {
            const text = await res.text();
            const parsed = JSON.parse(text) as V3Scene;
            void VirtualSdCard.writeFile(`/sdcard/scenes/${id}.json`, new TextEncoder().encode(text), 'application/json');
            engine.loadScene(parsed, startStepId);
            return;
          }
        } catch (err) {
          console.warn('Error fetching production scene directly:', err);
        }
      }

      // 3. Built-in sample scenes (only if not found in manifest)
      if (id === 'LESSON_TEST') {
        engine.loadScene(SAMPLE_LESSON_TEST, startStepId);
        return;
      }
      if (id === 'INLIST_DEMO') {
        engine.loadScene(SAMPLE_INLIST_SCENE, startStepId);
        return;
      }
      if (id === 'TALK_DEMO') {
        engine.loadScene(SAMPLE_TALK_SCENE, startStepId);
        return;
      }
      if (id === 'START') {
        engine.loadScene(SAMPLE_START_SCENE, startStepId);
        return;
      }
      if (id === 'END') {
        engine.loadScene(SAMPLE_END_SCENE, startStepId);
        return;
      }

      // 4. Fallback to CSDL catalog
      try {
        const items = await fetchCdnCatalog();
        const item = items.find((c) => c.id === id);
        const metaUrl = item?.metadataUrl || `/cdn/lessions/${id}/metadata.json`;
        const res = await fetch(metaUrl);
        if (res.ok) {
          const rawMeta = await res.json();
          const v3Scene = convertMetadataToV3Scene(id, item?.title || id, rawMeta);
          engine.loadScene(v3Scene, startStepId);
        }
      } catch (err) {
        console.warn('Fallback catalog fetch error:', err);
      }
    },
    [backendManifest, engine.loadScene],
  );

  const syncCatalogWithManifest = useCallback(
    (scenes: { id: string; ver?: number; pin?: boolean; hash?: string }[]) => {
      const v3Items: LessonSummary[] = (scenes || []).map((s) => ({
        id: s.id,
        title:
          s.id === 'HAHA'
            ? 'Bài Học HAHA (Bản phát hành chuẩn)'
            : s.id === 'START'
            ? 'Bắt đầu (START)'
            : s.id === 'END'
            ? 'Kết thúc (END)'
            : s.id === 'UNIT_TEST_DAY_03_01'
            ? 'Bài học kiểm thử GĐ3'
            : `Kịch bản ${s.id}`,
        description:
          s.id === 'HAHA'
            ? '42 bước: Chạm 4 vùng pie4, Vuốt 4 hướng, Voice STT/LLM, Hoạt ảnh .eaf'
            : `Kịch bản phát hành v${s.ver ?? 1}${s.pin ? ' (Core)' : ''}`,
        category: 'learning',
        metadataUrl: s.hash ? `/api/v1/o/${s.hash}` : '',
        coverUrl: null,
      }));
      setStoreCatalog(v3Items);
    },
    [setStoreCatalog],
  );

  const fetchManifestFromBackend = useCallback(async (): Promise<V3DeviceManifest | null> => {
    setIsFetchingManifest(true);
    setManifestError(null);
    try {
      const res = await fetch('/api/v1/device/manifest?device_id=simulator_v3_dev');
      if (res.ok) {
        const data: V3DeviceManifest = await res.json();
        setBackendManifest(data);
        await VirtualSdCard.saveManifestCache(data);
        if (data.prompts) await VirtualSdCard.savePromptsCache(data.prompts);
        if (data.cfg) await VirtualSdCard.saveConfigCache(data.cfg);

        if (data.scenes && data.scenes.length > 0) {
          void syncCatalogWithManifest(data.scenes);
        }
        return data;
      } else {
        setManifestError(`Backend HTTP ${res.status}`);
        return null;
      }
    } catch (err: any) {
      setManifestError(err?.message || 'Lỗi mạng');
      return null;
    } finally {
      setIsFetchingManifest(false);
    }
  }, [syncCatalogWithManifest]);

  const refreshCatalogAndManifest = useCallback(async () => {
    await fetchManifestFromBackend();
  }, [fetchManifestFromBackend]);

  // Initial boot: load cached manifest or fetch from backend, wake device, start initial scene
  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    void (async () => {
      // 1. Load cache
      const cached = await VirtualSdCard.loadManifestCache();
      if (cached) {
        setBackendManifest(cached);
        if (cached.scenes && cached.scenes.length > 0) {
          void syncCatalogWithManifest(cached.scenes);
        }
      }

      // 2. Fetch fresh manifest from backend
      const fresh = await fetchManifestFromBackend();
      if (fresh?.scenes && fresh.scenes.length > 0) {
        void syncCatalogWithManifest(fresh.scenes);
      }
      // NOTE: Do NOT auto-start any scene on boot.
      // Device and simulator boot up into Standby / Idle face.
      // Lessons should only start when explicitly chosen by the user.
    })();
  }, [fetchManifestFromBackend, syncCatalogWithManifest]);

  // Register external scene loader for cross-scene transitions (e.g. START -> HAHA)
  useEffect(() => {
    engine.registerExternalSceneLoader((sceneId, stepId) => {
      void loadSceneById(sceneId, stepId);
    });
    return () => {
      engine.registerExternalSceneLoader(null);
    };
  }, [engine.registerExternalSceneLoader, loadSceneById]);

  // Register touch handler to bridge RoundScreen taps into engine
  useEffect(() => {
    setV3TouchHandler((result) => {
      const reply = mapTouchResultToV3Reply(result);
      engine.handleInputReply(reply);
    });

    return () => {
      setV3TouchHandler(null);
    };
  }, [engine.handleInputReply, setV3TouchHandler]);

  // Register load scene handler for RoundScreen menu
  useEffect(() => {
    setV3LoadSceneHandler((sceneId: string) => {
      void loadSceneById(sceneId);
    });

    return () => {
      setV3LoadSceneHandler(null);
    };
  }, [loadSceneById, setV3LoadSceneHandler]);

  // Register jump step handler to bridge Lesson Studio / IndexTable jump into V3 engine
  useEffect(() => {
    setV3JumpStepHandler((stepId: string) => {
      engine.jumpToStep(stepId);
    });

    return () => {
      setV3JumpStepHandler(null);
    };
  }, [engine.jumpToStep, setV3JumpStepHandler]);

  // Register input handler for voice/speech replies from TalkBar or mic
  useEffect(() => {
    setV3InputHandler((text: string) => {
      if (!engine.currentStep) return;
      engine.handleInputReply(text);
    });

    return () => {
      setV3InputHandler(null);
    };
  }, [engine.currentStep, engine.handleInputReply, setV3InputHandler]);


  // Synchronize state with RoundScreen display
  useEffect(() => {
    if (useSimulatorStore.getState().menu.view.screen !== 'closed') {
      return;
    }

    if (!engine.currentStep) {
      return;
    }

    const rawLayout =
      engine.currentStep?.listen?.mode === 'touch'
        ? engine.currentStep.listen.touch?.layout
        : undefined;

    const mappedLayout: TouchLayoutType | null = parseTouchLayout(rawLayout);

    const isWaitingForInput = engine.isAwaitingInput && !engine.isPlayingAudio;
    const micState = useSimulatorStore.getState().micState;

    let friendlyCaption: string | null = null;
    if (engine.currentStep) {
      if (engine.isPlayingAudio) {
        friendlyCaption = 'Bống đang nói...';
      } else if (isWaitingForInput) {
        if (engine.currentStep.listen?.mode === 'voice') {
          const opts = (engine.currentStep.listen.voice?.options || []).map((o) => o.name).join(', ');
          friendlyCaption = opts
            ? `Hỏi bé: [${opts}]`
            : micState === 'listening'
              ? 'Bống đang lắng nghe bé nói...'
              : 'Bé bấm mic để nói nhé!';
        } else if (engine.currentStep.listen?.mode === 'touch') {
          friendlyCaption = 'Bé chạm vào màn hình nhé!';
        } else if (engine.currentStep.listen?.mode === 'hear') {
          friendlyCaption =
            micState === 'listening'
              ? 'Bống đang lắng nghe bé...'
              : 'Bé bấm mic để nói cùng Bống nhé!';
        } else if (engine.currentStep.talk) {
          friendlyCaption = `Trò chuyện cùng ${engine.currentStep.talk.voice}`;
        }
      } else {
        friendlyCaption = `Bước: ${engine.currentStep.id}`;
      }
    }

    const firstVisual = engine.currentStep?.visual?.[0];
    const rawSrc = Array.isArray(firstVisual?.src) ? firstVisual?.src[0] : firstVisual?.src;
    let visualUrl: string | null =
      firstVisual?.url ||
      (typeof rawSrc === 'string' && (rawSrc.includes('/') || rawSrc.endsWith('.eaf'))
        ? rawSrc
        : null);

    if (visualUrl && (visualUrl.startsWith('https://bong-api.bcserver.xyz/api/v1/o/') || visualUrl.startsWith('http://localhost:8000/api/v1/o/'))) {
      visualUrl = visualUrl.replace(/^https?:\/\/[^/]+\/api\/v1\/o\//, '/api/v1/o/');
    }

    // Resolve visualUrl from manifest files
    if (!visualUrl && typeof rawSrc === 'string' && backendManifest?.files) {
      const fileAsset = backendManifest.files.find((f) => f.id === rawSrc);
      if (fileAsset) {
        const baseClean = '/api/v1';
        let blobBase = backendManifest.blob_base
          ? backendManifest.blob_base.replace(/\/$/, '')
          : `${baseClean}/o`;
        blobBase = blobBase.replace(/^https?:\/\/[^/]+\/api\/v1\/o/, '/api/v1/o');
        visualUrl = `${blobBase}/${fileAsset.hash}${fileAsset.kind === 'anim' ? '.eaf' : ''}`;
      }
    }

    if (visualUrl && !isEafUrl(visualUrl)) {
      const isKnownEaf =
        (firstVisual as any)?.nodeType === 'eaf' ||
        (typeof rawSrc === 'string' &&
          backendManifest?.files?.some((f) => f.id === rawSrc && f.kind === 'anim'));
      if (isKnownEaf) {
        visualUrl = `${visualUrl}.eaf`;
      }
    }

    setV3ScreenState({
      expression: engine.activeOrb,
      mode: engine.isPlayingAudio ? 'speaking' : 'idle',
      waitingFor: isWaitingForInput
        ? engine.currentStep?.listen?.mode === 'touch'
          ? 'touch'
          : engine.currentStep?.listen?.mode === 'voice' || engine.currentStep?.listen?.mode === 'hear'
            ? 'speech'
            : null
        : null,
      touchLayout: isWaitingForInput && engine.currentStep?.listen?.mode === 'touch' ? mappedLayout : null,
      caption: friendlyCaption,
      imageUrl: visualUrl,
      kind: 'lesson',
    });

    if (engine.currentStep) {
      const store = useSimulatorStore.getState();
      const matched = store.directIndexes.find((idx) => idx.order === engine.currentStep?.id);
      if (matched && store.directActiveIndex?.order !== matched.order) {
        useSimulatorStore.setState({
          directActiveIndex: matched,
          directPlaybackState: engine.isPlayingAudio ? 'playing' : 'idle',
          lessonPosition: `${matched.order}/${store.directIndexes.length}`,
          lessonDebug: `Step ${matched.order}`,
        });
      }
    }
  }, [
    backendManifest,
    engine.activeOrb,
    engine.currentStep,
    engine.isAwaitingInput,
    engine.isPlayingAudio,
    setV3ScreenState,
  ]);

  // Auto-mic integration: automatically open mic when step expects speech input and autoMic is enabled
  useEffect(() => {
    const isWaitingForSpeech =
      engine.isAwaitingInput &&
      !engine.isPlayingAudio &&
      (engine.currentStep?.listen?.mode === 'voice' ||
        engine.currentStep?.listen?.mode === 'hear' ||
        Boolean(engine.currentStep?.talk));

    const store = useSimulatorStore.getState();
    if (isWaitingForSpeech) {
      if (store.autoMic && store.micState !== 'listening' && store.menu.view.screen === 'closed') {
        void store.startListening();
      }
    } else if (engine.isPlayingAudio) {
      if (store.micState === 'listening') {
        store.stopListening();
      }
    }
  }, [engine.isAwaitingInput, engine.isPlayingAudio, engine.currentStep]);

  const value: V3EngineContextType = useMemo(
    () => ({
      engine,
      backendManifest,
      isFetchingManifest,
      manifestError,
      fetchManifestFromBackend,
      loadSceneById,
      refreshCatalogAndManifest,
    }),
    [
      engine,
      backendManifest,
      isFetchingManifest,
      manifestError,
      fetchManifestFromBackend,
      loadSceneById,
      refreshCatalogAndManifest,
    ],
  );

  return <V3EngineContext.Provider value={value}>{children}</V3EngineContext.Provider>;
}
