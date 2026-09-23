/**
 * Script Engine React Hook.
 * Implements the 8-step lifecycle and 6 memory spaces from v3 spec.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { V3Scene, V3Step, MemorySpaces, OrbExpression } from './types';
import { resolvePlaceholders } from './script-parser';
import { VirtualSdCard } from './virtual-sd-card';
import { isBongEncrypted, decryptBongAsset, SimulatedDeviceSecurity } from './crypto-client';

const playAudioBuffer = async (
  audioContext: AudioContext,
  buffer: ArrayBuffer
): Promise<void> => {
  try {
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    return new Promise((resolve) => {
      source.onended = () => resolve();
    });
  } catch {
    return new Promise((resolve) => setTimeout(resolve, 600));
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
    attempt: 0,
    match: null,
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

export function useScriptEngine() {
  const [scene, setScene] = useState<V3Scene | null>(null);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [activeOrb, setActiveOrb] = useState<OrbExpression>('idle');
  const [memory, setMemory] = useState<MemorySpaces>(INITIAL_MEMORY);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [currentReply, setCurrentReply] = useState<string | null>(null);
  const [isAwaitingInput, setIsAwaitingInput] = useState(false);

  const stepTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const logMessage = useCallback((msg: string) => {
    setExecutionLog((prev) => [...prev.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const loadScene = useCallback((newScene: V3Scene) => {
    setScene(newScene);
    setCurrentStepId(newScene.entry);
    setExecutionLog([]);
    logMessage(`Đã nạp kịch bản: ${newScene.id}, bắt đầu từ step: ${newScene.entry}`);

    if (newScene.screen?.orb) {
      setActiveOrb(newScene.screen.orb);
    }
  }, [logMessage]);

  const currentStep = scene?.steps.find((s) => s.id === currentStepId) || null;

  // Evaluate branches condition
  const evaluateBranches = useCallback(
    (step: V3Step, reply: string | null): string | null => {
      if (!step.branches || step.branches.length === 0) {
        return step.next || null;
      }

      for (const branch of step.branches) {
        if (branch.when === 'default' || !branch.when) {
          return branch.go || branch.next || null;
        }

        if (typeof branch.when === 'object') {
          let matched = true;
          for (const [key, expectedVal] of Object.entries(branch.when)) {
            let actualVal: any = null;
            if (key === 'reply') {
              actualVal = reply;
            } else if (key.startsWith('sys.')) {
              actualVal = (memory.sys as any)[key.replace('sys.', '')];
            } else if (key.startsWith('learn.')) {
              actualVal = memory.learn[key.replace('learn.', '')];
            } else if (key.startsWith('stat.')) {
              actualVal = memory.stat[key.replace('stat.', '')];
            }

            if (actualVal !== expectedVal) {
              matched = false;
              break;
            }
          }

          if (matched) {
            return branch.go || branch.next || null;
          }
        }
      }

      return null;
    },
    [memory],
  );

  // Commit save memory mutations
  const commitSave = useCallback((saveObj?: Record<string, any>) => {
    if (!saveObj) return;

    setMemory((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(saveObj)) {
        const parts = k.split('.');
        const space = parts[0] as keyof MemorySpaces;
        const sub = parts.slice(1).join('.');

        // Disallow writing to sys or profile directly
        if (space === 'sys' || space === 'profile') continue;

        if (space === 'learn' || space === 'user' || space === 'tmp' || space === 'stat') {
          if (typeof v === 'string' && v.startsWith('+')) {
            const add = parseInt(v.replace('+', ''), 10) || 0;
            const cur = typeof next[space][sub] === 'number' ? next[space][sub] : 0;
            (next[space] as any)[sub] = cur + add;
          } else {
            (next[space] as any)[sub] = v;
          }
        }
      }
      return next;
    });
  }, []);

  // Jump to next step
  const transitionToStep = useCallback(
    (target: string | null, reply: string | null) => {
      if (!target) {
        logMessage('Kịch bản đã hoàn thành hoặc dừng lại.');
        setIsAwaitingInput(false);
        return;
      }

      // Resolve placeholder if target is dynamic
      const resolvedTarget = resolvePlaceholders(target, memory, { reply });

      if (currentStep?.save) {
        commitSave(currentStep.save);
      }

      logMessage(`Chuyển sang step: ${resolvedTarget} (kết quả: ${reply || 'auto'})`);
      setCurrentStepId(resolvedTarget);
      setCurrentReply(null);
      setIsAwaitingInput(false);
    },
    [commitSave, currentStep, logMessage, memory],
  );

  // Handle reply from touch or voice
  const handleInputReply = useCallback(
    (reply: string) => {
      if (!currentStep) return;
      setCurrentReply(reply);
      logMessage(`Nhận phản hồi từ bé: "${reply}"`);

      const target = evaluateBranches(currentStep, reply);
      transitionToStep(target, reply);
    },
    [currentStep, evaluateBranches, logMessage, transitionToStep],
  );

  // Step entry effect
  useEffect(() => {
    if (!currentStep) return;

    // 1. Set Orb expression
    if (currentStep.orb) {
      setActiveOrb(currentStep.orb);
    }

    logMessage(`--- Đang thực thi Step: ${currentStep.id} ---`);

    // 2. Play Audio from Virtual SD Card or synthesized tone
    if (currentStep.audio && currentStep.audio.length > 0) {
      setIsPlayingAudio(true);
      const audioNodes = currentStep.audio;

      (async () => {
        for (const aud of audioNodes) {
          const srcId = Array.isArray(aud.src) ? aud.src[0] : aud.src;
          // Check SD card for this asset
          let foundBuffer: ArrayBuffer | null = null;
          const possiblePaths = [
            srcId,
            `/sdcard/assets/audio/${srcId}`,
            `/sdcard/assets/audio/${srcId}.opus`,
            `/sdcard/assets/audio/${srcId}.wav`,
            `/sdcard/assets/audio/welcome.opus`, // sample fallback
          ];
          for (const p of possiblePaths) {
            foundBuffer = await VirtualSdCard.readFile(p);
            if (foundBuffer) break;
          }

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

            if (!audioContextRef.current && typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
              const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
              audioContextRef.current = new AudioCtx();
            }

            if (audioContextRef.current) {
              await playAudioBuffer(audioContextRef.current, plaintextBuffer);
            } else {
              await new Promise((r) => setTimeout(r, 600));
            }
          } else {
            // Synthesized tone if file not yet on SD card
            if (!audioContextRef.current && typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext)) {
              const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
              audioContextRef.current = new AudioCtx();
            }
            if (audioContextRef.current) {
              await playSynthesizedTone(audioContextRef.current, 540, 500);
            } else {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
        setIsPlayingAudio(false);
      })();
    }

    // 3. Determine if awaiting input
    if (currentStep.listen && currentStep.listen.mode !== 'none') {
      setIsAwaitingInput(true);
      logMessage(`Đang chờ tương tác (${currentStep.listen.mode})...`);
    } else {
      setIsAwaitingInput(false);
      // Auto advance
      const delay = (currentStep.audio?.length || 0) * 800 + 600;
      stepTimerRef.current = window.setTimeout(() => {
        const nextStep = currentStep.next || evaluateBranches(currentStep, null);
        transitionToStep(nextStep, null);
      }, Math.max(delay, 500));
    }

    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current);
    };
  }, [currentStep, evaluateBranches, logMessage, transitionToStep]);

  return {
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
    jumpToStep: setCurrentStepId,
  };
}
