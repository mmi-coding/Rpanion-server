# Feature 24 report: Telemetry injectors (HTTP/UDP/serial → MAVLink)

**Branch:** `feature/telemetry-injectors`, merged `--no-ff` into `dev` (`4361ac9`)
**Status:** complete, WSL-verified (encoding + all three sources + UI); live MAVLink delivery to a GCS is on-device
**Docs:** `docs/TELEMETRY-INJECTORS.md` · `docs/ROADMAP.md` · `docs/ONDEVICE-CHECKLIST.md` (feature 24)

Completes **ROADMAP §B1** — the last buildable-now UAVcast-Pro-6 parity feature.

## What was built

A `/telemetryinjector` page + service that lets external processes push sensor
data into the MAVLink stream so custom readings appear in the GCS alongside the
autopilot telemetry, without opening a separate GCS link.

- **Backend (`server/telemetryInjector.js`)** — self-contained:
  - **Encoding:** `encodeFloat(name,value)` → `NAMED_VALUE_FLOAT` (name capped 10),
    `encodeText(text,severity)` → `STATUSTEXT` (text capped 50, severity default
    6/INFO), via `new MavLinkProtocolV2(sysid, compid).serialize(...)` (node-mavlink).
  - **Funnel:** `ingest({name,value}|{text,severity})` routes to the right encoder
    and updates counters; `_ingestLine()` parses one NDJSON line for the UDP/serial
    sources.
  - **Sources:** HTTP (via the route below), UDP (`dgram` bind, NDJSON datagrams),
    serial (`SerialPort` + `ReadlineParser`). Transport is isolated behind two seams
    (`_send` dgram→`127.0.0.1:14540`, `_makeSerial`) so the module is fully testable
    without hardware. The master switch auto-starts enabled sources in the
    constructor; `setSettings()` validates then restarts the listeners.
  - `canInjectHttp()` seam gates the HTTP route (stubbable in route tests).
- **Endpoints (`server/index.js`)** — `GET /api/telemetryinjector` (settings+status),
  `POST /api/telemetryinjectormodify` (express-validator on every field, restarts
  listeners), `POST /api/telemetryinject` (one reading; **409** when the injector or
  HTTP source is disabled, **422** on a malformed reading). Live status pushed over
  socket.io as `TelemetryInjectorStatus` from the FC status loop; `quitting()` wired
  into graceful shutdown.
- **Frontend (`src/telemetryinjector.jsx`)** — basePage page: status table (per-source
  state, counters, last reading) + settings form (master/HTTP/UDP/serial toggles,
  UDP port, serial device/baud, sys/comp ID). Self-documenting (HelpSection with the
  reading-shape table + curl/nc examples, HelpTip on all 9 controls). Wired into
  `AppRouter` (import/Link/Route) + `e2e/routes.js` (ROUTES + SELF_DOCUMENTING_PAGES).

## Design decisions

- **Why a new module, not videostream/mavManager:** injection is a distinct concern
  (external data → MAVLink) and a fresh file keeps it at 100% without re-covering the
  large existing modules. mavManager already binds `14540`; sending *to* the router
  endpoint (which is bidirectional/routed) reuses the existing rebroadcast path, so no
  new GCS wiring is needed.
- **Generic mapping (NAMED_VALUE_FLOAT + STATUSTEXT):** per the chosen scope — any GCS
  understands these without a custom dialect, so arbitrary sensors "just work."
- **Seams over mocks:** `_send`/`_makeSerial`/`canInjectHttp` mirror the fork's
  established testing seam pattern; the real serial open path is exercised against a
  pty (`test/fakeModemPty.js`), real UDP against an ephemeral loopback socket.

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (947 passing). `telemetryInjector.test.js`
  drives encode/ingest/`_ingestLine`, the UDP listener (real bind, NDJSON + bad line +
  emitted error), the serial listener (fake PassThrough + real pty + open-failure),
  `start()` source branches, `_send` socket create/reuse (+ send callback),
  `canInjectHttp`, and `setSettings` apply/disable/invalid. `index.routes.test.js`
  covers the three endpoints by stubbing the prototype (GET 200; modify 422/200/422 +
  string-boolean coercion; inject 422/409/200/422).
- Frontend `covfront`: **100/100/100/100** (813 passing). `telemetryinjector.test.jsx`
  covers all status-badge and last-reading branches (all-on / off / name-only /
  text-only), socket push, save (checkbox + parsed ints), the non-checkbox change
  branch, reconnect re-fetch, and the fetch-reject / !ok / data.error / POST-throw
  paths; asserts the 9 HelpTips + HelpSection (self-documenting rule).
- e2e: **68 passed** — `/telemetryinjector` added to smoke, navigation and
  self-documenting sets. `npm run lint` clean; `npm run build` OK.

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 24)

With mavlink-router live and a GCS connected: confirm injected NAMED_VALUE_FLOAT /
STATUSTEXT actually appear in the GCS; UDP from another host; a real serial device;
component ID attribution; master-switch off → 409 + boot auto-start of saved state;
read-only users blocked (403).
