#!/usr/bin/env node
/**
 * Builds a fully portable Windows bundle of reStrikeOMC.
 *
 * Layout produced (default --out: dist-bundle/reStrikeOMC):
 *   reStrikeOMC/
 *   ├── node.exe                  (downloaded portable Node.js)
 *   ├── start.bat                 (launcher; auto-generates secrets on first run)
 *   ├── README.txt                (user-facing notes)
 *   ├── app/
 *   │   ├── dist/                 (compiled api: tsc + migrations)
 *   │   ├── web/                  (compiled web: vite build output)
 *   │   ├── node_modules/         (production deps via `pnpm deploy --prod`)
 *   │   └── package.json          (deployed manifest)
 *   └── data/                     (created on first run; SQLite db + .env live here)
 *
 * Requirements: pnpm, an internet connection (to download node.exe), Node 22.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, cpSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const NODE_VERSION = process.env.RESTRIKE_NODE_VERSION ?? 'v22.11.0';
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;

function parseArgs() {
  const out = { outDir: resolve(repoRoot, 'dist-bundle/reStrikeOMC'), skipBuild: false, skipDeploy: false };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--out' && process.argv[i + 1]) out.outDir = resolve(process.argv[++i]);
    else if (a === '--skip-build') out.skipBuild = true;
    else if (a === '--skip-deploy') out.skipDeploy = true;
  }
  return out;
}

function run(cmd, args, opts = {}) {
  console.log(`[bundle] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
}

async function downloadNode(targetPath) {
  if (existsSync(targetPath)) {
    const sz = statSync(targetPath).size;
    if (sz > 30_000_000) {
      console.log(`[bundle] node.exe already present (${(sz / 1_000_000).toFixed(1)}MB); skipping download.`);
      return;
    }
    rmSync(targetPath, { force: true });
  }
  console.log(`[bundle] downloading ${NODE_URL} ...`);
  const res = await fetch(NODE_URL);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await pipeline(res.body, createWriteStream(targetPath));
  const sz = statSync(targetPath).size;
  console.log(`[bundle] saved node.exe (${(sz / 1_000_000).toFixed(1)}MB)`);
}

const START_BAT = `@echo off
setlocal EnableDelayedExpansion
title reStrikeOMC
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "NODE_EXE=%SCRIPT_DIR%node.exe"
set "APP_DIR=%SCRIPT_DIR%app"
set "DATA_DIR=%SCRIPT_DIR%data"
set "ENV_FILE=%DATA_DIR%\\.env"

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM Validate existing .env. If missing or any value empty, regenerate.
set "NEED_GEN=0"
if not exist "%ENV_FILE%" set "NEED_GEN=1"
if "%NEED_GEN%"=="0" findstr /B /R /C:"SESSION_COOKIE_SECRET=." "%ENV_FILE%" >nul 2>&1 || set "NEED_GEN=1"
if "%NEED_GEN%"=="0" findstr /B /R /C:"CONNECTION_PASSWORD_KEY=." "%ENV_FILE%" >nul 2>&1 || set "NEED_GEN=1"

if "%NEED_GEN%"=="1" (
    echo [reStrikeOMC] Generating secrets...
    "%NODE_EXE%" -e "const fs=require('fs'),c=require('crypto');fs.writeFileSync(process.argv[1],'SESSION_COOKIE_SECRET='+c.randomBytes(32).toString('hex')+String.fromCharCode(10)+'CONNECTION_PASSWORD_KEY='+c.randomBytes(32).toString('hex')+String.fromCharCode(10));" "%ENV_FILE%"
    if errorlevel 1 (
        echo [reStrikeOMC] FATAL: failed to write %ENV_FILE%
        pause
        exit /b 1
    )
    echo [reStrikeOMC] Wrote "%ENV_FILE%"
)

for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do set "%%a=%%b"

if not defined SESSION_COOKIE_SECRET (
    echo [reStrikeOMC] FATAL: SESSION_COOKIE_SECRET missing after load
    pause
    exit /b 1
)
if not defined CONNECTION_PASSWORD_KEY (
    echo [reStrikeOMC] FATAL: CONNECTION_PASSWORD_KEY missing after load
    pause
    exit /b 1
)

set "PORT=8080"
set "HOST=127.0.0.1"
set "DB_PATH=%DATA_DIR%\\restrike.db"

echo [reStrikeOMC] Starting server on http://%HOST%:%PORT%/
echo [reStrikeOMC] Press Ctrl+C to stop. Keep this window open while you use the app.

REM Launch the api so its output (incl. any crash stack) stays in this window.
REM Open the browser only after the port is accepting connections, so the user
REM does not see ERR_CONNECTION_REFUSED on first page load.
start /b "" "%NODE_EXE%" "%APP_DIR%\\dist\\index.js"

echo [reStrikeOMC] Waiting for server to accept connections...
set "WAIT_SECS=0"
:wait_for_port
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('%HOST%',%PORT%); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto port_ready
set /a WAIT_SECS+=1
if %WAIT_SECS% geq 30 (
    echo [reStrikeOMC] WARNING: server did not bind within 30s. Opening browser anyway.
    goto port_ready
)
timeout /t 1 /nobreak >nul
goto wait_for_port

:port_ready
echo [reStrikeOMC] Server up. Opening browser...
start "" "http://%HOST%:%PORT%/"

REM Block until node exits so closing this window stops the server.
:tail_node
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 goto node_exited
timeout /t 2 /nobreak >nul
goto tail_node

:node_exited
echo.
echo [reStrikeOMC] Server stopped (node.exe exited).
echo [reStrikeOMC] If unexpected, scroll up for any stack trace.
echo [reStrikeOMC] Press any key to close this window.
pause >nul
endlocal
`;

const README_TXT = `reStrikeOMC — portable Windows bundle
======================================

Just double-click "start.bat".

What it does on first run:
  - Creates a "data" folder next to start.bat
  - Generates two random 32-byte hex secrets (SESSION_COOKIE_SECRET and
    CONNECTION_PASSWORD_KEY) and writes them to data\\.env. KEEP THIS FILE.
  - Creates "data\\restrike.db" (SQLite). All your users + connections
    + audit log live here.
  - Opens your default browser to http://127.0.0.1:8080/

To move the install to another machine: copy this entire folder. Bring
the "data" folder along to keep your users + connections, or leave it
behind to start fresh.

To uninstall: delete this folder.

Files:
  node.exe         Bundled Node.js runtime (no install needed)
  start.bat        Launcher (this is what you run)
  app/             Compiled server + bundled web UI
  data/            Created on first run; do not commit, do not share
`;

async function main() {
  const { outDir, skipBuild, skipDeploy } = parseArgs();
  console.log(`[bundle] target: ${outDir}`);

  if (!skipBuild) {
    console.log('[bundle] Building all workspace packages...');
    run('pnpm', ['-r', 'build'], { cwd: repoRoot });
  } else {
    console.log('[bundle] --skip-build: assuming dist/ artifacts are present');
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const appDir = resolve(outDir, 'app');

  if (!skipDeploy) {
    console.log('[bundle] Running pnpm deploy --prod (hoisted) for @restrike/api ...');
    // node-linker=hoisted = npm-style flat node_modules, so transitive deps
    // are discoverable by Node's standard upward node_modules walk. pnpm's
    // default isolated layout uses .pnpm/ + symlinks which break the moment
    // cp -r materializes those symlinks as real directories on a target
    // machine — Node then can't find e.g. `debug` from inside obs-websocket-js.
    run(
      'pnpm',
      [
        '--filter',
        '@restrike/api',
        '--config.node-linker=hoisted',
        'deploy',
        '--prod',
        appDir,
      ],
      { cwd: repoRoot }
    );
  } else {
    console.log('[bundle] --skip-deploy: assuming app/ already deployed');
  }

  // Make sure the api's compiled dist + migrations made it into the deploy.
  // pnpm deploy copies files matching the package's "files" field or everything;
  // we need both dist/ and the migration assets that copy-migrations.mjs writes.
  const apiDist = resolve(repoRoot, 'apps/api/dist');
  if (!existsSync(apiDist)) {
    throw new Error(`apps/api/dist not found — run 'pnpm --filter @restrike/api build' first`);
  }
  const deployedDist = resolve(appDir, 'dist');
  if (!existsSync(deployedDist)) {
    cpSync(apiDist, deployedDist, { recursive: true });
  }

  // Copy the web build alongside the api so server.ts's webDir resolves to ../web
  console.log('[bundle] Copying web build to app/web ...');
  const webSrc = resolve(repoRoot, 'apps/web/dist');
  if (!existsSync(webSrc)) {
    throw new Error(`apps/web/dist not found — run 'pnpm --filter @restrike/web build' first`);
  }
  cpSync(webSrc, resolve(appDir, 'web'), { recursive: true });

  // Download portable Node.exe (skipped if already cached at the target path)
  await downloadNode(resolve(outDir, 'node.exe'));

  // Drop the launcher + readme
  writeFileSync(resolve(outDir, 'start.bat'), START_BAT, 'utf8');
  writeFileSync(resolve(outDir, 'README.txt'), README_TXT, 'utf8');

  // Sanity check: verify critical native modules are in the bundle
  const sqliteNode = resolve(
    appDir,
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
  );
  const bcryptNode = resolve(appDir, 'node_modules/bcrypt/lib/binding');
  if (!existsSync(sqliteNode)) {
    console.warn(
      `[bundle] WARNING: ${sqliteNode} not found — better-sqlite3 native binding missing`
    );
  }
  if (!existsSync(bcryptNode)) {
    console.warn(`[bundle] WARNING: ${bcryptNode} not found — bcrypt may not work`);
  }

  console.log(`[bundle] DONE. Bundle ready at: ${outDir}`);
  console.log(`[bundle] Double-click ${outDir}\\start.bat to run.`);
}

main().catch((e) => {
  console.error('[bundle] FAILED:', e);
  process.exit(1);
});
