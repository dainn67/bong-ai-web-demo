import { describe, expect, it } from 'vitest';
import { indexForPosition, parseSrt, parseTimestamp } from './srt';

const SAMPLE = `1
00:00:00,000 --> 00:00:02,500
Ngày xửa ngày xưa

2
00:00:02,500 --> 00:00:05,000
có một chú rùa

3
00:00:06,000 --> 00:00:08,000
và một chú thỏ
`;

describe('parseTimestamp', () => {
  it('converts to milliseconds', () => {
    expect(parseTimestamp('00:00:02,500')).toBe(2500);
    expect(parseTimestamp('01:02:03,004')).toBe(3_723_004);
  });

  it('returns 0 rather than NaN for junk', () => {
    expect(parseTimestamp('nonsense')).toBe(0);
  });
});

describe('parseSrt', () => {
  it('parses every well-formed block', () => {
    const cues = parseSrt(SAMPLE);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({
      index: 1,
      startMs: 0,
      endMs: 2500,
      text: 'Ngày xửa ngày xưa',
    });
  });

  it('handles CRLF line endings', () => {
    expect(parseSrt(SAMPLE.replace(/\n/g, '\r\n'))).toHaveLength(3);
  });

  it('keeps multi-line cue text', () => {
    const cues = parseSrt('1\n00:00:00,000 --> 00:00:01,000\nmột\nhai\n');
    expect(cues[0].text).toBe('một\nhai');
  });

  // The whole point of the skip-don't-throw rule: one bad block in a
  // hand-edited file costs that block and nothing else.
  it('skips malformed blocks without losing the good ones', () => {
    const cues = parseSrt(`1
00:00:00,000 --> 00:00:01,000
tốt

không-phải-số
00:00:01,000 --> 00:00:02,000
bỏ qua

3
thiếu thời gian
bỏ qua

4
00:00:03,000 --> 00:00:04,000
cũng tốt
`);
    expect(cues.map((c) => c.text)).toEqual(['tốt', 'cũng tốt']);
  });

  it('drops a cue with timing but no text', () => {
    expect(parseSrt('1\n00:00:00,000 --> 00:00:01,000\n')).toEqual([]);
  });

  it('sorts by start time', () => {
    const cues = parseSrt(`2
00:00:05,000 --> 00:00:06,000
sau

1
00:00:01,000 --> 00:00:02,000
trước
`);
    expect(cues.map((c) => c.text)).toEqual(['trước', 'sau']);
  });

  it('returns nothing for empty input', () => {
    expect(parseSrt('')).toEqual([]);
  });
});

describe('indexForPosition', () => {
  const cues = parseSrt(SAMPLE);

  it('finds the covering cue', () => {
    expect(indexForPosition(cues, 0)).toBe(0);
    expect(indexForPosition(cues, 2499)).toBe(0);
    expect(indexForPosition(cues, 2500)).toBe(1);
  });

  // Cue 2 ends at 5s and cue 3 starts at 6s — the gap is real and must read as
  // "no caption", not as the previous line lingering.
  it('returns -1 in the gap between cues', () => {
    expect(indexForPosition(cues, 5500)).toBe(-1);
  });

  it('returns -1 past the end', () => {
    expect(indexForPosition(cues, 99_000)).toBe(-1);
  });
});
