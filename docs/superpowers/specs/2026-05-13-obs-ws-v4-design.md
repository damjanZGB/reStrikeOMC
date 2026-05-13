# obs-websocket v4 legacy protocol support — design

**Status:** approved (2026-05-13)
**Branch:** `feat/obs-ws-v4-protocol`
**Owner:** Damjan

---

## Goal

Let `reStrikeOMC` control mixed fleets containing both **obs-websocket v5** (OBS
Studio 28+ built-in) and **obs-websocket v4** (the legacy plugin used by OBS
Studio 27 and earlier, plus the v4 compatibility plugin) without sacrificing
feature parity in the dashboard. Operators pick a default protocol globally and
can override per connection. Autodiscovery scans both default ports and tags
each result with its detected protocol.

## Non-goals

- v4 InputVolumeMeters / real-time VU bars (v4 has no meter event stream; mute
  state is the only audio-related v4 event we care about).
- v4 batch requests (`RequestBatch`); single requests are sufficient.
- Translating *every* v4-only request into a v5-shaped interface. The wire
  client supports only the commands listed in `packages/shared/src/protocol/commands.ts`
  plus the snapshot read-side. Anything else returns `unsupported_command`.

---

## Architecture

The current `apps/api/src/obs/connection-manager.ts` is the only file that
imports `obs-websocket-js`. Everything downstream (`event-coalescer`,
`state-store`, web `wire`) consumes already-normalized v5-shaped payloads. The
cleanest seam is therefore *inside* the per-slot client object the manager
talks to: a common interface, two implementations behind a factory, translation
hidden inside the v4 implementation.

### Module layout (new + modified)

```
apps/api/src/obs/
├── clients/
│   ├── types.ts          ← NEW. IObsClient interface, ConnectOpts, errors.
│   ├── v5-client.ts      ← NEW. Adapter wrapping obs-websocket-js.
│   ├── v4-client.ts      ← NEW. Hand-rolled v4 wire client + scene cache.
│   ├── v4-translate.ts   ← NEW. Pure functions: cmd / event / snapshot v4 ↔ internal.
│   ├── v4-protocol.ts    ← NEW. v4 frame types + sha256 auth helper.
│   └── index.ts          ← NEW. createObsClient(protocol) factory.
├── mock-server.ts        ← UNCHANGED (v5 mock).
├── mock-server-v4.ts     ← NEW. v4-protocol mock for adapter tests.
├── connection-manager.ts ← MODIFIED. Holds IObsClient instead of OBSWebSocket.
└── command-bus.ts        ← UNCHANGED.
```

### IObsClient contract

```ts
// clients/types.ts
export type ObsProtocol = 'v4' | 'v5';

export interface ConnectOpts {
  eventSubscriptions?: number; // ignored by v4 (no bitfield subscription)
}

export interface IObsClient {
  connect(url: string, password: string | undefined, opts: ConnectOpts): Promise<void>;
  disconnect(): Promise<void>;
  /** Internal (v5-vocab) command name. v4 client translates at the boundary. */
  call(requestType: string, payload: Record<string, unknown>): Promise<unknown>;
  on(event: 'Identified',       cb: () => void): void;
  on(event: 'ConnectionClosed', cb: () => void): void;
  on(event: 'ConnectionError',  cb: () => void): void;
  /** Forwarded OBS event by internal (v5) name. */
  on(event: string, cb: (data: unknown) => void): void;
  off?(event: string, cb: (data: unknown) => void): void;
}

export class AuthFailedError extends Error {
  readonly code = 4009; // mirrors v5 ConnectionError.code for handler compat
}
```

The v5 adapter is a thin pass-through; the v4 adapter does all the heavy
lifting. The manager learns about protocol only when constructing the slot.

---

## Gap fixes (decided)

1. **Scene-item id vs name mismatch.** v4 addresses items by
   `{scene-name, item: {name|id}}`; v5 uses `{sceneName, sceneItemId}`. The v4
   client keeps a stateful cache `Map<sceneName, Map<sceneItemId, sceneItemName>>`,
   populated on snapshot and refreshed via `SceneItemAdded` /
   `SceneItemRemoved` / `SourceRenamed` events. Translator looks up the name
   from cache on `SetSceneItemEnabled`. Cache miss → one-shot
   `GetSceneItemList` recovery before the request errors.
