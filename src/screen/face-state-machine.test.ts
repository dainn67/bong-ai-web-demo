import { describe, expect, it } from 'vitest';
import { INITIAL_FACE_STATE, reduceFace, toIdle } from './face-state-machine';
import type { IncomingMessage } from '../protocol/message-types';

describe('face state machine', () => {
  it('wears the emotion the backend sends with a reply', () => {
    const next = reduceFace(INITIAL_FACE_STATE, {
      type: 'llm',
      text: 'Ngày xửa ngày xưa...',
      emotion: 'happy',
    });

    expect(next.mode).toBe('emotion');
    expect(next.emotion).toBe('happy');
    // Prefixed, so the caption says who is talking without a second line.
    expect(next.statusText).toBe('Bống: Ngày xửa ngày xưa...');
  });

  it('keeps the current face when the backend sends an emotion it does not know', () => {
    const happy = reduceFace(INITIAL_FACE_STATE, { type: 'llm', text: 'a', emotion: 'happy' });
    const next = reduceFace(happy, { type: 'llm', text: 'b', emotion: 'confounded' });

    // An unrecognised mood must not blank the screen — a backend adding a new
    // emotion should degrade to "no change", never to a crash or an empty face.
    expect(next.emotion).toBe('happy');
    expect(next.statusText).toBe('Bống: b');
  });

  it('holds the emotion through speech instead of resetting to neutral', () => {
    const sad = reduceFace(INITIAL_FACE_STATE, { type: 'llm', text: 'oh', emotion: 'sad' });
    const speaking = reduceFace(sad, { type: 'tts', state: 'start' });

    expect(speaking.mode).toBe('speaking');
    expect(speaking.emotion).toBe('sad');
  });

  it('shows each sentence as it is spoken', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const sentence = reduceFace(speaking, {
      type: 'tts',
      state: 'sentence_start',
      text: 'Chào con!',
    });

    expect(sentence.statusText).toBe('Chào con!');
  });

  it('leaves speaking on tts.stop but only settles to idle on demand', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const stopped = reduceFace(speaking, { type: 'tts', state: 'stop' });

    // The one-second linger is the caller's job, so `stop` itself must not
    // jump straight to idle.
    expect(stopped.mode).toBe('emotion');
    expect(toIdle(stopped).mode).toBe('idle');
  });

  it('reports what the child was heard saying, and says who said it', () => {
    const next = reduceFace(INITIAL_FACE_STATE, { type: 'stt', text: 'con muốn nghe truyện' });
    expect(next.statusText).toBe('Nghe thấy: con muốn nghe truyện');
  });

  it('leaves spoken sentences unprefixed', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const sentence = reduceFace(speaking, { type: 'tts', state: 'sentence_start', text: 'Chào con!' });

    // While the badge is audibly talking, naming it every sentence reads as a
    // transcript rather than speech.
    expect(sentence.statusText).toBe('Chào con!');
  });

  it('ignores message types it has no display for', () => {
    const state = reduceFace(INITIAL_FACE_STATE, { type: 'pong' });
    // Same reference, so React skips the re-render.
    expect(state).toBe(INITIAL_FACE_STATE);
  });

  it('shows an image the backend sends, in either spelling', () => {
    const schema = reduceFace(INITIAL_FACE_STATE, {
      type: 'display',
      action: 'show_image',
      url: 'https://cdn/story.gif',
    });
    const legacy = reduceFace(INITIAL_FACE_STATE, {
      type: 'display_image',
      url: 'https://cdn/story.gif',
    });

    // Two spellings are in circulation and neither has been seen live, so the
    // simulator has to accept whichever the backend settles on.
    expect(schema.imageUrl).toBe('https://cdn/story.gif');
    expect(legacy.imageUrl).toBe('https://cdn/story.gif');
  });

  it('treats an image frame with no url as clearing the screen', () => {
    const showing = reduceFace(INITIAL_FACE_STATE, { type: 'display_image', url: 'https://cdn/a.gif' });
    const cleared = reduceFace(showing, { type: 'display_image', url: null });

    expect(cleared.imageUrl).toBeNull();
  });

  it('wears a face the backend names outright, including ones no reply produces', () => {
    const next = reduceFace(INITIAL_FACE_STATE, {
      type: 'display',
      action: 'expression',
      name: 'thinking',
    });

    // `thinking` is a device state, not a conversational mood — it has no
    // route in through `llm`.
    expect(next.expression).toBe('thinking');
  });

  it('ignores a face name it does not know rather than blanking the screen', () => {
    const named = reduceFace(INITIAL_FACE_STATE, { type: 'display', action: 'expression', name: 'smug' });
    expect(named).toBe(INITIAL_FACE_STATE);
  });

  it('drops a named face when the next reply arrives, but keeps the artwork', () => {
    const named = reduceFace(INITIAL_FACE_STATE, { type: 'display', action: 'expression', name: 'thinking' });
    const withImage = reduceFace(named, { type: 'display_image', url: 'https://cdn/lesson.gif' });
    const replied = reduceFace(withImage, { type: 'llm', text: 'xong rồi', emotion: 'happy' });

    // A fresh mood supersedes a face the backend named a moment ago. Artwork
    // outlives it: a lesson image stays up across the whole exchange.
    expect(replied.expression).toBeNull();
    expect(replied.emotion).toBe('happy');
    expect(replied.imageUrl).toBe('https://cdn/lesson.gif');
  });

  it('clears artwork on a fresh handshake so a reconnect starts clean', () => {
    const showing = reduceFace(INITIAL_FACE_STATE, { type: 'display_image', url: 'https://cdn/a.gif' });
    expect(reduceFace(showing, { type: 'hello', session_id: 's3' })).toEqual(INITIAL_FACE_STATE);
  });

  it('resets on a fresh handshake so a reconnect starts clean', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const rehello: IncomingMessage = { type: 'hello', session_id: 's2' };

    expect(reduceFace(speaking, rehello)).toEqual(INITIAL_FACE_STATE);
  });
});
