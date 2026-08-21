/**
 * A backend that says exactly what you tell it to.
 *
 * The live server has never sent a `display` frame, so screen content is
 * otherwise untestable — and its replies are neither deterministic nor always
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
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = 5181;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const GIF = 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif';

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

/** What the fake backend says, and when. Edit freely — that is the point. */
const SCRIPT = [
  [200, { type: 'hello', session_id: 'fake-session-1', audio_params: { format: 'opus', sample_rate: 16000, channels: 1 } }],
  [1200, { type: 'stt', text: 'cho con xem trái đất' }],
  [1600, { type: 'llm', text: 'Đây là Trái Đất nè!', emotion: 'happy' }],
  // the shape the backend schema builds
  [2200, { type: 'display', action: 'show_image', url: GIF, width: 240, height: 240 }],
  // the older spelling, to prove both are accepted
  [9000, { type: 'display_expression', name: 'thinking' }],
  [12000, { type: 'display', action: 'show_image', url: null }],
];

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

    for (const [delay, message] of SCRIPT) {
      setTimeout(() => {
        if (socket.destroyed) return;
        socket.write(textFrame(JSON.stringify(message)));
        console.log('->', message.type, message.action ?? message.name ?? '');
      }, delay);
    }
    socket.on('error', () => socket.destroy());
  })
  .listen(PORT, () => console.log(`fake backend on ws://localhost:${PORT}/`));