2. **No real-time VU meters in v4.** Accepted. No polling. No
   `InputVolumeMeters` events emitted from the v4 client. Mute *state* still
   propagates via `SourceMuteStateChanged` → `InputMuteStateChanged`.
3. **No `VirtualcamStateChanged` event in v4.** Per-connection 5-second poll of
   `GetVirtualCamStatus`. Emit synthesized `VirtualcamStateChanged` only on
   value flip. Cleared on disconnect. Cost: 1 req / 5s per v4 connection.
4. **`SetCurrentProgramScene` cut vs transition.** Non-issue: v5 has the same
   cut-vs-transition behaviour outside studio mode.

---

## v4 wire protocol — what `v4-client.ts` implements

### Connect + auth sequence

1. Open a plain `ws://host:port` WebSocket. No subprotocol.
2. Send `{request-type: "GetAuthRequired", message-id: "<uuid>"}`.
3. Server responds:
   - `{authRequired: false, status: "ok"}` → emit `Identified` immediately.
   - `{authRequired: true, challenge, salt, status: "ok"}` → run challenge auth.
4. Challenge auth:
   - `secret = base64( sha256( password + salt ) )`
   - `authResponse = base64( sha256( secret + challenge ) )`
   - Send `{request-type: "Authenticate", auth: authResponse, message-id: "<uuid>"}`.
5. Server responds `{status: "ok"}` → emit `Identified`. Or
   `{status: "error", error: "authentication failed"}` → throw `AuthFailedError`.

### Request/response correlation

- Every request gets a fresh `message-id` (uuid v4).
- `pending: Map<messageId, {resolve, reject, timer}>` with 8s timeout.
- On response frame with `message-id`: resolve/reject and clear timer.
- On `status: "error"`: reject with `new Error(frame.error)` carrying
  `(err as { code?: number }).code = parseInt(frame.code ?? '0')`.

### Event routing

- Server frames with `update-type` and no `message-id` are events.
- Pass `{update-type, ...rest}` to `translateEvent`. On non-null result, emit
  internal event name + payload to listeners.

### Scene-item cache (gap 1)

- On `Identified`: call `GetSceneList` then `GetSceneItemList` for every scene
  in parallel; populate `sceneItems: Map<sceneName, Map<itemId, itemName>>`.
- On event `SceneItemAdded`: add entry.
- On event `SceneItemRemoved`: drop entry.
- On event `SourceRenamed`: walk all scenes, update `itemName` where it was the
  old name.
- On event `ScenesChanged`: rebuild the cache from scratch.

### Virtual-cam poll (gap 3)

- After `Identified`, start `setInterval(5000, pollVirtCam)`.
- `pollVirtCam`: call `GetVirtualCamStatus`. If `outputActive` flipped vs last
  observation, emit synth event `VirtualcamStateChanged` with
  `{outputActive: bool}`.
- Stop interval on disconnect / `ConnectionClosed`.

---

## Translation tables — `v4-translate.ts`

Pure functions, exhaustively tested. Translator throws
`new Error('unsupported_v4_command: ' + internalName)` for unknown internal
names (defensive — should never fire because the schema gate-keeps requests).

### Request translation (internal → v4)

