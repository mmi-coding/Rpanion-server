# FC Configuration page

*Read-only* overview of how the connected flight controller is set up — what
sensors it has, what's on each serial port, what the servo outputs are assigned
to, and what's on the CAN/DroneCAN bus. The Flight Controller page additionally
shows the FC's Ethernet (`NET_*`) parameters. Reach it at **Flight → FC
Configuration** (`/fcconfig`).

This is the missing middle ground between the **MAVLink Inspector** (live
telemetry, but raw) and **Mission Planner** (full parameter editor): it answers
"how is this FC wired up?" without leaving the webUI and without a ground station.

## How it works

The webUI has **no parameter editor**. To show serial/servo/CAN/NET configuration
(which lives in FC *parameters*, not telemetry), the backend downloads the
flight controller's **entire parameter set** once and caches it:

- `mavManager.sendParamRequestList()` asks the FC to stream every parameter
  (`PARAM_REQUEST_LIST`). Each `PARAM_VALUE` carries the total count and its own
  index, so the download knows when it is complete.
- `server/fcParams.ts` (`FCParams`) accumulates the values, tracks progress, and
  — if the stream stalls with indices missing — re-requests the gaps
  (`sendParamRead` → `PARAM_REQUEST_READ`), exactly like a ground station. States:
  `idle → downloading → complete` (or `partial` if some params never arrive, or
  `failed` if no FC responds).
- `getOverview()` decodes the cached parameters plus a snapshot of the live
  telemetry (`server/mavTelemetry.ts`) into a structured, read-only overview.

Data sources, by section:

| Section | Source |
|---|---|
| **Sensors** | `SYS_STATUS` telemetry `onboard_control_sensors_*` bitmask (present / enabled / healthy) |
| **Serial peripherals** | `SERIALx_PROTOCOL` / `SERIALx_BAUD` parameters |
| **Servo outputs** | `SERVOx_FUNCTION/MIN/MAX/REVERSED` params + live `SERVO_OUTPUT_RAW` PWM |
| **CAN / DroneCAN** | bus config from `CAN_Px_DRIVER/BITRATE`, `CAN_Dx_PROTOCOL` params; **live node list** from a CAN-forwarding scan (see below) |
| **Ethernet (NET_)** | `NET_*` parameters (on the Flight Controller page) |

Click **Refresh parameters** (or **Refresh from FC** on the FC page) to
(re)download. On a fast link (Ethernet/USB) it takes a few seconds; over a
constrained telemetry radio it takes longer, with a live progress bar. Re-run
after changing FC settings to update the page. Live progress is pushed on the
existing 1 Hz status loop as the `FCParamStatus` socket.io event; the decoded
overview is fetched over `GET /api/FCConfigOverview`.

## DroneCAN node scan

The CAN *bus* config (driver/protocol/bitrate) comes from parameters, but listing
the actual **nodes** on the bus needs more: ArduPilot doesn't stream node status
over MAVLink. **Scan DroneCAN bus** does what a ground station's DroneCAN screen
does — it asks the FC to tunnel the CAN bus over MAVLink (`MAV_CMD_CAN_FORWARD`,
re-requested every second so the tunnel stays open), then speaks DroneCAN
(UAVCAN v0) over the forwarded `CAN_FRAME`s:

- decodes periodic **NodeStatus** broadcasts → node id, health, mode, uptime;
- sends a **GetNodeInfo** request to each discovered node → its **name**
  (e.g. `org.ardupilot.gps`), SW/HW version and unique id.

The scan runs for a few seconds and the node table updates live (pushed as the
`DroneCANNodes` socket.io event). It is **read-only** — the only frames injected
are standard empty GetNodeInfo requests; no node is configured. Backend:
`server/droneCan.ts` (`DroneCANMonitor`).

ArduPilot specifics handled here (from `AP_CANManager/AP_MAVLinkCAN.cpp`):
`MAV_CMD_CAN_FORWARD` and `CAN_FILTER_MODIFY` take a **1-based** bus (we add 1;
`CAN_FRAME` itself is 0-based); forwarding lapses after 5 s (re-requested each
second); and the FC forwards into a small (~20-frame) buffer, so we send a
`CAN_FILTER_MODIFY` (ids sorted, message type 341 + service type 1) to forward
only NodeStatus + GetNodeInfo and keep that buffer from saturating.

**Status / limitation (verified on-device 2026-06-17, Pixhawk 6X):** node
**discovery + health + mode + uptime** and the **CAN bus config** work reliably.
Node **names/versions** (via GetNodeInfo) **do not resolve on this FC**: the
flight controller's CAN-forward path systematically drops the **tail frames** of
each multi-frame GetNodeInfo response (we receive the first 1–3 frames, never the
end-of-transfer frame), so reassembly never completes. This was confirmed to be
**FC-side, not ours**: it reproduces identically over **both Ethernet/UDP and a
direct USB link**, at minimal traffic, with the CAN filter active and responses
filtered to ours only (clean per-transfer-id sequences, none ending). The decoder
itself is correct (unit-tested against full synthetic responses). A node with no
resolved name still shows its id/health/mode/uptime — which is the useful part.

We still send GetNodeInfo (a few retries) in case a node's response is short
enough to fit, and we only reassemble responses addressed to us (the autopilot
also polls GetNodeInfo; its responses share the node's source id and would
otherwise corrupt reassembly).

The alternative transport — **SLCAN** (what Mission Planner's DroneCAN GUI uses) —
was also investigated and is **not viable from the companion over Ethernet** on
this FC: SLCAN-over-USB is bench-only (needs the FC USB cable), and
SLCAN-via-MAVLink (`SERIAL_CONTROL` tunnel) returned no response over the Ethernet
link in testing — SLCAN binds to a *serial* port and our link is a NET port. So for
node **names/params**, use Mission Planner's DroneCAN GUI over a USB/serial SLCAN
connection (bench). Full details: docs/reports/feature-37-dronecan-nodes.md.

## Notes & limits

- **Read-only.** This feature only *reads* parameters and enumerates nodes. A
  future feature can add `PARAM_SET` + an editor on top of the same `fcParams` cache.
- **Sensors / servo PWM are a snapshot** taken when the overview is fetched (after
  a download completes or on a manual refresh), not a continuous live feed.
- **DroneCAN decoding is lenient** (no transfer-CRC validation) — fine for a
  read-only monitor; only NodeStatus + GetNodeInfo are handled (enough to
  enumerate). If no DroneCAN devices are on the bus, the scan simply finds nothing.
- Serial-protocol and servo-function enums cover the common ArduPilot values with
  a numeric fallback (`Protocol 999`, `Function 12345`) for anything unmapped.

## API

- `POST /api/FCParamRefresh` — start a full parameter download; returns
  `{ started, state, received, total }`.
- `GET /api/FCConfigOverview` — the decoded overview
  `{ state, received, total, sensors, serial, servos, can, net }`.
- socket.io `FCParamStatus` — `{ state, received, total }`, pushed every second.
- `POST /api/FCDroneCANScan` — start a DroneCAN scan (optional body `{ buses: [0,1] }`).
- `GET /api/FCDroneCANNodes` — current nodes `{ scanning, nodes[] }`.
- socket.io `DroneCANNodes` — `{ scanning, nodes }`, pushed every second.
