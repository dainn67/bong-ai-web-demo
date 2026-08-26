import { describe, expect, it } from 'vitest';
import { parseIncoming, toDisplayCommand, toEmotion } from './message-types';

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

  it('parses content_catalog frame with lessons, stories and topics', () => {
    const raw = JSON.stringify({
      type: 'content_catalog',
      version: 1,
      child_name: 'Bé Bống',
      lessons: [{ id: 'L_001', title: 'Lời chào' }],
      stories: [{ id: 'S_001', title: 'Rùa và Thỏ' }],
      topics: [{ id: 'animals-5', title: '5 con vật' }],
    });
    const parsed = parseIncoming(raw);
    expect(parsed).toEqual({
      type: 'content_catalog',
      version: 1,
      child_name: 'Bé Bống',
      lessons: [{ id: 'L_001', title: 'Lời chào' }],
      stories: [{ id: 'S_001', title: 'Rùa và Thỏ' }],
      topics: [{ id: 'animals-5', title: '5 con vật' }],
    });
  });

  it('parses activity_state message', () => {
    const raw = JSON.stringify({
      type: 'activity_state',
      state: 'paused',
      session_id: 'test-session-123',
    });
    const parsed = parseIncoming(raw);
    expect(parsed).toEqual({
      type: 'activity_state',
      state: 'paused',
      session_id: 'test-session-123',
    });
  });
});

describe('toDisplayCommand', () => {
  it('handles display show_image frame', () => {
    const msg = parseIncoming('{"type":"display","action":"show_image","url":"https://example.com/a.jpg"}')!;
    expect(toDisplayCommand(msg)).toEqual({ kind: 'image', url: 'https://example.com/a.jpg' });
  });

  it('handles display_image frame', () => {
    const msg = parseIncoming('{"type":"display_image","url":"https://example.com/b.png"}')!;
    expect(toDisplayCommand(msg)).toEqual({ kind: 'image', url: 'https://example.com/b.png' });
  });

  it('handles image frame', () => {
    const msg = parseIncoming('{"type":"image","url":"https://example.com/c.jpg"}')!;
    expect(toDisplayCommand(msg)).toEqual({ kind: 'image', url: 'https://example.com/c.jpg' });
  });

  it('handles custom show_image frame', () => {
    const msg = parseIncoming('{"type":"custom","payload":{"action":"show_image","image_url":"https://example.com/e.jpg"}}')!;
    expect(toDisplayCommand(msg)).toEqual({ kind: 'image', url: 'https://example.com/e.jpg' });
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
