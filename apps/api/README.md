# @restrike/api

Backend for the multi-OBS web controller. See `docs/superpowers/specs/2026-05-01-multi-obs-webapp-design.md`.

## Quickstart

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env to set SESSION_COOKIE_SECRET and CONNECTION_PASSWORD_KEY
pnpm --filter @restrike/api dev
```

## First-run setup

```bash
curl -X POST http://localhost:8080/api/setup \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"longenoughpw"}'
```

## Login + cookie jar

```bash
curl -c cookies.txt -X POST http://localhost:8080/api/auth/login \
  -H "content-type: application/json" \
  -d '{"username":"alice","password":"longenoughpw"}'
```

## Add an OBS connection

```bash
curl -b cookies.txt -X POST http://localhost:8080/api/connections \
  -H "content-type: application/json" \
  -d '{"name":"Studio A","host":"192.168.1.50","port":4455,"password":"obspw"}'
```

## Subscribe to live state

Use any WS client (e.g. `wscat -c ws://localhost:8080/ws -H "Cookie: <restrike_sess=...>"`).
On connect you receive a `state.snapshot`. Live diffs follow as `state.diff`.

## Send a fan-out command

Send (over WS):

```json
{"type":"cmd","id":"r1","action":"SetCurrentProgramScene","targets":["<connId>"],"payload":{"sceneName":"Scene 1"}}
```

You'll receive `{"type":"cmd.result","id":"r1","ok":["<connId>"],"failed":[]}`.
