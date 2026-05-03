import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiPort = 8090;
const webPort = 5174;
const dbDir = resolve(__dirname, '../api/data/e2e');
const dbPath = resolve(dbDir, 'test.db');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @restrike/api dev',
      port: apiPort,
      cwd: resolve(__dirname, '../..'),
      env: {
        PORT: String(apiPort),
        HOST: '127.0.0.1',
        DB_PATH: dbPath,
        SESSION_COOKIE_SECRET: 'a'.repeat(32),
        CONNECTION_PASSWORD_KEY: 'b'.repeat(32),
      },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec vite --port ${webPort} --strictPort --host 127.0.0.1`,
      port: webPort,
      cwd: __dirname,
      env: {
        VITE_API_HTTP: `http://127.0.0.1:${apiPort}`,
        VITE_API_WS: `ws://127.0.0.1:${apiPort}`,
      },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
