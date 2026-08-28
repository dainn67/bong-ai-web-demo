/**
 * A backend that says exactly what you tell it to.
 *
 * The live server has never sent a `display` frame, and has no idea what a
 * `lesson_question` is — so screen content and the whole touch protocol are
 * otherwise untestable. Its replies are neither deterministic nor always
 * forthcoming, which makes it a poor thing to develop the screen against.
 *
 * Run it, then point the connection panel at `ws://localhost:5181/` with any
 * dead OTA URL, so the client takes its fallback path.
 *
 *   node scripts/fake-server.mjs
 *
 * Hand-rolled rather than pulling in `ws`: the server half of a handshake and
 * an unmasked text frame is about fifteen lines, and a dev-only dependency
 * that ships in nothing is not worth the install.
 *
 * Unlike the first version, this one *reads*. A touch question is a round trip
 * — the interesting half is the `lesson_touch` coming back — and a server that
 * only ever talks can prove the ring lights up but not that anything happens
 * when the child answers.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = 5181;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const GIF = 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif';

/**
 * Artwork is served by the dev server, not from here.
 *
 * Root-relative on purpose: the browser resolves it against whatever origin the
 * simulator is on, so nothing breaks when the Vite port moves. The real backend
 * sends absolute CDN urls; the client cannot tell the difference.
 */
const ART = {
  tap4: '/demo-tap4.svg',
  swipe: '/demo-swipe.svg',
  zone1: '/demo-cat.svg',
  zone2: '/demo-dog.svg',
  zone3: '/demo-elephant.svg',
  zone4: '/demo-monkey.svg',
};

/** Server frames are never masked, so this is just opcode plus length. */
function textFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

/**
 * Pulls whole frames out of whatever has arrived so far.
 *
 * Client frames *are* masked — that half of the protocol is not optional — so
 * this unmasks in place and returns the tail that is still a partial frame.
 * Binary frames are the microphone and are dropped without being decoded;
 * during a speech question they arrive fifty times a second and none of them
 * mean anything to a script.
 */
function readClientFrames(buffer, onText) {
  let offset = 0;
  let closed = false;

  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (cursor + 2 > buffer.length) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (cursor + 8 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + length > buffer.length) break;
    const payload = buffer.subarray(cursor, cursor + length);
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    offset = cursor + length;

    if (opcode === 0x8) {
      closed = true;
      break;
    }
    if (opcode === 0x1) onText(payload.toString('utf8'));
  }

  return { rest: buffer.subarray(offset), closed };
}

/**
 * The opening act: the display frames, which need no answer.
 *
 * Kept because they are still the only way to see both spellings of a display
 * command land on the glass.
 */
const OPENING = [
  [200, { type: 'hello', session_id: 'fake-session-1', audio_params: { format: 'opus', sample_rate: 16000, channels: 1 } }],
  [1200, { type: 'stt', text: 'cho con xem trái đất' }],
  [1600, { type: 'llm', text: 'Đây là Trái Đất nè!', emotion: 'happy' }],
  // the shape the backend schema builds
  [2200, { type: 'display', action: 'show_image', url: GIF, width: 360, height: 360 }],
  // the older spelling, to prove both are accepted
  [6000, { type: 'display_expression', name: 'thinking' }],
  [8000, { type: 'display', action: 'show_image', url: null }],
];

/**
 * The questions, in order, each waiting for its own answer.
 *
 * `reply` gets the zone the client reported and returns the frames to send
 * back. Returning nothing is allowed and means "say nothing, ask the next one".
 */
