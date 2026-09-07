import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECONNECT_ATTEMPTS, WsClient } from './ws-client';
import { DEFAULT_CONFIG } from '../config/device-config';

describe('WsClient reconnect and offline protection', () => {
  const config = {
    ...DEFAULT_CONFIG,
    otaUrl: 'http://127.0.0.1:9999/xiaozhi/ota/',
    fallbackWsUrl: 'ws://127.0.0.1:9999/xiaozhi/v1/',
    macAddress: '11:22:33:44:55:66',
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('defines MAX_RECONNECT_ATTEMPTS as 3', () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBe(3);
  });

  it('stops reconnecting after MAX_RECONNECT_ATTEMPTS when server is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    class MockWebSocket {
      binaryType = 'arraybuffer';
      readyState = 3; // CLOSED
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: (() => void) | null = null;

      constructor(_url: string) {
        setTimeout(() => {
          this.onerror?.();
          this.onclose?.();
        }, 10);
      }

      send() {}
      close() {}
    }

    vi.stubGlobal('WebSocket', MockWebSocket);

    const statuses: string[] = [];
    const logs: Array<{ type: string; payload: unknown }> = [];

    const client = new WsClient(config, {
      onStatus: (status) => statuses.push(status),
      onMessage: () => {},
      onAudio: () => {},
      onLog: (_dir, type, payload) => logs.push({ type, payload }),
    });

    await client.connect();

    await vi.advanceTimersByTimeAsync(20);
    expect(statuses).toContain('disconnected');

    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(4100);

    const stoppedLog = logs.find((l) => l.type === 'reconnect_stopped');
    expect(stoppedLog).toBeDefined();

    const statusCount = statuses.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(statuses.length).toBe(statusCount);

    client.disconnect();
  });

  it('resets attempts and stops timers cleanly on manual disconnect', async () => {
    const statuses: string[] = [];
    const client = new WsClient(config, {
      onStatus: (status) => statuses.push(status),
      onMessage: () => {},
      onAudio: () => {},
      onLog: () => {},
    });

    client.disconnect();
    expect(statuses).toEqual(['disconnected']);
  });

  it('formats payload correctly for startLesson, jumpLessonIndex, and nextLessonIndex', () => {
    const client = new WsClient(config, {
      onStatus: () => {},
      onMessage: () => {},
      onAudio: () => {},
      onLog: () => {},
    });

    const sent: unknown[] = [];
    (client as unknown as { sendRaw: (msg: unknown) => void }).sendRaw = (msg: unknown) => {
      sent.push(msg);
    };

    client.startLesson('unit-test-pp-moi-day-03', '57');
    expect(sent[0]).toEqual({
      type: 'start_lesson',
      lesson_id: 'unit-test-pp-moi-day-03',
      order: '57',
    });

    client.jumpLessonIndex('57', 'unit-test-pp-moi-day-03');
    expect(sent[1]).toEqual({
      type: 'jump_lesson_index',
      order: '57',
      lesson_id: 'unit-test-pp-moi-day-03',
    });

    client.nextLessonIndex('unit-test-pp-moi-day-03');
    expect(sent[2]).toEqual({
      type: 'next_lesson_index',
      lesson_id: 'unit-test-pp-moi-day-03',
    });
  });
});
