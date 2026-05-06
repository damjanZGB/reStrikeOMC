# reStrikeOMC — Session Handoff

**Last updated:** 2026-05-05
**Branch:** `master`
**Last commit:** `2cadbb7 feat(web): Canvas-based VU meter with IEC dB zones and peak hold`

---

## Resume here (next session)

### 1. Verify Phase 1 + Phase 2 visually against the real LAN

This is the gate before starting Phase 3. The dev server should already be running
(see [Run the app](#run-the-app)). Open http://localhost:5173 against actual OBS
instances on the LAN and confirm:

- **Phase 1 (data accuracy)** — mute states and volumes match the real OBS
  state on each instance, both at first paint and after live changes (toggle a
  mute or move a fader in OBS itself, dashboard updates within ~33 ms).
- **Phase 2 (VU meters)** — thin colored bar appears below each volume slider,
  green up to -20 dB, yellow to -9 dB, red above. Peak-hold line lingers and
  decays. Muted inputs render at 30% opacity. No-data inputs show track only.

If anything's off, fix it before Phase 3 — theming on top of broken data is wasted work.

### 2. Then execute Phase 3 — dark studio theme

The proposal is approved (see [Phase 3 spec](#phase-3-spec) below).
This is one commit covering the token palette + minimal component application.

---

## Project context (one paragraph)

reStrikeOMC is a multi-OBS web controller. Node.js Fastify API (`apps/api`) +
React/Vite frontend (`apps/web`) + shared Zod-typed protocol (`packages/shared`).
Connects to multiple OBS Studio instances on a LAN via obs-websocket v5,
fans out commands, and broadcasts a coalesced state stream to all dashboards.
Auth is cookie sessions over HTTPS-or-localhost; OBS passwords are encrypted
at rest in SQLite via PBKDF2-derived AES key.

---

## Phase status

| Phase | Status | Commit |
|---|---|---|
| 1 — Audio data pipeline accuracy fix (4 bugs) | ✅ shipped, awaiting visual verification | `e07e9ce` |
| 2 — VU meter component (Canvas + rAF + dB zones) | ✅ shipped, awaiting visual verification | `2cadbb7` |
| 3 — Dark studio theme + semantic state colors | ⏳ approved, not started | — |

### Phase 1 recap — what shipped

Four interrelated bugs caused "all audio sources at 100% unmuted" symptom.
Commit `e07e9ce`:

| Bug | File | Fix |
|---|---|---|
| A | `apps/api/src/state/event-coalescer.ts` | `InputMuteStateChanged` / `InputVolumeChanged` translators were returning `inputs: []`. Now return real `{ name, muted }` / `{ name, volumeMul, volumeDb }` partials. |
| B | `apps/api/src/obs/connection-manager.ts` `fetchSnapshot` | Only fetched `GetInputList`. Now also fans out `GetInputMute` + `GetInputVolume` per input via `Promise.allSettled`. |
| C | `apps/api/src/obs/connection-manager.ts` `openOnce` | `client.connect()` used the obs-websocket-js default subscription, which excludes `InputVolumeMeters`. Now passes `EventSubscription.All \| EventSubscription.InputVolumeMeters`. |
| D | `apps/api/src/state/event-coalescer.ts` `translateMeters` | Returned a full `InputState` with `muted=false, volumeMul=0` defaults — would have clobbered live state 30×/sec. Now returns `{ name, levels }` only. |

Schema change (`packages/shared/src/types/state.ts`): added `InputStatePartialSchema`,
override `InstanceStateDiffSchema.inputs` to use it. The store keys by input
name and merges per-field with nullish-coalesce — same pattern that fixed
output-state in commit `9e5976f`.

Mock-server (`apps/api/src/obs/mock-server.ts`): added `setInputMute` /
`setInputVolume` test seeders, `emitMeters` helper, `GetInputMute` /
`GetInputVolume` handlers. `SetInput*` now mutates state and emits change events.

Tests: `apps/api/src/obs/audio-scenarios.test.ts` — 4 user-scenario tests
pinning each bug. Full api suite: 100 passing (was 96).

### Phase 2 recap — what shipped

`apps/web/src/components/vu-meter.tsx` — Canvas-based meter with IEC dB zones
and peak hold. Wired into `audio-mixer.tsx` beneath each volume slider.
Commit `2cadbb7`.

- Linear OBS multiplier → dBFS via `20 * Math.log10(mul)`, clamped to `[-60, 0]`.
- Three color zones: green to -20 dB, yellow to -9 dB, red above.
- Painted as backing gradient with doubled stops at breakpoints — colors stay
  anchored to dB positions regardless of bar width.
- Peak hold: per-channel max with 0.5 dB/frame decay (≈30 dB/s), drawn as 1 px line.
- Multi-channel inputs stack vertically, 1 px gaps.
- Muted → 30% opacity. Empty `levels[]` → track only.
- rAF-driven; reads latest levels via `useRef` so the loop never re-binds.

Pure helpers (`mulToDb`, `dbToPosition`, `decayPeak`) are exported and tested
in `apps/web/src/components/vu-meter.test.ts` — 15 cases.

CSS vars `--vu-green`, `--vu-yellow`, `--vu-red`, `--vu-track` live in
`apps/web/src/globals.css` and are read via `getComputedStyle` so Phase 3's
broader theme change can retune the palette without touching the component.

Volume readout next to each fader now shows percent **and** dB
("75% · −2.5 dB"). Mute reads as "−∞ dB".

---

## Phase 3 spec

**Goal:** dark-first studio aesthetic, semantic state colors,
2 px tile accent stripe + status dot. Light theme out of scope.

### Token palette (HSL — drops into `apps/web/src/globals.css`)

```css
/* Surfaces */
--bg            : 220 18%  8%;   /* app background */
--surface-1     : 220 16% 11%;   /* tile / card */
--surface-2     : 220 14% 15%;   /* hovered tile, modal */
--surface-3     : 220 12% 19%;   /* input fields, dropdowns */
--border        : 220 10% 22%;
--border-strong : 220 10% 30%;

/* Text */
--fg        : 210 25% 96%;
--fg-muted  : 220 10% 65%;
--fg-subtle : 220  8% 50%;

/* Primary action — used sparingly */
--primary    : 200 95% 55%;   /* cyan — "broadcast / signal" */
--primary-fg : 220 30%  8%;

/* Semantic state colors */
--state-live    :   0 75% 55%;   /* streaming on */
--state-record  : 350 75% 55%;   /* recording */
--state-replay  :  45 95% 55%;   /* replay buffer armed */
--state-vcam    : 260 70% 65%;   /* virtual cam */
--state-preview : 145 60% 50%;   /* preview safe */
--state-warn    :  30 95% 55%;
--state-bad     :   0 85% 55%;   /* error / disconnected */
--state-ok      : 145 50% 45%;   /* connected idle */

/* VU zones — already in globals.css from Phase 2; keep values */
--vu-green  : 145 65% 45%;
--vu-yellow :  45 95% 55%;
--vu-red    :   0 75% 55%;
--vu-track  : 220 14% 14%;
```

### Tile state stripe priority

Each connection tile gets a 2 px left-edge accent stripe colored by the
highest-priority active state:

```
live > recording > replay armed > connected > preview > disconnected > auth_failed
```

Plus an 8 px status dot in the tile header. Pulse animation when live or recording.

### Implementation steps

1. Replace HSL values in `apps/web/src/globals.css` `:root` and `.dark` blocks.
2. Extend `apps/web/tailwind.config.ts` with named colors so components write
   `bg-surface-1`, `text-fg-muted`, `bg-state-live`, `bg-vu-green`, etc.
3. Apply semantic colors only where they communicate state:
   - Tile header (status stripe — new component or inline)
   - Tile header (status dot)
   - Audio mixer mute button (uses `--state-bad` when muted)
   - Connection list (status indicator)
4. Don't mass-refactor — most components keep current Tailwind usage.

### Tests

- Visual: take a Playwright screenshot before/after to confirm contrast.
- Accessibility: confirm WCAG AA contrast on `--fg` over `--surface-1`
  (should be ~13:1) and on `--state-*` over `--surface-1`.

---

## Run the app

### First-time setup (already done on this machine)
- `apps/api/.env` exists with random 64-char hex secrets for both
  `SESSION_COOKIE_SECRET` and `CONNECTION_PASSWORD_KEY`. Gitignored.
- `**/.env` and `.claude/` are in `.gitignore`.

### Daily workflow
```bash
# api dev (auto-loads .env via Node --env-file flag forwarded by tsx)
pnpm dev:api

# web dev (Vite, HMR)
pnpm dev:web
```
- API: http://localhost:8080 (also listening on LAN IPs)
- Web: http://localhost:5173

If api crashes with `SESSION_COOKIE_SECRET must be set...`, the `.env` file is missing.
Regenerate with: `node -e "const c=require('crypto'); console.log('SESSION_COOKIE_SECRET='+c.randomBytes(32).toString('hex')+'\nCONNECTION_PASSWORD_KEY='+c.randomBytes(32).toString('hex'))" > apps/api/.env`
then add `PORT=8080`, `HOST=0.0.0.0`, `DB_PATH=./data/restrike.db`.

### Tests + build
```bash
pnpm test         # full monorepo test suite (currently 100 api + 33 web = 133)
pnpm build        # full TypeScript + Vite build
pnpm bundle       # produce portable Desktop bundle (dist-bundle/)
```

---

## Open tasks (TaskList)

| ID | Status | Subject |
|---|---|---|
| #62 | pending | Playwright dashboard test against primed mock |
| #63 | pending | Opt-in real-OBS integration test (gated on `RESTRIKE_REAL_OBS_HOST`) |
| #65 | pending | Theming proposal — superseded by Phase 3 (this doc) |
| #68 | pending | Phase 3: Dark studio theme + semantic state colors |

Tasks #60, #61, #64, #66, #67 are completed.

---

## Recent commits

```
2cadbb7 feat(web): Canvas-based VU meter with IEC dB zones and peak hold
e07e9ce fix(state,obs): correct audio pipeline — mute, volume, and meters
663db22 test(obs): realistic-OBS scenario fixtures + 6 output-state regression tests
ee453e6 chore(dev): autoload api .env and ignore local secrets
9e5976f fix(state): correct output-state pipeline (initial fetch + per-key merge)
6945afa feat(api,bundle): defensive boot + diagnostic survival
0dbeaf5 feat: per-connection lifecycle + edit UI + custom-port discovery
ca49cf0 fix(web,api): empty-body Content-Type and SPA fallback decorateReply
```

---

## Key files (where to look)

### Audio pipeline (Phase 1)
- `packages/shared/src/types/state.ts` — `InputStatePartialSchema`,
  `InstanceStateDiffSchema.inputs` override
- `apps/api/src/state/state-store.ts` — `mergeInputs`, `applyDiff`
- `apps/api/src/state/event-coalescer.ts` — translators for
  `InputMuteStateChanged` / `InputVolumeChanged` / `InputVolumeMeters` /
  `InputCreated` / `InputNameChanged`; `translateMeters`
- `apps/api/src/obs/connection-manager.ts` — `EVENT_SUBSCRIPTIONS` const,
  `fetchSnapshot` (two-stage Promise.allSettled), `SnapshotInput`
- `apps/api/src/state/wire.ts` — uses real mute/volume from snapshot
- `apps/web/src/realtime/use-ws.ts` — frontend mirror of `mergeInputs`
- `apps/api/src/obs/mock-server.ts` — test infra: `setInputMute`,
  `setInputVolume`, `emitMeters`, `GetInputMute`, `GetInputVolume`
- `apps/api/src/obs/audio-scenarios.test.ts` — 4 user-scenario regression tests

### VU meter (Phase 2)
- `apps/web/src/components/vu-meter.tsx` — component + math helpers
- `apps/web/src/components/vu-meter.test.ts` — 15 helper tests
- `apps/web/src/components/audio-mixer.tsx` — integration point
- `apps/web/src/globals.css` — `--vu-*` CSS vars

### Realistic-OBS scenarios (Tasks #60, #61)
- `apps/api/src/obs/scenarios.ts` — composable mock states
- `apps/api/src/obs/scenarios.test.ts` — 6 output-state regression tests

---

## Open observations and follow-ups

- **AudioMixer doesn't filter to audio-capable inputs.** It renders a row for
  every input regardless of `kind`. Currently benign because non-audio inputs
  get default mute/volume values from `Promise.allSettled` rejections in the
  snapshot. Would be cleaner to filter on `kind` (`wasapi_*`, `coreaudio_*`,
  `pulse_*`, `dshow_input`, etc.) on the frontend or at the wire layer.
- **Bug C regression test isn't truly end-to-end.** The mock-server doesn't
  enforce `EventSubscription` filtering, so meter events flow even without the
  subscription bit. Test #4 in `audio-scenarios.test.ts` verifies the pipeline
  works *given* events arrive, not that the subscription request was correctly
  formed. Code review + Phase 2's manual visual check is the actual safety net.
- **Tile filtering of audio inputs by kind** could move to the api-side
  snapshot to reduce wire chatter. Defer until profile shows it matters.
- **Light theme** is intentionally not in scope for Phase 3. Add later only if
  there's a real use case (control rooms run dark).

---

## How to use this doc

When you start a new session: read this top-to-bottom, then check
`git log --oneline -5` to confirm the head still matches "Last commit" above.
If it doesn't, somebody (probably you) committed in between — re-read the
diff before continuing.

Update this file as work progresses. Keep it under ~400 lines; if it grows,
split per-phase docs into `docs/handoff/` and link them.
