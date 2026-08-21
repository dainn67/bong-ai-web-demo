import { describe, expect, it } from 'vitest';
import { parseIncoming, toEmotion } from './message-types';

describe('parseIncoming', () => {
  it('parses a well-formed frame', () => {
    expect(parseIncoming('{"type":"stt","text":"hi"}')).toEqual({ type: 'stt', text: 'hi' });
  });

  it('returns null instead of throwing on malformed JSON', () => {
    // One bad frame must never take the socket down.
    expect(parseIncoming('{not json')).toBeNull();
  });

  it('rejects frames with no type', () => {
    expect(parseIncoming('{"text":"orphan"}')).toBeNull();
  });

  it('rejects a bare JSON value', () => {
    expect(parseIncoming('"hello"')).toBeNull();
    expect(parseIncoming('null')).toBeNull();
  });
});

describe('toEmotion', () => {
  it('accepts the documented emotions', () => {
    expect(toEmotion('happy')).toBe('happy');
  });

  it('rejects anything else so callers can fall back', () => {
    expect(toEmotion('ecstatic')).toBeNull();
    expect(toEmotion(undefined)).toBeNull();
  });
});