const QUESTIONS = [
  {
    label: 'tap4 — bốn con vật',
    ask: {
      type: 'lesson_question',
      question_type: 'touch',
      touch_layout: 'tap4',
      image_url: ART.tap4,
      timeout_ms: 10000,
    },
    lead: 'Bé chạm vào con mèo nhé!',
    reply(zone) {
      const animal = {
        zone1: ['con mèo', ART.zone1],
        zone2: ['con chó', ART.zone2],
        zone3: ['con voi', ART.zone3],
        zone4: ['con khỉ', ART.zone4],
      }[zone];

      if (animal) {
        const [name, url] = animal;
        return [
          { type: 'display_image', url },
          {
            type: 'llm',
            text: zone === 'zone1' ? `Đúng rồi, ${name}!` : `Bé chọn ${name} rồi nè.`,
            emotion: zone === 'zone1' ? 'happy' : 'surprised',
          },
        ];
      }
      if (zone === 'silent') {
        return [{ type: 'llm', text: 'Bé còn đó không?', emotion: 'sad' }];
      }
      // `cham_khac` — the dead centre, or a corner the glass does not have.
      return [{ type: 'llm', text: 'Bé bấm vào một trong bốn con vật nhé!', emotion: 'neutral' }];
    },
  },
  {
    label: 'swipe — bốn hướng',
    ask: {
      type: 'lesson_question',
      question_type: 'touch',
      touch_layout: 'swipe',
      image_url: ART.swipe,
      timeout_ms: 10000,
    },
    lead: 'Bé vuốt lên nhé!',
    reply(zone) {
      const said = {
        vuot_len: 'Vuốt lên, giỏi quá!',
        vuot_xuong: 'Bé vuốt xuống rồi.',
        vuot_trai: 'Bé vuốt sang trái.',
        vuot_phai: 'Bé vuốt sang phải.',
        silent: 'Bé thử vuốt một cái xem nào.',
      }[zone];
      return [
        { type: 'display', action: 'show_image', url: null },
        { type: 'llm', text: said ?? 'Bé vuốt dứt khoát hơn chút nhé!', emotion: 'happy' },
      ];
    },
  },
  {
    // Last, because it is the only one that needs the microphone: the first two
    // still work when the browser refuses permission.
    label: 'speech — vòng đỏ',
    ask: { type: 'lesson_question', question_type: 'speech', timeout_ms: 8000 },
    lead: 'Bé nói "con mèo" xem nào!',
    reply: () => [],
  },
];

/** How long a branch reply is left on screen before the next question. */
const BEAT_MS = 2500;

createServer((_req, res) => res.end('websocket only'))
  .on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`,
    );
    console.log('client connected:', req.url);

    let pending = Buffer.alloc(0);
    let asked = -1;

    const send = (message) => {
      if (socket.destroyed) return;
      socket.write(textFrame(JSON.stringify(message)));
      console.log('->', message.type, message.action ?? message.touch_layout ?? message.name ?? '');
    };

    const askNext = () => {
      asked += 1;
      const question = QUESTIONS[asked];
      if (!question) {
        console.log('-- script finished');
        return;
      }
      console.log(`-- asking: ${question.label}`);
      send({ type: 'llm', text: question.lead, emotion: 'neutral' });
      send(question.ask);
    };

    for (const [delay, message] of OPENING) {
      setTimeout(() => send(message), delay);
    }
    setTimeout(askNext, 9000);

    const onText = (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      // Everything else the client says is `listen`, `abort` and `ping`, which
      // this script has no opinion about. Logged at one line so the touch frame
      // is easy to spot in among them.
      if (message.type !== 'lesson_touch') {
        console.log('<-', message.type, message.state ?? '');
        return;
      }

      const point = message.point ? ` at (${Math.round(message.point.x)},${Math.round(message.point.y)})` : '';
      const held = message.duration_ms === undefined ? '' : ` in ${message.duration_ms}ms`;
      console.log(`<- lesson_touch  ${message.layout}  ${message.zone}${point}${held}`);

      const question = QUESTIONS[asked];
      // A touch for a question that is already answered, or answered against a
      // grid we did not set. The real backend has to drop these too, or a child
      // double-tapping advances the lesson twice.
      if (!question || question.ask.touch_layout !== message.layout) {
        console.log('   (ignored — no matching open question)');
        return;
      }

      for (const frame of question.reply(message.zone)) send(frame);
      setTimeout(askNext, BEAT_MS);
    };

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const { rest, closed } = readClientFrames(pending, onText);
      pending = rest;
      if (closed) socket.destroy();
    });
    socket.on('error', () => socket.destroy());
  })
  .listen(PORT, () => console.log(`fake backend on ws://localhost:${PORT}/`));
