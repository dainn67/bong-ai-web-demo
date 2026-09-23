import { describe, it, expect } from 'vitest';
import { validateV3Scene, resolvePlaceholders } from './script-parser';
import { SAMPLE_LESSON_TEST, SAMPLE_START_SCENE, SAMPLE_END_SCENE } from './sample-scenes';
import type { MemorySpaces } from './types';

describe('v3 script parser and validator', () => {
  it('validates compliant sample scenes without errors', () => {
    const resLesson = validateV3Scene(SAMPLE_LESSON_TEST);
    expect(resLesson.valid).toBe(true);

    const resStart = validateV3Scene(SAMPLE_START_SCENE);
    expect(resStart.valid).toBe(true);

    const resEnd = validateV3Scene(SAMPLE_END_SCENE);
    expect(resEnd.valid).toBe(true);
  });

  it('detects missing id or entry', () => {
    const res = validateV3Scene({ steps: [] });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.rule === 1)).toBe(true);
  });

  it('detects duplicate step ids', () => {
    const res = validateV3Scene({
      id: 'TEST_DUP',
      entry: 'step1',
      steps: [
        { id: 'step1', next: 'step2' },
        { id: 'step1', next: 'step2' },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.rule === 2 && i.message.includes('Trùng lặp'))).toBe(true);
  });

  it('flags forbidden {nbest} placeholder', () => {
    const res = validateV3Scene({
      id: 'TEST_NBEST',
      entry: 's1',
      steps: [
        {
          id: 's1',
          listen: { mode: 'voice', voice: { options: ['cat'], prompt: 'Prompt with {nbest}' } },
          branches: [{ when: 'default', go: 's1' }],
        },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.message.includes('{nbest}'))).toBe(true);
  });

  it('resolves placeholders from memory spaces correctly', () => {
    const memory: MemorySpaces = {
      sys: {
        rnd: 4,
        attempt: 2,
        match: 'exact',
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

    const text = 'Chào {profile.child_name}, bé thử lần {sys.attempt}, từ cat có điểm {learn.word.cat}!';
    const resolved = resolvePlaceholders(text, memory);
    expect(resolved).toBe('Chào Bảo Anh, bé thử lần 2, từ cat có điểm 5!');
  });
});
