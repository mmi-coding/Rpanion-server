# Feature 12 — fork frontend pages to 100% coverage

Branch: `feature/coverage-frontend-fork` → merged into `dev` (`--no-ff`).
Task #14 of the coverage campaign ([docs/TESTING.md](../TESTING.md)).

## Goal

Bring all five fork-added frontend pages and components — Help.jsx,
cellulartuning.jsx, pipelineeditor.jsx, cameraswitcher.jsx, ltemodem.jsx —
from their pre-feature baselines to a literal **100%** on all four v8/vitest
metrics, and raise the frontend coverage ratchet accordingly.

## Coverage table

### Per-file before → after

| File | Stmts before | Stmts after | Branches before | Branches after |
|---|---|---|---|---|
| src/components/Help.jsx | 57.14% | **100%** | 57.14% | **100%** |
| src/cellulartuning.jsx | 87.8% | **100%** | (partial) | **100%** |
| src/pipelineeditor.jsx | 0% | **100%** | 0% | **100%** |
| src/cameraswitcher.jsx | 0% | **100%** | 0% | **100%** |
| src/ltemodem.jsx | 0% | **100%** | 0% | **100%** |

All four metrics (statements, branches, functions, lines) reached 100% on each
file. Per-file truth is in `coverage/coverage-final.json` after `covfront` —
the text summary omits 100% rows.

### Frontend "All files" before → after

| Metric | Before | After |
|---|---|---|
| Statements | ~3% (upstream gap) | **18.34%** |
| Branches | ~4% | **19.67%** |
| Functions | ~3% | **14.03%** |
| Lines | ~3% | **18.31%** |

The remaining gap is upstream pages (video.jsx, networkconfig.jsx, basePage,
flightcontroller.jsx, etc.) — scope of feature 15.

## Work packages

Three sequential test-writer packages (sequential to avoid concurrent vitest
coverage runs sharing the `coverage/` output directory).

### W1 — Help.jsx + cellulartuning.jsx

**New file: `src/components/Help.test.jsx`** — 9 tests.

- `HelpTip`: renders the `?` trigger; tooltip text visible after click; tooltip
  hidden before interaction.
- `HelpSection`: collapsed on mount; expands on click; collapses again on
  second click; keyboard Enter expands; keyboard Space expands; an unrelated
  key (e.g. `Tab`) leaves the section collapsed.

Help.jsx was at 57.14% because the collapse toggle and keyboard handler had
never been exercised. All branches are now covered with no annotations needed.

**Extended file: `src/cellulartuning.test.jsx`** — 3 tests → 15 tests.

New branches covered:

- Socket reconnect fires the initialization request again (`connect` event
  re-emitted after first mount settle).
- `fetch` error path: `mockFetch` throws a network error on
  `/api/cellulartuning`; page renders the error state.
- Submit success path: `POST /api/cellulartuningmodify` returns
  `{ result: 'OK' }`; status message updates.
- Submit error path: server returns `{ result: 'error', msg: 'bad input' }`;
  error message surfaces in the UI.

### W2 — pipelineeditor.jsx + cameraswitcher.jsx

**New file: `src/pipelineeditor.test.jsx`** — 22 tests.

- Initial render with empty pipelines dict and with a populated dict.
- Add pipeline flow: fill device/pipeline fields, submit, success and error
  branches.
- Edit pipeline flow: click Edit button (populates form from existing entry),
  modify pipeline text, submit.
- Delete pipeline: click Delete, confirm modal, success and error branches.
- Reorder up/down buttons at list boundaries.
- Dry-run test button: success (valid pipeline reported back), failure (parse
  error), network error.
- Socket reconnect re-requests pipeline state.
- Fetch error on initial load.

Two `/* v8 ignore next */` annotations at **src/pipelineeditor.jsx:55,57**:
the `entry` guard in the Edit-button handler checks `if (entry)` before
reading `entry.pipeline`. This branch is structurally unreachable because the
Edit button is only rendered for keys that are already present in the pipelines
dict — there is no code path that creates an Edit button for a missing key. A
test cannot reach the `else` arm; the annotation is the correct resolution.

**New file: `src/cameraswitcher.test.jsx`** — 22 tests.

- Initial render: default state (auto mode, no source selected).
- `switchMode` branch `'auto'`: save settings, success and error paths.
- `switchMode` branch `'manual'`: exposes source selector; save settings.
- `switchMode` branch `'command'`: exposes per-source command inputs.
- Manual source switch button: emits switch event, success and error.
- Socket status pushes: `CameraSwitcherStatus` event updates mode/source
  display; second push with changed source updates again.
- Socket reconnect re-requests switcher state.
- Fetch error on initial load.
- Disabled controls during save in-progress.

### W3 — ltemodem.jsx

**New file: `src/ltemodem.test.jsx`** — 75 tests.

ltemodem.jsx is the largest fork frontend file. Test groups:

- **Pure helper functions** — `formatBytes` matrix (bytes/KB/MB/GB edge cases),
  `signalLabel` matrix (every RSRP tier + null/unknown), `stepBadge` matrix
  (every connection-test step result variant).
- **Initial render** — default loading state; populated state after fetch
  resolves.
- **Discovery scan** — scan with no candidates found; scan returning USB + UART
  candidates; scan network error; scan server error; re-scan after first scan.
- **Connection test** — happy path (all steps pass); partial failure (step 3
  fails, remaining steps not shown); network error during test; server error.
