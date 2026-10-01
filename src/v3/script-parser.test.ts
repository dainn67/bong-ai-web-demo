import { describe, it, expect } from 'vitest';
import { validateV3Scene, resolvePlaceholders } from './script-parser';
import {
  SAMPLE_LESSON_TEST,
  SAMPLE_START_SCENE,
  SAMPLE_END_SCENE,
  SAMPLE_TALK_SCENE,
  SAMPLE_PROMPT_STORE,
} from './sample-scenes';
import type { MemorySpaces } from './types';

const MEM: MemorySpaces = {
  sys: {
    rnd: 4,
    silent_streak: 0,
    net: true,
    time: '12:00',
    battery: 90,
    first_run: false,
  },
  profile: {
    child_name: 'Bảo Anh',
    bong_name: 'Bống',
    bedtime: '21:00',
    lesson_from: '19:45',
    lesson_to: '20:30',
  },
  learn: { 'word.cat': 5 },
  user: { fav_animal: 'cat' },
  stat: { today_min: 20, sessions: 3 },
  tmp: { return: 'step_prev' },
};

const errors = (r: { issues: { type: string }[] }) => r.issues.filter((i) => i.type === 'error');
const warnings = (r: { issues: { type: string; rule: string }[] }) =>
  r.issues.filter((i) => i.type === 'warning');
const hasRule = (r: { issues: { rule: string }[] }, rule: string) =>
  r.issues.some((i) => i.rule === rule);

