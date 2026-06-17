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
- `server/index.io.test.js` — `POST /api/FCDroneCANScan` (+ default + filter +
  body-less regression: the Scan button sends no body), `GET /api/FCDroneCANNodes`.
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
- **Fixed — the Scan button 500'd (empty-body POST).** Clicking **Scan DroneCAN
  bus** returned *"Unexpected token '<' … is not valid JSON"*: the button POSTs with
  no body, so `express.json()` left `req.body` undefined and the route's
  `req.body.buses` threw → Express's `<!DOCTYPE html>` 500 page → the frontend's
  `r.json()` failed. Initial bring-up missed it because forwarding/decoding was
  driven via the API *with* a JSON body (and both backend tests + the mocked
  frontend test sent one). Now `req.body?.buses`; a body-less regression test was
  added. The default `[0, 1]` bus list already covered the empty case.
- **Works:** node discovery, health/mode/uptime (live, ticking), and CAN bus
  config — validated against the real node.
- **Limitation (SUPERSEDED — see "GUI-parity rework" below; names DO resolve once
  the filter is removed and one bus is forwarded at a time). [Original note:]** With
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

## SLCAN-via-MAVLink investigation (names — not viable over Ethernet, 2026-06-17)

To get reliable names we tried the second documented route — SLCAN, which is what
Mission Planner's DroneCAN GUI uses (a raw CAN tunnel, no 20-frame forward buffer).
Findings, all spiked on-device via pymavlink/node-mavlink against TCP `5760` (no
code shipped — this was a feasibility spike that did **not** pan out):

- **SLCAN-over-USB is bench-only** and was ruled out: it needs the FC USB cable to
  the Pi (`ttyACM1`), which the deployment (FC-over-Ethernet + LTE) doesn't have.
- **SLCAN-via-MAVLink** (preferred; tunnels SLCAN ASCII over `SERIAL_CONTROL`)
  **returned zero `SERIAL_CONTROL` replies** over the Ethernet link across ~7
  attempts — node-mavlink + pymavlink, correctly targeted to the FC, `EXCLUSIVE`,
  polling, with `CAN_SLCAN_CPORT=1` and `CAN_SLCAN_SERNUM=0` set live. The receive
  path is healthy (heartbeats + PARAM_VALUE acks flow), so the FC simply isn't
  engaging the tunnel.
- **Root cause (likely fundamental):** SLCAN attaches to a *serial* port; our link
  is **Ethernet (a NET port, no serial id)**, and with USB unplugged SLCAN on the
  dead SERIAL0 never produces traffic. `CAN_SLCAN_SERNUM` is **non-persistent**
  (live readback `0`, but `-1` after a reboot) — it's designed for a live serial
  session, not an Ethernet tunnel.
- ArduPilot quirks confirmed along the way: avoid `SERIALx_PROTOCOL=22` (arming
  hardfault, ArduPilot issue #30055); the `CAN_FRAME` forward path itself is a known
  rough edge (ArduPilot issue #28187).

**Conclusion (SUPERSEDED by the GUI-parity rework below).** This concluded names
were unobtainable over the link — but that was an artefact of *our* filter + combined
bus loop, not SLCAN-vs-CAN-forward. The `mavcan` (CAN-over-MAVLink) transport we
already use **does** resolve names once it's driven like the reference tool (one bus,
no filter); SLCAN was never needed. The SLCAN findings above remain valid as a record
of why that *other* transport isn't viable over Ethernet, but it's moot now.

## GUI-parity rework — sweep one bus at a time, no filter (2026-06-17)

On a live drone the scan listed only **one** node, on CAN2; a GPS on CAN1 and other
nodes never appeared. Re-checking how the **reference tool** actually gets its data
(rather than assuming) surfaced two divergences in our scan, both now fixed:

- **The FC forwards exactly one bus at a time.** `AP_MAVLinkCAN.cpp` keeps a single
  `can_forward.callback_bus`; a new `MAV_CMD_CAN_FORWARD` *unregisters* the previous
  bus's callback. Our `_forward()` looped `canForward(0)` then `canForward(1)` in one
  pass, so the bus-1 request immediately cancelled bus 0 — **only the last bus in the
  list was ever live** (CAN2), which is exactly why CAN1 nodes were invisible. The
  reference agrees on the constraint: pydronecan's `mavcan` driver (what the **DroneCAN
  GUI Tool** uses; connect string `mavcan:udp:…`) forwards **one bus per driver
  instance**, and Mission Planner exposes a **separate button per CAN port**. Fix: the
  scan now **dwells on each requested bus in turn** (`PER_BUS_MS` = 5 s, re-arming the
  active bus every second; total window = `buses.length × PER_BUS_MS`), rotating
  through them — one **Scan** click still covers every bus.
