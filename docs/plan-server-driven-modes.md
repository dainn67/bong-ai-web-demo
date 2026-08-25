# Plan — thin device: the server drives the modes

Goal: the simulator stops being an app that calls APIs and becomes what the
badge actually is — a speaker, a microphone, a screen and one WebSocket. It
POSTs `/ota`, opens the socket it is handed, and everything after that arrives
as Opus frames and JSON control frames. No lesson APIs, no CDN fetches, no
speech-to-text call, no parent JWT in the browser.

This supersedes the client-side approach in
[`plan-app-modes-on-device.md`](./plan-app-modes-on-device.md). That plan was
right for the time: the lesson orchestrator did not exist on the server yet, so
the only way to see a lesson run was to port the Flutter engine into the
browser. It exists now, so the port is no longer simulation — it is a second
implementation of the same FSM, drifting against the first.

Source of truth for the target shape:
`../backend-python/docs/project-docs/xiaozhi-lesson-architecture.md` §2, §4, §6,
and the 25/08/2026 entry in `../backend-python/docs/CHANGELOG.md`.

---

## Status

Phases 1–4 and 6–8 are **implemented** on `feat/thin-device-server-modes`.
Typecheck, lint and 91 tests pass; the bundle dropped from 277 kB to 237 kB.

Phase 0 and Phase 5 are **not done, and neither could be done here.** Phase 0
needs the `xiaozhi-esp32-server` repo, which is not in this workspace. Phase 5
needs a browser pointed at a deployment whose orchestrator is live. The plan
gates Phase 6 on Phase 5 passing, and that gate was crossed deliberately on the
instruction to implement — the deleted engine is one `git revert` away, but
until a lesson has been watched running end to end, **treat lesson mode as
untested rather than as working.**

The five open questions below are all still open. Question 2 — how the device
learns to open the mic for `await_answer` — is the one most likely to require
code, and the current answer is "auto-VAD, we hope".

---

## The shape being copied

```
┌─────────────┐   WebSocket    ┌──────────────────┐   HTTP (internal auth)  ┌──────────────┐
│  Simulator  │ ←────────────→ │  xiaozhi-server  │ ←────────────────────→  │ bong-api     │
│  (browser)  │   Opus + JSON  │  voice runtime   │  /internal/device-proxy │ lesson FSM   │
└─────────────┘                │  + orchestrator  │  /lesson-sessions       └──────────────┘
                               └──────────────────┘
```

The architecture doc is explicit on the two rules that matter here (§4):

> Thiết bị chỉ nhận Opus + JSON control (`tts`/`stt`). Nội dung bài học **không**
> "push JSON lesson tree xuống box".

> Media: Lesson Backend cung cấp URL; xiaozhi **cache local** rồi
> `ContentType.FILE`. Không stream MP3 thô xuống ESP32.

So the device never sees a `metadata.json`, never resolves a `{userPhone}` or
`{voiceID}` placeholder, never decodes an mp3. The server walks the FSM, fetches
the clip from the CDN, transcodes it to Opus, and pushes it down the same pipe
that carries chat speech. What reaches us is indistinguishable from a TTS reply,
which is exactly the point.

### Who the device is allowed to talk to, after this

| Host | Purpose | When |
|---|---|---|
| `bong-ai-esp.bcserver.xyz/xiaozhi/ota/` | ask where the socket is | every connect |
| `wss://bong-ai-esp.bcserver.xyz/xiaozhi/v1/` | everything else | for the session |
| `bong-api.bcserver.xyz/api/v1/devices/bind-by-phone` | provisioning | once per test account |

That is the whole list. Verified live while writing this — the OTA endpoint
answers `{"websocket":{"url":"wss://bong-ai-esp.bcserver.xyz/xiaozhi/v1/","token":""}}`
and sends `Access-Control-Allow-Origin: *`, so it needs no proxy.

---

## What this deletes

Measured, not estimated:

