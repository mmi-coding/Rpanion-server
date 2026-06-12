# Testing & Coverage

This fork achieved **100% test coverage — statements, branches, functions and
lines — on both suites** (upstream sat at ~34% backend, ~0% frontend). Both
ratchets are now terminal at 100/100/100/100. The target applies to all code
in the repo, including upstream-inherited modules.

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
- End state: all eight numbers read 100. **Both ratchets are now at 100 and held there permanently.**

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

Applied in `server/pppConnection.js` and `server/flightController.js` on
`feature/coverage-backend-upstream`.

**`testHooks` export seam** — `server/index.js` does not export its singletons
or the http server (they are module-level locals). A `testHooks` object is
appended at the bottom of the file and gated so production behaviour is
unchanged. It exposes the module-level `httpServer`, `io`, the six singleton
managers, `gracefulShutdown`, and an `isShuttingDown` accessor — enough for
tests to emit events directly on real singletons, connect a real socket.io
client, and drive shutdown:

```js
// bottom of server/index.js — additive only, zero production change
if (process.env.NODE_ENV !== 'production') {
  module.exports.testHooks = { httpServer, io, fcManager, ... gracefulShutdown, ... }
}
```

**Rate-limiter skip seam** — the 50 req/min express-rate-limit middleware
trips immediately under 820-test suites. A `skip` predicate disables it in
development unless the test opts in:

```js
skip: (req) => process.env.NODE_ENV === 'development' && !process.env.ENABLE_RATE_LIMIT
```

Set `ENABLE_RATE_LIMIT=1` in a test that specifically covers the limiter.

### Shared ephemeral-port harness for index.js tests (`test/indexApp.js`)

`server/index.js` binds a real http server and socket.io instance. Three test
files all need that server; starting it three times causes port conflicts.
The shared harness pattern:

```js
// test/indexApp.js
let serverInstance = null
async function getServer() {
  if (!serverInstance) serverInstance = await startApp(0) // port 0 → ephemeral
  return serverInstance
}
async function closeServer() { await serverInstance.close(); serverInstance = null }
module.exports = { getServer, closeServer }
```

Each test file calls `getServer()` in `before()` and `closeServer()` in
`after()`. The `0`-port binding lets the OS pick a free port; `server.address().port`
gives the actual value. **One server per suite run — do not start a second
instance from a parallel suite** (mocha test files run sequentially under
`--file`).

### Prototype-stubbing unexported class singletons

`server/index.js` constructs singletons (`new NtripManager(...)` etc.) and
never exports the instances. Sinon cannot stub an unexported instance; stub
the **prototype** instead:

```js
const NtripManager = require('./ntrip')
sinon.stub(NtripManager.prototype, 'getSettings').returns({ ... })
```

Prototype stubs apply to every instance (including the one already created
inside index.js). Restore in `afterEach` with `sinon.restore()`.

**Function-export modules** (those that export a plain function or object, not
a class) are stubbed by replacing the exported property directly:

```js
const aboutInfo = require('./aboutInfo')
sinon.stub(aboutInfo, 'getAbout').returns({ ... })
```

### No-res handlers: fire-and-forget + stub-poll

Some upstream route handlers take `(req)` with no `res` parameter — they fire
side effects but never call `res.json()` or `res.send()`, so the request hangs
indefinitely. Test them by sending the request without awaiting a response,
then polling a stub until the side-effect fires:

```js
// fire-and-forget (no await)
fetch(`http://localhost:${port}/api/shutdowncc`, { method: 'POST', ... })
// poll the stub
await new Promise(resolve => {
  const iv = setInterval(() => {
    if (stub.called) { clearInterval(iv); resolve() }
  }, 20)
})
```

### Hand-built multipart/form-data bodies

`supertest` is not in the project's dependencies. For `multipart/form-data`
endpoints (e.g. `/api/vpnwireguardprofileadd`), build the body manually with
`Buffer.concat` and a fixed boundary string, then send via Node's built-in
`http.request`:

```js
const boundary = '----TestBoundary'
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n`),
  Buffer.from(`--${boundary}--\r\n`)
])
// set Content-Type: multipart/form-data; boundary=----TestBoundary
```

### NODE_ENV juggling with mandatory restore

Tests that cover production-mode branches (e.g. the `authenticateToken`
middleware behaves differently when `NODE_ENV === 'production'`) must always
restore the original value — even if the test assertion throws:

```js
const saved = process.env.NODE_ENV
try {
  process.env.NODE_ENV = 'production'
  // ... test
} finally {
  process.env.NODE_ENV = saved
}
```

