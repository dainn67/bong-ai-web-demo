/**
 * Đọc truyện — a bundled story with a synced transcript.
 *
 * The simplest of the three modes and deliberately the first one built: one
 * mp3, one SRT, no mic, no LLM, no auth. It exercises the whole menu → catalog
 * → player → captions path while the auth surface is still unwritten, so if the
 * plumbing is wrong it shows up here rather than halfway through the lesson
 * engine.
 */

import { cdnUrl } from '../lessons/catalog';
import { indexForPosition, parseSrt, type TranscriptCue } from './srt';

export interface Story {
  id: string;
  title: string;
  audioUrl: string;
  cues: TranscriptCue[];
}

/**
 * Loads a story's metadata and, if it ships one, its transcript.
 *
 * A missing or unparseable transcript costs the captions, not the story — the
 * audio is the thing the child is here for.
 */
export async function loadStory(
  metadataUrl: string,
  signal?: AbortSignal,
): Promise<Story> {
  const response = await fetch(metadataUrl, { signal });
  if (!response.ok) throw new Error(`Không tải được truyện (HTTP ${response.status})`);
  const json = (await response.json()) as Record<string, unknown>;

  const audio = typeof json.audio_url === 'string' ? json.audio_url : '';
  if (!audio) throw new Error('Truyện này chưa có file âm thanh');

  const transcriptUrl =
    typeof json.transcript_url === 'string' && json.transcript_url ? json.transcript_url : null;

  return {
    id: String(json.id ?? ''),
    title: typeof json.title === 'string' ? json.title : 'Truyện',
    audioUrl: cdnUrl(audio),
    cues: transcriptUrl ? await loadCues(cdnUrl(transcriptUrl), signal) : [],
  };
}

async function loadCues(url: string, signal?: AbortSignal): Promise<TranscriptCue[]> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return [];
    return parseSrt(await response.text());
  } catch {
    // An abort lands here too, which is fine: the caller is already tearing
    // this session down and will not read the result.
    return [];
  }
}

export interface StoryPlayerHandlers {
  /** Fires when the highlighted line changes, with -1 in the gaps. */
  onCue: (index: number, text: string | null) => void;
  onEnded: () => void;
  onError: (message: string) => void;
}

/**
 * Plays a story through an `<audio>` element.
 *
 * Not Web Audio: a story is one long file played start to finish, and the
 * element streams it, seeks it and survives a stall for free. The lesson player
 * needs sample-accurate offsets and gain ramps and pays for Web Audio there —
 * this does not, so it should not.
 */
export class StoryPlayer {
  private readonly audio: HTMLAudioElement;
  private lastCue = -2; // -1 is a real value (in a gap), so start outside it.

  private readonly story: Story;
  private readonly handlers: StoryPlayerHandlers;

  constructor(story: Story, handlers: StoryPlayerHandlers) {
    this.story = story;
    this.handlers = handlers;
    this.audio = new Audio(story.audioUrl);
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', this.onTimeUpdate);
    this.audio.addEventListener('ended', this.handlers.onEnded);
    this.audio.addEventListener('error', this.onError);
  }

  private readonly onTimeUpdate = (): void => {
    const index = indexForPosition(this.story.cues, this.audio.currentTime * 1000);
    if (index === this.lastCue) return;
    this.lastCue = index;
    this.handlers.onCue(index, index < 0 ? null : this.story.cues[index].text);
  };

  private readonly onError = (): void => {
    this.handlers.onError('Không phát được truyện');
  };

  async play(): Promise<void> {
    try {
      await this.audio.play();
    } catch (error) {
      // Autoplay policy, usually — which should not happen here because play()
      // rides the tap that chose the story, but say so rather than sit silent.
      this.handlers.onError(`Không phát được truyện: ${String(error)}`);
    }
  }

  pause(): void {
    this.audio.pause();
  }

  async resume(): Promise<void> {
    await this.play();
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  /** Jumps to a cue. Used by tap-to-seek on the transcript. */
  seekToCue(index: number): void {
    const cue = this.story.cues[index];
    if (!cue) return;
    this.audio.currentTime = cue.startMs / 1000;
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  stop(): void {
    this.audio.pause();
    this.audio.removeEventListener('timeupdate', this.onTimeUpdate);
    this.audio.removeEventListener('ended', this.handlers.onEnded);
    this.audio.removeEventListener('error', this.onError);
    // Dropping the src releases the buffer; without it a long story keeps
    // downloading after the child has moved on.
    this.audio.src = '';
  }
}
