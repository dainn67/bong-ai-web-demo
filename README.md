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

`src/dev/` holds the instruments — connection panel, packet inspector, audio
counters, and the box you type into. Nothing in there exists on real hardware,
which is why it all lives behind the **Dev** button rather than beside the
device: what is being shown here is a toy a small child talks to, and a packet
log competing with it for attention makes the product look like a debugging
session. Escape closes the drawer.

The badge itself is drawn as an object — shell, bezel, glass, ears, status LED,
speaker grille. Only what is inside the round display is under firmware
control; the rest is there so it reads as hardware you could clip to a stuffed
animal.

## Connecting

Real hardware boots knowing one URL: the **OTA endpoint**. It POSTs there, gets
back a WebSocket address plus a token, and connects to that. The simulator does
the same. If the OTA request fails it falls back to the WebSocket URL in the
settings panel, because dev servers often don't have OTA deployed.

Endpoints:

| | OTA | WebSocket |
|---|---|---|
| Shared dev (default) | `https://bong-ai-esp.bcserver.xyz/xiaozhi/ota/` | `wss://bong-ai-esp.bcserver.xyz/xiaozhi/v1/` |
| Local | `http://localhost:8003/xiaozhi/ota/` | `ws://localhost:8000/xiaozhi/v1/` |
| Older prod | `http://mini-8003.bcserver.xyz/xiaozhi/ota/` | `ws://mini-8000.bcserver.xyz/xiaozhi/v1/` |

`bong-ai-esp` is the one to point at. It terminates TLS, so `https`/`wss` work
and the page can be served over https; its OTA endpoint replies with
`Access-Control-Allow-Origin: *`, so the browser reaches it with no proxy. It
issues an empty token, which `buildSocketUrl` already omits rather than sending
as `token=`.

The `mini-*` hosts are served on port 80 only, so they are `ws://` and not
`wss://` — a page on https will refuse to open the socket. And
`bong-api.bcserver.xyz` does **not** route `/xiaozhi/`; it falls through to
FastAPI, which has no such endpoint.

## Audio

Opus in both directions, mono, at whatever `sample_rate` the handshake settles
on — 16000 by default, matching the badge and the speech recogniser behind it.
Frames are 60 ms, which is `frame_duration` in the server's own reply.

| | |
|---|---|
| `src/audio/pcm-worklet.js` | mic tap on the audio thread, one frame per message |
| `src/audio/mic-capture.ts` | `getUserMedia` → `AudioEncoder` → socket |
| `src/audio/opus-player.ts` | `AudioDecoder` → buffers queued on the audio clock |

Three things here were found the hard way and are easy to undo by accident:

- **The recogniser needs a trailing gap.** Audio that stops abruptly is never
  transcribed — the backend's VAD waits for silence to decide the turn ended,
  and without it the whole utterance is discarded in silence. A live mic
  supplies that gap naturally; anything replaying a fixed clip must pad it.
- **Opus always decodes to 48 kHz**, whatever rate the decoder is configured
  with. The playback `AudioContext` is deliberately left at the device default
  rather than pinned to `sampleRate`, and each buffer is built from
  `data.sampleRate`.
- **The mic is muted while the speaker is active**, plus a short hangover. A
  laptop has no echo cancellation between its own speaker and its own mic, so
  without this the badge transcribes itself and interrupts itself. The level
  meter keeps running while muted, which is what makes barge-in work.

The worklet is excluded from Vite's asset inlining in `vite.config.ts`:
`audioWorklet.addModule()` refuses a `data:` URL, and dev serves a real path
either way, so inlining breaks the built bundle only.

## Server-driven screen content

The backend can take the screen over: a face by name, or an image — a GIF, a
lesson picture — that fills the circle in place of any face.

```json
{"type":"display","action":"expression","name":"thinking"}
{"type":"display","action":"show_image","url":"https://…/story.gif"}
{"type":"display","action":"show_image","url":null}
```

That last one, an image frame with no URL, clears the screen.

Two caveats, because none of this has ever come over the live socket:

- **Two spellings exist.** The backend schema builds `{"type":"display",
  "action":…}`; an older client listens for `{"type":"display_expression"}` and
  `{"type":"display_image"}`. Both are accepted here. When the backend picks
  one, delete the other.
- **Named faces outrank the mood** we infer from a reply, until the next reply
  arrives. Images outlive replies entirely, and go only when replaced or
  cleared — a lesson picture should not vanish because the badge said something.

Real hardware has no image decoder and the backend pre-converts stills to
RGB565 for it. A browser has no such problem, so the simulator can show
animation the badge cannot yet — which is the point of having one.

## Touch

The glass is an input surface. Tapping it toggles the microphone — the same
thing the mic button does, routed through the same action so the two cannot
drift apart.

`src/screen/touch-input.ts` holds the rules as pure functions, so what counts
as a touch is tested without a screen to poke at:

- **Coordinates are the device's**, 0–240, whatever size the badge is drawn at.
  The firmware only ever thinks in its own pixels, so everything above that
  line does too.
- **The corners are not the device.** The display is round and its element is
  square, so a click in the corner is inside the box and outside the hardware.
  A real badge feels nothing there.
- **A drag is not a tap.** Worth enforcing now rather than when swipe arrives:
  otherwise every swipe would also toggle the mic on release.

Pointers are tracked by `pointerId` — one path for finger, mouse and stylus,
and more than one finger becomes a matter of reading the map rather than
restructuring anything.

## Two protocol details that will waste your afternoon

Both come from the handshake, and both fail quietly rather than loudly:

- **`features.emoji` must be `true`**, or the backend never attaches `emotion`
  to `llm` frames and the face sits on neutral forever.
- **`audio_params` must be declared.** The server echoes back whatever rate you
  declare and encodes its TTS at it, so this field is a live knob, not a
  formality. Stay silent and it answers `24000` with `frame_duration: 60`. Send
  16 kHz audio into that and everything plays at the wrong speed — it sounds
  like a fault in the codec, but it's the handshake. Whatever the decoder is
  configured with must come from `config.sampleRate`, not a constant.

## Testing

```bash
npm test
node scripts/fake-server.mjs   # a backend that says what you tell it to
```

The live server is intermittent and never sends `display` frames, so the fake
one is how you exercise screen content and any other reply you need on demand.
Point the connection panel at `ws://localhost:5181/`, with a dead OTA URL so
the client falls back to it.

Tests cover the pure logic — frame parsing, URL building, the face state
machine. They run in Node with no DOM, so the whole suite is near-instant.

## Status

Working: OTA handshake, WebSocket with `hello`, heartbeat, backoff reconnect,
typed-text conversation, the round screen and its state machine, packet
inspector, and the audio pipeline in both directions.

Verified against the shared dev server: playback decodes and schedules real TTS
(the frame counter in the audio panel is the proof — Opus frames are the one
thing the packet inspector does not log), `llm` frames arrive carrying
`emotion`, and speech sent up as Opus comes back transcribed in `stt`.

Not verified: `getUserMedia` and the worklet, on a machine with no microphone.
The encoder they feed is verified — the same configuration, driven from a file
instead of a mic, produced frames the backend transcribed correctly.
