# Multi-OBS Web Controller — Design Spec

**Date:** 2026-05-01
**Status:** Draft, pending user review
**Repo:** reStrikeOMC (currently a fork of OBS Blade — Flutter mobile app for single-instance OBS control)

## 1. Goal

Build a **local web app** that controls **multiple OBS Studio instances simultaneously** over `obs-websocket` v5, with multi-select fan-out for any control: select a set of instances, click "Scene 1" once, the request is dispatched to every selected instance in parallel.

The new app is a separate codebase added alongside the existing Flutter project (which keeps shipping as the mobile companion). The web app is **not** a port of the Flutter UI — it is purpose-built for desktop multi-instance use, reusing the same OBS-control feature set.

## 2. Non-goals (explicit cuts for v1)

- Twitch / YouTube / Owncast chat integration.
- Source-filter editor (filter visibility may be readable, but no settings UI).
- Persisted historical stream/record statistics with charts.
- Theme customization, intro tour, in-app purchases.
- TriggerHotkeyByKeySequence (only TriggerHotkeyByName is supported).
- Per-user role-based access control (single role: any logged-in user can do anything).
- Optimistic UI updates for fan-out commands.
- Mobile responsive layout (desktop-first; tablet works but not optimized).

## 3. Decisions captured during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Tight MVP — control surface only | Match what users actually click during a live show; defer everything else |
| UX model | **Hybrid** — per-tile controls + global command bar | Per-tile = direct visibility & one-instance tweaks; global bar = explicit multi-target fan-out |
| Deployment | **Shared LAN control panel** from day 1 | Backend on a NUC/VPS on LAN, multi-operator, web UI on `0.0.0.0` |
| Failure model | **Best-effort fan-out** with per-target failure indicators | Lowest friction; failures are visible and recoverable |
| Auth | **Named users + individual passwords**, single role | Audit log of "who triggered what" is a real requirement; roles are overkill |
| Selection scope | **Per-operator** (session-keyed) | Operators don't interfere with each other's broadcast groups |
| Stack | Lean & explicit | Vite + React + shadcn frontend; Fastify + native `ws` + better-sqlite3 backend; obs-websocket-js for OBS protocol; pnpm workspace |

## 4. Feature inventory ported from the Flutter app

The current mobile codebase (`lib/`) implements an extensive obs-websocket v5 client. The MVP carries this subset:

**Connection management**
- Saved connections (host/port/password/name) — persisted server-side now (was Hive on mobile).
- LAN autodiscovery via socket-scan of port 4455 across `/24` subnet (lifted from `lib/utils/network_helper.dart`); opt-in, runs on backend.
- obs-websocket v5 handshake (Hello/Identify/Identified, ops 0/1/2) and SHA256(secret + challenge) auth — handled by `obs-websocket-js`.

**Per-instance control surface (per Flutter `lib/views/dashboard/`)**
- `SetCurrentProgramScene`, `SetCurrentPreviewScene`
- `SetStudioModeEnabled`, `TransitionToProgram`, `SetCurrentSceneTransition`, `SetCurrentSceneTransitionDuration`
- `SetSceneItemEnabled` (per scene item)
- `SetInputMute`, `SetInputVolume`, `SetInputAudioSyncOffset`
- `ToggleStream`, `ToggleRecord`, `ToggleRecordPause`, `ToggleReplayBuffer`, `SaveReplayBuffer`, `ToggleVirtualCam`
- `TriggerHotkeyByName`
- `SetCurrentSceneCollection`, `SetCurrentProfile`
- `GetSourceScreenshot` (low-FPS preview poll, default 2 FPS, configurable)

**Multi-instance fan-out**
- All of the above can target N instances at once.
- Fan-out shape: `{ targets: [connId, ...], action, payload }` → `{ ok: [...], failed: [{ connId, error }] }`