A missing restore silently poisons every subsequent test in the file.

### JWT `iat` collision spacing

JWTs include an `iat` (issued-at) claim with second-level precision. Two
tokens minted within the same second are byte-identical, so a test that signs
two different tokens in rapid succession may receive stale cached ones.
Insert a 1-second gap (`await new Promise(r => setTimeout(r, 1100))`) between
minting tokens, or use sinon fake time to advance the clock between mints.

### Timeouts for suites that mix `execSync`, sleeps, or bcrypt under load

Mocha's default per-test timeout is 2 s. Under a loaded CI box (or a
heavily-loaded WSL instance), any of the following can silently exceed that
budget:

- **`execSync` spawning a fake `sudo`** — the OS needs to fork, exec, and
  wait; measured at >2 s ~1 run in 3 under load. Raise the enclosing
  `describe` to at least `this.timeout(10000)`.
- **`before()` hooks that space JWT mints** — three 1.1 s `iat` sleeps already
  consume 3.3 s; add two bcrypt logins (~900 ms each on Pi-class hardware) and
  only ~0.8 s of headroom remains against a 5 s hook timeout. Raise such
  `before()` hooks to **20 s**.

The rule of thumb: set the timeout to the sum of all mandatory sleeps + at
least 3× the cost of the most expensive operation, rounded up to the next
round number.

### Scenario-driven fake `sudo` dispatcher

One `FakeBin` `sudo` script dispatches on `case "$*" in` patterns plus a
`$FAKE_SCENARIO` environment variable — covers every `nmcli`/`iw`/`pppd`
invocation shape. Use separate scenarios for `exit 1` (→ `error`) and
`stderr + exit 0` (→ `stderr`): istanbul counts each `||` operand
independently.

### Fake `awk` with real fall-through

A fake `awk` that delegates to the real binary must use an absolute path:
`exec /usr/bin/awk "$@"` — a relative path recurses into the fake via PATH.

### sinon fake timers with child processes

`sinon.useFakeTimers()` by default fakes `setImmediate`, which silently
blocks child-process `close`/`stdout` event delivery. When a test mixes a
fake clock with child processes or sockets, always scope the fake:

```js
const clock = sinon.useFakeTimers({
  toFake: ['setTimeout','clearTimeout','setInterval','clearInterval']
})
```

Prefer `await clock.tickAsync(n)` over synchronous `.tick(n)`.

### `uncaughtException` in child-process / socket callbacks

An assertion throwing inside a child-process or socket callback becomes an
`uncaughtException`; `server/index.js`'s process-wide handler then shuts
down the whole mocha run with no summary.

**Rule:** every assertion inside such callbacks goes in `try/catch + done(e)`.

