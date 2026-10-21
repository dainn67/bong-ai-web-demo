/**
 * Deterministic E2E Runner for `START#kiemtra -> HAHA#quiz -> SACH_KY_DIEU#answer -> END#idle -> END#finished`.
 *
 * Verifies the complete device V3 contract in the simulator:
 * 1. `START#kiemtra` branches on `{sys.first_run} = false` -> `HAHA#quiz`
 * 2. `POST /api/v1/device/listen` returns `{ reply: "correct", handoff: { kind: "question", seed: ... } }`
 * 3. Handoff seed is stored in `memory.sys.handoff_seed` / `memory.sys.last_utterance` and branches on `{reply} = correct` to `SACH_KY_DIEU#answer`
 * 4. `SACH_KY_DIEU#answer` expands `{sys.handoff_seed}` via `resolvePlaceholders` and calls `/talk/start`, `/talk/turn`, `/talk/end`
 * 5. Transitions via `branch: "done"` (with no `handoff.target`) to `END#idle -> END#finished`
 * 6. Emits exactly 1 `ev: "end"` line (`by: "end_scene"`) after `END#finished` and flushes via `POST /api/v1/device/sync`.
 */

import { evalWhen } from './when-expr';
import { resolvePlaceholders } from './script-parser';
import { JourneyLog } from './journey-log';
import {
  postDeviceListen,
  postDeviceTalkEnd,
  postDeviceTalkStart,
  postDeviceTalkTurn,
} from './device-contract-client';
import {
  CANONICAL_E2E_PROMPTS,
  CANONICAL_SCENE_MAP,
} from './e2e-fixtures';
import type { MemorySpaces, V3Branch } from './types';

function evaluateBranches(
  branches: V3Branch[],
  memory: MemorySpaces,
  reply: string
): V3Branch | undefined {
  for (const b of branches) {
    if (b.when === 'default') return b;
    if (evalWhen(b.when, { reply, memory })) return b;
  }
  return undefined;
}

export interface E2ERunReport {
  passed: boolean;
  visitedSteps: string[];
  listenReply: string | null;
  listenHandoffSeed: string | null;
  talkBranch: string | null;
  endEventsCount: number;
  endReason: string | null;
  syncedAckSeq?: number;
  error?: string;
}

function makeSilentWavBlob(): Blob {
  const wav = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);
  return new Blob([wav], { type: 'audio/wav' });
}

function createMockContractFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/device/listen')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          reply: 'correct',
          transcript: 'Con mèo ạ, mà tại sao trời lại có mưa hả Bống?',
          handoff: {
            kind: 'question',
            seed: 'tại sao trời lại có mưa?',
          },
          diagnostics: {
            stt_ms: 95,
            llm_ms: 180,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
          },
        }),
      } as Response;
    }
    if (url.endsWith('/api/v1/device/talk/start')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session: 'ts_e2e_mock',
          audio: 'QUJD',
          branch: 'continue',
          topic: 'weather',
          tts_left: 85,
          assistant_text: 'Mưa rơi từ những đám mây nặng hạt trên bầu trời đó con!',
        }),
      } as Response;
    }
    if (url.endsWith('/api/v1/device/talk/turn')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          audio: 'QUJD',
          branch: 'done',
          topic: 'weather',
          tts_left: 80,
          transcript: 'Con hiểu rồi ạ!',
          assistant_text: 'Giỏi lắm, bây giờ mình chuẩn bị nghỉ ngơi nhé!',
          handoff: {
            kind: 'question',
            seed: 'Con hiểu rồi ạ!',
            source_transcript: 'Con hiểu rồi ạ!',
          },
        }),
      } as Response;
    }
    if (url.endsWith('/api/v1/device/talk/end')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    }
    if (url.endsWith('/api/v1/device/sync')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, ack_seq: 1 }),
      } as Response;
    }
    throw new Error(`Unexpected URL in mock E2E runner: ${url}`);
  }) as typeof fetch;
}