**Read-only state shown per tile**
- Current program scene + preview scene (if studio mode)
- Active outputs (live / recording / replay buffer / virtual cam) with elapsed time
- Per-input mute + dB level + 50 Hz meter (coalesced server-side to ~30 Hz)
- 1 Hz stats badge (FPS, CPU, kbit/s) — same `GetStats`/`GetStreamStatus`/`GetRecordStatus` batch as the Flutter app does

**Persisted (SQLite)**
- Users (id, username, bcrypt password, created_at).
- Connections (id, name, host, port, encrypted password, created_at).
- Audit log (id, ts, user_id, action, targets JSON, result JSON).
- Sessions (id, user_id, expires_at).

## 5. Architecture

```
                            LAN
   ┌──────────────────────────────────────────────────────┐
   │   ┌──────────────┐   ┌──────────────┐   ┌────────┐   │
   │   │ OBS host A   │   │ OBS host B   │   │  ...   │   │
   │   │  obs-ws:4455 │   │  obs-ws:4455 │   │        │   │
   │   └──────▲───────┘   └──────▲───────┘   └────▲───┘   │
   │          │ ws (obs v5)      │ ws (obs v5)    │ ws    │
   │   ┌──────┴──────────────────┴────────────────┴────┐  │
   │   │     Node.js backend (single process)         │  │
   │   │   ┌──────────────────┐  ┌──────────────────┐  │  │
   │   │   │ ConnectionMgr    │──│ EventCoalescer   │  │  │
   │   │   └────────┬─────────┘  └────────┬─────────┘  │  │
   │   │   ┌────────▼─────────────────────▼─────────┐  │  │
   │   │   │   StateStore (latest known truth)      │  │  │
   │   │   └────────┬───────────────────────────────┘  │  │
   │   │   ┌────────▼─────────┐  ┌──────────────────┐  │  │
   │   │   │ WS Hub (browser) │  │ Fastify HTTP API │  │  │
   │   │   └────────▲─────────┘  └────────▲─────────┘  │  │
   │   │   ┌────────▼─────────────────────▼─────────┐  │  │
   │   │   │   SQLite (users, conns, audit, sess.)  │  │  │
   │   │   └─────────────────────────────────────────┘  │  │
   │   └────────────────┬─────────────────────────────┘  │
   │           ┌────────▼─────────┐ ┌──────────────┐    │
   │           │ Browser (op. 1)  │ │ Browser (..) │    │
   │           │ React + shadcn   │ │              │    │
   │           └──────────────────┘ └──────────────┘    │
   └──────────────────────────────────────────────────────┘
```

**Three logical layers in one Node process:**

1. **OBS edge** — `ConnectionManager` owns N persistent obs-websocket-js connections. Auto-reconnect with exponential backoff (1 s → 30 s cap, jittered). `EventCoalescer` is a per-instance buffer holding the latest known scene/input state and meter samples; it flushes diffs to the central `StateStore` at most ~30 Hz.

2. **State + commands** — `StateStore` is the in-memory authoritative truth: scenes, current program/preview scene, inputs (mute, volume, levels), outputs (live/recording/replay/vcam), per-instance health flag (`connected` / `degraded` / `disconnected` / `auth_failed`). The `CommandBus` accepts fan-out requests, dispatches via `ConnectionManager`, returns `{ ok, failed }`.

3. **Client edge** — Fastify serves a small HTTP API (auth, connections CRUD, audit log) and a `ws` server for live state push. Each authenticated browser joins a "user room" keyed by `userId`. The Vite-built frontend is served as static assets from the same process in production (separate dev server in development).

**Scaling target:** ~10 OBS instances × ~5 concurrent browser clients on a LAN. Memory budget is trivial; the only hot stream is the meter event firehose, which the coalescer handles.

## 6. Components