| Internal | v4 `request-type` | Notes |
|---|---|---|
| `SetCurrentProgramScene` | `SetCurrentScene` | `{sceneName}` → `{scene-name}` |
| `SetCurrentPreviewScene` | `SetPreviewScene` | studio-mode only |
| `SetStudioModeEnabled` | `EnableStudioMode` \| `DisableStudioMode` | branch on bool |
| `TransitionToProgram` | `TransitionToProgram` | rename `transitionDurationMs` → nested `with-transition.duration` if present |
| `SetCurrentSceneTransition` | `SetCurrentTransition` | `{transitionName}` → `{transition-name}` |
| `SetCurrentSceneTransitionDuration` | `SetTransitionDuration` | `{transitionDurationMs}` → `{duration}` |
| `SetSceneItemEnabled` | `SetSceneItemProperties` | cache lookup yields item-name; v4 payload `{scene-name, item: {name}, visible}` |
| `SetInputMute` | `SetMute` | `{inputName,muted}` → `{source,mute}` |
| `SetInputVolume` | `SetVolume` | prefer `volumeMul` → `volume`; ignore dB (v4 doesn't accept dB on SetVolume) |
| `SetInputAudioSyncOffset` | `SetSyncOffset` | `{inputName,syncOffsetMs}` → `{source, offset: ms*1_000_000}` (ns) |
| `ToggleStream` | `StartStopStreaming` | |
| `ToggleRecord` | `StartStopRecording` | |
| `ToggleRecordPause` | `PauseRecording` \| `ResumeRecording` | client tracks paused state from RecordingPaused/Resumed events; toggles |
| `ToggleReplayBuffer` | `StartStopReplayBuffer` | |
| `SaveReplayBuffer` | `SaveReplayBuffer` | |
| `ToggleVirtualCam` | `StartStopVirtualCam` | v4.9+; older servers reject with `404` — surface as error |
| `TriggerHotkeyByName` | `TriggerHotkeyByName` | `{hotkeyName}` → `{hotkeyName}` |
| `SetCurrentSceneCollection` | `SetCurrentSceneCollection` | |
| `SetCurrentProfile` | `SetCurrentProfile` | |

Snapshot reads:

| Internal | v4 | Reshape |
|---|---|---|
| `GetSceneList` | `GetSceneList` | `current-scene` → `currentProgramSceneName`; `scenes[].name` → `scenes[].sceneName`; need separate `GetPreviewScene` call for preview when studio mode is on; v4 returns `null` if disabled |
| `GetInputList` | `GetSourcesList` | filter `typeId` to audio kinds; map `{name, typeId}` → `{inputName, inputKind}` |
| `GetStreamStatus` | `GetStreamingStatus` | `{streaming, totalStreamTime}` → `{outputActive, outputDuration: totalStreamTime*1000}` |
| `GetRecordStatus` | `GetRecordingStatus` | added in v4.7; older returns 404 — fall back to `GetStreamingStatus.recording` |
| `GetReplayBufferStatus` | `GetReplayBufferStatus` | `{isReplayBufferActive}` → `{outputActive}` |
| `GetVirtualCamStatus` | `GetVirtualCamStatus` | `{isVirtualCam}` → `{outputActive}` |
| `GetInputMute` | `GetMute` | `{name,muted}` → `{inputMuted}` |
| `GetInputVolume` | `GetVolume` | `{volume,muted}` → `{inputVolumeMul, inputVolumeDb: 20*log10(volume)}` |

### Event translation (v4 → internal)

| v4 `update-type` | Internal event | Notes |
|---|---|---|
| `SwitchScenes` | `CurrentProgramSceneChanged` | `{scene-name}` → `{sceneName}` |
| `PreviewSceneChanged` | `CurrentPreviewSceneChanged` | |
| `StudioModeSwitched` | `StudioModeStateChanged` | `{new-state}` → `{studioModeEnabled}` |
| `ScenesChanged` | `SceneListChanged` | rebuild scene-item cache as side effect |
| `SceneItemVisibilityChanged` | `SceneItemEnableStateChanged` | translate item-id from cache |
| `SourceMuteStateChanged` | `InputMuteStateChanged` | `{sourceName,muted}` → `{inputName,inputMuted}` |
| `SourceVolumeChanged` | `InputVolumeChanged` | |
| `SourceAudioSyncOffsetChanged` | `InputAudioSyncOffsetChanged` | ns → ms |
| `SourceCreated` | `InputCreated` | filter on audio kind |
| `SourceDestroyed` | `InputRemoved` | |
| `SourceRenamed` | `InputNameChanged` + cache rename | |
| `StreamStarting`/`Started`/`Stopping`/`Stopped` | `StreamStateChanged` | collapse to `{outputActive}` |
| `RecordingStarting`/`Started`/`Stopping`/`Stopped`/`Paused`/`Resumed` | `RecordStateChanged` | |
| `ReplayStarting`/`Started`/`Stopping`/`Stopped` | `ReplayBufferStateChanged` | |
| `SceneCollectionChanged` | `CurrentSceneCollectionChanged` | |
| `ProfileChanged` | `CurrentProfileChanged` | |
| `Heartbeat`, `Exiting`, others | — | dropped |
| synth (5s poll) | `VirtualcamStateChanged` | gap-3 fix |

---

## Storage

**Migration `apps/api/src/db/migrations/002_v4_protocol.sql`:**

```sql
ALTER TABLE connections ADD COLUMN protocol TEXT;

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_settings (key, value) VALUES ('defaultProtocol', 'v5');
```

`protocol` is `NULL` (inherit), `'v4'`, or `'v5'`. Existing rows are NULL → use
the seeded default `'v5'` → identical behaviour pre-feature.

---

## API

### Schema (`packages/shared/src/types/connection.ts`)

```ts
export const ObsProtocolSchema = z.enum(['v4', 'v5']);

export const ConnectionConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  hasPassword: z.boolean(),
  protocol: ObsProtocolSchema.nullable(),     // NEW
});

export const ConnectionInputSchema = z.object({
  name: z.string().min(1).max(64),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(4455),
  password: z.string().max(256).optional(),
  protocol: ObsProtocolSchema.nullable().optional(),  // NEW
});
```

### New endpoints

- `GET  /api/settings` → `{defaultProtocol: 'v4'|'v5'}`
- `PUT  /api/settings` body `{defaultProtocol}` → `204` (auth-guarded)

### Modified endpoints

- `POST /api/connections` accepts optional `protocol`.
- `PATCH /api/connections/:id` accepts optional `protocol`. Reconnect triggers
  if protocol changes.
- `POST /api/connections/:id/test` honors the row's resolved protocol.

### Resolution rule

```
effective = row.protocol ?? settings.defaultProtocol ?? 'v5'
```

Resolved at `manager.add(target)` time and at `obs/test` time.

---

## Discovery

`scanLan` extended in `apps/api/src/discovery/scan.ts`:

1. **Candidate generation:** unchanged (CIDR /24 expansion or auto-detect).
2. **Ports to probe:** if caller passed `?port=N`, probe only N. Otherwise
   probe both `4444` and `4455` per host.
3. **TCP probe** as today (cheap RST on closed ports).
4. **WS handshake** on each TCP-open host:
   - Open WS to `ws://host:port`.
   - Read first server frame (250 ms timeout).
   - If frame has `op === 0` (and `d.obsWebSocketVersion`) → v5.
   - Otherwise send `{request-type:"GetAuthRequired", message-id:"d"}` and read
     next frame. If frame has `message-id === "d"` with a `status` field →
     v4.
   - Anything else → drop the host (not OBS).
5. **Return type:** `{host, port, protocol: 'v4'|'v5'}[]`.
6. **Existing test stays green** because `?port=N` still matches the
   `port: N` row regardless of `protocol`.

Upper-bound timeout per host: 1.5 s. Concurrency stays at 32.

---

## Frontend

- **Connections page** (`apps/web/src/pages/connections.tsx`):
  - Add/Edit dialog gains a `<Select>` with options
    `"Default (v5)" | "v4" | "v5"`. Stores `null | 'v4' | 'v5'`.
  - Table gains a "Protocol" column with a small badge:
    - `v5` → cyan
    - `v4` → amber
    - inherited → muted "default" tag with tooltip showing resolved value.
  - Header gets a "Settings" link.
  - Discovery table: each discovered row shows the detected protocol badge;
    selecting one auto-fills both the port and the protocol.
- **New page** `apps/web/src/pages/settings.tsx`:
  - Single field for now: `Default protocol` dropdown.
  - PUT to `/api/settings`.
- **Realtime/wire**: unchanged. The dashboard already consumes normalized
  state regardless of which protocol fed it.

---

## Testing

| File | Purpose | Approx cases |
|---|---|---|
| `clients/v4-translate.test.ts` | Pure command + event + snapshot translation | ~30 |
| `clients/v4-client.test.ts` | Lifecycle, auth, scene-cache, vcam poll | ~12 |
| `mock-server-v4.test.ts` | Sanity of the test double | ~5 |
| `connection-manager.test.ts` | Existing v5 cases pass; new test for `protocol:'v4'` path | +3 |
| `routes/discover.test.ts` | Existing `?port=N` passes; new test for dual-port + protocol tag | +3 |
| `routes/connections.test.ts` | Protocol field round-trips through API | +2 |
| `db/schema.test.ts` | Migration applies cleanly; default seed present | +1 |
| `app_settings.test.ts` | New endpoints work; PUT updates `defaultProtocol` | ~4 |

Target: existing 100 api tests stay green; new tests bring api total to ~160.
Web tests stay 44 with +5 for the new protocol UI bits.

---

## Out of scope (deferred)

- Hot-swapping a connected slot's protocol without disconnect.
- Per-protocol distinct event subscription preferences (v5 has the bitfield;
  v4 has nothing similar — we just listen).
- Backporting newer v4 commands (`OpenInputPropertiesDialog`, etc.) into the
  internal command schema.
- Migrating the existing mock-server.ts to share scaffolding with the v4 mock
  — the protocols are too different to factor a useful common base.
