/**
 * Sample compliant v3 Scenes for testing the Script Engine in Web Demo.
 * Oct-1 contract: Excel `when` strings, options {name,desc}, hear/talk modes.
 */

import type { V3Scene } from './types';

export const SAMPLE_LESSON_TEST: V3Scene = {
  id: 'LESSON_TEST',
  entry: 'step_intro',
  screen: { base: 'orb', orb: 'happy', brightness: 80 },
  volume: 75,
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
        { when: '{reply} = zone1', go: 'step_touch_correct', save: { 'learn.word.cat': '+1' } },
        { when: '{reply} = zone2', go: 'step_touch_wrong' },
        { when: '{reply} = zone3', go: 'step_touch_wrong' },
        { when: '{reply} = zone4', go: 'step_touch_wrong' },
        { when: '{reply} = miss', go: 'step_touch_question' },
        { when: 'default', go: 'step_touch_wrong' },
      ],
    },
    {
      id: 'step_touch_correct',
      orb: 'delicious',
      audio: [{ src: 'praise_good_job' }],
      next: 'step_hear_presence',
    },
    {
      id: 'step_touch_wrong',
      orb: 'crying',
      audio: [{ src: 'encourage_try_again' }],
      next: 'step_hear_presence',
    },
    {
      // `hear` — local only, no server call: did the child say anything?
      id: 'step_hear_presence',
      orb: 'thinking',
      audio: [{ src: 'ask_ready' }],
      listen: { mode: 'hear', timeout: 4000, ignore_silence: true },
      branches: [
        { when: '{reply} = spoke', go: 'step_voice_question' },
        { when: '{reply} = silent', go: 'step_voice_question' },
        { when: 'default', go: 'step_voice_question' },
      ],
    },
    {
      id: 'step_voice_question',
      orb: 'surprised',
      audio: [{ src: 'ask_cat_name' }],
      listen: {
        mode: 'voice',
        voice: {
          options: [
            { name: 'cat', desc: 'Bé nói "cat", "a cat" hoặc "con mèo".' },
            { name: 'cat_near', desc: 'Bé cố nói "cat" nhưng phát âm lệch: "cát", "két", "khát" hoặc tương tự.' },
          ],
          prompt: '{prompts.classify_cat}',
        },
        retry: {
          on: ['silent', 'unclear'],
          audio: [{ src: 'hint_ask_again' }],
        },
      },
      branches: [
        { when: '{reply} = cat', go: 'step_finish', save: { 'stat.score': '+10' } },
        { when: '{reply} = cat_near', go: 'step_finish', save: { 'stat.score': '+5' } },
        { when: 'OR({reply} = silent, {reply} = other, {reply} = unclear, {reply} = error)', go: 'step_finish' },
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

export const SAMPLE_TALK_SCENE: V3Scene = {
  id: 'TALK_DEMO',
  entry: 'step_talk',
  screen: { base: 'orb', orb: 'loving', brightness: 80 },
  volume: 70,
  steps: [
    {
      id: 'step_talk',
      orb: 'loving',
      audio: [{ src: 'talk_invite' }],
      talk: {
        voice: 'sach',
        prompt: '{prompts.sach_ky_dieu}\n{history}\n{options}',
        seed: 'bé vừa nghe xong chuyện cơn mưa',
        turns: 3,
        sec: 90,
        ignore_silence: true,
        options: [
          { name: 'done', desc: 'Câu hỏi của bé đã được trả lời và bé không hỏi thêm.' },
          { name: 'story', desc: 'Bé muốn nghe kể chuyện.' },
        ],
      },
      branches: [
        { when: '{reply} = story', go: 'LESSON_TEST' },
        { when: 'default', go: 'step_bye' },
      ],
    },
    {
      id: 'step_bye',
      orb: 'happy',
      audio: [{ src: 'goodbye_well_done' }],
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
      audio: [],
      branches: [
        { when: 'ISBLANK({stat.guide_done})', go: 'GUIDE' },
        { when: '{sys.first_run} = TRUE', go: 'ONBOARD' },
        { when: 'default', go: 'HAHA' },
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

/** Prompt store entries the demo uses when no manifest is loaded. */
export const SAMPLE_PROMPT_STORE: Record<string, string> = {
  classify_cat:
    'Bạn phân loại câu trả lời của trẻ 4-6 tuổi khi được hỏi "Đây là con gì?".\n' +
    'Đây là các lựa chọn:\n{options}\n' +
    'Bản ghi: "{transcript}"\n' +
    'Chỉ trả lời đúng một tên lựa chọn.',
  sach_ky_dieu:
    'Bạn là Sách Kỳ Diệu, một nhân vật thân thiện nói chuyện với trẻ 4-6 tuổi.\n' +
    'Trả lời ngắn gọn, ấm áp. Khi bé đã được trả lời xong thì branch="done"; ' +
    'khi bé muốn nghe chuyện thì branch="story"; còn lại branch="continue".',
};

export const SAMPLE_MANIFEST_LISTS: Record<string, Array<{ value: string; [k: string]: unknown }>> = {
  colors: [
    { value: 'red', say: 'Màu đỏ' },
    { value: 'blue', say: 'Màu xanh' },
    { value: 'yellow', say: 'Màu vàng' },
  ],
};

export const SAMPLE_INLIST_SCENE: V3Scene = {
  id: 'INLIST_DEMO',
  entry: '5_ask_fav_color',
  screen: { base: 'orb', orb: 'thinking', brightness: 80 },
  volume: 75,
  steps: [
    {
      id: '5_ask_fav_color',
      orb: 'thinking',
      audio: [{ src: 'ask_color_audio' }],
      listen: {
        mode: 'voice',
        timeout: 6000,
        voice: {
          prompt: 'Bé thích màu gì?',
          options: [
            { name: '{lists.colors.value}', desc: 'Màu trong danh sách' },
            { name: 'other', desc: 'Màu khác' },
          ],
        },
      },
      branches: [
        { when: 'INLIST({reply}, {lists.colors.value})', go: '5_confirm', save: { 'user.fav_color': '{reply}' } },
        { when: '{reply} = other', go: '5_other_color' },
        { when: 'default', go: '6' },
      ],
    },
    {
      id: '5_confirm',
      orb: 'happy',
      audio: [{ src: 'confirm_color_audio' }],
      next: '6',
    },
    {
      id: '5_other_color',
      orb: 'surprised',
      audio: [{ src: 'other_color_audio' }],
      next: '6',
    },
    {
      id: '6',
      orb: 'idle',
      next: 'END#idle',
    },
  ],
};