- **No `CAN_FILTER_MODIFY`.** pydronecan forwards **all** frames by default (the filter
  is opt-in, only sent if a `filter_list` is configured). We had added a filter to
  protect the FC's ~20-frame forward buffer, but it was also the one variable present
  during the multi-frame GetNodeInfo truncation. The scan no longer sends it (the
  `sendCanFilter()`/`canFilter()` wrappers stay for a busy-bus fallback, mirroring
  pydronecan's optional filter). GetNodeInfo retries now target only the bus currently
  being forwarded (a request on a non-forwarded bus goes nowhere).

Sources (primary): DroneCAN spec §4.3 *MAVLink bus transport layer*; pydronecan
`dronecan/driver/mavcan.py` (one bus per instance, `MAV_CMD_CAN_FORWARD` param1 =
`bus+1` re-sent at 1 Hz, `CAN_FILTER_MODIFY` only if configured); ArduPilot
`AP_CANManager/AP_MAVLinkCAN.cpp` (single `callback_bus`, filter-id bit extraction);
ArduPilot DroneCAN GUI docs + Mission Planner DroneCAN/UAVCAN setup (per-port buttons).

**Verified on-device (2026-06-17) — names DO resolve; the earlier "FC-side
limitation" conclusion was wrong.** After the rework the same FC enumerated nodes on
**both** buses with names + versions:

```
10  · CAN2   org.ardupilot:0                  OK  Operational  3677 s  1.0 / 1.0
123 · CAN1   com.vimdrones.srv-hub-4ch-p      OK  Operational  3648 s  1.9 / 5.127
125 · CAN1   org.ardupilot.HolybroG4_GPS      OK  Operational  3646 s  1.7 / 4.29
```

(The CAN2 ESC is absent only because it was unpowered.) So the multi-frame
GetNodeInfo truncation was **caused by our own `CAN_FILTER_MODIFY` / combined-loop
bug, not the flight controller** — removing the filter and forwarding one stable bus
at a time lets GetNodeInfo complete, exactly as the reference GUI does.

**Residual fixed — transfer-CRC validation (2026-06-17).** Two names initially came
back **truncated/garbled** (`com.vimdrones.srv-hub-4ch-p…`, `org.ardupilot:0`): the
FC's CAN-forward path (ArduPilot issue #28187) still drops the occasional forwarded
frame mid-transfer, and the decoder did **no transfer-CRC validation** — it accepted
the first (possibly partial) reassembled GetNodeInfo response and then stopped
retrying, so a bad name stuck. Now the 2-byte DroneCAN transfer CRC is verified:
**CRC-16-CCITT** (poly `0x1021`, init `0xffff`; check value `0x29b1`) seeded with the
**GetNodeInfo data-type signature `0xee468a8121c46a9e`** (libcanard
`UAVCAN_PROTOCOL_GETNODEINFO_SIGNATURE`, fed little-endian — matches pydronecan's
`crc16_from_bytes(payload, initial=base_crc)`). A CRC mismatch ⇒ the transfer is
discarded, the node stays nameless, and GetNodeInfo is **retried** within that bus's
dwell until a clean response arrives. Net effect: a node name is now **either correct
or absent — never garbled**. (Sources: pydronecan `dronecan/dsdl/common.py` CRC-16,
`dronecan/transport.py` transfer-CRC seeding; libcanard signature constant.)
Discovery/health/mode/uptime were never affected.

## Needs-on-device (remaining)

Appended to `docs/ONDEVICE-CHECKLIST.md`: confirm NodeStatus **health/mode bit
decoding** on a non-OK node (UAVCAN v0 MSB-first) vs Mission Planner; no adverse
effect on the live bus. Node discovery on **both** CAN buses and name resolution are
verified on-device (see above). Transfer-CRC validation + retry is now implemented —
confirm on-device that the previously-garbled names (`com.vimdrones.…`, the CAN2 node)
now resolve **cleanly** (or stay blank — never garbled).
