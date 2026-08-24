# Plan — App modes on the badge screen

Goal: a menu on the circle screen offering **Bài học** (lessons), **Trò chuyện**
(free talk) and **Đọc truyện** (stories), each running to completion inside the
240px display, behaving like the Flutter parent app.

Source of truth for the behaviour being ported: `../mobile-flutter`, especially
`docs/lesson-flow.md` and `lib/features/learning/domain/flow/`.

---

## Two things this plan is not

**The menu does not exist on real hardware.** The badge has one button and a
touch screen; there is no mode picker in firmware, and the shipping design has
the *server* choose the mode. This menu is a test affordance that happens to be
drawn inside the circle because that is where it needs to be exercised. Treat it
like `src/dev/` — instrumentation, not simulation.

**Parent login lives in the dev drawer, never on the glass.** Real firmware
authenticates with a MAC address and a device token, not a phone number and a
password. Putting a login form on the badge screen would simulate something that
cannot exist. The drawer holds the credentials; the circle screen only ever sees
the *results* of being signed in.

---

## Why login is unavoidable for lessons

Not because of the grading APIs. Because of the audio URLs.

Measured on `Unit-01-Day-02` (117 nodes, a real shipping lesson): **110 of its
166 clips carry a placeholder in the URL — 66%.**

```
.../English/Vocative/{userPhone}/V008.mp3     ← recordings that say the child's name
.../OT2/{voiceID}/B2_1.mp3                    ← the parent-chosen voice
```

`{userPhone}` and `{voiceID}` resolve from the signed-in account at parse time.
Without one, the resolver returns null and the engine — by design, spec §8.3 —
**silently drops the clip**. An unauthenticated lesson does not fail visibly. It
plays two-thirds silence, which is worse than not running.

The question endpoints are a footnote next to that: roughly 10 of ~110 nodes per
lesson are questions, and câu hỏi 1 (3–6 per lesson) needs no network at all.

Every `/lessions/*` route is `require_active_subscription` — signed in **and**
paying. An expired subscription fails exactly like a bug, so the drawer must
show subscription state prominently.

---

## Phase 0 — Unblock the network

Four hosts, four different CORS stories. Verified with `curl -H Origin:`:

| Host | Serves | CORS | Action |
|---|---|---|---|
| `pub-…r2.dev` | lesson mp3 clips | `ACAO: *` | **none — fetch directly** |
| `static-bongai.bcserver.xyz` | catalog, metadata, SRT, `data/index.json` | none | proxy |
| `files.bcserver.xyz` | story mp3 | none | proxy (only if decoding) |
| `bong-api.bcserver.xyz` | auth + lesson APIs | allows `:3000`, `:5173`, `bong-ai.bcserver.xyz` — **not `:5180`** | proxy |
| `mini-3000.bcserver.xyz` | FunASR STT | none for `:5180` | proxy |

Add to `vite.config.ts`:

```
/api  → https://bong-api.bcserver.xyz
/cdn  → https://static-bongai.bcserver.xyz
/stt  → https://mini-3000.bcserver.xyz
/media→ https://files.bcserver.xyz
```

Two notes worth writing down now:

- The lesson clips needing **no** proxy is lucky and load-bearing — they are the
  bulk of the bytes, and they stream straight into `decodeAudioData`.
- **This is dev-only.** `npm run build` output served from anywhere else hits the
  same wall. Either ask backend to whitelist the sim's origin, or accept that the
  built bundle can't do lessons. Decide before anyone demos from `dist/`.

---

## Phase 1 — Auth, in the drawer

New: `src/api/api-client.ts`, `src/api/auth-client.ts`, `src/dev/auth-panel.tsx`

- `POST /api/v1/auth/login` with phone + password → access + refresh token
- `GET /api/v1/profile` → the account the lessons need:
  `phone` (→ `{userPhone}`), `voiceId` (→ `{voiceID}`), `bongVolume`
  (→ `{bongVolume}`), `aiNickname`, `child{id,name,nickname}`
- Tokens in `localStorage` (this is a test tool; there is no keychain and no
  pretence of one)
- Single-flight refresh on 401, mirroring the app's `AuthTokenStore`

The panel shows: signed-in phone, child name, **subscription status and expiry**,
and the resolved `voiceId`/`bongVolume`. Those four lines are the difference
between "lessons are broken" and "the subscription lapsed on Tuesday".

---

## Phase 2 — The menu on the glass

New: `src/screen/menu-state.ts` (pure), `src/screen/menu.tsx`

`menu-state.ts` is a reducer like `face-state-machine.ts` — closed → mode list →
lesson picker → running — so it tests in Vitest without a DOM, same as the rest
of `src/screen/`.

Opening it: **long-press the existing rim button** rather than adding a second
control. The button already classifies press duration (`classifyPress`), a
mode picker is a deliberate act, and it keeps the glass free of chrome that
firmware doesn't have. Short press keeps its current meaning.

