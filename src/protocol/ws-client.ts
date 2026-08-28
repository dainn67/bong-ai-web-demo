/**
 * The chat WebSocket: handshake, heartbeat, reconnect, and frame dispatch.
 *
 * Deliberately knows nothing about React or about audio. It speaks the protocol
 * and hands typed events to whoever is listening, which is what makes it
 * testable without a browser.
 */

import type { DeviceConfig } from '../config/device-config';
import { buildSocketUrl, fetchChatEndpoint } from './ota-client';
import { parseIncoming, type IncomingMessage, type OutgoingMessage } from './message-types';
import type {
  TouchClassificationResult,
  TouchDetail,
  TouchLayoutType,
} from '../screen/touch-layout';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface WsClientHandlers {
  onStatus: (status: ConnectionStatus) => void;
  onMessage: (message: IncomingMessage) => void;
  /** Raw Opus frame from the backend, ready to decode. */
  onAudio: (frame: ArrayBuffer) => void;
  /** Every frame in both directions, for the packet inspector. */
  onLog: (direction: 'in' | 'out', type: string, payload: unknown) => void;
}

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 10_000;

export class WsClient {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** Set by `disconnect()` so a deliberate close doesn't trigger a reconnect. */
  private stopped = false;
  private sessionId: string | null = null;

  private readonly config: DeviceConfig;
  private readonly handlers: WsClientHandlers;

  constructor(config: DeviceConfig, handlers: WsClientHandlers) {
    this.config = config;
    this.handlers = handlers;
  }

  /** The backend's session id, available once the handshake completes. */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.clearReconnect();
    this.handlers.onStatus('connecting');

    let wsUrl = this.config.fallbackWsUrl;
    let token = '';
    try {
      const ota = await fetchChatEndpoint(this.config);
      wsUrl = ota.wsUrl;
      token = ota.token;
      this.handlers.onLog('in', 'ota', ota);
    } catch (error) {
      // A missing OTA endpoint is common on dev servers, so this is a warning
      // and not a failure — we still try the configured URL directly.
      this.handlers.onLog('in', 'ota_failed', { error: String(error) });
    }

