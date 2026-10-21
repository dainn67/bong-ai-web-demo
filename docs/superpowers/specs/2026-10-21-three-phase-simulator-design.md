# Three-Phase V3 Simulator Design

## Purpose

Make `bong-ai-web-demo` the browser reference implementation for the V3 device
contract. It must let the team validate a released manifest and its scenes end
to end before handing the same contract to IoT. The simulator is a test tool;
it is not a second product UI and does not choose a learning or talk mode for a
child.

## Scope

Included:

- Script-driven execution across GĐ1, GĐ2, and GĐ3 capabilities.
- Browser simulation of device storage, encrypted blobs, sync, and journey
  telemetry.
- A repeatable E2E fixture proving the customer handoff flow.
- Clear capability and diagnostic reporting when an API or browser capability
  is missing.

Excluded:

- Firmware implementation, ESP32 audio timing, Secure Boot, eFuse, or real
  hardware touch/SD validation.
- Changes to backend API contracts except test fixtures or mock responses in
  the simulator.
- A consumer-facing menu that lets a child select a mode outside a scene.

## Product Rules

1. The manifest and scene graph are the source of truth. A boot begins at
   `START`; only `go`, `next`, or a branch may enter another scene; the
   terminal route is `END#finished` or `END#idle`.
2. A `talk` block is a step capability, not a top-level simulator mode. The
   standalone Free Talk panel remains a diagnostic harness and is visibly
   labelled as such.
3. Every network-affecting action exposes the effective provider, model,
   fallback, elapsed time, request identity, and actionable failure state.
4. A simulator result is a contract result, never evidence that the physical
   firmware has passed its hardware acceptance criteria.

## Capability Matrix

| Stage | Simulator must execute | Observable proof |
|---|---|---|
| GĐ1 | Manifest, scene loading, audio/visual queues, `listen` modes, retry, branches, local SD cache | Step timeline, normalized reply, branch target, cached asset/hash |
| GĐ2 | `test`/`live`, device auth simulation, wrapped content key, encrypted BONG asset, incremental sync and journey outbox | Active channel, key/asset status, sync acknowledgement and persisted journey lines |
| GĐ3 | `pet`, bounded `talk`, `lists`, `seed`, `sys.last_utterance`, handoff into and out of an AI turn | Turn budget, transcript/seed, returned branch, scene transition and final journey event |

## Architecture

The existing `V3EngineProvider` remains the single runtime owner. It owns scene
state, memory, asset playback coordination, and journey sequence numbers.
Network and browser-only work move behind small adapters so the engine can run
the same fixture with an in-memory fake or the real backend.

### Runtime units

- `src/v3/use-script-engine.ts`: deterministic state transitions only. It
  accepts normalized input/turn results and emits typed execution events; it
  does not create form data or call `fetch`.
- `src/v3/device-contract-client.ts`: one browser adapter for manifest, auth,
  key retrieval, blob fetch, `/listen`, `/talk/*`, and `/sync`. Each response
  is normalized into simulator types and retains diagnostics.
- `src/v3/capability-matrix.ts`: declares the phase required by each scene
  capability and reports unsupported or unavailable prerequisites before a
  step starts.
- `src/v3/e2e-fixtures.ts`: immutable manifest/scenes and backend responses
  for regression scenarios, including the customer handoff fixture.
- `src/v3/e2e-runner.ts`: drives a fixture through the engine with injected
  device input and asserts terminal state and emitted journey events.
- `src/v3/script-engine-panel.tsx`: execution studio; displays a timeline,
  capability state, diagnostics, and fixture runner. It cannot manually
  select a free-talk mode.
- `src/v3/talk-simulator-panel.tsx`: explicit API diagnostic harness only;
  it uses the same contract client, labels itself as a harness, and is not in
  the normal device path.

## Data Flow

```text
boot → manifest/channel/auth/key sync → START scene
     → step audio/visual → listen or talk capability
     → normalized result → branch/next target
     → ... → END#finished or END#idle
     → journey outbox → /device/sync acknowledgement
```

For a talk step, the engine calls `start`, repeatedly submits captured or
fixture audio/text to `turn`, and calls `end` exactly once on an exit branch.
The client returns `branch`, `transcript`, `reply`, `topic`, `tts_left`,
`seed`, and diagnostics. The engine stores `sys.last_utterance` from the most
recent child transcript. A handoff seed is passed to the next script step;
the engine does not invent an AI answer locally.

## Customer E2E Fixture

The fixture is named `start-haha-magic-book-end` and uses only released-scene
syntax:

1. `START#kiemtra` plays its audio and branches to `HAHA`.
2. `HAHA#quiz` accepts the child utterance: “Bằng 4. Vậy đố cậu biết tại sao
   trời lại có mưa?”. The configured classifier result is `reply: correct`
   with `handoff.seed: tại sao trời lại có mưa?`.
3. The branch enters `SACH_KY_DIEU#answer`. Its `talk` step starts with the
   seed, receives a bounded answer, records `sys.last_utterance`, and exits on
   `answer`.
4. The branch enters `END#idle`; `idle` plays once, advances to `finished`,
   and `finished` terminates. `END#finished` must never point to itself.

The fixture must run with a fake client in unit tests and against a selected
backend environment from the Studio. The latter is an integration check and
must be reported separately from deterministic unit results.

## Error Handling

- A missing required capability stops before the step and records a structured
  `error` journey line with `where`, `code`, scene, and step.
- A recoverable unavailable service routes only through an authored
  `error`/`silent`/`default` branch. It may not jump to `END` silently.
- A failed blob/hash/key operation leaves the previous valid cache untouched.
- A talk start failure does not reserve an unclosed talk sequence; a failed
  turn retains the current step and exposes retry/exit controls.
- Replaying an acknowledged journey line is safe; only unacknowledged lines
  are submitted by sync.

## Acceptance Criteria

1. The normal simulator boot has no top-level free-talk selector; normal free
   talk begins only on a scene `talk` step.
2. The fixture reaches `END#finished` once, plays each END audio once, and
   emits exactly one `session_end` line.
3. The fixture’s talk handoff carries the child’s final question as its seed;
   it does not pass the preceding answer as the seed.
4. The Studio visibly distinguishes deterministic fixture, real-backend
   integration, and physical-firmware validation states.
5. Unit tests cover all three stages and error paths; browser mic/audio
   remains a manual integration check documented in the UI.

## Test Strategy

- Unit: capability gating, engine transitions, END termination, fixture event
  sequence, BONG key/blob cache behavior, sync idempotency, and client response
  normalization.
- Component: Studio timeline/diagnostics and harness labelling using mocked
  contract client responses.
- Integration: manually select the live/test backend, execute the fixture,
  inspect `X-Bong-*` headers and journey acknowledgement.
- Hardware handoff: export a fixture execution report containing manifest
  version, scene versions, requested/actual providers, and journey session ID;
  IoT runs the same scenario on firmware separately.

## Non-Goals and Compatibility

Existing lesson/story menu experiments remain development tools and must not
be treated as V3 device UX. The legacy xiaozhi socket continues to be useful
for chat diagnostics but is not the GĐ3 `talk` contract. Existing saved
Virtual SD caches are versioned/migrated rather than discarded without notice.
