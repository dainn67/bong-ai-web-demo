# Device Simulator

A browser stand-in for the Bống round badge — the Bluetooth speaker+mic clipped
to a child's stuffed animal. It speaks the same protocol as the real hardware so
the backend can be developed and debugged without a physical device.

## Run it

```bash
npm install
cp .env.example .env      # optional; the UI can edit endpoints at runtime
npm run dev               # http://localhost:5180
```

**Use Chrome.** The audio pipeline relies on WebCodecs `AudioEncoder` /
`AudioDecoder`, which Safari only shipped in 26.0 and Firefox for Android does
not have at all. This is an internal tool, so that trade is deliberate.

## What it does

The simulator is three things stacked together:

| Layer | Directory | Job |
|---|---|---|
| Protocol | `src/protocol/` | OTA handshake, WebSocket, heartbeat, reconnect |
| Audio | `src/audio/` | Mic → Opus → send; receive Opus → speaker |
| Screen | `src/screen/` | Round display and its face state machine |

`src/dev/` holds the instruments — connection panel, packet inspector, text
input. Nothing in there exists on real hardware.

## Connecting

Real hardware boots knowing one URL: the **OTA endpoint**. It POSTs there, gets
back a WebSocket address plus a token, and connects to that. The simulator does
the same. If the OTA request fails it falls back to the WebSocket URL in the
settings panel, because dev servers often don't have OTA deployed.

Endpoints:

| | OTA (HTTP) | WebSocket |
|---|---|---|
| Local | `http://localhost:8003/xiaozhi/ota/` | `ws://localhost:8000/xiaozhi/v1/` |
| Production | `http://mini-8003.bcserver.xyz/xiaozhi/ota/` | `ws://mini-8000.bcserver.xyz/xiaozhi/v1/` |

Two things worth knowing about production: those subdomains are served on port
80 only, so they are `ws://` and not `wss://` — a page on https will refuse to
open the socket. And `bong-api.bcserver.xyz` does **not** route `/xiaozhi/`; it
falls through to FastAPI, which has no such endpoint.

## Two protocol details that will waste your afternoon

Both come from the handshake, and both fail quietly rather than loudly:

- **`features.emoji` must be `true`**, or the backend never attaches `emotion`
  to `llm` frames and the face sits on neutral forever.
- **`audio_params` must be declared.** Stay silent and the backend assumes
  24000 Hz. Send 16 kHz audio into that and everything plays at the wrong
  speed — it sounds like a fault in the codec, but it's the handshake.

## Testing

```bash
npm test
```

Tests cover the pure logic — frame parsing, URL building, the face state
machine. They run in Node with no DOM, so the whole suite is near-instant.

## Status

Working: OTA handshake, WebSocket with `hello`, heartbeat, backoff reconnect,
typed-text conversation, the round screen and its state machine, packet
inspector.

Not built yet: the audio pipeline. `src/audio/` is empty. Receiving and decoding
Opus comes first, then microphone capture and encoding — in that order, since
hearing the backend talk is what proves the loop before you add a second
failure point.
