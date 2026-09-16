import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectLessonPlayer, type DirectPlayerHandlers } from './direct-lesson-player';

describe('DirectLessonPlayer', () => {
  let handlers: DirectPlayerHandlers;
  let player: DirectLessonPlayer;

  const mockRawMetadata = {
    version: '2',
    page: 'Day-01',
    indexes: [
      {
        order: '1',
        audio: [{ url: 'https://example.com/audio1.mp3', fileName: 'A001' }],
        visual: [{ url: 'https://example.com/image1.png', fileName: 'I001', stop: 'giu' }],
        next: '2',
      },
      {
        order: '2',
        audio: [{ url: 'https://example.com/audio2.mp3', fileName: 'A002' }],
        visual: [],
        next: '57',
      },
      {
        order: '57',
        audio: [{ url: 'https://example.com/audio57.mp3', fileName: 'A057' }],
        visual: [{ url: 'https://static-bongai.bcserver.xyz/order_57.png', fileName: 'I057', stop: 'giu' }],
        next: '75',
      },
      {
        order: '75',
        audio: [{ url: 'https://example.com/audio75.mp3', fileName: 'A075' }],
        visual: [{ url: 'https://static-bongai.bcserver.xyz/order_77.png', fileName: 'I075', stop: 'tat' }],
        next: 'end',
      },
    ],
  };

  beforeEach(() => {
    handlers = {
      onIndexChange: vi.fn(),
      onPlaybackStateChange: vi.fn(),
      onVisualChange: vi.fn(),
      onAudioProgress: vi.fn(),
      onError: vi.fn(),
    };
    player = new DirectLessonPlayer(handlers);

    // Mock HTMLAudioElement as a class
    globalThis.Audio = class {
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      src = '';
      volume = 1;
      duration = 5;
      currentTime = 0;
      onplay: (() => void) | null = null;
      onpause: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
    } as unknown as typeof Audio;
  });

  it('parses indexes properly from raw metadata JSON', () => {
    const items = player.parseAndSetIndexes(mockRawMetadata);
    expect(items).toHaveLength(4);
    expect(items[0].order).toBe('1');
    expect(items[0].visuals[0].url).toBe('https://example.com/image1.png');
    expect(items[1].visuals).toHaveLength(0);
    expect(items[2].order).toBe('57');
    expect(items[3].order).toBe('75');
  });

  it('plays specific index directly and fires callbacks', async () => {
    player.parseAndSetIndexes(mockRawMetadata);
    await player.playIndex('57');

    expect(handlers.onIndexChange).toHaveBeenCalledWith(
      expect.objectContaining({ order: '57' })
    );
    expect(handlers.onVisualChange).toHaveBeenCalledWith(
      expect.stringContaining('order_57.png'),
      'giu'
    );
    expect(player.activeIndex?.order).toBe('57');
  });

  it('cuts visual to null when index has empty visual array', async () => {
    player.parseAndSetIndexes(mockRawMetadata);
    await player.playIndex('2');

    expect(handlers.onIndexChange).toHaveBeenCalledWith(
      expect.objectContaining({ order: '2' })
    );
    expect(handlers.onVisualChange).toHaveBeenCalledWith(null);
  });

  it('steps to next index via playNext', async () => {
    player.parseAndSetIndexes(mockRawMetadata);
    await player.playIndex('1');
    expect(player.activeIndex?.order).toBe('1');

    await player.playNext();
    expect(player.activeIndex?.order).toBe('2');

    await player.playNext();
    expect(player.activeIndex?.order).toBe('57');
  });

  it('steps to previous index via playPrev', async () => {
    player.parseAndSetIndexes(mockRawMetadata);
    await player.playIndex('57');
    expect(player.activeIndex?.order).toBe('57');

    await player.playPrev();
    expect(player.activeIndex?.order).toBe('2');
  });

  it('handles auto-next setting toggle and delay', () => {
    expect(player.isAutoNextEnabled).toBe(false);
    player.setAutoNext(true, 2000);
    expect(player.isAutoNextEnabled).toBe(true);
    expect(player.autoNextDelay).toBe(2000);
  });

  it('correctly parses lesson with .eaf visual assets', async () => {
    const eafMetadata = {
      version: '2',
      id: 'lesson_eaf_test',
      title: 'Bài Học Biểu Cảm Cùng Bống (.eaf Test)',
      indexes: [
        {
          order: '1',
          audio: [{ url: '/sounds/chime.wav', fileName: 'chime_01.wav' }],
          visual: [{ url: '/emotes/happy.eaf', fileName: 'happy.eaf', stop: 'giu' }],
          next: '2',
        },
        {
          order: '2',
          audio: [{ url: '/sounds/chime.wav', fileName: 'chime_02.wav' }],
          visual: [{ url: '/emotes/thinking.eaf', fileName: 'thinking.eaf', stop: 'giu' }],
          next: 'end',
        },
      ],
    };

    const items = player.parseAndSetIndexes(eafMetadata);
    expect(items).toHaveLength(2);
    expect(items[0].visuals[0].url).toBe('/emotes/happy.eaf');
    expect(items[1].visuals[0].url).toBe('/emotes/thinking.eaf');

    await player.playIndex('1');
    expect(handlers.onVisualChange).toHaveBeenCalledWith('/emotes/happy.eaf', 'giu');
  });
});