The list renders inside the 240px circle: big rows, scrollable, Vietnamese
labels, one tap to enter.

**Modes are mutually exclusive.** Entering a lesson or a story must disconnect
the xiaozhi socket first — otherwise two pipelines fight over the speaker and
the failure looks like an audio bug.

---

## Phase 3 — Catalog

New: `src/lessons/catalog.ts`

`GET /cdn/lessions/lessions.json` → `{config:{base_url}, stories[], learning[]}`,
flattened exactly as `LessonStaticApi.listLessons` does. Currently 3 stories and
14 learning lessons. `data_url` + `base_url` → `metadataUrl`.

No auth on this call — the catalog loads signed out, which is what lets the menu
render before anyone logs in.

---

## Phase 4 — Đọc truyện (do this first)

The cheapest mode and the honest vertical slice: it exercises menu → catalog →
picker → player → captions → exit with **zero auth surface**.

New: `src/content/srt.ts` (pure parser + `indexForPosition`), `src/content/story-player.ts`

The three stories are v1 format: one `audio_url` plus a `transcript_url` SRT.
Play it, highlight the current cue in the Bống bubble, done. No mic, no LLM.

Ship this before touching the lesson engine. If the menu plumbing is wrong,
finding out here costs an afternoon instead of a week.

---

## Phase 5 — Lesson engine

The big one. Port from Dart, preserving the pure/impure split the repo already
uses — engine logic pure and unit-tested, side effects in the store.

| New file | Ports from | Carries |
|---|---|---|
| `src/lessons/lesson-node.ts` | `lesson_node.dart` | metadata parse, `nodeTypeFromVi` / `branchTypeFromVi` fuzzy Vietnamese matching, the `useRawKey` branch-key rule, loose duration parsing |
| `src/lessons/lesson-graph.ts` | `lesson_graph.dart` | group-by-`order`, `allAudioUrls`, `referencedDataCategories` |
| `src/lessons/placeholder.ts` | `lesson_placeholder.dart` | `{values.*}`, `{data.*}`, `{value}` — **null on unresolved** |
| `src/lessons/graph-engine.ts` | `lesson_graph_engine.dart` (792 lines) | the state machine |
| `src/lessons/linear-engine.ts` | `lesson_linear_engine.dart` | v1 — 4 of 17 catalog entries still use it |

Three things must survive the port intact:

1. **The generation counter.** Every supersede (skip, interrupt, exit) bumps
   `_gen`; every async continuation checks `_stale(gen)` before touching state.
   This is what makes the engine safe under a child mashing the screen.
2. **Never dead-end.** Empty graph → finish silently. 404 clip → skip to next.
   Unresolvable placeholder → drop that clip. Grader down → treat as wrong.
   Classifier timeout → `silent`. Authoring cycle → stop at 500 nodes. Mic denied
   is the *only* error screen.
3. **`{value}` lives exactly one group.** `_branchValuePending` is set when a
   value-bearing branch is chosen, consumed by that branch's first group, and
   cleared by every other group. Get this wrong and stale values leak forward.

Tests (pure, no DOM): branch-name mapping including the deliberate
`dung → im lang → sai → phan hoi` order, placeholder resolution and its null
cases, the winner rule, and each safety fallback.

---

## Phase 6 — Group audio player

New: `src/lessons/group-player.ts` — ports `lesson_group_audio_player.dart`.

One order-group = several clips playing concurrently, each with its own `delay`,
`volume`, `startOffset`, `maxDuration`, `fadeIn`, `fadeOut`. Wait for all to
drain; the "winner" is the clip that has a `next` and finished last.

Use **Web Audio** (`AudioBufferSourceNode` + `GainNode`), not `<audio>` — exact
sample-accurate offsets and real gain ramps, which `<audio>` cannot do. Requires
`fetch` + `decodeAudioData`, which is fine: the clip host already sends `ACAO: *`.

Preload every clip in `allAudioUrls` up front, as the Dart player does, so nodes
play instantly instead of stalling ~3s each on network.

---

## Phase 7 — Mic turn + STT

| New file | Ports from | Notes |
|---|---|---|
| `src/audio/vad.ts` | `silence_vad.dart` | RMS 600 speech / 300 silence / 800ms hangover. Pure, testable. |
| `src/audio/turn-controller.ts` | `vad_turn_controller.dart` | `maxUtterance` 20s from speech start, `maxListen` 10s if no speech ever comes. Pure. |
| `src/audio/wav.ts` | `pcm_wav.dart` | PCM16 → WAV |
| `src/api/stt-client.ts` | `server_stt_service.dart` | `POST /stt/api/stt/transcribe`, multipart WAV |

