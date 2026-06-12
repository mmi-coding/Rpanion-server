# Testing & Coverage

This fork targets **100% test coverage — statements, branches, functions and
lines — on both suites** (upstream sat at ~34% backend, ~0% frontend). The
target applies to all code in the repo, including upstream-inherited modules.

## Commands

| Command | What it does |
|---|---|
| `npm run testback` | backend mocha suite (plain) — `npm run build` must run first |
| `npm run testfront` | frontend vitest suite (plain) |
| `npm run covback` | backend suite under nyc **with the coverage gate** (per-file table) |
| `npm run covfront` | frontend suite under vitest/v8 **with the coverage gate** |

CI parity before every merge (replaces the plain test runs — the cov
variants run the same tests):

```
npm run lint                                            # 0 errors
rm -f ./config/settings.json && npm run build && npm run covback
rm -f ./config/settings.json && npm run covfront
```

## The coverage ratchet

Thresholds live in `package.json` (`nyc` section, backend) and
`vite.config.js` (`test.coverage.thresholds`, frontend). The rule:

- **Thresholds equal the highest coverage achieved so far, rounded down.**
- Any merge that raises coverage **must** bump the thresholds to the new floor.
- Thresholds are **never lowered**. A PR that drops below the floor fails
  `covback`/`covfront` and must add tests, not loosen the gate.
- End state: all eight numbers read 100.

## Backend patterns

### Fake binaries on PATH (`test/fakeBin.js`)

System-wrapper modules (networkManager, adhocManager, vpn, networkClients,
...) shell out via `child_process.exec`/`execSync`, which resolve binaries
through `PATH` at call time. Tests prepend a temp dir of fake `nmcli`, `wg`,
`zerotier-cli`, `sudo`, ... shell scripts — every branch becomes drivable
with **no upstream source changes** and no real system tools:

```js
const { FakeBin } = require('../test/fakeBin')
const fake = new FakeBin()
fake.install('nmcli', 'case "$FAKE_SCENARIO:$*" in ... esac')
fake.activate()                      // before()
// drive scenarios per-test:
process.env.FAKE_SCENARIO = 'stderr' // children inherit the env
...
fake.calls('nmcli')                  // recorded invocations, for assertions
fake.cleanup()                       // after(): restores PATH, removes dir
```

`server/networkClients.test.js` is the reference example (module at 100%).
A fake `sudo` that `exec "$@"`s by default (with cases for the commands under
test) covers the `sudo <tool>` call sites.

### Live serial devices on a pty (`test/fakeModemPty.js`)

Serial-stack code (open/parser/write/timeout/close in `server/ltemodem.js`)
runs against a **real `SerialPort`** opened on a pty created by
`python/fake-sim7600.py` — canned AT responses, no hardware:

```js
const { startFakeModem, startSilentPty } = require('../test/fakeModemPty')
const fake = await startFakeModem()            // resolves { path, proc, stop() }
// new LTEModem(settings) with atPort = fake.path → full live round trips
fake.stop()                                    // after()
```

- `startSilentPty()` gives a pty that never answers — probe/AT-timeout paths.
- serialport **locks** devices: two concurrent opens of one pty fail with
  "Cannot lock port". Use a separate pty per concurrently-open port.
- The emulator mimics real-modem quirks deliberately: a blank line before
  each response, a whitespace-only line in `AT+CGMI` (blank-line guards —
  `ReadlineParser` drops truly empty tokens, so only whitespace lines reach
  them), an unsolicited "SMS DONE" after `ATE0` (no-command-pending paths),
  and `FAKE_SIM7600_ERROR=1` to answer everything with `ERROR`.

### Fake validator/interpreter scripts

`server/customPipelines.js` resolves Python via `logpaths.getPythonPath()`;
stubbing it with sinon to point at tiny `#!/bin/sh` scripts in a temp dir
drives every validator outcome (stderr+exit 1, garbage stdout, verdict then
crash, ENOENT) — see `server/customPipelines.test.js`.

### Injected seams

Fork modules already expose seams (`sendAT` fixtures, `_ping`,
`listNetInterfaces` overrides in `server/ltemodem.js`); prefer those where
they exist. `sinon` is available for stubbing module methods and timers.
Where a destructured import blocks stubbing, convert it to an object import
(`const serialDetection = require('./serialDetection.js')`) — a 2-line seam,
no behaviour change.

## Frontend patterns (`test/ui.jsx`, `test/socketMock.js`)

The upstream "renders without crashing" tests never flush React's concurrent
rendering — they execute nearly nothing. Real page tests use:

```jsx
import { renderPage, mockFetch } from '../test/ui.jsx'
import { lastSocket } from '../test/socketMock.js'
vi.mock('socket.io-client', () => import('../test/socketMock.js'))

mockFetch({
  '/api/cellulartuning': { settings, status },                  // GET
  'POST /api/cellulartuningmodify': (url, opts) => ({ ... })    // assert via opts.body
})
const page = renderPage(<CellularTuningPage />)
await page.flush()                       // settle componentDidMount fetches
page.click(el) / page.setValue(input, v) / page.submit(form)
act(() => { lastSocket().fire('CellularTuningStatus', {...}) }) // server push
page.unmount()
```

- `mockFetch` throws on unhandled routes, so unexpected requests fail loudly.
  Call `vi.unstubAllGlobals()` in `afterEach`.
- `src/cellulartuning.test.jsx` is the reference example.

## Unreachable code: ignore annotations (last resort)

Some branches cannot execute off-target even with fakes (hard hardware
probes, platform checks). Mark them, **always with a reason**:

- backend (nyc/istanbul): `/* istanbul ignore next -- Pi-only: reads /proc/device-tree */`
- frontend (vitest v8): `/* v8 ignore next -- browser-only API */`

Annotations inside upstream files are acceptable (user decision 2026-06-12:
literal 100% beats merge friction), but exhaust fake-bin/sinon options first —
an ignore hides regressions; a test catches them.

## Where things live

- backend tests: `server/*.test.js`, `mavlink/*.test.js` (mocha + assert + sinon)
- frontend tests: `src/**/*.test.jsx` (vitest + happy-dom)
- shared helpers: `test/` (excluded from both coverage scopes)
- modem AT emulator: `python/fake-sim7600.py` (pty; for live bench tests)
