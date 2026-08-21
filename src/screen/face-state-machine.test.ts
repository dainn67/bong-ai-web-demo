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
    expect(next.statusText).toBe('Ngày xửa ngày xưa...');
  });

  it('keeps the current face when the backend sends an emotion it does not know', () => {
    const happy = reduceFace(INITIAL_FACE_STATE, { type: 'llm', text: 'a', emotion: 'happy' });
    const next = reduceFace(happy, { type: 'llm', text: 'b', emotion: 'confounded' });

    // An unrecognised mood must not blank the screen — a backend adding a new
    // emotion should degrade to "no change", never to a crash or an empty face.
    expect(next.emotion).toBe('happy');
    expect(next.statusText).toBe('b');
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

  it('reports what the child was heard saying', () => {
    const next = reduceFace(INITIAL_FACE_STATE, { type: 'stt', text: 'con muốn nghe truyện' });
    expect(next.statusText).toContain('con muốn nghe truyện');
  });

  it('ignores message types it has no display for', () => {
    const state = reduceFace(INITIAL_FACE_STATE, { type: 'pong' });
    // Same reference, so React skips the re-render.
    expect(state).toBe(INITIAL_FACE_STATE);
  });

  it('resets on a fresh handshake so a reconnect starts clean', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const rehello: IncomingMessage = { type: 'hello', session_id: 's2' };

    expect(reduceFace(speaking, rehello)).toEqual(INITIAL_FACE_STATE);
  });
});
