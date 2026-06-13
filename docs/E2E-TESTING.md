# End-to-end testing (Playwright)

The unit suites (`covback`/`covfront`, see [TESTING.md](TESTING.md)) mock the
backend, socket.io and `fetch`. The **e2e suite** is different: it drives a real
Chromium browser against the **real stack** — the Vite-served React UI talking to
the live Express/socket.io backend — and asserts what a user actually sees.

These tests are **not** part of the coverage ratchet. They are a separate,
browser-based smoke/navigation/behaviour gate.

## Quick start

```bash
npm run e2e:install     # one-time: download the Chromium build Playwright uses
npm run e2e             # run the whole suite (auto-starts the dev stack)
npm run e2e:ui          # interactive UI mode (watch/debug)
npm run e2e:report      # open the last HTML report
```

`npm run e2e` launches the app itself via Playwright's `webServer` config
(`playwright.config.js`), so you don't need a server running first. If you
already have `npm run dev` up on :3000/:3001 it is reused.

## How the harness runs the app

`server/paths.js` only reads the repo-local `config/` and the SPA client routes
only resolve correctly when `NODE_ENV=development`. So the harness starts two
processes (mirroring `npm run dev`, but split so Playwright can wait on each
port):

| Process | Command | Port |
|---|---|---|
| Backend | `rm -f ./config/settings.json && NODE_ENV=development node ./server/index.js` | 3001 |
| Frontend | `npm start` (Vite) | 3000 |

Tests hit `http://localhost:3000` (`baseURL`); Vite proxies `/api` + `/socket.io`
to the backend. The `rm -f ./config/settings.json` mirrors CI's clean state (an
empty `settings.json` breaks `settings-store` on boot).

Dev mode means **auth is disabled** (`/api/auth` → `{authEnabled:false}`), so
every page is reachable without logging in and the sidebar omits the Logout link.

## What is covered (WSL-verifiable)

All specs live in `e2e/`; the plan they were generated from is
[`specs/webui-e2e-plan.md`](../specs/webui-e2e-plan.md).

| Spec | Covers |
|---|---|
| `app-shell.spec.js` | Sidebar lists all 17 links, every link opens the right page, unknown route → 404, logout route absent in dev mode |
| `smoke.spec.js` | Direct navigation to all 16 content routes renders the page `<h1>` with the shell intact and no uncaught exception |
| `graceful-degradation.spec.js` | With no companion hardware: Video → "OpenCV is not installed", LTE Modem → "monitoring is disabled", Home → "Not connected"/"Inactive" statuses |
| `self-documenting-ui.spec.js` | Fork rule ([UI-GUIDELINES.md](UI-GUIDELINES.md)): fork pages expose HelpTips and a HelpSection that expands/collapses; hover reveals a tooltip |

Shared helpers: `e2e/routes.js` (route ↔ nav-text ↔ title table) and
`e2e/fixtures.js` (a `gotoPage` helper + an auto-fixture that fails any test whose
page throws an **uncaught exception**). Note: several upstream pages log React
controlled-input *warnings* to the console — those are pre-existing and are
deliberately **not** treated as failures; only real page crashes fail a test.

## What is NOT covered here (needs-on-device)

- **Login / logout auth flow.** Auth is only enabled in production mode, which
  needs `/etc/rpanion-server/config/*` and the backend serving the build. Tracked
  in [ONDEVICE-CHECKLIST.md](ONDEVICE-CHECKLIST.md).
- **Live hardware values** (real FC link, modem signal, camera streams). The
  graceful-degradation assertions describe the *no-hardware* state; on a fully
  equipped Pi the live values differ.

## The Playwright skill (planner / generator / healer)

This repo was initialised with the official Playwright agent workflow
(`npx playwright init-agents --loop=claude`), which scaffolded:

- `.claude/agents/playwright-test-planner.md` — explores the live app and writes a
  plan into `specs/`.
- `.claude/agents/playwright-test-generator.md` — drives the app and writes specs
  from a plan.
- `.claude/agents/playwright-test-healer.md` — runs failing specs and repairs them.
- `.mcp.json` — the `playwright-test` MCP server those agents use.

These agents become available to Claude Code after it loads `.mcp.json` (restart /
re-trust the workspace). The current suite was authored by following that same
planner → generator → healer methodology against the live dev stack.
