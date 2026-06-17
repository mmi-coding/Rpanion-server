# Feature 37: DroneCAN node enumeration via CAN forwarding

Branch: `feature/dronecan-nodes` → `dev`. See [docs/FC-CONFIG.md](../FC-CONFIG.md).

## Why

Feature 36's FC Configuration page showed the CAN *bus* config (driver/protocol/
bitrate from `CAN_*` params) but the DroneCAN **node list was always empty** —
confirmed on a real Pixhawk (2026-06-17): ArduPilot does not stream
`UAVCAN_NODE_STATUS/INFO` over MAVLink, so there is nothing to enumerate passively.
Real enumeration needs **CAN forwarding** (`MAV_CMD_CAN_FORWARD` + `CAN_FRAME`) and
a DroneCAN (UAVCAN v0) decoder — the same mechanism Mission Planner's DroneCAN
screen uses.

## What

- **`mavlink/mavManager.ts`** — `sendCanForward(bus)` (`common.CanForwardCommand`,
  MAV_CMD_CAN_FORWARD=32000) and `sendCanFrame(bus, id, data[])` (`common.CanFrame`).
- **`server/flightController.ts`** — primary-link `canForward(bus)` / `sendCanFrame(...)`.
- **NEW `server/droneCan.ts`** (`DroneCANMonitor`): `scan(buses)` enables forwarding
  on each bus, re-requesting every ~1 s (forwarding lapses ~2 s on the FC) for a
  scan window; `onCanFrame(packet, data)` decodes the tunnelled frames, builds the
  node table from NodeStatus and fires a GetNodeInfo request for each newly-seen
  node; `getNodes()` / `stop()`. Pure helpers (`parseCanId`, `parseTail`, a
  `Reassembler` for single/multi-frame transfers, `decodeNodeStatus`,
  `decodeNodeInfo`) are exported as statics for direct unit testing. Decoding is
  lenient — the 2-byte transfer CRC is stripped, not validated.
- **`server/index.ts`** — instantiate `DroneCANMonitor(fcManager)`, feed `CanFrame`
  (msgid 386) from the existing `gotMessage` handler, emit `DroneCANNodes` on the
  1 Hz loop, expose on `testHooks`.
- **`server/routes/fcConfig.ts`** — `POST /api/FCDroneCANScan` (default buses 0+1,
  out-of-range filtered) and `GET /api/FCDroneCANNodes`.
- **`server/fcParams.ts`** — removed the superseded best-effort telemetry node
  decoder; `getOverview().can` is now `{ ports, drivers }` only.
- **`src/fcconfig.jsx`** — the CAN / DroneCAN section gains a **Scan DroneCAN bus**
  button + scanning state and a live node table (Node · Name · Health · Mode ·
  Uptime · SW/HW) fed by the `DroneCANNodes` socket event; `HelpTip`s.
- Read-only: the only injected frames are standard empty GetNodeInfo requests.

## Tests / coverage

- `server/droneCan.test.js` (mocha + sinon fake timers + spy fcManager) —
  `parseCanId` (message/service), `parseTail`, `decodeNodeStatus` (+ short reject),
  `decodeNodeInfo` (with/without COA, + short reject), `Reassembler` (single,
  multi, no-start, transfer-id mismatch, duplicate-toggle drops), the scan
  lifecycle (immediate + 1 s re-forward + auto-stop), `onCanFrame` junk-frame
  guards + service/message-type filters, NodeStatus→node + GetNodeInfo request,
  GetNodeInfo response fills name/versions (incl. info-before-status), unknown-mode
  fallback, node sorting.
- `mavlink/mavManager.test.js` — `sendCanForward` / `sendCanFrame` msgid bytes.
- `server/flightController.test.js` — `canForward`/`sendCanFrame` primary-link
  routing (no-link / no-mavManager paths).
- `server/index.io.test.js` — `POST /api/FCDroneCANScan` (+ default + filter),
  `GET /api/FCDroneCANNodes`.
- `src/fcconfig.test.jsx` — scan button POST + scanning state, `DroneCANNodes`
  socket populates the table (incl. em-dash fallbacks), scan-error modal.
- Both suites remain **100/100/100/100**; `typecheck` + `lint` clean.

## WSL-verified

- The DroneCAN decode + reassembly + scan lifecycle end-to-end via synthetic
  CAN_FRAME sequences (single NodeStatus frames + chunked multi-frame GetNodeInfo
  responses). node-mavlink `CanForwardCommand` / `CanFrame` shapes confirmed
  against the installed package.

## On-device results (2026-06-17, ArduPlane FC over Ethernet)

Bringing the scan up against a real FC found two bugs (now fixed) and one
remaining FC-side limitation:

- **Fixed — `MAV_CMD_CAN_FORWARD`/`CAN_FILTER_MODIFY` bus is 1-based.** Per
  `AP_CANManager/AP_MAVLinkCAN.cpp` (`bus = param1 - 1`, `param1 0 disables`), our
  0-based request *disabled* forwarding on bus 0. Now `bus + 1`. (`CAN_FRAME`
  itself is 0-based — left as-is.)
- **Fixed — added `CAN_FILTER_MODIFY`.** The FC forwards into a ~20-frame buffer
  that overflows under bus load; we now filter to NodeStatus (msg 341) + GetNodeInfo
  (svc 1), sorted ids (the FC binary-searches), cutting traffic ~45× (1224→~27
  frames/scan).
- **Fixed — only reassemble GetNodeInfo responses addressed to us.** The autopilot
  also polls GetNodeInfo; its responses share the node's source id, so under one
  reassembly key they interleaved with ours. Now filter on `dest == OUR_NODE_ID`.
- **Works:** node discovery, health/mode/uptime (live, ticking), and CAN bus
  config — validated against the real node.
- **Limitation (root-caused) — GetNodeInfo names don't resolve on this FC.** With
  all of the above (filter active, dest-filtered to our responses, tiny traffic),
  every multi-frame GetNodeInfo response is still truncated: we receive the first
  1–3 frames with clean, non-interleaved per-transfer-id sequences but **never an
  end-of-transfer frame**, so reassembly never completes. The **USB-link test was
  decisive** — it reproduces identically over a direct USB MAVLink link *and* over
  Ethernet/UDP, ruling out the link and mavlink-router. It is a flight-controller
  CAN-forward limitation (the FC drops the tail of each burst, likely CAN RX-FIFO /
  forward-queue), not a decode bug — the decoder is unit-tested against full
  synthetic multi-frame responses. Names are therefore not retrievable via CAN
  forwarding on this FC; discovery/health/uptime/bus-config are the useful output.

## Needs-on-device (remaining)

Appended to `docs/ONDEVICE-CHECKLIST.md`: confirm NodeStatus **health/mode bit
decoding** on a non-OK node (UAVCAN v0 MSB-first) vs Mission Planner; confirm
behaviour with a node on **CAN bus 2**; no adverse effect on the live bus. (Node
names are a known FC-side limitation — not expected to resolve.)
