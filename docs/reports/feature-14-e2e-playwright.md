# Feature 14 report: End-to-end browser tests (Playwright)

**Branch:** `feature/e2e-playwright` (commit `482aab0`), merged `--no-ff` into `dev` (`e4f90c2`)
**Status:** complete, WSL-verified; login/logout auth flow + production-serving deferred to on-device
**Docs:** `docs/E2E-TESTING.md` (the e2e story) · `docs/TESTING.md` (pointer) · `specs/webui-e2e-plan.md` (the plan)

## What was built

The first **end-to-end** layer for the fork. Where `covback`/`covfront` mock the
backend, socket.io and `fetch`, this suite drives a **real Chromium** against the
**real stack** (Vite-served React UI ↔ live Express/socket.io backend) and asserts
what a user sees. It is deliberately **separate from the coverage ratchet**.

Built with the **official Playwright CLI + agent workflow**:

- `npm i -D @playwright/test` + `npx playwright install chromium`
- `npx playwright init-agents --loop=claude` scaffolded the official skill:
  `.claude/agents/playwright-test-{planner,generator,healer}.md` and the
  `playwright-test` MCP server in `.mcp.json`. The suite was authored by following
  that **planner → generator → healer** methodology against the live app: explore
  every route, save the plan (`specs/webui-e2e-plan.md`), generate specs, run, heal.

### The harness (`playwright.config.js`)

The backend only reads the repo-local `config/` and resolves SPA client routes
when `NODE_ENV=development` (`server/paths.js` hardcodes `/etc/rpanion-server` and
gates the SPA catch-all on non-dev). So Playwright's `webServer` launches the dev
stack — the same two processes as `npm run dev`, but split so it can wait on each
port independently:

| Process | Command | Port |
|---|---|---|
| Backend | `rm -f ./config/settings.json && NODE_ENV=development node ./server/index.js` | 3001 |
| Frontend | `npm start` (Vite) | 3000 |

`baseURL` is the Vite origin (`:3000`), which proxies `/api` + `/socket.io` to the
backend. `rm -f config/settings.json` mirrors CI's clean state (an empty file
breaks `settings-store` on boot). Dev mode disables auth, so all pages are
reachable and the sidebar omits Logout. Run serially (`workers:1`) because backend
config is process-global and several pages POST mutations.

### The 50 tests (`e2e/`)

- **`app-shell.spec.js`** — sidebar lists all 17 nav links; each link opens the
  right route (URL + `<h1>`); unknown route → 404 with the shell intact; the Logout
  link and `/logoutconfirm` route are absent in dev mode (auth disabled).
- **`smoke.spec.js`** — direct navigation (exercises Vite SPA fallback) to all 16
  content routes; each renders its `<h1>` title with the sidebar intact and throws
  no uncaught exception.
- **`graceful-degradation.spec.js`** — against a real backend with no companion
  hardware: Video → "OpenCV is not installed", LTE Modem → "monitoring is
  disabled", Home → "Not connected" / "Inactive" subsystem statuses.
- **`self-documenting-ui.spec.js`** — the fork rule (`docs/UI-GUIDELINES.md`): the
  four fork pages expose `aria-label="help"` HelpTips, a HelpSection that
  expands/collapses (`aria-expanded` toggles), and a tooltip on hover.

Shared: `e2e/routes.js` (route ↔ nav-text ↔ `<h1>` table, captured from the live
app) and `e2e/fixtures.js` (a `gotoPage` helper + an **auto-fixture that fails any
test whose page throws an uncaught exception**). React controlled-input *warnings*
logged by upstream pages are pre-existing and explicitly **not** treated as
failures — only real crashes fail.

### Wiring

- Scripts: `e2e`, `e2e:ui`, `e2e:report`, `e2e:install`.
- `.gitignore` drops `test-results/`, `playwright-report/`, `blob-report/`,
  `playwright/.cache`; `eslint.config.mjs` ignores the report/result dirs so
  `eslint .` stays clean and fast.
- The `.claude/agents/*` and `.mcp.json` skill scaffolding is committed so the
  team can drive the planner/generator/healer agents (after Claude Code loads
  `.mcp.json`).

## How it was tested (WSL)

- `npm run e2e` — **50 passed** reusing an already-running dev stack.
- `CI=1 npx playwright test` — **50 passed** from a cold start (Playwright boots
  both servers via `webServer`), validating the CI path end to end.
- CI parity re-verified on `dev`: `npm run lint` clean; `build && covback` →
  **100/100/100/100** (3866 stmts); `covfront` → **100/100/100/100** (746 tests).
  The e2e addition touches no `src/`/`server/` code, so both ratchets are
  unaffected.

Notable: Playwright's **bundled Chromium runs headless in this WSL box**, so the
visual checks deferred in feature 7 ("chromium is a broken snap") are now
automatable for the parts that don't need real hardware.

## Needs on-device (appended to `docs/ONDEVICE-CHECKLIST.md`, Feature 14)

Dev mode disables auth and Vite serves the SPA, so these can't be exercised in WSL:

- Production install: unauthenticated visit redirects to `/` and shows the login
  form (`authEnabled:true`); correct admin login persists a token, pages load,
  Logout appears; wrong password shows the error modal; logout returns to login;
  protected `/api/*` 401 without a token.
- Backend-served SPA (no Vite): deep-link to a client route loads via the
  production catch-all, not a 404.
- Optional: point `baseURL` at the device build to smoke the same routes with real
  hardware values present.
