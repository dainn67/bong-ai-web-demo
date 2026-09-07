import { describe, expect, it, beforeEach } from 'vitest';
import { useSimulatorStore } from './simulator-store';
import { DEFAULT_CONFIG } from '../config/device-config';

describe('simulatorStore direct mode and resetConfig', () => {
  beforeEach(() => {
    // Reset state before each test
    useSimulatorStore.setState({
      status: 'disconnected',
      lessonSourceMode: 'direct',
      config: { ...DEFAULT_CONFIG, macAddress: 'test-mac-123' },
    });
  });

  it('wakes up locally on tapScreen when in direct mode without connecting socket', () => {
    const store = useSimulatorStore.getState();
    expect(store.status).toBe('disconnected');
    expect(store.lessonSourceMode).toBe('direct');

    store.tapScreen();

    // Should transition to connected locally
    expect(useSimulatorStore.getState().status).toBe('connected');
  });

  it('switches lessonSourceMode cleanly and manages status', () => {
    const store = useSimulatorStore.getState();
    
    // Switch to socket mode (auto-connects if disconnected)
    store.setLessonSourceMode('socket');
    expect(useSimulatorStore.getState().lessonSourceMode).toBe('socket');
    expect(['connecting', 'connected']).toContain(useSimulatorStore.getState().status);

    // Switch back to direct mode
    store.setLessonSourceMode('direct');
    expect(useSimulatorStore.getState().lessonSourceMode).toBe('direct');
    expect(useSimulatorStore.getState().status).toBe('connected');
  });

  it('resets config to DEFAULT_CONFIG while preserving stable MAC address', () => {
    const store = useSimulatorStore.getState();
    const mac = store.config.macAddress;

    store.updateConfig({
      otaUrl: 'http://localhost:8002/xiaozhi/ota/',
      fallbackWsUrl: 'ws://localhost:8002/xiaozhi/v1/',
      apiUrl: 'http://localhost:8000/api/v1',
    });

    expect(useSimulatorStore.getState().config.otaUrl).toBe('http://localhost:8002/xiaozhi/ota/');

    store.resetConfig();

    const resetCfg = useSimulatorStore.getState().config;
    expect(resetCfg.otaUrl).toBe(DEFAULT_CONFIG.otaUrl);
    expect(resetCfg.fallbackWsUrl).toBe(DEFAULT_CONFIG.fallbackWsUrl);
    expect(resetCfg.apiUrl).toBe(DEFAULT_CONFIG.apiUrl);
    expect(resetCfg.macAddress).toBe(mac);
  });

  it('jumps to socket index and sets activity.kind even without visual', () => {
    const mockIndexes = [
      { order: '1', audios: [{ url: 'audio1.mp3' }], visuals: [] },
      { order: '2', audios: [{ url: 'audio2.mp3' }], visuals: [{ url: 'img2.png' }] },
      { order: '3', audios: [], visuals: [{ url: 'img3.png' }] },
    ];

    useSimulatorStore.setState({
      directIndexes: mockIndexes,
      directActiveIndex: null,
      lessonSourceMode: 'socket',
      status: 'connected',
    });

    const store = useSimulatorStore.getState();
    store.jumpSocketIndex('1');

    const state = useSimulatorStore.getState();
    expect(state.directActiveIndex?.order).toBe('1');
    expect(state.directPlaybackState).toBe('playing');
    expect(state.activity.kind).toBe('lesson');
    expect(state.lessonPosition).toBe('1/3');
  });

  it('nextSocketIndex advances sequentially through directIndexes in socket mode', () => {
    const mockIndexes = [
      { order: '1', audios: [{ url: 'audio1.mp3' }], visuals: [] },
      { order: '2', audios: [{ url: 'audio2.mp3' }], visuals: [{ url: 'img2.png' }] },
      { order: '3', audios: [], visuals: [{ url: 'img3.png' }] },
    ];

    useSimulatorStore.setState({
      directIndexes: mockIndexes,
      directActiveIndex: mockIndexes[0],
      lessonSourceMode: 'socket',
      status: 'connected',
    });

    const store = useSimulatorStore.getState();
    store.nextSocketIndex();

    expect(useSimulatorStore.getState().directActiveIndex?.order).toBe('2');
    expect(useSimulatorStore.getState().activity.imageUrl).toBe('img2.png');
    expect(useSimulatorStore.getState().lessonPosition).toBe('2/3');

    store.nextSocketIndex();
    expect(useSimulatorStore.getState().directActiveIndex?.order).toBe('3');

    store.nextSocketIndex();
    expect(useSimulatorStore.getState().directPlaybackState).toBe('idle');
  });

  it('toggles studio pause cleanly in socket mode', () => {
    useSimulatorStore.setState({
      directPlaybackState: 'playing',
      lessonSourceMode: 'socket',
      activity: { kind: 'lesson', phase: 'playing', title: 'Test', imageUrl: null, error: null, waitingFor: null, touchLayout: null, caption: '', notice: '', imageSeq: 0, hint: null },
    });

    const store = useSimulatorStore.getState();
    store.toggleStudioPause();
    expect(useSimulatorStore.getState().directPlaybackState).toBe('paused');

    store.toggleStudioPause();
    expect(useSimulatorStore.getState().directPlaybackState).toBe('playing');
  });
});
