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
| **CAN / DroneCAN** | `CAN_Px_DRIVER/BITRATE`, `CAN_Dx_PROTOCOL` params + `UAVCAN_NODE_STATUS/INFO` telemetry (best-effort) |
| **Ethernet (NET_)** | `NET_*` parameters (on the Flight Controller page) |

Click **Refresh parameters** (or **Refresh from FC** on the FC page) to
(re)download. On a fast link (Ethernet/USB) it takes a few seconds; over a
constrained telemetry radio it takes longer, with a live progress bar. Re-run
after changing FC settings to update the page. Live progress is pushed on the
existing 1 Hz status loop as the `FCParamStatus` socket.io event; the decoded
overview is fetched over `GET /api/FCConfigOverview`.

## Notes & limits

- **Read-only.** This feature only *reads* parameters. A future feature can add
  `PARAM_SET` + an editor on top of the same `fcParams` cache.
- **Sensors / servo PWM / nodes are a snapshot** taken when the overview is
  fetched (after a download completes or on a manual refresh), not a continuous
  live feed.
- **DroneCAN node enumeration is best-effort.** MAVLink `UAVCAN_NODE_STATUS`
  carries no node id and the telemetry store keeps only the latest message, so the
  node list may be incomplete; the CAN *bus* configuration (driver/protocol/
  bitrate) comes from parameters and is reliable. Full node enumeration generally
  needs CAN forwarding from the FC — see the on-device checklist.
- Serial-protocol and servo-function enums cover the common ArduPilot values with
  a numeric fallback (`Protocol 999`, `Function 12345`) for anything unmapped.

## API

- `POST /api/FCParamRefresh` — start a full parameter download; returns
  `{ started, state, received, total }`.
- `GET /api/FCConfigOverview` — the decoded overview
  `{ state, received, total, sensors, serial, servos, can, net }`.
- socket.io `FCParamStatus` — `{ state, received, total }`, pushed every second.
