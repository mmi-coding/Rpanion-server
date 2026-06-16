# MAVLink Inspector

Live view of the MAVLink telemetry the flight controller is sending, **in the
webUI** — no ground station required. Reachable at **Flight → MAVLink Inspector**
(`/mavinspector`).

## What it shows

- **Summary cards** — common flight values pulled out of the stream: attitude
  (roll/pitch/yaw, heading), speed & altitude (airspeed, ground speed, MSL alt,
  climb, throttle), GPS (fix type, satellites, lat/lon, relative alt), battery
  (voltage, current, remaining), and status (armed, custom mode, RC RSSI).
- **Inspector** — every MAVLink message the FC sends, with its update **rate**
  (Hz) and total **count**. Click a row to expand its raw decoded fields. A
  **stale** badge marks a message that has not updated in over 5 s. A **filter**
  box narrows the list by message name.

It updates whenever an FC link on the **Flight Controller** page is connected
(serial or UDP) — it does *not* require a video stream or a GCS.

## How it works

- **Backend** (`server/mavTelemetry.ts`): a `MavTelemetry` accumulator taps the
  existing `fcManager` `'gotMessage'` stream (`server/index.ts`) and keeps the
  latest decoded value of every message type, keyed by its canonical
  `MSG_NAME`, plus a smoothed inter-message interval → rate. A name-sorted
  snapshot (`getSnapshot()`) is emitted as the `MAVTelemetry` socket.io event on
  the same 1 Hz loop that already pushes `FCStatus`.
- **Frontend** (`src/mavinspector.jsx`): subscribes to `MAVTelemetry`, derives
  the summary cards from the snapshot, and renders the expandable inspector.

No new packets are requested from the FC — the inspector is purely passive over
what the vehicle already streams (raise stream rates on the FC, or enable
datastream requests on the Flight Controller page, if a message is missing).

## Limitations

Read-only. For sending commands, changing parameters, or plotting graphs, connect
a ground station (Mission Planner / QGC / MAVProxy) to a TCP/UDP output on the
Flight Controller page and use its own MAVLink inspector.

## Verification

- **WSL-verified:** backend accumulator (unit-tested incl. rate/stale/unknown-id
  handling) and the page (rendered with mocked snapshots — summary scaling,
  expand/collapse, filter, stale badge) — both suites at 100%.
- **Needs-on-device:** see `docs/ONDEVICE-CHECKLIST.md` — confirm the page shows
  real, live values from a connected FC and that rates look sane.
