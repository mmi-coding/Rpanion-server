# Feature 33 — Multiple serial telemetry links (#311)

Implements upstream feature request [#311](https://github.com/stephendade/Rpanion-server/issues/311):
connect to **more than one** MAVLink telemetry source at once (e.g. a flight
controller on the GPIO UART plus a second autopilot / radio / MAVLink device on
USB, or a UDP source) and route them all to the ground station over the cellular
link.

## Architecture — N independent links (chosen with the user)

The Flight Controller page was single-link: one `activeDevice` → one
`mavlink-routerd` → shared outputs + one `mavManager` monitor that locked onto the
first heartbeat's sysid and ignored everything else. This feature makes it
multi-link, with **full per-link status** by giving **each link its own router +
its own monitor** (the single-vehicle `mavManager` reused unchanged, N times). The
upside over a single merged router is **fault isolation**: one link dropping out
(or its router crashing) does not affect the others.

- **`server/fcLink.ts` (new) — `FCLink`**: one link's entire lifecycle — its own
  `mavlink-routerd`, its own `mavManager` on a per-link loopback monitor port
  (`14540 + 2·slot`), auto-reconnect loop, optional DataFlash logger, binlog
  tracking and `getStatus()`. Emits `gotMessage`/`armed`/`disarmed`/`newLink`/
  `stopLink` up to the orchestrator tagged with the link id.
- **`server/flightController.ts` — `FCDetails`** is now the orchestrator of an
  `FCLink[]`: `addLink` / `removeLink` (validated, de-duplicated, capped at 4),
  `setGlobalOptions`, shared UDP-output management (restarts every link), per-link
  + aggregate status, settings persistence, and **MAVLink fan-out** methods
  (`sendRTCMMessage` / `sendCommandAck` / `sendHeartbeat` / `sendData`) that reach
  every connected vehicle.
- **`server/index.ts`**: RTCM injection, camera-protocol responses and heartbeats
  now fan out to all links via those methods; the `gotMessage` handler receives
  the originating link so the camera-switcher requests `RC_CHANNELS` from the right
  vehicle. `FCStatus` now carries `getAllStatus()` = `{ …primaryStatus, links:[] }`
  — the primary vehicle is spread at the top level so the dashboard
  (`home.jsx`, `camera.ts` geotag, `system.ts` binlog) keeps working unchanged,
  while the Flight Controller page reads the per-link `links` array.
- **`server/routes/flightController.ts`**: `GET /api/FCDetails` (ports + options +
  links list), `POST /api/FCAddLink`, `POST /api/FCRemoveLink`, `POST /api/FCOptions`
  (replacing the single `/api/FCModify`); `/api/FCReboot` reboots all vehicles.
- **`src/flightcontroller.jsx`**: rewritten into an **add-link form** + a **status
  card per link** (live status + a Remove button) + the shared destinations/options
  with an **Apply** button. Self-documenting (intro + collapsed `HelpSection` +
  `HelpTip`s per the UI guidelines).

## Design decisions (documented limitations)

- **Shared GCS outputs** (the UDP-client destination list) go to **every** link, so
  all vehicles reach all destinations — the ground station tells them apart by
  MAVLink system id (standard). This is the path to use for multiple vehicles over
  the cellular/VPN link.
- **UDP Server (broadcast `:14550`) and TCP Server (`:5760`)** bind a fixed port, so
  they can only carry the **primary (first / slot 0) link**. Documented in the page's
  HelpSection.
- **DataFlash logging** captures the **primary link** (avoids multi-logger filename
  collisions).
- **Settings migration**: an existing single `flightcontroller.activeDevice` is
  migrated into a one-element `flightcontroller.links` array on first load, so
  current Pi configs keep working after the upgrade.
- Links are **capped at 4** (bounds the per-link loopback port range).

## Verification — WSL-verified

- `lint` 0 · `typecheck` 0 · `covback` **100/100/100/100** (980 passing) ·
  `covfront` **100/100/100/100** (825 passing).
  - New `server/fcLink.test.js` (the link lifecycle against fake `mavlink-routerd` /
    `mavManager` — start branches, binlog, reconnect, dflogger, status, destroy).
  - Rewritten `server/flightController.test.js` (orchestration with `FCLink` stubbed
    — add/remove/validate/duplicate/max, fan-out, options, migration, restore).
  - `server/index.io.test.js` updated for the fan-out methods + new routes.
  - Rewritten `src/flightcontroller.test.jsx` for the add-link / per-link-card UI.
- The hard constraint is respected: the user picks which serial ports are FC links,
  so the modem's own serial port is never grabbed.

## Needs on-device

- [ ] Two telemetry sources at once (e.g. FC on `/dev/serial0` + a second MAVLink
  device on USB) → both appear as separate link cards with independent live status,
  and both vehicles show up in Mission Planner via a UDP-client destination.
- [ ] Pull one link's cable → only that card goes "Not connected" and auto-reconnects
  when replugged; the other link is unaffected.
- [ ] Confirm the UDP-Server/TCP-Server outputs carry the first link, and an explicit
  UDP-client destination carries all vehicles.
- [ ] Existing single-link Pi config still works after upgrade (migrated to one link).
