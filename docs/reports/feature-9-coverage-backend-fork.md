# Feature 9 — Backend fork modules to 100% coverage

Branch: `feature/coverage-backend-fork` → merged into `dev` (`--no-ff`).
Task #11 of the coverage campaign ([docs/TESTING.md](../TESTING.md)).

## Goal

Take the four fork-authored backend modules to literal
**100/100/100/100** (statements/branches/functions/lines) and raise the
coverage ratchet to the new floor:

| Module | Before | After |
|---|---|---|
| `server/ltemodem.js` | 59.11% | **100/100/100/100** |
| `server/cameraSwitcher.js` | 89.36 / 82.6 / 81.8 / 89.4 | **100/100/100/100** |
| `server/cellularTuning.js` | ~87% | **100/100/100/100** |
| `server/customPipelines.js` | 82.4 / 74.4 / 100 / 82.4 | **100/100/100/100** |

## What was built

### Live serial harness: `test/fakeModemPty.js` (new)

Spawns pty-backed fake serial devices and resolves `{ path, proc, stop() }`:

- `startFakeModem(env)` — runs `python/fake-sim7600.py` (venv python when
  present). A **real `SerialPort`** opens the pty slave, so the entire
  serial stack (open, ReadlineParser, write, timeouts, close, error events)
  executes against canned AT responses. No hardware, no source seams.
- `startSilentPty()` — a pty that never answers, for probe-failure and
  AT-timeout paths. serialport **locks** devices ("Cannot lock port"), so
  concurrently-open ports each need their own pty.

### Emulator realism tweaks (`python/fake-sim7600.py`)

Each one mirrors real SIM7600 behaviour *and* drives an otherwise
unreachable branch:

- Responses prefixed with a blank line (real modems do this; exercises
  tokenizing). `ReadlineParser` never emits truly empty tokens (Node's
  `push('')` is a no-op), so the blank-line guards are reached via a
  **whitespace-only line** added to `AT+CGMI`.
- Unsolicited `SMS DONE` immediately after `ATE0`'s OK — pending is nulled
  synchronously on OK, so the next token deterministically hits the
  "no command pending" branches (`_onLine` and the probe parser).
- `FAKE_SIM7600_ERROR=1` answers `ERROR` to everything (modem-answers-error
  probe path).

### The one source change: a 2-line seam in `server/ltemodem.js`

`serialDetection` is now required as an object instead of destructured, so
tests can `sinon.stub(serialDetection, 'detectSerialDevices')`. No
behaviour change. Same pattern documented in TESTING.md for future modules.

### Test additions

- **ltemodem.test.js** (+~620 lines): doPoll orchestration with sendAT
  fixtures (rich status, sparse/garbage replies, auto-reconnect with 30 s
  holdoff, busy-skip, AT-timeout-reopens-port vs other-error-keeps-port),
  sendAT terminators (`ERROR`, `+CMS ERROR`), `readNetStats` NaN/counter-
  reset handling, real `/sys`-style interface listing via a tmp tree with a
  `rndis_host` driver symlink, settings validation matrix, user AT command
  paths, staged `testConnection` variants, discovery orchestration (FC
  exclusion, SIMCOM preference, serial-by-id mapping), `_ping` via a
  FakeBin `ping` (rtt/plain/stderr/silent/ENOENT), and three live pty
  suites: autostart monitor polling, port lifecycle + probe variants, and
  unresponsive-device timeouts (incl. killing the pty mid-probe).
- **cellularTuning.test.js** (+5 tests): unconfigured bitrate no-op,
  `setBitrate` rejection leaves tier unapplied, poll-loop timer with sinon
  fake timers, `getSettings` copy semantics, no-loop settings transition.
- **cameraSwitcher.test.js** (+6 tests): saveSettings catch via a throwing
  settings stub, getSettings copy semantics, hysteresis/switch-mode/
  command-B validation operands, settings change while already enabled,
  command-mode `doSwitch` through **real `exec`** (empty command skipped,
  `true` succeeds, failing command's stderr logged — console.error spy with
  a polling deadline), missing RC channel / null data in `onMavPacket`.
- **customPipelines.test.js** (+9 tests): every validator process outcome
  driven by stubbing `logpaths.getPythonPath()` at tiny `#!/bin/sh` scripts
  in a tmp dir — crash with stderr, ENOENT spawn failure (error.message
  fallback), garbage stdout (bad JSON), verdict-then-crash (stdout wins
  over exit code) — plus validator-error propagation, the save-without-
  validation path (console.log spy), and non-string pipeline rejection.
  No source seam needed: `logpaths` was already an object require.

## Ratchet raise

Backend thresholds (`package.json`, nyc): **44/36/37/44 → 50/43/44/50**
(statements/branches/functions/lines). Frontend unchanged (3/4/3/3).

## Baseline after this feature

| Suite | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| backend (206 tests) | 50.43 | 43.6 | 44.31 | 50.23 |
| frontend (19 tests) | 3.81 | 4.26 | 3.11 | 3.89 |

(Branch % varies ±0.05 between runs on timing-adjacent paths; the floor of
43 absorbs this.)

## CI parity

- `npm run lint` — 0 errors (1 pre-existing warning)
- `rm -f ./config/settings.json && npm run build && npm run covback` — 206
  passing, gate green at the raised thresholds
- `rm -f ./config/settings.json && npm run covfront` — 19 passing, gate green

## WSL-verified vs needs-on-device

Everything in this feature is test code plus a no-behaviour-change import
seam; all of it runs and was verified in WSL (the pty emulator substitutes
for the modem, FakeBin for `ping`, tmp trees for `/sys`). **Nothing added
to docs/ONDEVICE-CHECKLIST.md.**

## Docs

- `docs/TESTING.md` — new sections: live serial devices on a pty,
  fake validator/interpreter scripts, the object-import seam pattern.
- `CHANGELOG.md` — entry under Unreleased (fork).

## Follow-on plan (tracked as tasks)

- Task #12 — upstream system wrappers to 100% (networkManager 11%,
  adhocManager 18%, logConverter 29%, videostream 45%, pppConnection 45%,
  vpn 49%, cloudUpload 47%, ntrip 47%, serialDetection 50%, ...)
- Task #13 — `server/index.js` routes (19%, the largest single gap)
- Tasks #14/#15 — frontend pages, then the final ratchet to 100 everywhere