    if (this.stopped) return;
    this.openSocket(buildSocketUrl(wsUrl, this.config, token), token);
  }

  private openSocket(url: string, token: string): void {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.handlers.onStatus('connected');
      this.sendHello(token);
      this.startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (event.data instanceof ArrayBuffer) {
        this.handlers.onAudio(event.data);
        return;
      }
      const message = parseIncoming(event.data);
      if (!message) {
        this.handlers.onLog('in', 'unparseable', { raw: event.data });
        return;
      }
      if (message.type === 'hello') this.sessionId = message.session_id;
      this.handlers.onLog('in', message.type, message);
      this.handlers.onMessage(message);
    };

    socket.onclose = () => {
      // Guard against a stale socket firing after we already opened a new one.
      if (this.socket !== socket) return;
      this.socket = null;
      this.sessionId = null;
      this.stopHeartbeat();
      this.handlers.onStatus('disconnected');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // `onclose` always follows and owns the reconnect, so this only logs.
      this.handlers.onLog('in', 'socket_error', {});
    };
  }

  private sendHello(token: string): void {
    this.send({
      type: 'hello',
      device_id: this.config.macAddress,
      device_name: this.config.deviceName,
      device_mac: this.config.macAddress,
      token,
      features: { mcp: false, emoji: true },
      audio_params: {
        format: 'opus',
        sample_rate: this.config.sampleRate,
        channels: 1,
      },
    });
  }

  send(message: OutgoingMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
    this.handlers.onLog('out', message.type, message);
  }

  /**
   * Ships one encoded Opus frame.
   *
   * Not logged: frames arrive around a dozen times a second and logging each
   * one buries every other packet in the inspector.
   */
  sendAudio(frame: ArrayBuffer): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(frame);
  }

  /** Battery report. The badge's own condition, not part of the conversation. */
  sendBattery(level: number, charging: boolean): void {
    this.sendRaw({ type: 'battery', level, charging });
  }

  /** A physical button on the badge: `wake_up`, `press` or `goodbye`. */
  sendButton(action: string): void {
    this.sendRaw({ type: 'button', action });
  }

  /** A fault the badge has noticed in itself. */
  sendError(code: string, message: string): void {
    this.sendRaw({ type: 'error', code, message });
  }

  /** Start a lesson session via server streaming. */
  startLesson(lessonId: string): void {
    this.sendRaw({ type: 'start_lesson', lesson_id: lessonId });
  }

  /** Pause active lesson session. */
  pauseLesson(offsetMs?: number): void {
    this.sendRaw(offsetMs != null ? { type: 'pause_lesson', offset_ms: offsetMs } : { type: 'pause_lesson' });
  }

  /** Resume active lesson session. */
  resumeLesson(): void {
    this.sendRaw({ type: 'resume_lesson' });
  }

  /** Stop active lesson session. */
  stopLesson(): void {
    this.sendRaw({ type: 'stop_lesson' });
  }

  /** Start a story session via server streaming. */
  startStory(storyId: string): void {
    this.sendRaw({ type: 'start_story', story_id: storyId });
  }

  /** Pause active story session. */
  pauseStory(offsetMs?: number): void {
    this.sendRaw(offsetMs != null ? { type: 'pause_story', offset_ms: offsetMs } : { type: 'pause_story' });
  }

  /** Resume active story session. */
  resumeStory(): void {
    this.sendRaw({ type: 'resume_story' });
  }

  /** Stop active story session. */
  stopStory(): void {
    this.sendRaw({ type: 'stop_story' });
  }

  /** Start a topic conversation via server streaming. */
  startTopic(topicId: string): void {
    this.sendRaw({ type: 'start_topic', topic_id: topicId });
  }

  /** Send touch or swipe event to backend. */
  sendTouchEvent(gesture: 'tap' | 'swipe', zone?: string, direction?: string): void {
    const payload: Record<string, unknown> = {
      type: 'touch_event',
      gesture,
    };
    if (zone) payload.zone = zone;
    if (direction) payload.direction = direction;
    this.sendRaw(payload as { type: string } & Record<string, unknown>);
  }



  /**
   * The child's answer to a touch question — §3.1 of the touch protocol.
   *
   * Goes through the typed channel, not `sendRaw`: a touch is the child taking
   * their turn, the same class of thing as `listen`, so it belongs in
   * `OutgoingMessage` alongside the frames that carry speech.
   */
  sendTouch(
    layout: TouchLayoutType,
    zone: TouchClassificationResult,
    detail?: TouchDetail,
  ): void {
    this.send({
      type: 'lesson_touch',
      session_id: this.sessionId ?? undefined,
      layout,
      zone,
      point: detail?.point,
      duration_ms: detail?.durationMs,
    });
  }

  /**
   * Ships a frame outside the typed conversation union.
   *
   * These are device-condition messages the chat protocol has no place for —
   * the backend defines them, xiaozhi may or may not forward them, and neither
   * belongs in `OutgoingMessage` alongside the frames that carry speech.
   */
  private sendRaw(message: { type: string } & Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
    this.handlers.onLog('out', message.type, message);
  }

  /** Interrupts the backend mid-sentence. No-op before the handshake lands. */
  abort(reason = 'user_interrupt'): void {
    if (!this.sessionId) return;
    this.send({ type: 'abort', session_id: this.sessionId, reason });
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
    this.sessionId = null;
    this.handlers.onStatus('disconnected');
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Exponential backoff, capped so a long outage still retries twice a minute. */
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_BACKOFF_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Reconnecting re-runs the OTA handshake and re-sends `hello`, which is
      // what the backend expects — it treats the new socket as a new session.
      void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