- **AT console** — send command, response appended to log; clear log button;
  network error on send; disabled during send in-progress; multi-line response
  display.
- **Settings form** — change AT port selection (select onChange via native
  prototype setter pattern); change baud rate; change RNDIS interface; toggle
  auto-reconnect; submit success; submit error; fetch error on load.
- **Data counters** — socket `LTEModemStatus` push updates session/total
  counters; reset counters button; reset error path.
- **Socket reconnect** — `connect` event re-fires the initialization request.
- **Signal display** — `LTEModemStatus` push with each signal tier renders the
  correct badge colour; unknown signal type renders gracefully.

No v8 annotations were needed in ltemodem.jsx — every branch was reachable
through the mock layer.

## v8 annotations

Total in this feature: **2**, both in `src/pipelineeditor.jsx`.

| File | Lines | Reason |
|---|---|---|
| src/pipelineeditor.jsx | 55, 57 | `entry` guard in Edit-button handler: structurally unreachable because Edit buttons are only rendered for keys already present in the pipelines dict |

## Backend flake hardenings (discovered during CI parity)

The terminal 100% backend gate means any flake = red CI. Two pre-existing
time-budget issues surfaced under a loaded WSL instance during the triple
`covback` verification runs.

### `server/pppConnection.test.js` — `quitting` describe

The `quitting` describe block spawns a fake `sudo` via `execSync`. Under load,
the OS fork + exec path exceeded mocha's default 2 s timeout approximately 1
run in 3. Fix: `this.timeout(10000)` on the `quitting` describe.

### `server/index.auth.test.js` — production-mode `before()` hook

The `before()` hook spends at least 3.3 s on mandatory `iat`-spacing sleeps
(3 × 1.1 s) and ~1.8 s on two bcrypt logins, leaving only ~0.9 s of headroom
against the original 5 s hook timeout. Fix: hook timeout raised from 5000 ms
to **20000 ms**.

Backend re-verified: **3 consecutive `covback` runs**, all green at
100/100/100/100, 820 passing.

## Suite counts

| Suite | Files | Tests | Failing |
|---|---|---|---|
| Frontend (vitest) | 6 | **159** | 0 |
| Backend (mocha) | unchanged | **820** | 0 |

## Lint

`npm run lint` — **0 errors** (1 pre-existing upstream warning, unchanged).

## Ratchet raise

Frontend thresholds (`vite.config.js`, `test.coverage.thresholds`):

| Metric | Before | After |
|---|---|---|
| Statements | 3 | **18** |
| Branches | 4 | **19** |
| Functions | 3 | **14** |
| Lines | 3 | **18** |

Backend thresholds (`package.json`, nyc section): unchanged at 100/100/100/100
(terminal — every backend file is at 100%).

## CI parity

All three steps verified clean:

1. `npm run lint` — 0 errors
2. `rm -f ./config/settings.json && npm run build && npm run covback` —
   820 passing, gate green at 100/100/100/100 (3× stable)
3. `rm -f ./config/settings.json && npm run covfront` — 159 passing,
   gate green at thresholds 18/19/14/18

## WSL-verified vs needs-on-device

This branch is **test-only**. All 159 frontend tests run entirely in
happy-dom with mocked `fetch` and a mocked `socket.io-client` — no browser,
no network, no hardware. The two backend flake hardenings are timeout bumps
with no behaviour change.

**Nothing appended to `docs/ONDEVICE-CHECKLIST.md`.** There is no on-device
verification needed for this feature.

## New reusable frontend patterns (documented in docs/TESTING.md)

1. **`<select>` onChange** — use the `HTMLSelectElement.prototype` native
   setter + a bubbling `change` event; `setValue` in `test/ui.jsx` fires
   `input`, which only works for `<input>` elements.
2. **Modal errors in portals** — assert `document.body.textContent`, not the
   test container; `basePage`'s error modal mounts outside the container via a
   React portal.
3. **Per-file coverage truth** — `coverage/coverage-final.json` after
   `covfront`; the text table omits 100% rows.
4. **`lastSocket()` ordering** — unmount each page before rendering the next
   one; `lastSocket()` returns the newest mock socket and a stale mount
   produces the wrong instance.
5. **Never run two vitest coverage processes concurrently** — they share the
   `coverage/` output directory and corrupt each other's totals; iterate with
   `npx vitest --run <file>` (no coverage) and run the full gate only once.
6. **Timeout rule for execSync + sleep-heavy `before()` hooks** — set the
   timeout to the sum of all mandatory sleeps + at least 3× the cost of the
   most expensive operation, rounded up; default 2 s/5 s is routinely
   insufficient under load.

## Next step

**Feature 15 — frontend upstream pages to 100%.**

Largest targets by line count:

- `src/video.jsx` — ~1110 lines; stream start/stop, encoder config, bitrate,
  device/resolution selects, RTSP/RTP/UDP modes
- `src/networkconfig.jsx` — ~986 lines; nmcli-backed add/edit/delete/activate
  flows, Wifi scan, AP mode, adhoc mode
- `src/basePage.jsx` — currently ~48% statements; modal dialogs, socket
  reconnection banner, auth token refresh
- `src/flightcontroller.jsx`, `src/flightlogs.jsx`, `src/about.jsx`, etc.

Reaching 100% on those closes the final frontend gap and allows the ratchet
to move to 100/100/100/100 on both suites (the campaign's terminal goal).
