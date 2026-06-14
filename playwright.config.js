// Playwright end-to-end test configuration for the Rpanion-server web UI.
//
// These tests exercise the *real* stack (Vite-served React frontend + Express
// backend) rather than the mocked unit tests under src/. See docs/E2E-TESTING.md
// for the full story, including what is WSL-verifiable vs needs-on-device.
//
// Run mode: the backend only reads the repo-local config/ and serves SPA client
// routes correctly when NODE_ENV=development (see server/paths.js). Dev mode also
// disables auth, so these tests cover route smoke + navigation + graceful
// degradation. The login/logout auth flow requires production mode and is tracked
// in docs/ONDEVICE-CHECKLIST.md.

import { defineConfig, devices } from '@playwright/test'

const FRONTEND_PORT = 3000
const BACKEND_PORT = 3001
const BASE_URL = `http://localhost:${FRONTEND_PORT}`

export default defineConfig({
  testDir: './e2e',
  // Backend config/settings are process-global and several pages POST mutations,
  // so run serially to avoid cross-test interference (mirrors the unit-suite note
  // that concurrent suite runs collide).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Launch the full dev stack the same way `npm run dev` does, but split so
  // Playwright can wait on each port independently. The backend must run with
  // NODE_ENV=development (repo-local config + auth disabled) and a clean
  // settings.json (an empty file breaks settings-store, mirroring CI's `rm -f`).
  webServer: [
    {
      command: 'rm -f ./config/settings.json && NODE_ENV=development node -r ts-node/register ./server/index.ts',
      port: BACKEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm start',
      port: FRONTEND_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
