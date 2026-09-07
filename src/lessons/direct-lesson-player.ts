/**
 * Direct Lesson Player - Standalone client-side playback engine.
 *
 * Allows instant playback, direct index jumping, and auto-next stepping
 * directly from CDN metadata without needing esp32-server or WebSocket streams.
 */

import { cdnUrl } from './catalog';

export interface DirectAudioNode {
  fileName?: string;
  url: string;
  nodeType?: string;
  waitMs?: number;
  durationMs?: number | string;
  volume?: number;
  voice?: string | null;
}

export interface DirectVisualNode {
  fileName?: string;
  url: string;
  nodeType?: string;
  waitMs?: number;
  durationMs?: number | string;
  stop?: 'giu' | 'tat';
}

export interface DirectQuestionNode {
  type?: string;
  text?: string;
  layout?: string;
  options?: unknown[];
  branches?: Record<string, unknown>;
}

export interface DirectLessonIndexItem {
  order: string;
  type?: string;
  audios: DirectAudioNode[];
  visuals: DirectVisualNode[];
  question?: DirectQuestionNode | null;
  next?: string;
  waitMs?: number;
}

export type DirectPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended';

export interface DirectPlayerHandlers {
  onIndexChange: (index: DirectLessonIndexItem | null) => void;
  onPlaybackStateChange: (state: DirectPlaybackState) => void;
  onVisualChange: (url: string | null, stop?: 'giu' | 'tat') => void;
  onAudioProgress?: (currentTimeSec: number, durationSec: number) => void;
  onError?: (err: string) => void;
}

export class DirectLessonPlayer {
  private indexes: DirectLessonIndexItem[] = [];
  private indexMap: Map<string, DirectLessonIndexItem> = new Map();
  private currentIndex: DirectLessonIndexItem | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private autoNext = false;
  private autoNextDelayMs = 1500;
  private autoNextTimer: ReturnType<typeof setTimeout> | null = null;
  private state: DirectPlaybackState = 'idle';
  private volume = 1.0;
  private handlers: DirectPlayerHandlers;
  private activeVisualUrl: string | null = null;

  constructor(handlers: DirectPlayerHandlers) {
    this.handlers = handlers;
  }

  get isAutoNextEnabled(): boolean {
    return this.autoNext;
  }

  get autoNextDelay(): number {
    return this.autoNextDelayMs;
  }

  get loadedIndexes(): DirectLessonIndexItem[] {
    return this.indexes;
  }

  get activeIndex(): DirectLessonIndexItem | null {
    return this.currentIndex;
  }

  get playbackState(): DirectPlaybackState {
    return this.state;
  }

  get currentVisualUrl(): string | null {
    return this.activeVisualUrl;
  }

