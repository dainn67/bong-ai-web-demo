/**
 * Canonical V3 Scenes for `START#kiemtra -> HAHA#quiz -> SACH_KY_DIEU#answer -> END#idle -> END#finished` E2E Acceptance.
 */

import type { V3Scene } from './types';

export const CANONICAL_E2E_PROMPTS: Record<string, string> = {
  haha_quiz:
    'Bé đang chơi đố vui tiếng kêu con mèo. Câu bé nói: "{transcript}". Chọn 1 nhãn trong:\n{options}',
  sach_ky_dieu:
    'Bạn là Sách Kỳ Diệu thông thái. Trả lời ngắn gọn câu hỏi của bé và chọn branch phù hợp:\n{options}',
};

export const CANONICAL_START_SCENE: V3Scene = {
  id: 'START',
  entry: 'kiemtra',
  steps: [
    {
      id: 'kiemtra',
      orb: 'happy',
      branches: [
        { when: '{sys.first_run} = true', go: 'ONBOARD' },
        { when: 'default', go: 'HAHA#quiz' },
      ],
    },
  ],
};

export const CANONICAL_HAHA_SCENE: V3Scene = {
  id: 'HAHA',
  entry: 'quiz',
  steps: [
    {
      id: 'quiz',
      orb: 'thinking',
      listen: {
        mode: 'voice',
        voice: {
          prompt: '{prompts.haha_quiz}',
          options: [
            { name: 'correct', desc: 'Bé trả lời đúng câu đố vui' },
            { name: 'wrong', desc: 'Bé trả lời sai' },
          ],
        },
        retry: {
          on: ['silent', 'unclear'],
          audio: [],
        },
      },
      branches: [
        {
          when: '{reply} = correct',
          go: 'SACH_KY_DIEU#answer',
          save: { 'learn.word.cat': '+1' },
        },
        { when: 'default', go: 'END#idle' },
      ],
    },
  ],
};

export const CANONICAL_MAGIC_BOOK_SCENE: V3Scene = {
  id: 'SACH_KY_DIEU',
  entry: 'answer',
  steps: [
    {
      id: 'answer',
      orb: 'cool',
      talk: {
        voice: 'sach',
        prompt: '{prompts.sach_ky_dieu}',
        seed: '{sys.handoff_seed}',
        turns: 3,
        sec: 90,
        options: [
          { name: 'done', desc: 'Đã giải đáp xong câu hỏi của bé' },
          { name: 'continue', desc: 'Bé vẫn đang hỏi thêm' },
        ],
      },
      branches: [
        { when: '{reply} = done', go: 'END#idle' },
        { when: 'default', go: 'END#idle' },
      ],
    },
  ],
};

export const CANONICAL_END_SCENE: V3Scene = {
  id: 'END',
  entry: 'idle',
  steps: [
    {
      id: 'idle',
      orb: 'sleepy',
      next: 'finished',
    },
    {
      id: 'finished',
      orb: 'loving',
      save: {
        'stat.sessions': '+1',
      },
    },
  ],
};

export const CANONICAL_SCENE_MAP: Record<string, V3Scene> = {
  START: CANONICAL_START_SCENE,
  HAHA: CANONICAL_HAHA_SCENE,
  SACH_KY_DIEU: CANONICAL_MAGIC_BOOK_SCENE,
  END: CANONICAL_END_SCENE,
};
