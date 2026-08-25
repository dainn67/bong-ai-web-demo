/**
 * SRT subtitles → timed cues.
 *
 * Ported from the app's `srt_parser.dart` so a story reads the same on the badge
 * as it does on the phone. Times are milliseconds here rather than a Duration
 * type, because that is what the audio element reports.
 *
 * Malformed blocks are skipped, never thrown: a story with one bad cue should
 * lose that line, not the story.
 */

export interface TranscriptCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

const TIMING = /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/;

export function parseSrt(content: string): TranscriptCue[] {
  const blocks = content.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  const cues: TranscriptCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) continue;

    const index = Number.parseInt(lines[0].trim(), 10);
    if (Number.isNaN(index)) continue;

    const timing = TIMING.exec(lines[1].trim());
    if (!timing) continue;

    const text = lines.slice(2).join('\n').trim();
    if (!text) continue;

    cues.push({
      index,
      startMs: parseTimestamp(timing[1]),
      endMs: parseTimestamp(timing[2]),
      text,
    });
  }

  cues.sort((a, b) => a.startMs - b.startMs);
  return cues;
}

/** `HH:MM:SS,mmm` → milliseconds. Returns 0 for anything unparseable. */
export function parseTimestamp(stamp: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(stamp.trim());
  if (!match) return 0;
  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1_000 +
    Number(millis)
  );
}

/**
 * Index of the cue covering `positionMs`, or -1 between cues.
 *
 * Linear like the app's version. A story is a few hundred cues and this runs on
 * a timeupdate tick — binary search would be a fair amount of code to save a
 * few microseconds nobody will feel.
 */
export function indexForPosition(cues: TranscriptCue[], positionMs: number): number {
  for (let i = 0; i < cues.length; i++) {
    if (positionMs >= cues[i].startMs && positionMs < cues[i].endMs) return i;
  }
  return -1;
}