  setAutoNext(enabled: boolean, delayMs?: number): void {
    this.autoNext = enabled;
    if (delayMs !== undefined) {
      this.autoNextDelayMs = Math.max(0, delayMs);
    }
    if (!enabled && this.autoNextTimer) {
      clearTimeout(this.autoNextTimer);
      this.autoNextTimer = null;
    }
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.audioEl) {
      this.audioEl.volume = this.volume;
    }
  }

  async loadLessonFromMetadata(metadataUrl: string): Promise<DirectLessonIndexItem[]> {
    this.stop();
    this.setState('loading');

    const url = cdnUrl(metadataUrl);
    const res = await fetch(url);
    if (!res.ok) {
      const err = `Failed to load lesson metadata: HTTP ${res.status}`;
      this.handlers.onError?.(err);
      this.setState('idle');
      throw new Error(err);
    }

    const raw = await res.json();
    return this.parseAndSetIndexes(raw);
  }

  parseAndSetIndexes(raw: unknown): DirectLessonIndexItem[] {
    if (!raw || typeof raw !== 'object') {
      this.indexes = [];
      this.indexMap.clear();
      this.setState('idle');
      return [];
    }

    const rec = raw as Record<string, unknown>;
    const rawIndexes = Array.isArray(rec.indexes)
      ? rec.indexes
      : Array.isArray(rec.nodes)
      ? rec.nodes
      : [];

    this.indexes = rawIndexes.map((item: unknown): DirectLessonIndexItem => {
      const it = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const order = String(it.order ?? '');
      
      const rawAudio = Array.isArray(it.audio) ? it.audio : (it.audios && Array.isArray(it.audios) ? it.audios : []);
      const audios: DirectAudioNode[] = rawAudio.map((a: unknown) => {
        const ar = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
        return {
          fileName: typeof ar.fileName === 'string' ? ar.fileName : (typeof ar.filename === 'string' ? ar.filename : undefined),
          url: typeof ar.url === 'string' ? ar.url : '',
          nodeType: typeof ar.nodeType === 'string' ? ar.nodeType : undefined,
          waitMs: typeof ar.waitMs === 'number' ? ar.waitMs : 0,
          durationMs: (typeof ar.durationMs === 'number' || typeof ar.durationMs === 'string') ? ar.durationMs : undefined,
          volume: typeof ar.volume === 'number' ? ar.volume : 100,
          voice: typeof ar.voice === 'string' ? ar.voice : null,
        };
      });

      // Fallback if audio was single string or audio_url
      if (audios.length === 0) {
        const singleAudio = typeof it.audio === 'string' ? it.audio : (typeof it.audio_url === 'string' ? it.audio_url : null);
        if (singleAudio) {
          audios.push({
            url: singleAudio,
            fileName: typeof it.fileName === 'string' ? it.fileName : undefined,
            waitMs: typeof it.delayMs === 'number' ? it.delayMs : 0,
            durationMs: (typeof it.durationMs === 'number' || typeof it.durationMs === 'string') ? it.durationMs : undefined,
            volume: typeof it.volume === 'number' ? it.volume : 100,
            voice: typeof it.voice === 'string' ? it.voice : null,
          });
        }
      }

      const rawVisual = Array.isArray(it.visual) ? it.visual : (it.visuals && Array.isArray(it.visuals) ? it.visuals : []);
      const visuals: DirectVisualNode[] = rawVisual.map((v: unknown) => {
        const vr = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
        const stopVal = vr.stop === 'giu' || vr.stop === 'tat' ? vr.stop : undefined;
        return {
          fileName: typeof vr.fileName === 'string' ? vr.fileName : undefined,
          url: typeof vr.url === 'string' ? vr.url : '',
          nodeType: typeof vr.nodeType === 'string' ? vr.nodeType : undefined,
          waitMs: typeof vr.waitMs === 'number' ? vr.waitMs : 0,
          durationMs: (typeof vr.durationMs === 'number' || typeof vr.durationMs === 'string') ? vr.durationMs : undefined,
          stop: stopVal,
        };
      });

      // Fallback if visual was single string or image_url / gif_url
      if (visuals.length === 0) {
        const singleVisual = typeof it.image_url === 'string'
          ? it.image_url
          : typeof it.image === 'string'
          ? it.image
          : typeof it.gif_url === 'string'
          ? it.gif_url
          : typeof it.visual === 'string'
          ? it.visual
          : null;
        if (singleVisual) {
          visuals.push({
            url: singleVisual,
            fileName: typeof it.fileName === 'string' ? it.fileName : undefined,
            waitMs: 0,
            durationMs: 'full',
            stop: 'giu',
          });
        }
      }

      let question: DirectQuestionNode | null = null;
      if (it.question && typeof it.question === 'object') {
        const q = it.question as Record<string, unknown>;
        question = {
          type: typeof q.type === 'string' ? q.type : undefined,
          text: typeof q.text === 'string' ? q.text : undefined,
          layout: typeof q.layout === 'string' ? q.layout : undefined,
          options: Array.isArray(q.options) ? q.options : undefined,
          branches: q.branches && typeof q.branches === 'object' ? (q.branches as Record<string, unknown>) : undefined,
        };
      } else if (Array.isArray(it.branches) && it.branches.length > 0) {
        question = {
          type: 'choice',
          layout: typeof it.touchLayout === 'string' ? it.touchLayout : undefined,
          options: it.branches.map((b: any) => String(b.branchType || b.name || '')),
        };
      }


      return {
        order,
        type: typeof it.type === 'string' ? it.type : undefined,
        audios,
        visuals,
        question,
        next: typeof it.next === 'string' ? it.next : undefined,
        waitMs: typeof it.waitMs === 'number' ? it.waitMs : 0,
      };
    });

    this.indexMap.clear();
    for (const item of this.indexes) {
      if (item.order) {
        this.indexMap.set(item.order, item);
      }
    }

    this.currentIndex = null;
    this.setState('idle');
    this.handlers.onIndexChange(null);
    return this.indexes;
  }

  async playIndex(order: string): Promise<void> {
    const item = this.indexMap.get(order);
    if (!item) {
      this.handlers.onError?.(`Index order "${order}" not found in lesson`);
      return;
    }

    this.stopAudioAndTimer();
    this.currentIndex = item;
    this.handlers.onIndexChange(item);

    // 1. Handle Visual Channel
    this.applyVisualForIndex(item);

    // 2. Handle Audio Channel
    await this.applyAudioForIndex(item);
  }

  async playNext(): Promise<void> {
    if (!this.currentIndex) {
      if (this.indexes.length > 0) {
        await this.playIndex(this.indexes[0].order);
      }
      return;
    }

    // Follow item.next if valid, otherwise step by list sequence
    const nextOrder = this.currentIndex.next;
    if (nextOrder && this.indexMap.has(nextOrder)) {
      await this.playIndex(nextOrder);
      return;
    }

    const currIdx = this.indexes.findIndex((it) => it.order === this.currentIndex?.order);
    if (currIdx >= 0 && currIdx + 1 < this.indexes.length) {
      await this.playIndex(this.indexes[currIdx + 1].order);
      return;
    }

    // Reached end of lesson
    this.setState('ended');
  }

  async playPrev(): Promise<void> {
    if (!this.currentIndex) return;
    const currIdx = this.indexes.findIndex((it) => it.order === this.currentIndex?.order);
    if (currIdx > 0) {
      await this.playIndex(this.indexes[currIdx - 1].order);
    }
  }

  togglePause(): void {
    if (!this.audioEl) return;
    if (this.audioEl.paused) {
      void this.audioEl.play();
      this.setState('playing');
    } else {
      this.audioEl.pause();
      this.setState('paused');
    }
  }

  stop(): void {
    this.stopAudioAndTimer();
    this.activeVisualUrl = null;
    this.handlers.onVisualChange(null);
    this.handlers.onIndexChange(null);
    this.currentIndex = null;
    this.setState('idle');
  }

  private applyVisualForIndex(item: DirectLessonIndexItem): void {
    if (item.visuals && item.visuals.length > 0) {
      const vis = item.visuals[0];
      const targetUrl = cdnUrl(vis.url);
      this.activeVisualUrl = targetUrl;
      this.handlers.onVisualChange(targetUrl, vis.stop);
    } else {
      // Empty visual array: per Bong-AI specification, cut to black for this index
      this.activeVisualUrl = null;
      this.handlers.onVisualChange(null);
    }
  }

  private async applyAudioForIndex(item: DirectLessonIndexItem): Promise<void> {
    if (!item.audios || item.audios.length === 0 || !item.audios[0].url) {
      // No audio for this index
      this.setState('playing');
      if (this.autoNext) {
        this.scheduleAutoNext();
      } else {
        this.setState('ended');
      }
      return;
    }

    const audioNode = item.audios[0];
    const audioUrl = cdnUrl(audioNode.url);

    try {
      this.setState('loading');
      const audio = new Audio(audioUrl);
      audio.volume = this.volume;
      this.audioEl = audio;

      audio.onplay = () => this.setState('playing');
      audio.onpause = () => {
        if (this.state === 'playing') this.setState('paused');
      };
      audio.ontimeupdate = () => {
        if (this.handlers.onAudioProgress && audio.duration) {
          this.handlers.onAudioProgress(audio.currentTime, audio.duration);
        }
      };
      audio.onended = () => {
        this.setState('ended');
        if (this.autoNext) {
          this.scheduleAutoNext();
        }
      };
      audio.onerror = (e) => {
        console.warn(`[DirectLessonPlayer] Audio play error on index ${item.order}:`, e);
        this.setState('ended');
        if (this.autoNext) {
          this.scheduleAutoNext();
        }
      };

      await audio.play();
    } catch (err) {
      console.warn(`[DirectLessonPlayer] Autoplay or playback blocked: ${err}`);
      this.setState('ended');
      if (this.autoNext) {
        this.scheduleAutoNext();
      }
    }
  }

  private scheduleAutoNext(): void {
    if (this.autoNextTimer) clearTimeout(this.autoNextTimer);
    
    // If current index is a question waiting for interaction, do not auto-next
    if (this.currentIndex?.question) {
      return;
    }

    this.autoNextTimer = setTimeout(() => {
      this.autoNextTimer = null;
      void this.playNext();
    }, this.autoNextDelayMs);
  }

  private stopAudioAndTimer(): void {
    if (this.autoNextTimer) {
      clearTimeout(this.autoNextTimer);
      this.autoNextTimer = null;
    }
    if (this.audioEl) {
      this.audioEl.onplay = null;
      this.audioEl.onpause = null;
      this.audioEl.ontimeupdate = null;
      this.audioEl.onended = null;
      this.audioEl.onerror = null;
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
  }

  private setState(state: DirectPlaybackState): void {
    this.state = state;
    this.handlers.onPlaybackStateChange(state);
  }
}
