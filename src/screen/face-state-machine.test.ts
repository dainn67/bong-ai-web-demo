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
    // Stored bare — the field says who spoke, the bubble adds the name.
    expect(next.said).toBe('Ngày xửa ngày xưa...');
  });

  it('keeps the current face when the backend sends an emotion it does not know', () => {
    const happy = reduceFace(INITIAL_FACE_STATE, { type: 'llm', text: 'a', emotion: 'happy' });
    const next = reduceFace(happy, { type: 'llm', text: 'b', emotion: 'confounded' });

    // An unrecognised mood must not blank the screen — a backend adding a new
    // emotion should degrade to "no change", never to a crash or an empty face.
    expect(next.emotion).toBe('happy');
    expect(next.said).toBe('b');
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

    expect(sentence.said).toBe('Chào con!');
  });

  it('leaves speaking on tts.stop but only settles to idle on demand', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const stopped = reduceFace(speaking, { type: 'tts', state: 'stop' });

    // The one-second linger is the caller's job, so `stop` itself must not
    // jump straight to idle.
    expect(stopped.mode).toBe('emotion');
    expect(toIdle(stopped).mode).toBe('idle');
  });

  it('shows the child their own words, unprefixed', () => {
    const next = reduceFace(INITIAL_FACE_STATE, { type: 'stt', text: 'con muốn nghe truyện' });
    expect(next.heard).toBe('con muốn nghe truyện');
  });

  it('keeps the two speakers apart so neither erases the other', () => {
    const asked = reduceFace(INITIAL_FACE_STATE, { type: 'stt', text: 'kể chuyện đi' });
    const replied = reduceFace(asked, { type: 'llm', text: 'Ngày xửa ngày xưa', emotion: 'happy' });

    // They are drawn as two bubbles; a shared line would mean whoever spoke
    // last wiped the other out.
    expect(replied.heard).toBe('kể chuyện đi');
    expect(replied.said).toBe('Ngày xửa ngày xưa');
  });

  it('hides the tool calls the backend sends down the stt channel', () => {
    const said = reduceFace(INITIAL_FACE_STATE, { type: 'stt', text: 'kể chuyện vịt con' });
    const tool = reduceFace(said, { type: 'stt', text: '% start_learning_session' });

    // The LLM deciding to start a lesson arrives as an `stt` frame. Captioning
    // it would put a function name on the toy's face, so the screen holds what
    // the child actually said.
    expect(tool).toBe(said);
  });

  it('keeps commands and server notices off the face entirely', () => {
    const said = reduceFace(INITIAL_FACE_STATE, { type: 'stt', text: 'chào Bống' });

    // They are still in the packet log; they are just not conversation.
    expect(reduceFace(said, { type: 'iot', commands: [{}, {}] })).toBe(said);
    expect(reduceFace(said, { type: 'server', content: 'config updated' })).toBe(said);
  });

  it('treats a spoken sentence as the badge talking, like any other reply', () => {
    const speaking = reduceFace(INITIAL_FACE_STATE, { type: 'tts', state: 'start' });
    const sentence = reduceFace(speaking, { type: 'tts', state: 'sentence_start', text: 'Chào con!' });

    expect(sentence.said).toBe('Chào con!');
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

  it('shows an image the server actually sends, in all three of its spellings', () => {
    const url = 'https://cdn/praise.gif';
    const image = reduceFace(INITIAL_FACE_STATE, { type: 'image', url, session_id: 's1' });
    const gif = reduceFace(INITIAL_FACE_STATE, { type: 'gif', url, session_id: 's1' });
    const custom = reduceFace(INITIAL_FACE_STATE, {
      type: 'custom',
      session_id: 's1',
      payload: { action: 'show_image', image_url: url, gif_url: url },
    });

    // `send_image_message` emits all three for one picture. Whichever arrives
    // first has to put it up, because there is no ordering guarantee worth
    // relying on.
    expect(image.imageUrl).toBe(url);
    expect(gif.imageUrl).toBe(url);
    expect(custom.imageUrl).toBe(url);
  });

  it('collapses the image/gif/custom triple into one state change', () => {
    const url = 'https://cdn/praise.gif';
    const first = reduceFace(INITIAL_FACE_STATE, { type: 'image', url });
    const second = reduceFace(first, { type: 'gif', url });
    const third = reduceFace(second, {
      type: 'custom',
      payload: { action: 'show_image', image_url: url, gif_url: url },
    });

    // Reference equality: three frames, one render. This is the whole dedupe —
    // no timers, no window, just a reducer that does nothing when asked for
    // what is already on screen.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('reads a custom frame’s gif_url when image_url is missing', () => {
    const next = reduceFace(INITIAL_FACE_STATE, {
      type: 'custom',
      payload: { action: 'show_image', gif_url: 'https://cdn/only-gif.gif' },
    });
    expect(next.imageUrl).toBe('https://cdn/only-gif.gif');
  });

  it('leaves the screen alone for a custom action it does not know', () => {
    const next = reduceFace(INITIAL_FACE_STATE, {
      type: 'custom',
      payload: { action: 'set_volume', image_url: 'https://cdn/nope.gif' },
    });
    // `custom` is a bag: other actions will appear, and none of them should be
    // able to redraw the screen by accident.
    expect(next).toBe(INITIAL_FACE_STATE);
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