```
reStrikeOMC/
├── apps/api/                    Backend (Node + Fastify + ws)
│   └── src/
│       ├── obs/
│       │   ├── connection-manager.ts   Owns N obs-websocket-js clients; reconnect w/ backoff
│       │   ├── event-coalescer.ts      Per-instance ring buffer; emits diffs at ~30 Hz
│       │   └── command-bus.ts          Fan-out dispatcher; returns {ok, failed} envelope
│       ├── state/
│       │   ├── state-store.ts          Authoritative in-memory state of all instances
│       │   └── session-store.ts        Per-user selection + UI prefs (memory + cookie)
│       ├── realtime/
│       │   ├── ws-hub.ts               Browser WS server; per-user rooms; broadcasts diffs
│       │   └── protocol.ts             Zod envelopes for client↔server messages
│       ├── auth/
│       │   ├── sessions.ts             @fastify/cookie + bcrypt; session table
│       │   ├── users.ts                User CRUD; first-run admin bootstrap
│       │   └── audit.ts                Append-only audit-log writer
│       ├── db/
│       │   ├── sqlite.ts               better-sqlite3 wrapper + migration runner
│       │   └── migrations/             Versioned schema files
│       ├── discovery/
│       │   └── lan-scanner.ts          Optional LAN scan for port 4455 (background, opt-in)
│       ├── routes/                     Fastify route modules (login, connections, audit, users)
│       └── index.ts                    Bootstrap; serve static web build in prod
│
├── apps/web/                    Frontend (Vite + React + shadcn + Tailwind)
│   └── src/
│       ├── lib/
│       │   ├── realtime/client.ts      WS client; reconnect; outgoing command queue
│       │   ├── realtime/store.ts       Zustand store hydrated from WS diffs
│       │   └── api/client.ts           Fetch wrapper for HTTP; TanStack Query keys
│       ├── features/
│       │   ├── auth/                   Login screen, session bootstrap
│       │   ├── connections/            CRUD UI, autodiscovery panel, test-connect button
│       │   ├── dashboard/
│       │   │   ├── dashboard-page.tsx  Top-level layout
│       │   │   ├── instance-tile.tsx   One card per OBS instance (preview + controls)
│       │   │   ├── command-bar.tsx     Global multi-target action bar (uses selection)
│       │   │   └── selection.ts        Per-operator selection store
│       │   ├── audit/                  Read-only event log
│       │   └── settings/               Preview FPS, theme, change password
│       ├── components/
│       │   ├── ui/                     shadcn primitives (generated, owned)
│       │   └── obs/                    OBS composites: SceneButton, AudioFader, OutputToggle, PreviewImage, FailureBadge
│       ├── app/                        Router, root layout, auth guard
│       └── main.tsx
│
└── packages/shared/             Zod schemas + types reused both sides
    └── src/
        ├── protocol/messages.ts        Server↔client WS envelope schemas
        ├── protocol/commands.ts        One Zod schema per OBS action (fan-out payloads)
        ├── types/state.ts              Instance state shape (scenes, inputs, outputs)
        ├── types/connection.ts         Saved-connection shape
        └── types/auth.ts               User + session shapes
```

**Key boundaries**

- `ConnectionManager` is the **only** module that talks to obs-websocket. Everything else uses `CommandBus` + `StateStore`. Swap or mock either to test the rest.
- `WS Hub` and `HTTP routes` both depend on `Auth` for session validation but otherwise share no code.
- `packages/shared` has zero runtime deps beyond Zod — pulled by both api and web at build time, eliminating type drift.
- Browser holds **zero** OBS-protocol knowledge; it speaks the backend's command envelope only.

**File-size budget:** target <300 lines per module; if `state-store.ts` or `connection-manager.ts` grows past that, split by role (e.g. `state-store/scenes.ts`, `state-store/inputs.ts`).

## 7. Data flow

### 7.1 State in (OBS → browser)

```
obs-websocket event ──▶ ConnectionManager.onEvent(connId, event)
                              │
                              ▼
                   EventCoalescer.merge(connId, patch)        (in-memory, latest wins)
                              │  flushes at ~30 Hz per instance
                              ▼
                   StateStore.apply(connId, diff)
                              │
                              ▼
                   WS Hub broadcasts {type:"state.diff", connId, diff}
                              │
                              ▼
                   Each browser updates its Zustand store; affected tiles re-render
```

