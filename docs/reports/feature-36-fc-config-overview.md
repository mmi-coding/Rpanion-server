# Feature 36: FC Configuration overview (read-only)

Branch: `feature/fc-config-overview` → `dev`. See [docs/FC-CONFIG.md](../FC-CONFIG.md).

## Why

The webUI could show *live telemetry* (MAVLink Inspector) and configure *telemetry
links* (Flight Controller page), but gave no picture of **how the connected FC is
actually configured**: its sensors, what's on each serial port, the servo output
assignments, the CAN/DroneCAN bus, or — specifically requested — its Ethernet
(`NET_*`) parameters. You had to open Mission Planner's full parameter list. The
blocker was that the fork had **no parameter-read path** at all (`mavManager` sent
commands but never `PARAM_REQUEST_*`, and nothing cached `PARAM_VALUE`).

## What

- **`mavlink/mavManager.ts`** — `sendParamRequestList()` (`PARAM_REQUEST_LIST`) and
  `sendParamRead(index)` (`PARAM_REQUEST_READ`), mirroring the existing `sendX`
  command helpers (target sys/comp from the locked vehicle).
- **`server/flightController.ts`** — `requestParams()` / `requestParam(index)` that
  drive the **primary** link only (parameters come from one vehicle, not the
  multi-link fan-out).
- **`server/fcParams.ts`** (new, `FCParams`) — the parameter cache + download
  orchestration. `onMessage` captures `PARAM_VALUE` (name→value/type/index, total
  count, seen-index set). `requestAll()` starts a download and runs a watchdog:
  re-requests missing indices when the stream stalls, settling `complete` /
  `partial` / `failed`. `getProgress()` → `{state, received, total}`.
  `getOverview()` decodes the cached params + a `mavTelemetry` snapshot into
  `{ sensors, serial, servos, can, net }` using enum/bitmask tables with numeric
  fallbacks. Sensors come from the `SYS_STATUS` bitmask; live servo PWM from
  `SERVO_OUTPUT_RAW`; best-effort DroneCAN nodes from `UAVCAN_NODE_STATUS/INFO`.
- **`server/index.ts`** — instantiate `FCParams(fcManager, mavTelemetry)`, feed it
  from the existing `gotMessage` handler, emit `FCParamStatus` on the 1 Hz loop,
  expose it on `testHooks`.
- **`server/routes/fcConfig.ts`** (new) — `POST /api/FCParamRefresh`,
  `GET /api/FCConfigOverview`.
- **`src/fcconfig.jsx`** (new) — the FC Configuration page: Sensors / Serial /
  Servos / DroneCAN sections, a **Refresh parameters** button and a live progress
  bar (subscribes to `FCParamStatus`, refetches the overview on completion).
- **`src/flightcontroller.jsx`** — an **Ethernet (`NET_`) parameters** card under
  the existing Ethernet HelpSection (decoded `NET_*` + per-port table, its own
  refresh + progress), sharing the same backend.
- **`src/fcConfigShared.js`** (new) — `fmt` / `onoff` / `stateVariant` formatters
  shared by both pages. **`src/AppRouter.jsx`** — route `/fcconfig` + a **Flight**
  nav entry (`CFG`).
- Read-only by design (no `PARAM_SET`); self-documenting (intro + HelpSection +
  per-control HelpTips).

## Tests / coverage

- `server/fcParams.test.js` (mocha + sinon fake timers) — onMessage guards +
  caching + completion; `requestAll` start/fail; every `_tick` watchdog branch
  (waiting, no-response timeout, complete, stall re-request, batch cap, partial,
  not-stalled); `getOverview` decoding (serial/servo/CAN/NET enums + fallbacks,
  sensor bitmask incl. missing-field `||0`, DroneCAN node both/status-only/
  info-only, empty/safe overview).
- `mavlink/mavManager.test.js` — `sendParamRequestList` / `sendParamRead` emit
  well-formed v2 frames (msgid bytes), via the existing UDP-listener pattern.
- `server/flightController.test.js` — `requestParams`/`requestParam` primary-link
  routing incl. the no-link and link-without-mavManager paths.
- `server/index.io.test.js` — `POST /api/FCParamRefresh`, `GET /api/FCConfigOverview`.
- `src/fcconfig.test.jsx` + extended `src/flightcontroller.test.jsx` (vitest) —
  waiting/empty/populated/partial states, all section + node-cell branches, the
  NET card (null / unset / present / complementary value branches), refresh POST,
  `FCParamStatus`-driven refetch + progress bar, failed alert, fetch/refresh error
  modals, reconnect. New `src/fcConfigShared.test.jsx` covers the formatters.
- Both suites remain **100/100/100/100**; `typecheck` + `lint` clean.

## WSL-verified

- The download lifecycle (request → accumulate → completion → stall re-request →
  partial/failed) and the overview decoding — via unit tests feeding synthetic
  `PARAM_VALUE` packets + telemetry snapshots. node-mavlink `PARAM_*` /
  `UAVCAN_NODE_*` / `SYS_STATUS` / `SERVO_OUTPUT_RAW` field names and the sensor
  bitmask confirmed against the installed package. Page rendering (sections,
  progress, refresh, error paths) via UI tests with mocked fetch + socket.

## Needs-on-device

Appended to `docs/ONDEVICE-CHECKLIST.md` — a real full parameter download against a
Pixhawk 6X (completeness + timing over Ethernet vs a telemetry radio), live `NET_*`
matching Mission Planner, serial/servo decode against a known airframe, sensor
present/health tracking, and **DroneCAN node enumeration** (depends on the FC
forwarding `UAVCAN_NODE_STATUS/INFO` over MAVLink — verify whether nodes appear at
all; CAN bus config from params should always show).