The existing `mic-capture.ts` encodes Opus for xiaozhi. Lessons need **raw PCM16**
to send to STT, so the worklet output is tapped before the encoder rather than
after — a second consumer of the same stream, not a second capture.

Silero is not worth porting. The app treats the RMS VAD as its fallback, and for
a test harness the fallback is the right amount of machinery.

---

## Phase 8 — The three question types

- **Câu hỏi 1** — local. Speech detected AND text contains a letter or digit
  (`\p{L}\p{N}`) → `responded`, else `silent`. No network.
- **Câu hỏi 2** — `POST /api/v1/lessions/check-text`, multipart
  `lesson_id`/`part_id`/`text`. Backend holds the answer; never send one.
  Silence short-circuits before the call. API failure → treat as wrong, toast.
- **Câu hỏi 3** — `POST /api/v1/lessions/classify`, JSON
  `instruction`/`branches[]`/`child_text`/`values_from?`. Gate at
  `confidence < 0.7` → default branch (`other`, else `unclear`, else `silent`).
- **read / save** — `GET`/`POST /api/v1/lessions/data/{category}` (`mode=append`),
  plus `GET /cdn/data/index.json` for the shared `common` value lists.

**Fix the timeout contradiction while porting.** The Dart engine aborts classify
at 10s while its own HTTP client allows 25s and its comment says classify
"routinely takes ~9s" — so a valid slow answer is thrown away as silence. Pick
one number ≥ 25s here and note the divergence from the app.

---

## Phase 9 — Trò chuyện

Wiring only. The xiaozhi socket the simulator already speaks *is* free talk;
the app's `/live_chat/ws` is a different server behind a parent JWT and a live
subscription, and rebuilding on it would be strictly worse. The menu entry
connects the socket that already exists.

---

## Phase 10 — Progress (optional)

`POST /api/v1/lessions/progress` on entry and completion, resume by top-level
integer `order` from `timestamp_ms`. Skip on the first pass — it changes nothing
about whether a lesson plays correctly, and it is the easiest piece to add later.

---

## Order of work

```
0 proxy  →  4 stories  →  1 auth  →  3 catalog  →  2 menu
                              ↓
              5 engine  →  6 player  →  7 mic  →  8 questions
                              ↓
                     9 free talk  →  10 progress
```

Phase 4 before phase 1 is deliberate: stories need no login, so they prove the
menu and the player while the auth surface is still unwritten.

---

## Known hazard already in the tree

`handleMessage` in `src/store/simulator-store.ts` clears the idle timer on every
message but re-arms it only on `tts.stop`. A frame arriving inside the 1s linger
strands the face in `emotion`. Harmless today; a lesson pushes far more frames
through that path, so fix it before phase 5 rather than debugging it there.


---

## Build notes (what changed against the plan)

Written after implementing it, so the plan and the code do not drift.

**The menu opens on a hold whether or not the badge is awake.** The plan said
long-press; it did not say what happens asleep. Verifying found the gap: a story
disconnects the socket while it plays, so after exiting one the badge is asleep
and a hold would have woken it instead of opening the menu — leaving the child
with no route back. Nothing in the menu needs the socket, so the hold now opens
it either way. Goodbye still needs the badge awake, because there is nothing to
say goodbye to otherwise.

**A real touch bug, found while verifying.** The display called
`setPointerCapture` on every pointer starting inside it. That retargets the
pointer *and the click derived from it* to the container, so a menu row drawn
inside the display never received its own click. On hardware the child taps a
lesson and nothing happens. The glass now bails before capturing whenever an
overlay owns it.

**STT field name.** The service wants `audio`, not `file`. It reports
`{"loc": ["body", "audio"]}` for anything else. Verified against the live
endpoint, which returns `{text, raw_text, emotion, events}`.

**Timeout divergence, deliberate.** `CLASSIFY_TIMEOUT_MS` is 30s here, and the
engine imposes no second shorter one. The app aborts at 10s while its own client
allows 25s and its comment says classify "routinely takes ~9s", so a valid slow
answer is discarded as silence there. Noted so the difference is a decision, not
a drift.

**Not verified.** Lesson playback end to end — that needs a parent account with
an active subscription. The signed-out path is verified: the catalog lists all
14 lessons and picking one reports that login is required. Everything from
loading metadata onward is covered by unit tests against fakes (31 of them,
including every never-dead-end rule), not by a live run.

**Harness gotchas**, all cost real time, none were product bugs:
- CDP `pointerType: 'touch'` on `dispatchMouseEvent` skips the click synthesis a
  real touchscreen performs, so `onClick` handlers never fire. Use plain mouse.
- The 3s press debounce is real firmware behaviour. A test that mashes gets
  throttled and looks like a dead button.
- `innerText` applies CSS `text-transform`; an assertion on the authored casing
  silently misses an uppercased header. Use `textContent`.
- Re-measure element coordinates before every press. Waking shifts the layout.