- `InputVolumeMeters` (50 Hz) is **only** coalesced — never persisted, never logged. Coalescer drops everything but the latest sample per input between flushes.
- Scene/scene-item/output state changes bypass throttling — they flush immediately because they're rare and user-visible.
- **Initial sync per instance:** on first connect, `ConnectionManager` issues a batched `GetSceneList` + `GetInputList` + `GetSpecialInputs` + `GetSceneItemList` (per scene) + `GetStudioModeEnabled` + four output-status requests. The batch result hydrates `StateStore` before any diff is broadcast — browsers either see "instance still connecting" or full state, never half-populated.

### 7.2 Command out (browser → OBS, fan-out)

```
User clicks "Scene 1" on a tile while 3 instances are selected
                              │
                              ▼
   Browser ws msg: {type:"cmd", id:<uuid>, action:"SetCurrentProgramScene",
                   targets:[connA,connB,connC], payload:{sceneName:"Scene 1"}}
                              │
                              ▼
   WS Hub validates session → CommandBus.dispatch(...)
                              │
                              ▼
   Promise.allSettled over targets via ConnectionManager
                              │
                              ▼
   Result aggregated → {ok:[connA,connB], failed:[{connId:connC, error:"..."}]}
                              │
                              ▼
   Audit row written: {userId, ts, action, targets, result}
                              │
                              ▼
   WS Hub replies {type:"cmd.result", id, ok, failed}
                              │
                              ▼
   Browser updates spinner; failed instances flash red
   (state diffs from successful instances arrive separately via 7.1)
```

- **No optimistic UI** in MVP. Buttons spin until result; actual state change comes via Flow A.
- **Single-target commands** (per-tile click with no multi-selection) use the same path with `targets:[connId]` — no separate code path.
- **No retries.** Fan-out actions are user intent; the user decides whether to retry.

### 7.3 Selection (per-operator)

- Lives in browser-side Zustand store, persisted to `localStorage` keyed by user ID.
- Mirrored to backend `SessionStore` on change so audit rows record what was selected at action time.
- Other operators do not see another operator's selection — only the OBS state itself is shared.

### 7.4 Auth flow

- `POST /api/auth/login` → bcrypt compare → set `httpOnly` session cookie → server-side session row in SQLite (24 h sliding expiry).
- WebSocket upgrade reads the cookie; rejects connection if no valid session. Reconnects re-validate.
- `POST /api/auth/logout` deletes the session row, clears the cookie, closes all WS connections for that session.
- First-run bootstrap: if `users` table is empty on startup, the API serves a one-time `/setup` page to create the initial user account.

## 8. Error handling

| Failure | Detection | Behavior | UI |
|---|---|---|---|
| OBS connection drops | `ConnectionClosed` event from `obs-websocket-js` | State → `disconnected`, exponential-backoff reconnect (1 s → 30 s, jittered) | Tile shows "reconnecting…", controls greyed |
| OBS auth rejected | Identify response code `4009` / similar | State → `auth_failed`, **no** reconnect | Tile shows "auth failed — edit connection" |
| Per-target command failure | `Promise.allSettled` rejected leg | Aggregate into `failed[]` with `{ SceneNotFound \| InputNotFound \| RequestTimeout \| Disconnected }` + raw msg | Red dot + tooltip on the failing tile |
| Browser WS disconnect | Client reconnect loop (250 ms → 5 s) | On reconnect, send `{type:"sync"}`; server replies with full snapshot | Pending command spinners cleared after 10 s with "request lost" toast |
| Backend crash / restart | N/A (process exits) | SQLite preserves users/connections/sessions/audit; in-memory state recomputed via initial sync per connection | Browsers reconnect, see "reconnecting…" briefly per tile |
| Stale connection | No events + missed `GetStats` for 10 s | State → `degraded` (yellow) → eventually `disconnected` once WS closes | Yellow badge on tile |

**Logging discipline**