For code that intentionally throws inside async callbacks (e.g.
`networkManager`'s `netmask2CIDR`), use a listener-swap pattern:

```js
const saved = process.listeners('uncaughtException')
process.removeAllListeners('uncaughtException')
process.once('uncaughtException', (err) => {
  // assert on err
  saved.forEach(h => process.on('uncaughtException', h))
  done()
})
```

### Double-callback guards and silent fall-throughs

- `return callback(e)` inside a `forEach` only exits the iteration — the
  tail callback still fires. Guard tests with a `finished` flag.
- Incomplete `if/else-if` chains with no final `else` fire and forget — test
  them by invoking then `setTimeout(done, 300)` (no assertion possible).

### MAVLink byte injection

Write crafted MAVLink v2 buffers directly to `mavManager`'s `inStream`
(a `PassThrough`) — no UDP socket needed. A msgid with a magic number in
mavlink-mappings but absent from the node-mavlink REGISTRY exercises the
`!clazz` dispatch branch.

UDP-port hygiene: `mavManager` binds at construction; use one distinct port
per test instance, call `m.close()` in `afterEach`. `flightController`
hardcodes 14540 — keep that port free.

### mavManager missing methods (upstream bug)

`flightController.startBinLogging()` / `stopBinLogging()` call
`sendBinStreamRequest()` / `sendBinStreamRequestStop()` on the mavManager
instance, but these methods do not exist in `mavManager.js`. Tests inject a
stub mavManager object with those methods rather than using a real instance.

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

### `<select>` onChange — set value via native prototype setter

`test/ui.jsx`'s `setValue` fires an `input` event, which React's synthetic
`onChange` wires to `<input>` elements but **not** to `<select>`. For select
elements, use the native `HTMLInputElement` prototype setter to update `.value`
and dispatch a bubbling `change` event:

```jsx
import { act } from 'react-dom/test-utils'

act(() => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value'
  ).set
  nativeSetter.call(selectEl, 'newValue')
  selectEl.dispatchEvent(new Event('change', { bubbles: true }))
})
```

### Modal errors render in a portal on `document.body`

`basePage`'s error modal is mounted in a React portal outside the test
container. Assert `document.body.textContent`, not `container.textContent`:

```js
assert.ok(document.body.textContent.includes('Something went wrong'))
```

### Per-file coverage truth is `coverage/coverage-final.json`

The vitest text summary omits rows where all four metrics are 100%. To verify a
specific file's numbers after `covfront`, read
`coverage/coverage-final.json` — every file is present regardless of score.

### `lastSocket()` — unmount before rendering the next page

`lastSocket()` from `test/socketMock.js` returns the most recently constructed
mock socket. If two page components are mounted concurrently (or a prior test
left a mounted page), `lastSocket()` returns the wrong instance. Always call
`page.unmount()` at the end of each test (or in `afterEach`) before rendering
the next page under test.

### Never run two vitest coverage processes concurrently

Both share the `coverage/` output directory; concurrent runs corrupt each
other's output and produce wrong totals. During development, iterate with
single-file targeted runs (no coverage) and run the full gate only once:

```
npx vitest --run src/mypage.test.jsx          # fast, no coverage
npm run covfront                              # full gate, once
```

### v8 ignore placement rules

`ast-v8-to-istanbul` resolves `/* v8 ignore next */` by requiring the comment
end to be adjacent to the AST node start (getIgnoreHint: comment end == node
start). Practical consequences:

- Expression-level annotation: place the comment **inline, immediately before
  the expression** — no whitespace gap between comment end and node.
- Implicit-else / if-falsy arms have no source location in the AST. These
  cannot be annotated inline; only `/* v8 ignore start */` ... `/* v8 ignore stop */`
  blocks work, wrapping the entire if/else-if construct.
- If an if/else-if false branch is reachable in principle but cannot be driven
  by the test layer, **exhaust test approaches first** (ref pattern, module
  reset, state injection) before annotating. An ignore hides regressions; a
  test catches them.

### Ref pattern for class component handlers

Attach a `ref` callback to a class component's root element to capture the
instance, then call handlers directly with crafted state:

```jsx
let inst
const page = renderPage(<MyPage ref={r => { inst = r }} />)
await page.flush()
inst.setState({ someFlag: true })
inst.handleSubmit()   // drives guard chains and catch paths happy-dom can't reach
```

Useful for: deeply-nested guard chains, catch paths that require specific state
combinations, and react-select `(option, actionMeta)` handlers that happy-dom
DOM events cannot trigger.

### MemoryRouter wrapper for pages that use react-router

Pages that render `<Link>` or call `useLocation()` crash without a router
context. Wrap in `<MemoryRouter>` before rendering:

```jsx
import { MemoryRouter } from 'react-router-dom'
const page = renderPage(<MemoryRouter><AppRouter /></MemoryRouter>)
```

### Module-side-effect files (index.jsx, serviceWorker.js)

Files that execute side effects on import (DOM manipulation, `navigator.serviceWorker`
registration) cannot be imported statically in tests — the side effect fires
before stubs are in place. Use `vi.resetModules()` + dynamic `await import()`
inside the test **after** stubbing the environment:

```js
beforeEach(() => vi.resetModules())

test('registers SW', async () => {
  // stub navigator.serviceWorker, #root div, NODE_ENV, etc. first
  global.navigator.serviceWorker = { register: vi.fn().resolves({ ... }) }
  document.body.innerHTML = '<div id="root"></div>'
  await import('../src/index.jsx')   // side effect runs against stubs
})
```

No coverage excludes are needed; every branch is reachable this way.

### localStorage.clear() in afterEach for basePage subclasses

`basePage` reads an auth token from `localStorage` on socket construction. A
stale token from a prior test fires `/api/auth` unexpectedly and trips
`mockFetch`'s "unhandled route" assertion. Clear in `afterEach`:

```js
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })
```

### Stub URL methods, not the URL global

`happy-dom` uses the `URL` constructor internally. Replacing `global.URL`
breaks happy-dom's own event handling. Stub only the methods under test:

```js
vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
```

### Per-test fixture factories for state-mutating handlers

Pages that mutate a shared `this.state` object directly in handlers (e.g.
adhocwifi's `handleAdapterChange`) leave side effects that bleed across tests
when a single fixture constant is shared. Use a factory function:

```js
function makeState() { return { adapters: [...], selected: null, ... } }
// each test: inst.state = makeState() before driving the handler
```

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
