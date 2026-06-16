# Feature 35: MAVLink Inspector (webUI live FC telemetry)

Branch: `feature/mavlink-inspector` → `dev`. See [docs/MAVLINK-INSPECTOR.md](../MAVLINK-INSPECTOR.md).

## Why

The webUI exposed only a small, fixed slice of MAVLink: the Flight Controller
page's status card (connection, packets, vehicle type/FW, position) and the video
HUD overlay's ~44 fields — and the HUD telemetry is only parsed *while a HUD video
stream is running*. There was no way to see the FC's live data in the webUI on its
own; users had to attach a ground station. This feature adds that view.

## What

- **`server/mavTelemetry.ts`** — a `MavTelemetry` accumulator. `onMessage(packet,
  data)` records the latest decoded value of every message type, keyed by the
  node-mavlink canonical `MSG_NAME` (falling back to `UNKNOWN_<id>`), flattening
  scalar fields and stringifying arrays/objects. It tracks an exponentially
  smoothed inter-message interval → rate. `getSnapshot()` returns a name-sorted
  array with `rate` (Hz), `count`, a `stale` flag (>5 s since last update) and the
  fields. `clear()` empties it.
- **`server/index.ts`** — instantiate `mavTelemetry`, feed it from the existing
  `fcManager` `'gotMessage'` handler (alongside ntrip/video/camera consumers), and
  emit `io.sockets.emit('MAVTelemetry', mavTelemetry.getSnapshot())` on the 1 Hz
  `FCStatusLoop`. No new MAVLink requests are sent — purely passive.
- **`src/mavinspector.jsx`** — new page subscribing to `MAVTelemetry`. Curated
  summary cards (attitude/speed/GPS/battery/status, derived from the snapshot with
  unit scaling) + a full inspector table (rate/id/count, click-to-expand fields,
  stale badge, name filter). Self-documenting: intro sentence, HelpSection, filter
  HelpTip.
- **`src/AppRouter.jsx`** — route `/mavinspector` and a **Flight** group nav entry
  (`MAV`).

## Tests / coverage

- `server/mavTelemetry.test.js` (mocha) — null/headerless packets, known +
  unknown ids, scalar/array/object/null/undefined fields, first-vs-repeat rate
  seeding + smoothing, sort order, stale flag, clear.
- `src/mavinspector.test.jsx` (vitest) — waiting/empty state (null helpers →
  "—"), full snapshot (scaled summary values, armed, inspector rows, stale
  badge), expand/collapse, filter via the input `onChange`, disarmed + null + string
  field handling, reconnect handler.
- Both suites remain **100/100/100/100**; `typecheck` + `lint` clean.

## WSL-verified

- Backend accumulator logic, the snapshot shape/rate/stale maths, and the page
  rendering (summary scaling, expand, filter, stale) — via unit/UI tests with
  mocked data. node-mavlink `MSG_NAME` + field enumeration confirmed against the
  installed package.

## Needs-on-device

Appended to `docs/ONDEVICE-CHECKLIST.md` — confirm the page shows real live values
from a connected FC (Pixhawk 6X over the Ethernet/UDP link), that rates are
plausible, the summary tracks the vehicle, and stale appears when a message stops.
