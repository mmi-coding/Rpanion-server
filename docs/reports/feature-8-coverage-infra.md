# Feature 8 — Coverage infrastructure (gates, ratchet, test harnesses)

**Branch:** `feature/coverage-infra` → merged into `dev` (`--no-ff`, 1581901)
**Commit:** 3f5984c
**Date:** 2026-06-12

## Goal

Kick off the 100%-coverage campaign (user mandate: upstream sat at ~34%
backend / ~0% frontend; this fork targets literal 100% on both suites,
upstream-inherited files included). This feature ships the *infrastructure*:
gated coverage scripts, a ratchet rule, and the two test harnesses that make
full coverage reachable — each proven on a real module.

## What was built

### Gated coverage scripts (`package.json`)

| Script | What it does |
|---|---|
| `npm run covback` | mocha suite under nyc with `--check-coverage` (per-file table) |
| `npm run covfront` | vitest suite with v8 coverage and threshold gate |

These replace the plain test runs in CI parity (see `CLAUDE.md` and
`docs/TESTING.md`). Thresholds:

- backend: `package.json` → `nyc` section — statements 44 / branches 36 / functions 37 / lines 44
- frontend: `vite.config.js` → `test.coverage.thresholds` — statements 3 / branches 4 / functions 3 / lines 3

**Ratchet rule:** thresholds equal the highest coverage achieved so far,
rounded down; any merge that raises coverage bumps them; they are never
lowered. End state: all eight numbers read 100.

Frontend coverage is scoped with `include: ['src/**/*.{js,jsx}']` — the
upstream `App.test.jsx` imports `server/pppConnection.js`, which polluted the
report until the include filter was set.

### Backend harness: fake binaries on PATH (`test/fakeBin.js`)

System-wrapper modules (`networkClients`, `networkManager`, `adhocManager`,
`vpn`, ...) shell out via `child_process.exec`/`execSync`, which resolve
binaries through `PATH` at call time. `FakeBin` writes fake `nmcli`/`sudo`/...
shell scripts into a temp dir, prepends it to `PATH`, records every
invocation for assertions, and selects behavior per-test via the inherited
`process.env.FAKE_SCENARIO`. Every branch becomes drivable with **zero
upstream source changes** and no real system tools.

A fake `sudo` that `exec "$@"`s by default (with cases for the commands
under test) covers `sudo <tool>` call sites.

### Frontend harness: real React rendering (`test/ui.jsx`, `test/socketMock.js`)

Root-cause finding: the upstream "renders without crashing" tests call
`root.render()` without `act()`, so React's concurrent renderer never
flushes — those tests execute almost no component code (hence 0% page
coverage despite "passing" tests). The helpers provide:

- `renderPage(element)` — `act()`-wrapped `createRoot` into a
  document-attached container; returns `flush`/`click`/`setValue`/`submit`/`unmount`
- `mockFetch(routes)` — per-route fetch stubbing keyed `"METHOD /path"`;
  **throws on unhandled routes** so unexpected requests fail loudly
- `socketMock.js` — `vi.mock('socket.io-client', ...)` replacement with a
  `fire(event, ...args)` hook to simulate server pushes

## Proof on real modules

| Module | Before | After | How |
|---|---|---|---|
| `server/networkClients.js` | 36% | **100/100/100/100** | 6 fake-nmcli/sudo tests (AP leases, no-AP, not-AP-mode, bad lease, stderr, exec failure) |
| `src/cellulartuning.jsx` | 0% | **87.8%** stmts | 3 act()-based tests: fetch-driven render, socket push, form save POST body |

Gate verified to actually fail: `--coverage.thresholds.statements=99` →
`ERROR: Coverage for statements (3.81%) does not meet global threshold (99%)`.

## Baseline after this feature

| Suite | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| backend (151 tests) | 44.96 | 36.91 | 37.29 | 44.94 |
| frontend (19 tests) | 3.81 | 4.26 | 3.11 | 3.89 |

Largest backend gaps (next features): `index.js` 19.3% (~1800 lines),
`networkManager` 11.1%, `adhocManager` 18.4%, `logConverter` 28.9%,
`pppConnection` 45%, `videostream` 45.2%, `ntrip` 46.6%, `cloudUpload` 46.9%.

## CI parity

- `npm run lint` — 0 errors (1 pre-existing warning)
- `rm -f ./config/settings.json && npm run build && npm run covback` — 151 passing, gate green
- `rm -f ./config/settings.json && npm run covfront` — 19 passing, gate green

## WSL-verified vs needs-on-device

Everything in this feature is host-independent (fake binaries, mocked
fetch/sockets) — **fully WSL-verified, nothing added to
`docs/ONDEVICE-CHECKLIST.md`.**

## Docs

- `docs/TESTING.md` (new) — commands, ratchet rule, both harness patterns,
  ignore-annotation policy (last resort, always with a reason)
- `CLAUDE.md` — CI parity updated to covback/covfront; coverage-ratchet section added
- `CHANGELOG.md` — Testing entry

## Follow-on plan (tracked as tasks)

1. Backend fork modules to 100% (ltemodem 59%, cameraSwitcher 89%, cellularTuning 97%, customPipelines 82%)
2. Backend upstream wrappers to 100% via fakeBin + sinon
3. `index.js` routes to 100%
4. Frontend fork pages to 100%
5. Frontend upstream pages to 100% + final ratchet to 100 everywhere
