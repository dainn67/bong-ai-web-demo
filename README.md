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

## Deploying

```bash
docker compose up -d --build     # nginx on 127.0.0.1:3002, behind the proxy manager
```

The badge itself needs no proxy: OTA and the WebSocket are absolute URLs to
`bong-ai-esp`, which sends `Access-Control-Allow-Origin: *`, and lesson content
never touches the browser — the server fetches the clips and pushes them down
the socket as Opus.

One route needs proxying, and it is not part of running the device:
`/api/v1/devices/bind-by-phone`, which provisions the simulator against a parent
account once. `bong-api` does not whitelist this origin, so `vite.config.ts`
answers it in dev and `nginx.conf` answers it in the container. **Keep the two
in step.**

There used to be four such routes and they were the source of the one
production-only failure this project has had: `dist/` served without them
answered `/cdn/…` with `index.html`, and the catalog fetch died on
`Unexpected token '<', "<!doctype "... is not valid JSON`. Moving the lesson
engine to the server removed the class, not just the instance.

## What it does

The simulator is three things stacked together:

| Layer | Directory | Job |
|---|---|---|
| Protocol | `src/protocol/` | OTA handshake, WebSocket, heartbeat, reconnect |
| Audio | `src/audio/` | Mic → Opus → send; receive Opus → speaker |
| Screen | `src/screen/` | Round display and its face state machine |

That is the whole device. There is no lesson engine, no catalog, no
speech-to-text call and no parent login, because the badge has none of those —
it says what it wants and the server drives everything that follows. See
[`docs/plan-server-driven-modes.md`](docs/plan-server-driven-modes.md) for what
that replaced and why.

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

## Modes

There is no start-lesson frame in the protocol, and no endpoint the device can
call. A mode is entered by **saying so**:

```json
{"type":"listen","state":"detect","text":"Bắt đầu bài học tiếng Anh"}
```

The server's LLM routes that to its lesson orchestrator, which drives the
backend FSM and pushes the result back as speech, Opus clips and image frames.
From the badge's side a lesson is indistinguishable from a conversation, which
is exactly what it is meant to be.

**The menu on the glass** shows what there is to ask for. Tap **Bài học** or
**Đọc truyện** and it lists the catalog — 3 stories and 17 lessons, from the open
`GET /api/v1/lessions`, through the same `/api` proxy provisioning uses. Tapping
a row says *that lesson's title*, which is how the badge asks for one in
particular.

The list is a menu, not content. It does not tell the device how to run
anything and the device could not act on it if it did — take it away and the
badge still works, you just have to know what to ask for.

The prefix on the phrase is doing real work. `Kể chuyện <title>` is routed into
the **stories** list by the backend before anything else is tried;
`Bắt đầu bài học <title>` walks lessons first. That is what keeps the two "Rùa và
thỏ" entries apart — there is a lesson by that name *and* a story by that name.
See `intentFor` in `menu-state.ts`.

**Ý định** in the drawer covers the rest: the catch-all phrases that let the
*server* pick a lesson, resuming yesterday's, quitting — plus a box for anything
you want to type. The wording is matched by a language model, not a parser, so a
phrase that works today can stop working when the prompt changes, which is why
the free-text box is there.

You can tell it routed by watching the packet inspector for an `stt` frame
reading `% start_learning_session`. That is the tool call, not speech, and
`reduceFace` deliberately keeps it off the badge's face.

**Lessons need the device bound to a parent account.** `bind-by-phone` in the
drawer does it: give it a phone number that is already registered and it upserts
a `UserDevice`, attaches a child, and hands back the `device_id` the simulator
then identifies as. Without it `/lesson-sessions/start` answers
`DEVICE_NOT_BOUND`, which arrives as a spoken refusal several seconds after
asking — miserable to debug, hence the panel saying up front whether this badge
is bound.

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

The backend takes the screen over: a face by name, or an image — a GIF, a lesson
picture — that fills the circle in place of any face.

**What the server actually sends.** `send_image_message` in xiaozhi-server emits
three frames for one picture, back to back, so ESP32 firmware, this simulator
and the mobile app each find a spelling they understand:

```json
{"type":"image","url":"https://…/praise.gif","session_id":"…"}
{"type":"gif","url":"https://…/praise.gif","session_id":"…"}
{"type":"custom","payload":{"action":"show_image","image_url":"…","gif_url":"…"}}
```

All three are accepted, and `reduceFace` collapses them: setting an image that
is already up returns the same state, so three frames make one render. No
timers, no dedupe window — the reducer stays a pure function of the frame.

**What the schema says.** `{"type":"display","action":"expression"|"show_image"}`
plus the older `display_expression` / `display_image` spellings. Still accepted,
still never seen over the live socket. When one of the families wins, delete the
other.

Two rules that are easy to get backwards:

- **Named faces outrank the mood** we infer from a reply, until the next reply
  arrives.
- **Images outlive replies entirely,** and go only when replaced or when a
  `display_image` arrives with a null URL. Nothing in the proven family can
  clear the screen — a lesson picture should not vanish because the badge said
  something, so holding it is the right default.

Real hardware has no image decoder and the backend pre-converts stills to
RGB565 for it. A browser has no such problem, so the simulator can show
animation the badge cannot yet — which is the point of having one.

## Hardware

The badge reports its own condition, and **Phần cứng** in the drawer is where
you decide what that condition is: battery and charging, WiFi strength, and an
injected fault.

The **button is on the badge**, on the rim at three o'clock, because a physical
button is real hardware and does not belong in a drawer labelled as things real
hardware does not have. There is one, as there is on the device, so meaning
comes from how long it is held rather than from picking an action off a list:

| | |
|---|---|
| Press while asleep | `wake_up` — a child holding a dark toy should not have to know how long to hold |
| Short press | `press` |
| Held past 800ms | `goodbye`, and the badge sleeps |

It fills up as you hold it, so the goodbye is visible before it fires rather
than a surprise afterwards. Presses are debounced 3s and capped at ten a
minute — the same rules the backend applies, run locally too, because firmware
debounces in the device and the badge should behave the same whether or not a
backend is reachable. A press that does not count says so on the glass, since
a child who sees nothing happen just presses harder. When an API address is
set it also reports to `/devices/{id}/fallback/button-press`, which is how the
device and the backend are ever seen to disagree about the count.

Battery and signal are drawn on the badge's own screen, since that is where
they would be on the real thing, and both go red at the same threshold the
parent app uses.

It reports over two links, because they are two systems:

| | Goes to | Carries |
|---|---|---|
| The chat socket | xiaozhi | `battery`, `button`, `error` frames |
| `POST /devices/{id}/telemetry` | FastAPI | the full reading, including `uptime_seconds` and `error_code` |

Only the second reaches the parent app: `/devices/dashboard/list` reads what
that endpoint writes. It is off until you fill in **API backend** in the
connection panel, because the backend is usually not running next to you, and
a panel full of red failures for an service you never intended to use is
worse than one that says nothing.

The fault injector matters more than it looks. `error_code` is a field the
backend logs and the parent app can show, and nothing else in the stack can
produce one — no device has ever sent it. Same for a flat battery: turn on
**Tự hao pin** and the badge drains, disconnects at zero, and gives the
parent app's offline path something real to react to.

## Touch

The glass is the badge's whole physical interface, and what a touch means
depends on what the device is doing:

| State | A tap |
|---|---|
| Asleep | Wakes it — connects and says hello |
| Waking | Nothing. The wake is already under way, and a second one would tear down the socket that is opening |
| Awake | Opens or closes the microphone, through the same action the mic button calls |

The hardware has one surface and no labels on it, so the meaning has to come
from context. It responds with the screen dark, too — a device that ignored you
until it was already awake would be a strange thing to hand a child.

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

The live server is intermittent, so the fake one is how you exercise screen
content and any other reply you need on demand — including the `image` / `gif` /
`custom` triple, which is otherwise only reachable by getting a real lesson to
reach a node that has artwork on it.
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

Also not verified, and more important: **a lesson running end to end through the
server.** The device side is written and tested against the frames the backend
changelog documents, but nobody has yet watched a real lesson play through it —
see the parity checklist in `docs/plan-server-driven-modes.md`. Until that
happens, a lesson that does not start could be the phrase, the binding, or an
orchestrator that is not deployed on the host you are pointed at, and the packet
inspector is the only way to tell which.