export async function runCanonicalStartHahaMagicBookE2E(options?: {
  mode?: 'mock' | 'live';
  deviceId?: string;
  fetchImpl?: typeof fetch;
}): Promise<E2ERunReport> {
  const mode = options?.mode || 'mock';
  const deviceId = options?.deviceId || 'simulator_v3_dev';
  const fetchFn = options?.fetchImpl || (mode === 'mock' ? createMockContractFetch() : fetch);

  const visitedSteps: string[] = [];
  let listenReply: string | null = null;
  let listenHandoffSeed: string | null = null;
  let talkBranch: string | null = null;

  const memory: MemorySpaces = {
    sys: {
      rnd: 0.5,
      silent_streak: 0,
      net: true,
      time: '10:00',
      battery: 95,
      first_run: false,
    },
    profile: {
      child_name: 'Bé Bống',
      bong_name: 'Bống',
      bedtime: '21:00',
      lesson_from: '08:00',
      lesson_to: '20:00',
    },
    learn: {},
    user: {},
    stat: { today_min: 5, sessions: 1, onboard_done: true },
    tmp: {},
  };

  const journey = new JourneyLog({
    deviceId,
    endpoint: '/api/v1/device/sync',
    storage: null,
    fetchImpl: fetchFn,
  });

  try {
    const sid = journey.sessionStart({ mver: 3, battery: 95 });
    const clip = makeSilentWavBlob();

    // 1. START#kiemtra
    const startScene = CANONICAL_SCENE_MAP.START;
    const startStep = startScene.steps[0];
    visitedSteps.push(`${startScene.id}#${startStep.id}`);
    const startBranch = evaluateBranches(startStep.branches || [], memory, '');
    const hahaTarget = startBranch?.go || 'HAHA#quiz';
    journey.step({ sc: 'START', st: 'kiemtra', go: hahaTarget });

    // 2. HAHA#quiz
    const [hahaSceneId, hahaStepId] = hahaTarget.split('#');
    const hahaScene = CANONICAL_SCENE_MAP[hahaSceneId];
    const quizStep = hahaScene.steps.find((s) => s.id === (hahaStepId || hahaScene.entry))!;
    visitedSteps.push(`${hahaScene.id}#${quizStep.id}`);
    const listenSeq = journey.peekSeq();
    const listenRes = await postDeviceListen(
      {
        deviceId,
        scene: hahaScene.id,
        step: quizStep.id,
        mode: 'voice',
        prompt: CANONICAL_E2E_PROMPTS.haha_quiz,
        options: quizStep.listen?.voice?.options || [],
        clip,
        sid,
        seq: listenSeq,
        lan: 1,
        sceneVer: 1,
        mver: 3,
      },
      fetchFn
    );

    listenReply = listenRes.reply;
    if (listenRes.handoff?.seed) {
      listenHandoffSeed = listenRes.handoff.seed;
      memory.sys.handoff_seed = listenRes.handoff.seed;
      memory.sys.last_utterance = listenRes.handoff.seed;
      memory.tmp.seed = listenRes.handoff.seed;
    }

    const quizBranch = evaluateBranches(quizStep.branches || [], memory, listenRes.reply);
    const magicTarget = quizBranch?.go || 'SACH_KY_DIEU#answer';
    journey.step({
      sc: hahaScene.id,
      st: quizStep.id,
      m: 'voice',
      lan: 1,
      ans: listenRes.reply,
      go: magicTarget,
      ms: 900,
    });

    // 3. SACH_KY_DIEU#answer
    const [mbSceneId, mbStepId] = magicTarget.split('#');
    const mbScene = CANONICAL_SCENE_MAP[mbSceneId];
    const mbStep = mbScene.steps.find((s) => s.id === (mbStepId || mbScene.entry))!;
    visitedSteps.push(`${mbScene.id}#${mbStep.id}`);

    const talkSeq = journey.peekSeq();
    const resolvedSeed = resolvePlaceholders(mbStep.talk?.seed || '', memory);
    const tStart = await postDeviceTalkStart(
      {
        deviceId,
        scene: mbScene.id,
        step: mbStep.id,
        voice: mbStep.talk!.voice,
        prompt: CANONICAL_E2E_PROMPTS.sach_ky_dieu,
        seed: resolvedSeed,
        options: mbStep.talk!.options,
        turns: mbStep.talk!.turns,
        sec: mbStep.talk!.sec,
        sid,
        seq: talkSeq,
        sceneVer: 1,
        mver: 3,
      },
      fetchFn
    );

    const tTurn = await postDeviceTalkTurn(
      {
        session: tStart.session!,
        clip,
        lan: 1,
        sid,
        seq: talkSeq,
        sceneVer: 1,
        mver: 3,
      },
      fetchFn
    );

    await postDeviceTalkEnd(
      {
        session: tStart.session!,
        end: `branch:${tTurn.branch}`,
        sid,
        seq: talkSeq,
        sceneVer: 1,
        mver: 3,
      },
      fetchFn
    );

    if (tTurn.handoff?.seed) {
      memory.sys.handoff_seed = tTurn.handoff.seed;
      memory.sys.last_utterance = tTurn.handoff.seed;
      memory.tmp.seed = tTurn.handoff.seed;
    }
    talkBranch = tTurn.branch;
    const mbBranch = evaluateBranches(mbStep.branches || [], memory, tTurn.branch);
    const endIdleTarget = mbBranch?.go || 'END#idle';

    journey.step({
      sc: mbScene.id,
      st: mbStep.id,
      m: 'talk',
      turns: 1,
      end: `branch:${tTurn.branch}`,
      go: endIdleTarget,
      ms: 2100,
    });

    // 4. END#idle -> END#finished (session_end only emitted after END#finished)
    const [endSceneId, endStepId] = endIdleTarget.split('#');
    const endScene = CANONICAL_SCENE_MAP[endSceneId];
    const idleStep = endScene.steps.find((s) => s.id === (endStepId || endScene.entry))!;
    visitedSteps.push(`${endScene.id}#${idleStep.id}`);
    const finishedStepId = idleStep.next || 'finished';
    journey.step({ sc: endScene.id, st: idleStep.id, go: finishedStepId });

    // 5. END#finished -> emits sessionEnd('end_scene') once
    visitedSteps.push(`${endScene.id}#${finishedStepId}`);
    journey.step({ sc: endScene.id, st: finishedStepId, go: 'sleep_idle' });
    journey.sessionEnd('end_scene', 94);
    // Any subsequent sessionEnd on the same sid is a no-op
    journey.sessionEnd('sleep_idle', 94);

    const endLines = journey.sessionLines().filter((l) => l.ev === 'end');
    const syncRes = await journey.flush();

    return {
      passed:
        syncRes.ok &&
        listenReply === 'correct' &&
        resolvedSeed === 'tại sao trời lại có mưa?' &&
        talkBranch === 'done' &&
        endLines.length === 1 &&
        endLines[0].by === 'end_scene' &&
        visitedSteps.join('->') ===
          'START#kiemtra->HAHA#quiz->SACH_KY_DIEU#answer->END#idle->END#finished',
      visitedSteps,
      listenReply,
      listenHandoffSeed,
      talkBranch,
      endEventsCount: endLines.length,
      endReason: (endLines[0]?.by as string) || null,
      syncedAckSeq: syncRes.ack_seq,
    };
  } catch (err: any) {
    return {
      passed: false,
      visitedSteps,
      listenReply,
      listenHandoffSeed,
      talkBranch,
      endEventsCount: 0,
      endReason: null,
      error: err?.message || String(err),
    };
  }
}
