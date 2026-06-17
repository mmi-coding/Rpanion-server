# Feature 38: DroneCAN node parameters (read-only) — click a node to read its params

Builds on feature-37 (DroneCAN node enumeration). The node table on the FC
Configuration page is now **expandable**: click any node row and the page reads
that node's **parameters** live from the device — name, current value, default,
min and max — the same list a ground station shows when you open a node.

## Why

feature-37 lists DroneCAN nodes (id, name, health, versions) but stops there. The
natural next question for any node is "how is it configured?" — which over DroneCAN
means enumerating `uavcan.protocol.param.GetSet`. This is the read side of what
Mission Planner's UAVCAN inspector does.

## What

- **`server/droneCan.ts`** — a bit-level DSDL codec for GetSet plus a per-node
  enumerator (`scanParams`), reusing the existing CAN-forwarding transport,
  `Reassembler` and transfer-CRC path:
  - `encodeGetSetRequestByIndex(i)` — a read-by-index request (`uint13 index`,
    *empty* value, empty name). Read-only by construction: the value union is always
    empty, so no `param.GetSet` ever sets anything; there is no write path.
  - `decodeGetSetResponse(payload)` — decodes `value, default_value, max_value,
    min_value, name`. GetSet's request/response use bit-level DSDL, but the
    `.Response` is **byte-aligned by design** (`void5`/`void6` padding before each
    `Value`/`NumericValue` union, so tag+payload land on byte boundaries) — so it
    decodes with plain byte reads, no general bit-stream reader. `int64` →
    JS number (or string if outside the safe range), `float32` trimmed to ~7
    significant digits, `string` length-prefixed, `name` tail-array-optimised; an
    empty name marks end-of-list.
  - `scanParams(node, bus)` — forwards the node's bus, reads index 0,1,2,… driven
    by each response (with a 1 Hz retry for dropped ones), until an empty name.
    Responses are correlated to the outstanding request by **transfer id** (UAVCAN
    service responses echo the request's), so a late retry can't be mis-attributed;
    multi-frame responses are transfer-CRC-validated (seeded with the GetSet
    signature `0xa7b622f939d1a4d5`). A stalled index retries up to 10×; the sweep is
    bounded at 2000 indices. Opening a node takes over the single forwarded bus
    (pausing the node sweep), since the FC forwards one bus at a time.
- **`server/routes/fcConfig.ts`** — `POST /api/FCDroneCANNodeParams` (start, body
  `{ node, bus }`, range-checked → 400 otherwise) and `GET /api/FCDroneCANNodeParams`
  (current state). **`server/index.ts`** pushes the `DroneCANNodeParams` socket event
  each second.
- **`src/fcconfig.jsx`** — node rows are clickable to expand a read-only param table
  (Name · Value · Default · Min · Max) with reading / empty / **no-response** states
  and a HelpTip. (Pixhawk/autopilot rows are clickable too; the autopilot's own
  params are better seen via "Refresh parameters" — it can't be read this way anyway,
  see below.)

## Reference-verified codec

The DSDL bit-packing is subtle, so the codec was developed against **pydronecan**
(the official reference implementation), installed in a throwaway venv to emit
authoritative vectors. Every request and response in the unit tests is a verbatim
pydronecan vector:

- requests: index `0→[00 00]`, `1→[01 00]`, `37→[25 00]`, `8191→[ff f8]`
- responses: int (`GPS_TYPE=5, def 1, min 0, max 22`), float (`1.5`), bool, string,
  end-of-list (`00 00 00 00`)

The full request frame matches the reference too: pydronecan's GetSet read-by-index
service request is CAN id `0x1E0BFDFF`, payload `00 00 c0` — **byte-identical** to
what `scanParams` emits.

## Tests / coverage

Both suites stay **100/100/100/100** (lint + typecheck clean):

- `server/droneCan.test.js` — codec vs pydronecan vectors (request encode; int /
  real / bool / string / end-of-list decode; out-of-range int64 → string; ±inf
  float; every truncated/invalid-union → null), `getSetCrcOk`, and the enumerator
  (first read + auto-advance, empty-name end, superseded-tid reject, bad-CRC reject,
  undecodable-response reject, incomplete-transfer hold, stalled-retry timeout,
  `MAX_PARAM_INDEX` bound, node-scan ↔ param-scan mutual exclusion, idle/getter
  states).
- `server/index.io.test.js` — the two endpoints (200, 400 missing/out-of-range, GET
  state).
- `src/fcconfig.test.jsx` — click-to-read, live table render + bool/null formatting,
  stale-node-push ignored, collapse, requesting/reading/empty/no-response states,
  inactive/other-node pushes ignored, error surfacing.

## WSL-verified

Codec + enumerator (unit tests with synthetic frames and pydronecan vectors),
routes, and the UI. The transport itself (real CAN forwarding) is hardware-only.

## On-device results (2026-06-18, Pi 4 + Pixhawk6X over UDP, 3 DroneCAN nodes)

Deployed to the Pi and validated against the live bus. The headline finding:
**the code is correct and the transport works end-to-end, but no node on this drone
answers `param.GetSet`** — so the table couldn't be shown populated here.

What was proven on real hardware (via temporary diagnostic counters + a raw frame
dump, since removed):

- **Request injection works:** our GetSet request goes out on the bus exactly as
  built (`TX id=0x9e0bfdff [00 00 c0]`), byte-identical to pydronecan.
- **Multi-byte injection works:** a 3-byte `GetNodeInfo` probe injected over the
  param-scan path was **answered back to us** (`125→127`) — so ArduPilot transmits
  our multi-byte injected frames and the node receives them.
- **Response routing works:** node 125's GetNodeInfo response to us decoded its full
  name; multi-frame reassembly + CRC handle responses addressed to us fine.
- **Yet zero `GetSet` (st11) frames** ever came back from node 125 (`org.ardupilot.
  HolybroG4_GPS`, an AP_Periph node) **or** node 123 (`com.vimdrones.srv-hub-4ch-p`),
  while both answer the mandatory `GetNodeInfo`. The autopilot's own node (10) can't
  be read this way at all — a CAN controller doesn't receive frames it transmits on
  our behalf.

Conclusion: `param.GetSet` is an **optional** DroneCAN service; these peripherals
(or their firmware builds) don't implement it, so their CAN acceptance filter never
admits `st11` and they never reply. This is invisible from our side and is **not** a
defect in the feature — the request is byte-identical to the reference GUI tool and
every transport layer is verified. The UI now shows a clear "no response — this node
may not expose parameters over param.GetSet" note for this case (distinct from a node
that answers with an empty list).

## Needs-on-device (remaining)

Appended to `docs/ONDEVICE-CHECKLIST.md`: confirm a **populated** parameter table
against a GetSet-capable node (e.g. a DroneCAN ESC, power module, or airspeed
sensor) — end-to-end decode of real int/float/bool/string params, min/max bounds,
and a multi-page enumeration.
