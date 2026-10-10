/**
 * Script Engine React Hook.
 * Implements the step lifecycle and six memory spaces — Oct-1 contract:
 * Excel-style `when`, single-shot `retry`, `ignore_silence`, `silent_streak`,
 * `hear` mode (local), `talk` sessions, device log schema {t,scene,step,mode,
 * reply,retried,ms,seq}.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { V3Scene, V3Step, MemorySpaces, OrbExpression, DeviceLogEntry, ManifestFileItem } from './types';
import { resolvePlaceholders } from './script-parser';
import { evalWhen } from './when-expr';
import { normalizeK7 } from './k7-normalizer';
import { VirtualSdCard } from './virtual-sd-card';
import { isBongEncrypted, decryptBongAsset, SimulatedDeviceSecurity } from './crypto-client';
import { isImaAdpcmWav, decodeImaAdpcmToAudioBuffer } from './adpcm-decoder';
import {
  SAMPLE_LESSON_TEST,
  SAMPLE_TALK_SCENE,
  SAMPLE_START_SCENE,
  SAMPLE_END_SCENE,
  SAMPLE_INLIST_SCENE,
  SAMPLE_MANIFEST_LISTS,
} from './sample-scenes';

const BUILTIN_SCENES: Record<string, V3Scene> = {
  LESSON_TEST: SAMPLE_LESSON_TEST,
  INLIST_DEMO: SAMPLE_INLIST_SCENE,
  TALK_DEMO: SAMPLE_TALK_SCENE,
  START: SAMPLE_START_SCENE,
  END: SAMPLE_END_SCENE,
};

let sharedAudioContext: AudioContext | null = null;
let activeSourceNode: AudioBufferSourceNode | null = null;
let activeSourceTimer: ReturnType<typeof setTimeout> | null = null;

export function stopCurrentAudioPlayback(): void {
  if (activeSourceTimer) {
    clearTimeout(activeSourceTimer);
    activeSourceTimer = null;
  }
  if (activeSourceNode) {
    try {
      activeSourceNode.stop();
      activeSourceNode.disconnect();
    } catch {}
    activeSourceNode = null;
  }
}

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioContext) {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      sharedAudioContext = new AudioCtx();
    }
  }
  return sharedAudioContext;
}

export function unlockSharedAudioContext(): void {
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

const playAudioBuffer = async (
  audioContext: AudioContext,
  buffer: ArrayBuffer
): Promise<void> => {
  stopCurrentAudioPlayback();
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {});
    }
    // If still suspended (no user interaction yet), don't deadlock!
    if (audioContext.state === 'suspended') {
      console.warn('[script-engine] AudioContext suspended (waiting for user interaction). Bypassing audio wait.');
      return new Promise((resolve) => setTimeout(resolve, 300));
    }

    let audioBuffer: AudioBuffer;
    if (isImaAdpcmWav(buffer)) {
      audioBuffer = decodeImaAdpcmToAudioBuffer(audioContext, buffer);
    } else {
      audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    activeSourceNode = source;

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          if (activeSourceTimer) {
            clearTimeout(activeSourceTimer);
            activeSourceTimer = null;
          }
          if (activeSourceNode === source) {
            activeSourceNode = null;
          }
          resolve();
        }
      };

      activeSourceTimer = setTimeout(finish, Math.max(500, (audioBuffer.duration + 0.6) * 1000));
      source.onended = finish;
      source.start(0);
    });
  } catch (err) {
    console.warn('Audio playback error, falling back to pause:', err);
    return new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const playSynthesizedTone = (
  audioContext: AudioContext,
  frequency: number = 520,
  durationMs: number = 500
): Promise<void> => {
  try {
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, audioContext.currentTime);

    gain.gain.setValueAtTime(0.01, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + durationMs / 1000);

    return new Promise((resolve) => setTimeout(resolve, durationMs));
  } catch {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
};

const INITIAL_MEMORY: MemorySpaces = {
  sys: {
    rnd: 0,
    silent_streak: 0,
    net: true,
    time: new Date().toLocaleTimeString(),
    battery: 85,
    first_run: false,
  },
  profile: {
    child_name: 'Bảo Anh',
    bong_name: 'Bống',
    bedtime: '21:00',
    lesson_from: '19:45',
    lesson_to: '20:30',
  },
  learn: {},
  user: {},
  stat: {
    today_min: 15,
    sessions: 2,
    guide_done: true,
  },
  tmp: {},
};

const SILENT_STREAK_LIMIT = 4; // cfg.silent_streak default

export function useScriptEngine() {
  const [scene, setScene] = useState<V3Scene | null>(null);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [stepRunSeq, setStepRunSeq] = useState(0);
  const [activeOrb, setActiveOrb] = useState<OrbExpression>('idle');
  const [memory, setMemory] = useState<MemorySpaces>(INITIAL_MEMORY);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentReply, setCurrentReply] = useState<string | null>(null);
  const [isAwaitingInput, setIsAwaitingInput] = useState(false);
  const [retriedThisStep, setRetriedThisStep] = useState(false);
  const [deviceLogs, setDeviceLogs] = useState<DeviceLogEntry[]>([]);
  const [manifestLists, setManifestLists] = useState<Record<string, Array<{ value: string; [k: string]: unknown }>>>(SAMPLE_MANIFEST_LISTS);
  const [manifestFiles, setManifestFiles] = useState<ManifestFileItem[]>([]);
  const manifestFilesRef = useRef<ManifestFileItem[]>([]);
  const externalSceneLoaderRef = useRef<((sceneId: string, stepId?: string) => Promise<void> | void) | null>(null);

  useEffect(() => {
    manifestFilesRef.current = manifestFiles;
  }, [manifestFiles]);

  const registerExternalSceneLoader = useCallback(
    (loader: ((sceneId: string, stepId?: string) => Promise<void> | void) | null) => {
      externalSceneLoaderRef.current = loader;
    },
    [],
  );

  const stepTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const logSeqRef = useRef(0);
  const stepEnteredAtRef = useRef(0);
  const retriedRef = useRef(false);

  const logMessage = useCallback((msg: string) => {
    setExecutionLog((prev) => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  /** Append a device log entry (new schema — seq monotonic, retried 0|1). */
  const pushDeviceLog = useCallback(
    (step: V3Step, mode: string, reply: string) => {
      const entry: DeviceLogEntry = {
        t: new Date().toISOString(),
        scene: scene?.id || '',
        step: step.id,
        mode,
        reply: reply.slice(0, 50),
        retried: retriedRef.current ? 1 : 0,
        ms: Math.max(0, Date.now() - stepEnteredAtRef.current),
        seq: ++logSeqRef.current,
      };
      setDeviceLogs((prev) => [...prev.slice(-200), entry]);
    },
    [scene],
  );

  const loadScene = useCallback((newScene: V3Scene, startStepId?: string) => {
    stopCurrentAudioPlayback();
    setScene(newScene);
    const entry =
      startStepId && newScene.steps.some((s) => s.id === startStepId) ? startStepId : newScene.entry;
    setCurrentStepId(entry);
    setStepRunSeq((seq) => seq + 1);
    setExecutionLog([]);
    setRetriedThisStep(false);
    retriedRef.current = false;
    logMessage(`Đã nạp kịch bản: ${newScene.id}, bắt đầu từ step: ${entry}`);

    const initialStep = newScene.steps.find((s) => s.id === entry);
    if (initialStep?.orb) {
      setActiveOrb(initialStep.orb);
    } else if (newScene.screen?.orb) {
      setActiveOrb(newScene.screen.orb);
    }
  }, [logMessage]);

  const currentStep = scene?.steps.find((s) => s.id === currentStepId) || null;

  // Commit save memory mutations (sys.*/profile.* are read-only)
  const commitSave = useCallback((saveObj?: Record<string, any>, reply?: string | null) => {
    if (!saveObj) return;

    setMemory((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(saveObj)) {
        const resolved = typeof v === 'string' ? resolvePlaceholders(v, prev, { reply: reply ?? null }) : v;
        const parts = k.split('.');
        const space = parts[0] as keyof MemorySpaces;
        const sub = parts.slice(1).join('.');

        if (space === 'sys' || space === 'profile') continue;

        if (space === 'learn' || space === 'user' || space === 'tmp' || space === 'stat') {
          if (typeof resolved === 'string' && resolved.startsWith('+')) {
            const add = parseInt(resolved.replace('+', ''), 10) || 0;
            const cur = typeof next[space][sub] === 'number' ? next[space][sub] : 0;
            (next[space] as any)[sub] = cur + add;
          } else {
            (next[space] as any)[sub] = resolved;
          }
        }
      }
      return next;
    });
  }, []);

  // Evaluate branches — `when` is an Excel-style string (or 'default').
  const evaluateBranches = useCallback(
    (step: V3Step, reply: string | null): string | null => {
      if (!step.branches || step.branches.length === 0) {
        return step.next || null;
      }

      for (const branch of step.branches) {
        const when = (branch as any).when;
        const isDefault = 'default' in branch || when === 'default' || when === undefined || when === null;
        if (isDefault) {
          if (branch.save) commitSave(branch.save, reply);
          return (branch as any).default || branch.go || branch.next || null;
        }
        if (typeof when === 'string' && evalWhen(when, { reply, memory, manifestLists })) {
          if (branch.save) commitSave(branch.save, reply);
          return branch.go || branch.next || null;
        }
      }
      return null;
    },
    [memory, manifestLists, commitSave],
  );

  // Jump to next step
  const transitionToStep = useCallback(
    (target: string | null, reply: string | null) => {
      stopCurrentAudioPlayback();
      if (!target) {
        logMessage('Kịch bản đã hoàn thành hoặc dừng lại.');
        setIsAwaitingInput(false);
        return;
      }

      const resolvedTarget = resolvePlaceholders(target, memory, { reply });

      if (currentStep?.save) {
        commitSave(currentStep.save);
      }

      logMessage(`Chuyển sang step: ${resolvedTarget} (kết quả: ${reply || 'auto'})`);

      // Cross-scene transition check (e.g. "END#idle", "END#finished", "LESSON_TEST", "HAHA")
      const sceneIdOnly = resolvedTarget.includes('#') ? resolvedTarget.split('#')[0] : resolvedTarget;
      const stepIdOnly = resolvedTarget.includes('#') ? resolvedTarget.split('#')[1] : undefined;

      if (sceneIdOnly !== scene?.id) {
        if (BUILTIN_SCENES[sceneIdOnly]) {
          logMessage(`🔄 Chuyển sang kịch bản tích hợp: ${sceneIdOnly} (step: ${stepIdOnly || 'entry'})`);
          loadScene(BUILTIN_SCENES[sceneIdOnly], stepIdOnly);
          return;
        }
        if (externalSceneLoaderRef.current) {
          logMessage(`🔄 Chuyển sang kịch bản ngoại vi: ${sceneIdOnly} (step: ${stepIdOnly || 'entry'})`);
          void externalSceneLoaderRef.current(sceneIdOnly, stepIdOnly);
          return;
        }
      } else if (stepIdOnly) {
        setCurrentStepId(stepIdOnly);
        setStepRunSeq((seq) => seq + 1);
        setCurrentReply(null);
        setIsAwaitingInput(false);
        retriedRef.current = false;
        setRetriedThisStep(false);
        return;
      }

      setCurrentStepId(resolvedTarget);
      setStepRunSeq((seq) => seq + 1);
      setCurrentReply(null);
      setIsAwaitingInput(false);
      retriedRef.current = false;
      setRetriedThisStep(false);
    },
    [commitSave, currentStep, loadScene, logMessage, memory, scene?.id],
  );

  /** Replay the re-ask audio and re-open the listen window (one-shot). */
  const runRetryAudio = useCallback(
    async (step: V3Step) => {
      const retry = step.listen?.retry;
      if (!retry?.audio?.length) return;
      for (const aud of retry.audio) {
        if (aud.wait) {
          await new Promise((r) => setTimeout(r, aud.wait));
        }
        const srcId = Array.isArray(aud.src) ? aud.src[0] : aud.src;
        if (!audioContextRef.current) {
          audioContextRef.current = getSharedAudioContext();
        }
        if (audioContextRef.current) {
          let buf: ArrayBuffer | null = await VirtualSdCard.readFile(`/sdcard/assets/audio/${srcId}`).catch(() => null);
          if (!buf) {
            buf = await VirtualSdCard.readFile(`/sdcard/assets/audio/${srcId}.wav`).catch(() => null);
          }
          if (!buf) {
            let audioUrl = aud.url;
            if (!audioUrl && typeof srcId === 'string') {
              if (srcId === 'voc_bong' || srcId === 'voc_bong_generic') {
                audioUrl = '/api/v1/o/87b24c3975ea3e62b1fe6c6a2383e6253d898e69585572c95fca8b41a3b49ea1';
              } else if (manifestFilesRef.current) {
                const found = manifestFilesRef.current.find((f) => f.id === srcId);
                if (found) {
                  audioUrl = `/api/v1/o/${found.hash}`;
                }
              }
            }
            if (audioUrl) {
              try {
                const localUrl = audioUrl.replace(/^https?:\/\/[^/]+\/api\/v1\/o\//, '/api/v1/o/');
                let res = await fetch(localUrl);
                if (!res.ok && localUrl !== audioUrl) res = await fetch(audioUrl);
                if (res.ok) {
                  buf = await res.arrayBuffer();
                  void VirtualSdCard.writeFile(`/sdcard/assets/audio/${srcId}`, buf);
                }
              } catch (e) {
                console.warn('Could not fetch retry audio:', srcId, e);
              }
            }
          }
          if (buf) await playAudioBuffer(audioContextRef.current, buf);
          else await playSynthesizedTone(audioContextRef.current, 620, 450);
        }
      }
    },
    [],
  );

  // Handle reply from any input source (touch, hear, voice, pet, talk).
  const handleInputReply = useCallback(
    (reply: string) => {
      if (!currentStep) return;
      const mode = currentStep.talk ? 'talk' : currentStep.listen?.mode || 'auto';
      const options = currentStep.listen?.voice?.options || currentStep.talk?.options || [];

      let normalized: string;
      if (mode === 'hear') {
        normalized = reply === 'silent' ? 'silent' : 'spoke';
      } else if (mode === 'voice' || (options && options.length > 0)) {
        normalized = normalizeK7(reply, options);
      } else {
        normalized = normalizeK7(reply);
      }

      setCurrentReply(normalized);
      logMessage(`Nhận phản hồi từ bé: "${normalized}" (gốc: "${reply}")`);

      // retry: once per step, only when reply is in retry.on
      const retry = currentStep.listen?.retry;

      if (
        retry &&
        !retriedRef.current &&
        retry.on.includes(normalized)
      ) {
        retriedRef.current = true;
        setRetriedThisStep(true);
        logMessage(`↩ retry một lần — hỏi lại (on: ${retry.on.join(', ')})`);
        void runRetryAudio(currentStep);
        setIsAwaitingInput(true); // re-open listen window
        return; // log entry written only on FINAL reply — retried flag covers this attempt
      }

      pushDeviceLog(currentStep, mode, normalized);

      // silent streak — may short-circuit to END#idle (bypass branches)
      const streakLimit = memory.sys.cfg?.silent_streak ?? SILENT_STREAK_LIMIT;
      const finalReply = normalized;
      const ignore = currentStep.listen?.ignore_silence || currentStep.talk?.ignore_silence;
      const newStreak =
        finalReply === 'silent' && !ignore ? memory.sys.silent_streak + 1 : 0;
      setMemory((prev) => ({ ...prev, sys: { ...prev.sys, silent_streak: newStreak } }));
      if (newStreak >= streakLimit) {
        logMessage(`silent_streak đạt ${streakLimit} → END#idle (bỏ qua branches)`);
        transitionToStep('END#idle', finalReply);
        return;
      }

      const target = evaluateBranches(currentStep, normalized);
      transitionToStep(target, normalized);
    },
    [currentStep, evaluateBranches, logMessage, transitionToStep, memory, pushDeviceLog, runRetryAudio],
  );

  // Step entry effect
  useEffect(() => {
    if (!currentStep) return;
    stepEnteredAtRef.current = Date.now();
    retriedRef.current = false;
    setRetriedThisStep(false);

    if (currentStep.orb) {
      setActiveOrb(currentStep.orb);
    }

    logMessage(`--- Đang thực thi Step: ${currentStep.id} ---`);

    let cancelled = false;
    setIsAwaitingInput(false);

    (async () => {
      // 1. Play audio sequence if present
      if (currentStep.audio && currentStep.audio.length > 0) {
        setIsPlayingAudio(true);
        const audioNodes = currentStep.audio;

        for (const aud of audioNodes) {
          if (cancelled) return;
          if (aud.wait) {
            await new Promise((r) => setTimeout(r, aud.wait));
          }
          if (cancelled) return;
          const srcId = Array.isArray(aud.src) ? aud.src[0] : aud.src;
          let foundBuffer: ArrayBuffer | null = null;
          const possiblePaths = [
            srcId,
            `/sdcard/assets/audio/${srcId}`,
            `/sdcard/assets/audio/${srcId}.opus`,
            `/sdcard/assets/audio/${srcId}.wav`,
          ];
          for (const p of possiblePaths) {
            foundBuffer = await VirtualSdCard.readFile(p);
            if (foundBuffer) break;
          }

          if (!foundBuffer) {
            let audioUrl = aud.url;
            if (!audioUrl && typeof srcId === 'string') {
              if (srcId === 'voc_bong' || srcId === 'voc_bong_generic') {
                audioUrl = '/api/v1/o/87b24c3975ea3e62b1fe6c6a2383e6253d898e69585572c95fca8b41a3b49ea1';
              } else if (manifestFilesRef.current) {
                const found = manifestFilesRef.current.find((f) => f.id === srcId);
                if (found) {
                  audioUrl = `/api/v1/o/${found.hash}`;
                }
              }
            }
            if (audioUrl) {
              try {
                const localUrl = audioUrl.replace(
                  /^https?:\/\/[^/]+\/api\/v1\/o\//,
                  '/api/v1/o/'
                );
                let res = await fetch(localUrl);
                if (!res.ok && localUrl !== audioUrl) {
                  res = await fetch(audioUrl);
                }
                if (res.ok) {
                  foundBuffer = await res.arrayBuffer();
                  void VirtualSdCard.writeFile(`/sdcard/assets/audio/${srcId}`, foundBuffer);
                }
              } catch (e) {
                console.warn('Could not fetch audio buffer for', srcId, e);
              }
            }
          }

          if (cancelled) return;

          if (foundBuffer) {
            let plaintextBuffer = foundBuffer;
            if (isBongEncrypted(foundBuffer)) {
              const storedKey = SimulatedDeviceSecurity.getStoredContentKey();
              if (storedKey) {
                try {
                  plaintextBuffer = await decryptBongAsset(foundBuffer, storedKey.rawKeyBase64);
                  logMessage(`🔓 [Thẻ SD] Đã giải mã asset âm thanh (${srcId})`);
                } catch {
                  logMessage(`⚠️ [Thẻ SD] Lỗi giải mã asset (${srcId})`);
                }
              }
            }

            if (!audioContextRef.current) {
              audioContextRef.current = getSharedAudioContext();
            }

            if (audioContextRef.current) {
              await playAudioBuffer(audioContextRef.current, plaintextBuffer);
            } else {
              await new Promise((r) => setTimeout(r, 600));
            }
          } else {
            if (!audioContextRef.current) {
              audioContextRef.current = getSharedAudioContext();
            }
            if (audioContextRef.current) {
              await playSynthesizedTone(audioContextRef.current, 540, 500);
            } else {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
        if (cancelled) return;
        setIsPlayingAudio(false);
      } else {
        setIsPlayingAudio(false);
      }

      if (cancelled) return;

      // 2. Interactive step: listen (4 modes) or talk block (ONLY after audio finishes!)
      const interactive = (currentStep.listen && currentStep.listen.mode !== 'none') || currentStep.talk;
      if (interactive) {
        setIsAwaitingInput(true);
        const mode = currentStep.talk ? 'talk' : currentStep.listen?.mode;
        logMessage(`Đang chờ tương tác (${mode})...`);
      } else {
        setIsAwaitingInput(false);
        await new Promise((r) => setTimeout(r, 350));
        if (cancelled) return;
        const nextStep = currentStep.next || evaluateBranches(currentStep, null);
        transitionToStep(nextStep, null);
      }
    })();

    return () => {
      cancelled = true;
      stopCurrentAudioPlayback();
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [currentStep, stepRunSeq, evaluateBranches, logMessage, transitionToStep]);

  const jumpToStep = useCallback((stepId: string) => {
    stopCurrentAudioPlayback();
    setCurrentStepId(stepId);
    setStepRunSeq((seq) => seq + 1);
    setIsAwaitingInput(false);
    retriedRef.current = false;
    setRetriedThisStep(false);
  }, []);

  return {
    scene,
    currentStep,
    activeOrb,
    memory,
    executionLog,
    isPlayingAudio,
    isAwaitingInput,
    currentReply,
    retriedThisStep,
    deviceLogs,
    manifestLists,
    setManifestLists,
    manifestFiles,
    setManifestFiles,
    loadScene,
    handleInputReply,
    jumpToStep,
    registerExternalSceneLoader,
  };
}