| Area | Files | Lines |
|---|---|---|
| Lesson engines + parsers + player + tests | `src/lessons/*` | 3,557 |
| Story loader + SRT parser | `src/content/*` | 331 |
| Auth + STT + most of the API client | `src/api/*` | 394 |
| Parent login drawer panel | `src/dev/auth-panel.tsx` | 164 |
| HTTP telemetry | `src/protocol/telemetry-client.ts` | 72 |

4,518 of the tree's 9,670 lines, and with them: the placeholder resolver,
the three question types, the retry counter, the `values_from` category cache,
the FunASR upload, the group player's `decodeAudioData` path, and the four-way
CORS problem that produced `nginx.conf`. All of it is logic the server already
owns.

It also deletes a class of bug we have been living with. The browser engine and
the server FSM disagreed on things like extra-part rotation and branch audio
selection; whichever one a tester was looking at, the other was the one shipping.

### What we lose, honestly

The local engine is currently the only way to open a lesson's `metadata.json`
and watch it run — content QA for a newly imported lesson, before anyone wires
it into a session. After this change, a broken lesson is only visible through
the server, and a server-side orchestrator failure is indistinguishable from a
content failure.

That is a real cost and the reason Phase 5 exists: do not delete until the
server path has been shown to run the same lesson end to end.

---

## Protocol delta

### New inbound frames (from the 25/08 changelog, `send_image_message`)

xiaozhi-server sends **all three of these for the same image**, deliberately, so
that ESP32 firmware, the web simulator and the mobile app each find a spelling
they understand:

```json
{"type": "image", "url": "https://…/praise.gif", "session_id": "…"}
{"type": "gif",   "url": "https://…/praise.gif", "session_id": "…"}
{"type": "custom", "session_id": "…",
 "payload": {"action": "show_image", "image_url": "https://…/praise.gif",
             "gif_url": "https://…/praise.gif"}}
```

`src/protocol/message-types.ts` handles none of them. It knows `display`,
`display_expression` and `display_image` — three spellings the comment there
correctly notes have never been seen on the live socket. These three have been
seen; they are what the server actually emits.

Because all three arrive back to back for one image, the device must **collapse
them**, or the screen takes three identical updates.

The plan called for a dedupe window keyed on `(url, session_id)`. What shipped is
simpler and strictly better: `reduceDisplay` returns the *same state object* when
asked to show an image that is already up, so the second and third frames are
no-ops and React skips the render. No timers, no remembering what arrived when,
and the reducer stays a pure function of the frame — which is the property that
makes the whole display testable.

The one thing this gives up: re-showing the same picture cannot restart an
animated GIF. That would need a real clear first, and the server has never sent
one.

### Frames we already send, and their new significance

| Frame | Was | Becomes |
|---|---|---|
| `listen`/`detect` + `text` | typing to test chat | **how a mode starts** — the LLM routes the phrase to the orchestrator plugin |
| `listen`/`start` mode auto | hands VAD to the server | unchanged, and now also serves `await_answer` |
| `battery` | belt and braces alongside HTTP | the only telemetry path |
| `button` | ditto | ditto |
| `abort` | barge-in | also how a child abandons a lesson |

`sendText` in `simulator-store.ts:297` already does the `listen`/`detect` thing.
Starting a lesson is a one-line call, not a subsystem.

---

## Open questions — verify against xiaozhi-server first

**The `xiaozhi-esp32-server` repo is not in this workspace.** Everything below
is read off the backend changelog and architecture doc, which describe that
repo's behaviour without being it. Clone it next to the other three and confirm
before writing code:

1. **What phrase actually triggers the orchestrator?** The architecture doc uses
   *"bắt đầu bài học tiếng Anh về chào hỏi"* and *"tiếp tục bài học ngày hôm qua"*.
   Whether the plugin matches on keywords or the LLM function-calls it decides
   whether the dev drawer ships fixed phrases or a free-text box.
