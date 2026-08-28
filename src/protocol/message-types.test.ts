import { describe, expect, it } from 'vitest';
import {
  parseIncoming,
  toDisplayCommand,
  toEmotion,
  type LessonQuestionIn,
  type LessonTouchOut,
} from './message-types';

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

  /**
   * The literal examples out of `docs/Bong-AI-Touch-Protocol-V2.md`.
   *
   * That document is the contract the backend team builds against, so the
   * examples in it are worth pinning: renaming a field on this side would
   * otherwise leave the doc quietly describing a protocol nobody speaks.
   */
  describe('touch protocol §3', () => {
    it('parses the lesson_question example from §3.2', () => {
      const raw = JSON.stringify({
        type: 'lesson_question',
        question_type: 'touch',
        touch_layout: 'tap4',
        image_url: 'https://cdn.example.com/assets/animals_quiz.svg',
        timeout_ms: 10000,
      });

      const parsed = parseIncoming(raw) as LessonQuestionIn;
      expect(parsed.type).toBe('lesson_question');
      expect(parsed.question_type).toBe('touch');
      expect(parsed.touch_layout).toBe('tap4');
      expect(parsed.timeout_ms).toBe(10000);
      expect(parsed.image_url).toBe('https://cdn.example.com/assets/animals_quiz.svg');
    });

    it('serialises the lesson_touch example from §3.1', () => {
      const frame: LessonTouchOut = {
        type: 'lesson_touch',
        session_id: '1651446a-d89e-46ff-b61b-c4472736ce0b',
        layout: 'tap4',
        zone: 'zone1',
        point: { x: 180, y: 65 },
        duration_ms: 115,
      };

      expect(JSON.parse(JSON.stringify(frame))).toEqual({
        type: 'lesson_touch',
        session_id: '1651446a-d89e-46ff-b61b-c4472736ce0b',
        layout: 'tap4',
        zone: 'zone1',
        point: { x: 180, y: 65 },
        duration_ms: 115,
      });
    });

    it('omits the optional fields rather than sending them as null', () => {
      // What a timeout sends. An explicit `"point": null` would have the backend
      // reading a coordinate that never existed.
      const frame: LessonTouchOut = {
        type: 'lesson_touch',
        session_id: undefined,
        layout: 'tap4',
        zone: 'silent',
        point: undefined,
        duration_ms: undefined,
      };

      expect(JSON.parse(JSON.stringify(frame))).toEqual({
        type: 'lesson_touch',
        layout: 'tap4',
        zone: 'silent',
      });
    });
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