describe('v3 script parser and validator (B16)', () => {
  it('validates compliant sample scenes without errors', () => {
    expect(errors(validateV3Scene(SAMPLE_LESSON_TEST, { prompts: SAMPLE_PROMPT_STORE }))).toHaveLength(0);
    expect(errors(validateV3Scene(SAMPLE_START_SCENE))).toHaveLength(0);
    expect(errors(validateV3Scene(SAMPLE_END_SCENE))).toHaveLength(0);
    expect(errors(validateV3Scene(SAMPLE_TALK_SCENE, { prompts: SAMPLE_PROMPT_STORE }))).toHaveLength(0);
  });

  it('V1: detects missing id or entry', () => {
    const res = validateV3Scene({ steps: [] });
    expect(res.valid).toBe(false);
    expect(hasRule(res, 'V1')).toBe(true);
  });

  it('V1: scene id must start with A-Z', () => {
    const res = validateV3Scene({
      id: 'lower_scene',
      entry: 's1',
      steps: [{ id: 's1', next: 'END#finished' }],
    });
    expect(hasRule(res, 'V1')).toBe(true);
  });

  it('V1: detects duplicate step ids', () => {
    const res = validateV3Scene({
      id: 'TEST_DUP',
      entry: 'step1',
      steps: [
        { id: 'step1', next: 'step2' },
        { id: 'step1', next: 'step2' },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.rule === 'V1' && i.message.includes('Trùng'))).toBe(true);
  });

  it('V2: hear mode must not carry prompt/options', () => {
    const res = validateV3Scene({
      id: 'TEST_HEAR',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: { mode: 'hear', prompt: 'x' },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(res, 'V2')).toBe(true);
  });

  it('V2: voice requires options + prompt; pet bans gestures', () => {
    const noOpts = validateV3Scene({
      id: 'TEST_V',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: { mode: 'voice', voice: { prompt: 'p {transcript} {options}', options: [] } },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(noOpts, 'V2')).toBe(true);

    const petGest = validateV3Scene({
      id: 'TEST_PET',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: { mode: 'pet', gestures: ['tap'] },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(petGest, 'V2')).toBe(true);
  });

  it('V3/V4: option structure and reserved names', () => {
    const noDesc = validateV3Scene({
      id: 'TEST_OPT',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'cat' }], prompt: '{transcript} {options}' },
          },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(noDesc, 'V3')).toBe(true);

    const reserved = validateV3Scene({
      id: 'TEST_RSVD',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'silent', desc: 'x' }], prompt: '{transcript} {options}' },
          },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(reserved, 'V4')).toBe(true);
  });

  it('V5: retry must be a single {on,audio} object with valid replies', () => {
    const res = validateV3Scene({
      id: 'TEST_RETRY',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'cat', desc: 'x' }], prompt: '{transcript} {options}' },
            retry: { on: ['zone1'], audio: [{ src: 'a' }] },
          },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(res, 'V5')).toBe(true); // zone1 impossible for voice
  });

  it('V6: {nbest} banned + prompt must contain {transcript}/{options}', () => {
    const res = validateV3Scene({
      id: 'TEST_NBEST',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'cat', desc: 'x' }], prompt: 'p {nbest}' },
          },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(res, 'V6')).toBe(true);
  });

  it('V7: talk requires fields, bans Bống voice and option "continue"', () => {
    const missing = validateV3Scene({
      id: 'TEST_TALK',
      entry: 's1',
      steps: [
        {
          id: 's1',
          talk: { voice: 'sach' },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(missing, 'V7')).toBe(true);

    const bong = validateV3Scene({
      id: 'TEST_TALK2',
      entry: 's1',
      steps: [
        {
          id: 's1',
          talk: {
            voice: 'bong',
            prompt: 'x {options} {history}',
            turns: 2,
            sec: 60,
            options: [{ name: 'done', desc: 'x' }],
          },
          branches: [{ when: 'default', go: 'END#finished' }],
        },
      ],
    });
    expect(hasRule(bong, 'V7')).toBe(true);
  });

  it('V8: last branch must be default; unknown targets flagged', () => {
    const res = validateV3Scene({
      id: 'TEST_BR',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'cat', desc: 'x' }], prompt: '{transcript} {options}' },
          },
          branches: [{ when: '{reply} = cat', go: 'nowhere' }],
        },
      ],
    });
    expect(hasRule(res, 'V8')).toBe(true);
  });

  it('V9: when expression must be Excel string, bans cfg/bad vars', () => {
    const res = validateV3Scene({
      id: 'TEST_WHEN',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'cat', desc: 'x' }], prompt: '{transcript} {options}' },
          },
          branches: [
            { when: { reply: 'cat' } as unknown as string, go: 'END#finished' },
            { when: '{cfg.x} = 1', go: 'END#finished' },
            { when: 'default', go: 'END#finished' },
          ],
        },
      ],
    });
    const v9 = res.issues.filter((i) => i.rule === 'V9');
    expect(v9.length).toBeGreaterThanOrEqual(2); // object when + cfg banned
  });

  it('V10: save into sys.*/profile.* is read-only error', () => {
    const res = validateV3Scene({
      id: 'TEST_SAVE',
      entry: 's1',
      steps: [{ id: 's1', save: { 'sys.first_run': false }, next: 'END#finished' }],
    });
    expect(res.valid).toBe(false);
    expect(hasRule(res, 'V10')).toBe(true);
  });

  it('V10: infinite still visual must be the last node', () => {
    const res = validateV3Scene({
      id: 'TEST_VIS',
      entry: 's1',
      steps: [
        {
          id: 's1',
          visual: [
            { src: 'img_a', url: 'https://x/a.png' },
            { src: 'img_b', url: 'https://x/b.png' },
            { src: 'img_c', url: 'https://x/c.png' },
          ],
          next: 'END#finished',
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.issues.filter((i) => i.rule === 'V10')).toHaveLength(2);
  });

  it('W1: undeclared mode defaults are warnings, not errors', () => {
    const res = validateV3Scene({
      id: 'TEST_W1',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: {
            mode: 'voice',
            voice: { options: [{ name: 'cat', desc: 'x' }], prompt: '{transcript} {options}' },
          },
          branches: [
            { when: '{reply} = cat', go: 'END#finished' },
            { when: 'default', go: 'END#finished' },
          ],
        },
      ],
    });
    expect(res.valid).toBe(true);
    expect(warnings(res).some((i) => i.rule === 'W1')).toBe(true);
  });

  it('resolves placeholders from memory; blank key → "null"; group expands', () => {
    const text = 'Chào {profile.child_name}, fav={user.fav_animal}, miss={learn.unknown}';
    expect(resolvePlaceholders(text, MEM)).toBe('Chào Bảo Anh, fav=cat, miss=null');

    const group = resolvePlaceholders('CTX:\n{profile.*}', MEM);
    expect(group).toContain('child_name: Bảo Anh');
    expect(group).toContain('bedtime: 21:00');
  });
});