2. **How does the device learn it should open the mic for `await_answer`?**
   The directive schema carries `ui_hint: "listening"` and `timeout_ms`, but the
   changelog's `execute_directives` loop shows no frame being sent for it. If the
   server just relies on auto-VAD, we need nothing. If it sends something, we
   need to handle it. This is the single biggest unknown.
3. **Does anything clear the image?** `send_image_message` only ever sets. There
   is no "no image" frame in the changelog. Proposed device rule below.
4. **Does the orchestrator run on `bong-ai-esp.bcserver.xyz`,** or only on a
   local xiaozhi-server? If only local, Phase 5 needs a local stack and Phase 6
   cannot land until the shared host is updated.
5. **Is `child_id` resolved server-side from the bound device?**
   `StartSessionRequest` requires both `device_id` and `child_id`; the device
   only knows its MAC. `bind-by-phone` attaches a child, so presumably the
   orchestrator looks it up via `/internal/device-proxy/children` — confirm.

---

## Phases

### Phase 1 — Accept the image frames ✅

`src/protocol/message-types.ts`, `src/screen/face-state-machine.ts`.

Add `ImageIn`, `GifIn`, `CustomIn` to `IncomingMessage`, and extend
`toDisplayCommand` to normalise all three into the existing
`{ kind: 'image'; url }` command. The face state machine and `round-screen.tsx`
already render `face.imageUrl` — nothing downstream changes.

Collapse the triple by making the reducer idempotent, not by dedupe bookkeeping.
Unit-tested: three frames, one state change, asserted on reference equality.

Clearing rule, since the server has no clear frame: hold the image until another
image arrives, or until the session ends (`hello` on reconnect, or `abort`).
Do **not** clear on `tts stop` — the changelog's flow sends the image *with* the
audio, so clearing at end of speech would blank the screen mid-lesson.

Independent of everything else. Ship it first, it's useful either way.

### Phase 2 — Mode entry becomes an intent ✅

`src/screen/menu.tsx`, `src/screen/menu-state.ts`, `src/store/simulator-store.ts`.

`chooseMode('lesson')` stops opening a picker and constructing a `LessonRunner`.
It sends `{type:'listen', state:'detect', text:'<intent phrase>'}` and then does
nothing else — the badge waits for the server like it waits for any reply.

The three mode rows stayed on the glass; the per-lesson picker did not. See the
decision section below.

### Phase 3 — Provisioning replaces login ✅

`src/dev/auth-panel.tsx` → a bind panel.

Real firmware authenticates with a MAC and a device token, never a phone and a
password — the old plan says so and then, for want of an alternative, shipped a
login form anyway. `POST /api/v1/devices/bind-by-phone` is the alternative. Give
it a registered parent phone and it upserts a `UserDevice`, attaches a child,
and returns `device_id`, `device_token`, `child_id`, `child_name`.

This is a *flashing* operation, not a runtime one: done once per test account,
stored in localStorage, and the result is what `hello` carries. Model it that
way in the UI — a "provision this badge" panel, not a session.

Two backend notes:
- The endpoint has **no auth** and rotates `device_token` on every call. Fine for
  a dev harness; do not build anything on the token being stable.
- It returns `websocket_url: "ws://127.0.0.1:8003/xiaozhi/v1/"`, hardcoded in
  `device_service.py`. Ignore that field. OTA is the source of truth.

### Phase 4 — Telemetry over the socket only ✅

Delete `src/protocol/telemetry-client.ts` and its two `fetch` calls. `WsClient`
already has `sendBattery` and `sendButton`; the server now has somewhere to put
what they carry — `/internal/device-proxy/telemetry` landed on 25/08 and writes
`battery_level`, `wifi_rssi`, `is_charging`, `ip`, `ssid` onto `UserDevice`.

Worth confirming xiaozhi-server actually forwards our `battery` frame to it. If
it does not, that is a xiaozhi-server gap to file, not a reason to keep the HTTP
call — the real badge has no HTTP client either.

### Phase 5 — Parity, before deleting anything ⛔ not done

