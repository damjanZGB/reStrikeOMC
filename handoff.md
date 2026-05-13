# reStrikeOMC — Session Handoff

**Last updated:** 2026-05-13
**Branch:** `master`
**Last commit:** `0e6fd30 fix(obs): harden v4 client against 5 P0 defects surfaced by audit`

---

## Resume here (next session)

### LAN verification of v4 protocol coexistence (shipped 2026-05-13)

The obs-websocket v4 legacy protocol now ships alongside v5. Verification
against a real v4 instance has not been done yet:

- [ ] Connect to an OBS Studio 27.x (or v28+ with the legacy compat plugin)
      via the Add Connection dialog with protocol set to `v4`.
- [ ] Mute / unmute an input — the dashboard tile reflects the new state
      within ~33 ms.
- [ ] Switch scenes in OBS — `CurrentProgramSceneChanged` propagates.
- [ ] Start/stop streaming + recording — the badges flip.
- [ ] Toggle the virtual camera — the badge follows (5 s polling lag is
      expected; that's a known v4-protocol limitation).
- [ ] Run "Discover LAN" with the Port field blank — both 4444 and 4455 are
      probed and results carry the detected protocol badge.

Phase 1–3 audio/visual work from the previous session is also still awaiting
real-LAN verification — see the original checklist at the bottom of this
file.

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
| 3 — Dark studio theme + semantic state colors | ✅ shipped, awaiting visual verification | `ec9b3b4` |
| 4 — obs-websocket v4 legacy protocol coexistence | ✅ shipped, awaiting real-v4 verification | `698b9cc` |

### Phase 4 recap — what shipped (v4 protocol)

Hand-rolled v4 client + translation layer + dual-protocol discovery +
per-connection protocol field + global default setting. Design doc at
`docs/superpowers/specs/2026-05-13-obs-ws-v4-design.md`.

Six commits (`fae6c9e..698b9cc`):

| Commit | Phase |
|---|---|
| `fae6c9e` | design doc |
| `4420e75` | `IObsClient` interface, manager refactor (no behavior change) |
| `c0b35fa` | v4 wire client, translation tables, v4 mock |
| `90b7a17` | migration 002 + protocol field + `app_settings` + settings API |
| `a56c622` | dual-port discovery + WS handshake protocol detection |
| `698b9cc` | frontend protocol UI + `/settings` page |

Test counts: api 100 → 180 (+80), shared 17 → 19 (+2), web 44 → 44 (UI
not yet tested). Total 117 → 243.

Key code:
- `apps/api/src/obs/clients/types.ts` — `IObsClient`, `AuthFailedError`
- `apps/api/src/obs/clients/v5-client.ts` — passthrough adapter
- `apps/api/src/obs/clients/v4-client.ts` — wire protocol + auth +
  scene-item cache (gap fix #1) + 5s vcam poll (gap fix #3)
- `apps/api/src/obs/clients/v4-translate.ts` — request/response/event
  translation, audio-kind filter
- `apps/api/src/obs/clients/v4-protocol.ts` — frame types + sha256 auth
- `apps/api/src/obs/mock-server-v4.ts` — v4 mock for tests
- `apps/api/src/db/migrations/002_v4_protocol.sql` — `protocol` column +
  `app_settings` table seeded with `defaultProtocol='v5'`
- `apps/api/src/settings/repo.ts` — `SettingsRepo.resolveProtocol(row)`
- `apps/api/src/routes/settings.ts` — `GET`/`PUT /api/settings`
- `apps/api/src/discovery/scan.ts` — `probeWsV5` / `probeWsV4` /
  `detectProtocol` + dual-port `scanLan`
- `apps/web/src/components/protocol-badge.tsx` — v4/v5/default pill
- `apps/web/src/pages/settings.tsx` — global default dropdown

Resolution semantics: `effective = row.protocol ?? settings.defaultProtocol`.
Resolved in 3 places: POST/PATCH connection routes, `/test`, boot-time
hydration loop in `index.ts`. **Changing the global default does NOT
re-resolve already-connected rows** — they keep their existing slot until
manually reconnected. Documented in Settings page copy.

Accepted v4 limitations: no real-time VU meters (v4 has no
`InputVolumeMeters` stream; only mute matters per design), no
`VirtualcamStateChanged` event (synth via 5s poll), `SetSceneItemEnabled`
requires the per-scene id→name cache populated by snapshot + kept in sync
by `SceneItemAdded`/`Removed`/`SourceRenamed` events.

### Phase 4 gap punch list (from post-merge reviewer audit, 2026-05-13)

Three review agents (silent-failure hunter, architecture/type review,
test-coverage analyzer) ran against the merged work. Findings ranked by
severity below — none block the feature shipping but each will eventually
manifest as a user-visible bug.

**P0 — real defects (✅ all 5 fixed in commit `0e6fd30`, 2026-05-13):**
1. ✅ **Reconnect-while-disconnecting race.** Fixed by binding
   `handleClose` to its specific WebSocket and bailing when `this.ws`
   has been reassigned; `primeVcamPoll`/`primeSceneItemCache` also
   re-check `this.closing` after every await. Pinned by
   `v4-client.test.ts: "does not leak the vcam poll timer when disconnect
   runs mid-prime"` + `"survives a connect → disconnect → connect cycle
   without clobbering ws"`.
2. ✅ **`SceneItemAdded`/`SceneItemRemoved` events wired into
   `maintainCachesFromEvent`.** Pinned by the two new tests in the
   `ObsV4Client — events` describe.
3. ✅ **Malformed-JSON frames emit `ConnectionError`.** Pending requests
   still time out at 8 s, but the parse failure now has a forensic
   trail. Pinned by `"emits ConnectionError when the server sends a
   malformed JSON frame"`.
4. ✅ **`handleClose` skips drain when `this.closing` is true.** Pinned
   by `"does not double-iterate pending on disconnect"`.
5. ✅ **End-to-end PATCH-protocol → reconnect → v4 wire test.** Added
   to `settings.test.ts` — switches a connection from v5 to v4 against
   the appropriate mock and asserts the v4 mock received `SetCurrentScene`
   (v4 wire vocab), proving the translator is in the path.

api suite: 180 → 187 (+7 hardening tests). No network code touched.

**P1 — latent / narrow trigger:**
6. Boot-time hydration of v4 rows is untested (`index.ts:110-133`).
7. `translateResponse` returns `null` for write commands → caller
   receives raw v4 frame keys via the `?? raw` fallback in `call()`.
8. `AUDIO_KINDS` allowlist omits `mac_capture`, NDI, BlackMagic,
   `pulse_default` — `SourceCreated` events for those drop silently.
9. Asymmetric error surface: v4 emits payload-less `ConnectionError`;
   `v5-client.ts` installs no error listener at all.
10. `runAuth` localization-fragile `/auth/i.test(msg)` heuristic.
11. No route-level test for `/api/connections/:id/test` against a v4
    server with auth required.

**P2 — observability + doc:**
12. Zero logging in any of the v4 files — every `catch {}` is
    forensically silent.
13. Global default change doesn't re-resolve live NULL-protocol slots.
    Documented in UI copy; not pinned by a test.
14. Dual-port scan branch (no `?port=` param) isn't covered.
15. `ConnectionManager.call()` against a v4 slot isn't integration-tested.
16. Zero web tests for `ConnectionsPage` / `SettingsPage` / `ProtocolBadge`.
17. Numeric coercion edge cases in `translateResponse` (volume=NaN →
    -100 dB, indistinguishable from mute).
18. `v4-client.test.ts` reaches into private `pollVcamOnce` via `as any`.

Recommendation: fix P0 items 1, 2, 3, 4 in a follow-up branch
(`feat/obs-ws-v4-hardening`), add the missing integration tests from
items 5 + 6 + 11 in the same branch. P1 items 7-10 are worth a second
branch. P2 are documentation / observability work; can be deferred.

## Verification checklist

Open http://localhost:5173 against real OBS instances on the LAN.

**Phase 1 — accuracy**
- [ ] Mute states match the real OBS state per instance (first paint + after toggle in OBS).
- [ ] Volume sliders + dB readouts match OBS (e.g. -6 dB shows "50% · −6.0 dB").
- [ ] Multi-input setups show all visible audio sources (not just default Mic).
- [ ] Live changes propagate within ~33 ms (move a fader in OBS, dashboard tracks it).

**Phase 2 — VU meters**
- [ ] Thin bar (~6 px) below each volume slider when audio is playing.
- [ ] Green up to -20 dB, yellow to -9 dB, red above.
- [ ] Peak-hold line lingers ~1.2 s and decays.
- [ ] Muted inputs render at 30% opacity.
- [ ] Stereo inputs show two stacked bars with 1 px gap.

**Phase 3 — theme**
- [ ] App background is deep blue-black, not pure black or white.
- [ ] Tile cards have 2 px left-edge accent stripe colored by state.
- [ ] Status dot in tile header pulses when live or recording.
- [ ] STREAM/REC/REPLAY/VCAM badges are colored when active, dim when off.
- [ ] Connection status text (connected/connecting/auth_failed) uses semantic colors.
- [ ] No remaining `text-green-600` or `text-amber-600` flat-color flashes.

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

### Phase 3 recap — what shipped

Commit `ec9b3b4`. Dark studio palette + semantic state colors.

**Tokens** in `apps/web/src/globals.css`:
- Surfaces: `--background` (220 18% 8%), `--card` (220 16% 11%), plus aliases
  `--surface-1..3` for finer hierarchy.
- Text: `--foreground` (210 25% 96%), `--muted-foreground` (220 10% 65%),
  new `--fg-subtle` (220 8% 50%).
- Primary: cyan (200 95% 55%) — broadcast/signal accent.
- Semantic state (`--state-*`): live (red), record (magenta), replay (amber),
  vcam (purple), preview (green), warn (orange), bad (red), ok (subtle green).
- VU zones (`--vu-*`) — unchanged from Phase 2.

App is dark-by-default: `<html class="dark">` in `index.html`, and `:root`
carries identical tokens to `.dark` so a missing class doesn't flash light.

**Tailwind extension** in `apps/web/tailwind.config.js`: exposes the new
tokens as named utilities (`bg-surface-1`, `text-fg-subtle`, `bg-state-live`,
`text-state-ok`, etc.).

**New code**:
- `apps/web/src/lib/tile-state.ts` — `getTileStateColor(live)` priority
  function (11 vitest cases pinning live > record > replay > vcam > preview
  > ok / connecting → warn / auth_failed → bad / disconnected → subtle).
- `apps/web/src/components/status-dot.tsx` — small colored dot, pulses for
  live/record, reads `--state-*` via inline style.

**Component changes**:
- `dashboard.tsx`: tile gets 2 px left-edge stripe colored by state. StatusDot
  in header. Four `OutputBadge` components (STREAM/REC/REPLAY/VCAM) replace
  the emoji indicators, pulsing for live + record. Four hardcoded
  `text-green-600/text-amber-600` → semantic `text-state-*`.
- `connections.tsx`: 2 hardcoded colors → semantic on the test-connection
  result.

Web test suite: 33 → 44 passing.

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

## Phase 3 spec (historical, now shipped)

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

Tasks #60, #61, #64, #65, #66, #67, #68 are completed.

---

## Recent commits

```
ec9b3b4 feat(web): dark studio theme + semantic state colors
6e796e4 docs: add handoff.md for session-to-session continuity
2cadbb7 feat(web): Canvas-based VU meter with IEC dB zones and peak hold
e07e9ce fix(state,obs): correct audio pipeline — mute, volume, and meters
663db22 test(obs): realistic-OBS scenario fixtures + 6 output-state regression tests
ee453e6 chore(dev): autoload api .env and ignore local secrets
9e5976f fix(state): correct output-state pipeline (initial fetch + per-key merge)
6945afa feat(api,bundle): defensive boot + diagnostic survival
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

### Theme + tile state (Phase 3)
- `apps/web/src/globals.css` — full token system (surfaces, text, semantic state)
- `apps/web/tailwind.config.js` — named color utilities for new tokens
- `apps/web/index.html` — `class="dark"` on `<html>`
- `apps/web/src/lib/tile-state.ts` — `getTileStateColor` priority function
- `apps/web/src/lib/tile-state.test.ts` — 11 priority cases
- `apps/web/src/components/status-dot.tsx` — pulsing colored dot
- `apps/web/src/pages/dashboard.tsx` — tile stripe, status dot, OutputBadge

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