- All OBS errors logged with `connId`, request type, error code.
- All fan-out commands logged regardless of outcome (audit table is the truth; app log is for debugging).
- Passwords masked before any log.
- No stack traces shipped to the browser — generic error codes only.

## 9. Testing

**Unit (Vitest, fast, run on every save).**
- `event-coalescer`: enqueue 1000 meter events, assert flush emits exactly one diff per instance per flush window with the latest values.
- `command-bus`: mock `ConnectionManager.send`; run fan-out across 3 fake targets where one rejects; assert the `{ok, failed}` envelope shape and that the audit hook is called.
- `state-store`: apply a sequence of diffs, assert resulting snapshot.
- `auth/sessions`: bcrypt round-trip, cookie set/clear, expired-session rejection.
- Zod schemas in `packages/shared`: contract tests pinning the wire format so changes are visible in PR diffs.

**Integration (Vitest + a mock obs-websocket server).**
- In-process `ws` server mimicking the obs-websocket v5 handshake and a few request/response pairs (Hello/Identify/Identified, GetSceneList, SetCurrentProgramScene).
- Drive `ConnectionManager` against it: validate auth flow, reconnect-on-drop, disconnect cleanup.
- End-to-end: HTTP login → WS connect → send `cmd` → assert the mock OBS received the right request.

**E2E (Playwright, one happy-path test).**
- Start the API process pointing at a single mock OBS server, build & serve the web app from API in production mode.
- Test: log in → add a connection → see it connect → click a scene button → assert the active-scene badge updates within 1 s.
- One test only — point is to catch wiring bugs (build artifacts, cookie domain, WS path), not duplicate unit coverage.

**Out of scope:** real-OBS-Studio CI integration; load tests; visual regression tests.

**Coverage target:** 80% on the backend; opportunistic on the frontend (component tests where logic is non-trivial — selection store, fan-out result rendering).

## 10. Tech stack summary

| Layer | Choice |
|---|---|
| Frontend bundler | Vite |
| Frontend framework | React + TypeScript |
| UI library | shadcn/ui (generated, owned) + Tailwind |
| Frontend state | Zustand (UI/selection), TanStack Query (HTTP reads) |
| Frontend realtime | Native `WebSocket` against backend |
| Backend runtime | Node.js LTS (>=20) |
| Backend framework | Fastify + TypeScript |
| Browser-facing realtime | `ws` (native WebSocket server) |
| OBS protocol | `obs-websocket-js` |
| Persistence | better-sqlite3 (single file) |
| Auth | `@fastify/cookie` + `bcrypt`, session rows in SQLite |
| Validation | Zod (shared between client and server) |
| Test runner | Vitest (unit + integration), Playwright (E2E) |
| Workspace | pnpm workspace |

## 11. Open questions for v1.x (deferred from MVP)

- Saved "selection groups" / presets (e.g. "all main streams", "all backups")
- Filter-management UI (read filter list, toggle, edit settings)
- Persisted historical stream/record stats with charts (port `lib/models/past_stream_data.dart`)
- Optimistic UI for fan-out commands
- Role-based access control (read-only operator role)
- HTTPS via self-signed cert for LAN deploys
- Hidden scenes per connection (port `lib/models/hidden_scene.dart`)

## 12. Build sequence (informational — actual plan in writing-plans output)

Suggested coarse order, finalized in the implementation plan:

1. Workspace + shared package + Zod protocol skeleton.
2. SQLite + auth + first-run setup (no OBS yet).
3. `ConnectionManager` + `obs-websocket-js` against a mock server (no UI yet).
4. `StateStore` + `EventCoalescer` + `WS Hub` — backend can broadcast state to a curl-driven WS client.
5. Frontend skeleton: login + connections CRUD + a single read-only instance tile.
6. Per-tile control surface (scenes, audio, outputs) — single-instance fan-out.
7. Selection store + global command bar — multi-target fan-out.
8. Audit log viewer.
9. LAN autodiscovery (opt-in).
10. Polish pass — preview FPS slider, error toasts, settings.
11. Playwright happy-path E2E + manual smoke against real OBS.