This was written as "run the lesson through both engines and diff them", and
that is no longer possible — Phase 6 landed first, on instruction, so there is
no local engine left to diff against. What remains is a correctness check
against a live deployment, and it is the last thing standing between this branch
and "lesson mode works":

- does a lesson start at all from the intent phrase
- do the clips play in order, and does the audio arrive as Opus on the socket
- a wrong answer, then a second, then a third — does it retry and then move on
- do images appear, and does the screen update once rather than three times
- does it end, with a score

The packet inspector is the instrument; it logs every frame in both directions.
A device that is bound (see Phase 3) and still gets no lesson points at the
phrase or at the orchestrator, and the `stt` frame carrying
`% start_learning_session` is how you tell those apart — if it is there, the
routing worked and the problem is downstream.

**Until this passes, lesson mode on this branch is untested, not working.**

### Phase 6 — Remove the local engine ✅ (ahead of its gate)

Delete `src/lessons/`, `src/content/`, `src/api/stt-client.ts`,
`src/api/auth-client.ts`, and the lesson half of `src/api/api-client.ts`
(the request helper and token store stay for `bind-by-phone`).

`src/audio/` keeps everything: `mic-capture`, `vad`, `turn-controller`,
`opus-player` and the worklet are the badge's own hardware and are unaffected.
`GroupPlayer` goes with `src/lessons/` — it was the mp3 path, and there are no
mp3s any more.

### Phase 7 — Shrink both proxies ✅

With the CDN, STT and lesson APIs gone, `vite.config.ts` and `nginx.conf` need
one route between them: `/api` → `bong-api.bcserver.xyz`, for `bind-by-phone`.
Delete `/cdn`, `/stt`, `/media` from both. Keep the two files in step — the
comment at the top of each says why.

This is what makes the `Unexpected token '<'` class of failure impossible rather
than merely fixed.

### Phase 8 — Docs ✅

`README.md` loses "Server-driven screen content" as an aspiration and gains it
as a description. Mark `plan-app-modes-on-device.md` superseded at the top,
pointing here — it stays for the measurements in it, which are still the best
record of why lesson audio needs a signed-in account.

---

## The decision, and how it went

**Did a lesson picker survive on the glass?**

The old plan was already uneasy about it: *"no real badge has this menu … it
belongs to the same family as `src/dev/`, not to the firmware being simulated."*
Under a thin device that discomfort becomes structural — a picker needs lesson
titles, titles come from the catalog, and the catalog is a CDN fetch, which is
the exact dependency this plan removes. There is no device-facing catalog
endpoint to replace it with: `/internal/device-proxy/catalog` requires internal
auth, and the `GET /api/v1/devices/catalog` the changelog advertises **does not
exist in the code** — the route in `devices.py` is offline flash assets, and the
test is `test_device_proxy_catalog.py`, not `test_device_catalog.py`.

**Decided: the picker is gone, the three mode rows stayed.** Picking a mode on
the glass now sends its phrase and closes; there is no second screen and no
catalog fetch. The dev drawer gained **Ý định**, an intent box with presets and
free text, because the phrases are matched by a language model and the first
thing you want when one stops routing is to try three more.

The rows survived because they cost nothing once the catalog dependency is gone —
they are three constants in `MODE_INTENTS` — and they keep the demo watchable
without opening the drawer.

The alternative — keeping `/cdn` alive purely so a menu could list lesson titles —
was rejected: it preserves the fiction that the badge browses a catalog, and it
keeps the proxy surface that caused the production failure.

---

## What is left

1. **Clone `xiaozhi-esp32-server`** and answer the five questions above. Question
   2 is the one that could still require code.
2. **Run the parity check** (Phase 5) against a deployment with the orchestrator
   live. There is no local engine left to diff against, so it is now a
   correctness check rather than a comparison: does a lesson play, do wrong
   answers retry, do images appear, does it end with a score.
3. **Delete the speculative display family** (`display` / `display_expression` /
   `display_image`) once the proven one has been seen working. Both are accepted
   today, which is two code paths for one feature.
