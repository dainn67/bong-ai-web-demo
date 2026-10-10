import { describe, expect, it, beforeEach } from 'vitest';
import { useSimulatorStore, handleMessage, DEFAULT_V3_CATALOG } from './simulator-store';
import { isLegacyCatalogItem } from '../lessons/catalog';
import { DEFAULT_CONFIG } from '../config/device-config';
import type { IncomingMessage } from '../protocol/message-types';
import { INITIAL_FACE_STATE } from '../screen/face-state-machine';
import { IDLE_ACTIVITY } from '../screen/activity-state';

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

  it('updates both activity.imageUrl and face.imageUrl on display show_image command', () => {
    useSimulatorStore.setState({
      activity: { kind: 'lesson', phase: 'playing', title: 'Test', imageUrl: null, error: null, waitingFor: null, touchLayout: null, caption: '', notice: '', imageSeq: 0, hint: null },
      face: { ...INITIAL_FACE_STATE },
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const imgMsg: IncomingMessage = {
      type: 'display',
      action: 'show_image',
      url: 'https://static-bongai.bcserver.xyz/lessions/lesson-eaf-ezgif/ezgif.eaf',
    } as IncomingMessage;

    handleMessage(set, get, imgMsg);

    expect(useSimulatorStore.getState().activity.imageUrl).toBe('https://static-bongai.bcserver.xyz/lessions/lesson-eaf-ezgif/ezgif.eaf');
    expect(useSimulatorStore.getState().face.imageUrl).toBe('https://static-bongai.bcserver.xyz/lessions/lesson-eaf-ezgif/ezgif.eaf');
  });

  it('preserves activity.imageUrl when subsequent tts message arrives', () => {
    useSimulatorStore.setState({
      activity: {
        kind: 'lesson',
        phase: 'playing',
        title: 'Test',
        imageUrl: 'https://static-bongai.bcserver.xyz/lessions/lesson-eaf-ezgif/ezgif.eaf',
        error: null,
        waitingFor: null,
        touchLayout: null,
        caption: '',
        notice: '',
        imageSeq: 1,
        hint: null,
      },
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const ttsMsg: IncomingMessage = {
      type: 'tts',
      state: 'sentence_start',
      text: 'Bống xin chào bé!',
    } as IncomingMessage;

    handleMessage(set, get, ttsMsg);

    const state = useSimulatorStore.getState();
    expect(state.activity.caption).toBe('Bống xin chào bé!');
    expect(state.activity.imageUrl).toBe('https://static-bongai.bcserver.xyz/lessions/lesson-eaf-ezgif/ezgif.eaf');
  });

  it('clears both activity.imageUrl and face.imageUrl on clear command', () => {
    useSimulatorStore.setState({
      activity: {
        kind: 'lesson',
        phase: 'playing',
        title: 'Test',
        imageUrl: 'some-image.png',
        error: null,
        waitingFor: null,
        touchLayout: null,
        caption: '',
        notice: '',
        imageSeq: 1,
        hint: null,
      },
      face: { ...INITIAL_FACE_STATE, imageUrl: 'some-image.png', imageSeq: 1 },
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const clearMsg: IncomingMessage = {
      type: 'display',
      action: 'clear',
    } as IncomingMessage;

    handleMessage(set, get, clearMsg);

    expect(useSimulatorStore.getState().activity.imageUrl).toBeNull();
    expect(useSimulatorStore.getState().face.imageUrl).toBeNull();
  });

  it('toggles and sets autoMic state properly', () => {
    const store = useSimulatorStore.getState();
    const initial = store.autoMic;

    store.toggleAutoMic();
    expect(useSimulatorStore.getState().autoMic).toBe(!initial);

    store.setAutoMic(false);
    expect(useSimulatorStore.getState().autoMic).toBe(false);

    store.setAutoMic(true);
    expect(useSimulatorStore.getState().autoMic).toBe(true);
  });

  it('auto mutes mic when receiving STT while listening', () => {
    useSimulatorStore.setState({
      autoMic: true,
      micState: 'listening',
      micLevel: 0.5,
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const sttMsg: IncomingMessage = {
      type: 'stt',
      text: 'Bống ơi',
    } as IncomingMessage;

    handleMessage(set, get, sttMsg);

    expect(useSimulatorStore.getState().micState).toBe('off');
    expect(useSimulatorStore.getState().micLevel).toBe(0);
  });

  it('auto mutes mic when receiving thinking display command', () => {
    useSimulatorStore.setState({
      autoMic: true,
      micState: 'listening',
      micLevel: 0.5,
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const thinkingMsg: IncomingMessage = {
      type: 'display',
      name: 'thinking',
    } as unknown as IncomingMessage;

    handleMessage(set, get, thinkingMsg);

    expect(useSimulatorStore.getState().micState).toBe('off');
    expect(useSimulatorStore.getState().micLevel).toBe(0);
  });

  it('auto mutes mic when receiving tts start command', () => {
    useSimulatorStore.setState({
      autoMic: true,
      micState: 'listening',
      micLevel: 0.5,
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const ttsStartMsg: IncomingMessage = {
      type: 'tts',
      state: 'start',
    } as IncomingMessage;

    handleMessage(set, get, ttsStartMsg);

    expect(useSimulatorStore.getState().micState).toBe('off');
    expect(useSimulatorStore.getState().micLevel).toBe(0);
  });

  it('preserves V3 catalog and filters legacy items when content_catalog arrives', () => {
    useSimulatorStore.setState({
      lessonEngineType: 'v3',
      catalog: DEFAULT_V3_CATALOG,
    });

    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;

    const legacyCatalogMsg: IncomingMessage = {
      type: 'content_catalog',
      child_name: 'Bé Bống',
      lessons: [
        { id: 'TC16-intent-match-open-box', title: '[Case 16] Test', data_url: 'lessions/tc16' },
        { id: 'Day-01', title: 'Day-01', data_url: 'lessions/day-01' },
        { id: 'unit-template-day-03', title: 'Unit Template', data_url: 'lessions/template' },
      ],
      stories: [],
      topics: [],
    } as unknown as IncomingMessage;

    handleMessage(set, get, legacyCatalogMsg);

    const catalog = useSimulatorStore.getState().catalog;
    // Should preserve HAHA, START, END and NOT contain TC16, Day-01, or unit-template
    expect(catalog.map((c) => c.id)).toEqual(['HAHA', 'START', 'END']);
    expect(useSimulatorStore.getState().childName).toBe('Bé Bống');
  });

  it('isLegacyCatalogItem correctly identifies legacy test cases vs V3 scenes', () => {
    expect(isLegacyCatalogItem({ id: 'HAHA', title: 'Bài Học HAHA' })).toBe(false);
    expect(isLegacyCatalogItem({ id: 'START', title: 'Bắt đầu' })).toBe(false);
    expect(isLegacyCatalogItem({ id: 'END', title: 'Kết thúc' })).toBe(false);
    expect(isLegacyCatalogItem({ id: 'L_001', title: 'Lời chào' })).toBe(false);
    expect(isLegacyCatalogItem({ id: 'animals-5', title: '5 con vật' })).toBe(false);

    expect(isLegacyCatalogItem({ id: 'TC16-intent-match', title: 'Intent' })).toBe(true);
    expect(isLegacyCatalogItem({ id: 'Day-01', title: 'Day 01' })).toBe(true);
    expect(isLegacyCatalogItem({ id: 'some-id', title: '[Case 12] Cảm Ứng' })).toBe(true);
    expect(isLegacyCatalogItem({ id: 'unit-template-day-03', title: 'Template' })).toBe(true);
    expect(isLegacyCatalogItem({ id: 'e4fbb60b-05d8-4902-9de5-220ac4198f58', title: 'Legacy UUID' })).toBe(true);
  });

  it('dứt điểm Free Chat, mic và audio khi mở menu bằng pressBack', () => {
    useSimulatorStore.setState({
      status: 'connected',
      speaking: true,
      micState: 'listening',
      micLevel: 42,
      menu: { view: { screen: 'closed' }, cursor: 0 },
    });

    const store = useSimulatorStore.getState();
    store.pressBack();

    const state = useSimulatorStore.getState();
    expect(state.menu.view.screen).toBe('root');
    expect(state.speaking).toBe(false);
    expect(state.micState).toBe('off');
    expect(state.micLevel).toBe(0);
  });

  it('dứt điểm hoàn toàn mọi hoạt động khi bấm pressHome', () => {
    useSimulatorStore.setState({
      status: 'connected',
      speaking: true,
      micState: 'listening',
      activity: { ...IDLE_ACTIVITY, kind: 'lesson', title: 'Test Lesson', phase: 'playing' },
      menu: { view: { screen: 'picker', category: 'learning' }, cursor: 0 },
    });

    const store = useSimulatorStore.getState();
    store.pressHome();

    const state = useSimulatorStore.getState();
    expect(state.menu.view.screen).toBe('closed');
    expect(state.speaking).toBe(false);
    expect(state.micState).toBe('off');
    expect(state.activity.kind).toBeNull();
  });

  it('không cho phép mic mở hoặc phát TTS khi menu đang mở', async () => {
    useSimulatorStore.setState({
      status: 'connected',
      speaking: false,
      micState: 'off',
      autoMic: true,
      menu: { view: { screen: 'root' }, cursor: 0 },
    });

    const store = useSimulatorStore.getState();

    // 1. Calling startListening directly should be blocked
    await store.startListening();
    expect(useSimulatorStore.getState().micState).toBe('off');

    // 2. toggleListening should be blocked
    store.toggleListening();
    expect(useSimulatorStore.getState().micState).toBe('off');

    // 3. tapScreen should be blocked
    store.tapScreen();
    expect(useSimulatorStore.getState().micState).toBe('off');

    // 4. activity_state: idle should NOT close the menu
    const set = useSimulatorStore.setState;
    const get = useSimulatorStore.getState;
    handleMessage(set, get, { type: 'activity_state', state: 'idle' } as IncomingMessage);
    expect(useSimulatorStore.getState().menu.view.screen).toBe('root');

    // 5. tts: start message should be dropped while menu is open
    handleMessage(set, get, { type: 'tts', state: 'start' } as IncomingMessage);
    expect(useSimulatorStore.getState().speaking).toBe(false);
  });
});
