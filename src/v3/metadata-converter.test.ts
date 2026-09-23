import { describe, it, expect } from 'vitest';
import { convertMetadataToV3Scene } from './metadata-converter';
import { validateV3Scene } from './script-parser';

describe('metadata-converter', () => {
  it('converts node-graph metadata (indexes/nodes) into valid V3Scene', () => {
    const rawMeta = {
      page: 'Hiển thị & Media Cơ Bản',
      indexes: [
        {
          order: '1',
          type: 'play',
          audio: [
            {
              fileName: 'NT01',
              url: 'https://cdn.example.com/audio1.mp3',
              volume: 80,
            },
          ],
          visual: [],
          next: '2',
        },
        {
          order: '2',
          type: 'câu hỏi',
          content: 'Bé có thích gấu không?',
          audio: [{ url: 'https://cdn.example.com/audio2.mp3' }],
          visual: [{ url: 'https://cdn.example.com/bear.png', stop: 'giu' }],
          branches: [
            { branchType: 'có', next: '3' },
            { branchType: 'không', next: '3' },
          ],
        },
        {
          order: '3',
          type: 'play',
          audio: [{ url: 'https://cdn.example.com/audio3.mp3' }],
        },
      ],
    };

    const scene = convertMetadataToV3Scene('TC01-media', 'Test 01', rawMeta);
    expect(scene.id).toBe('TC01-media');
    expect(scene.entry).toBe('1');
    expect(scene.steps.length).toBe(3);

    const validation = validateV3Scene(scene);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it('converts story metadata with parts (S_001 Rùa và Thỏ) into valid V3Scene', () => {
    const storyMeta = {
      id: 'S_001',
      title: 'Rùa và Thỏ',
      parts: [
        {
          id: 0,
          type: 'play',
          description: 'Mở đầu truyện',
          audio_url: 'lessions/S_001/part_0.mp3',
        },
        {
          id: 1,
          type: 'question',
          description: 'Hỏi bé thỏ chạy nhanh hay chậm',
          audio_url: 'lessions/S_001/part_1.mp3',
          expected_answer: 'nhanh',
        },
        {
          id: 2,
          type: 'play',
          description: 'Kết thúc truyện',
          audio_url: 'lessions/S_001/part_2.mp3',
        },
      ],
    };

    const scene = convertMetadataToV3Scene('S_001', 'Rùa và Thỏ', storyMeta);
    expect(scene.id).toBe('S_001');
    expect(scene.entry).toBe('0');
    expect(scene.steps.length).toBe(3);

    const validation = validateV3Scene(scene);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });
});
