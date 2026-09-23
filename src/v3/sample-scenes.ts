/**
 * Sample compliant v3 Scenes for testing the Script Engine in Web Demo.
 */

import type { V3Scene } from './types';

export const SAMPLE_LESSON_TEST: V3Scene = {
  id: 'LESSON_TEST',
  entry: 'step_intro',
  screen: { base: 'orb', orb: 'happy', brightness: 80 },
  volume: 75,
  prompts: {
    classify_cat: `Bạn phân loại câu trả lời của trẻ 4-6 tuổi khi được hỏi "Đây là con gì?".
Lựa chọn:
- cat: đúng nếu bé nói: "cat", "a cat", "con mèo"
- cat_near: gần đúng nếu bé nói: "cát", "két", "mèo"
Bản ghi: "{transcript}"
Trả về JSON: {"option": "...", "match": "...", "value": null, "confidence": 0.9}`,
  },
  save: { 'learn.unit': 1 },
  steps: [
    {
      id: 'step_intro',
      orb: 'happy',
      audio: [{ src: 'hello_bong' }],
      visual: [{ src: 'bong_wave', repeat: 'once', hold: true }],
      next: 'step_touch_question',
    },
    {
      id: 'step_touch_question',
      orb: 'thinking',
      audio: [{ src: 'touch_prompt_choose' }],
      visual: [{ src: 'animals_quad', hold: true }],
      listen: {
        mode: 'touch',
        touch: { layout: 'pie4', timeout: 10000 },
      },
      branches: [
        { when: { reply: 'zone1' }, go: 'step_touch_correct', save: { 'learn.word.cat': '+1' } },
        { when: { reply: 'zone2' }, go: 'step_touch_wrong' },
        { when: { reply: 'zone3' }, go: 'step_touch_wrong' },
        { when: { reply: 'zone4' }, go: 'step_touch_wrong' },
        { when: { reply: 'miss' }, go: 'step_touch_question' },
        { when: 'default', go: 'step_touch_wrong' },
      ],
    },
    {
      id: 'step_touch_correct',
      orb: 'delicious',
      audio: [{ src: 'praise_good_job' }],
      next: 'step_voice_question',
    },
    {
      id: 'step_touch_wrong',
      orb: 'crying',
      audio: [{ src: 'encourage_try_again' }],
      next: 'step_voice_question',
    },
    {
      id: 'step_voice_question',
      orb: 'surprised',
      audio: [{ src: 'ask_cat_name' }],
      listen: {
        mode: 'voice',
        voice: {
          options: ['cat', 'cat_near'],
          hints: ['cat', 'a cat', 'cát', 'két', 'con mèo', 'mèo'],
          prompt_ref: 'classify_cat',
          min_conf: 0.6,
        },
      },
      branches: [
        { when: { reply: 'cat' }, go: 'step_finish', save: { 'stat.score': '+10' } },
        { when: { reply: 'cat_near' }, go: 'step_finish', save: { 'stat.score': '+5' } },
        { when: { reply: 'unclear' }, go: 'step_finish' },
        { when: { reply: 'silent' }, go: 'step_finish' },
        { when: 'default', go: 'step_finish' },
      ],
    },
    {
      id: 'step_finish',
      orb: 'cool',
      audio: [{ src: 'goodbye_well_done' }],
      save: { 'learn.completed': true },
      next: 'END#finished',
    },
  ],
};

export const SAMPLE_START_SCENE: V3Scene = {
  id: 'START',
  entry: 'step_init',
  screen: { base: 'orb', orb: 'idle', brightness: 70 },
  volume: 70,
  steps: [
    {
      id: 'step_init',
      orb: 'happy',
      audio: [{ src: 'bong_greeting' }],
      branches: [
        { when: { 'stat.guide_done': false }, go: 'GUIDE' },
        { when: { 'sys.first_run': true }, go: 'ONBOARD' },
        { when: 'default', go: 'LESSON_TEST' },
      ],
    },
  ],
};

export const SAMPLE_END_SCENE: V3Scene = {
  id: 'END',
  entry: 'finished',
  screen: { base: 'orb', orb: 'sleepy', brightness: 30 },
  volume: 50,
  steps: [
    {
      id: 'finished',
      orb: 'sleepy',
      audio: [{ src: 'bedtime_music' }],
      next: 'idle',
    },
    {
      id: 'idle',
      orb: 'sleepy',
      screen: { brightness: 10 },
      // Sleeps here until physical button pressed
    },
  ],
};
