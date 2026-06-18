# Feature 39: HUD editor — live flight-controller values (real, not mock)

Branch: `feature/hud-live-values` → `dev`.

## Why

The HUD Editor (`src/hudeditor.jsx`, #173) is a WYSIWYG layout tool: a black 16:9
canvas where you drag telemetry elements and style them, each chip drawn with
**mock data** (`ALT 124m`, `HDG 271`, …) so the numbers look real while you arrange
them. But they *are* mock — there was no way to confirm the layout against the
actual values the aircraft is sending. The burned-in HUD only parses telemetry
**while a video stream is running** (`videostream.ts updateHudFromPacket()` is a
no-op unless `useHud` + a live stream), so the editor couldn't borrow that path.

This feature adds a toggle that swaps the mock samples for the **real telemetry the
flight controller is transmitting right now**, sourced from the always-available
MAVLink stream — so the editor preview matches what will be burned onto the video.

## What

- **`server/hudOverlay.ts`** — three new pure functions (the file is I/O-free and
  unit-tested to 100%, so these stay deterministic):
  - `hudDataFromSnapshot(snapshot)` — builds the HUD field dict from a
    `MAVTelemetry` snapshot (the `{ name, fields, stale }` array the MAVLink
    Inspector already receives). Mirrors the per-packet unit conversions in
    `videostream.ts updateHudFromPacket()` (mV→V, cA→A, mm→m, rad→deg, RSSI %,
    sentinel `65535`/`-1`/`32767` → `null`, `HOME_POSITION` → home distance/bearing,
    etc.) but works off the accumulated latest-of-every-message snapshot, so it is
    available whenever an FC link is up — **no live video stream required**. Stale
    and malformed entries are ignored.
  - `formatHudElement(type, hud)` — the value string for one text element. A direct
    JS port of `python/video-server.py`'s `hudElementText()`, kept **byte-for-byte
    identical** (helpers `hnum`/`hint`/`hmmss` match Python's `_hud_num`/`_hud_int`/
    `_hud_mmss`) so the editor preview reads exactly like the burned-in video.
    Graphic elements (horizon/compass/homeDir) and unknown types return `''`.
    `clock` is taken from `hud.clock` (the caller supplies the wall-clock string) so
    the function stays pure.
  - `liveHudValues(snapshot, clock?)` → `{ connected, values }`. `values` is the
    formatted string for every **text** element type; `connected` is true when the
    FC is actually transmitting (≥1 non-stale message). Tolerates a non-array.
- **`server/index.ts`** — emit `io.sockets.emit('HUDLive', hudOverlay.liveHudValues(
  mavTelemetry.getSnapshot(), <HH:MM:SS>))` on the existing 1 Hz `FCStatusLoop`
  (next to the `MAVTelemetry` emit it already reuses). Purely passive — no new
  MAVLink requests.
- **`src/hudeditor.jsx`** — the page now opens a socket (`super(props, true)`).
  - New **"Show live values from the flight controller"** switch (`data-testid=
    "show-live"`) under the camera-backdrop toggle, with a HelpTip.
  - A status line: **● Live — receiving telemetry** (green) when `connected`, else
    **● Waiting for telemetry — connect a flight controller link…** (amber).
  - `chipValue(type)` returns the live reading when the toggle is on **and** a
    reading has arrived, otherwise the mock sample (so the canvas is never blank —
    it falls back to mock until the first `HUDLive` packet, and shows the FC's `--`
    placeholders once connected-but-quiet/disconnected). `renderChip()` uses it.
  - Subscribes to `HUDLive` (→ `state.live`) and to `reconnect` (re-runs
    `componentDidMount` to re-fetch the layout).
  - HelpSection prose updated to explain the toggle and that the horizon/compass/
    home arrow stay as layout previews.

### Scope decision

Live values fill the **text** readouts — the literal "values" the user asked for.
The artificial horizon, compass and home arrow remain representative previews: they
are instruments, not values, and the editor draws them as fixed-angle illustrative
shapes (not from live roll/pitch/heading). Driving them live in the editor would
mean re-porting `video-server.py`'s `_horizon_svg()` geometry and keeping it in
lock-step with the device — a fragile parity burden for little gain, since their
real motion is visible on the actual video. The HelpTip/HelpSection say so.

## Tests / coverage

- **`server/hudOverlay.test.js`** (mocha):
  - `formatHudElement()` — a full field dict rendering **all ~45 text elements**
    asserted against the exact expected strings (parity with `video-server.py`); an
    all-null dict exercising every `--` placeholder + ternary null-arm (`THR --`,
    `--%`, `GPS --/--`, `MODE --`, `DISARM`, `--:--`, `--:--:--`, `WP#--`, …); and
    `''` for graphic/unknown types.
  - `hudDataFromSnapshot()` — a full snapshot asserting every unit conversion;
    a sentinel snapshot mapping `65535`/`-1`/`32767`/`rssi 255` → `null` and
    skipping home distance when `HOME_POSITION` is absent; stale/malformed/no-fields
    entries ignored; non-array tolerated.
  - `liveHudValues()` — connected + per-element values + caller clock; disconnected
    `--` placeholders for empty/all-stale/non-array snapshots; graphic types absent.
- **`src/hudeditor.test.jsx`** (vitest) — toggle off→mock; on but no packet →
  "Waiting" + mock retained; `HUDLive` (connected) → real value on the chip while an
  element absent from the map falls back to its mock; toggle off → mock restored;
  a `reconnect` re-fetches the layout.
- **`server/index.io.test.js`** — the existing `FCStatusLoop` test (a real socket.io
  client) already drives the new `HUDLive` emit (empty snapshot → `connected:false`).

Both suites **100/100/100/100** (backend 5912 stmts / 2408 branches; frontend);
`npm run lint` + `npm run typecheck` clean.

## WSL-verified

- The socket wiring, snapshot→fields conversion, per-element formatting, the toggle,
  status line, live/mock chip swap, and the disconnected `--` placeholders — all via
  unit tests (no hardware needed; the snapshot shape is synthetic).
- `formatHudElement()` parity with `video-server.py hudElementText()` by asserting
  the exact output strings (the mock catalog `HUD_MOCK` was already a copy of these).

## Needs on-device

Appended to `docs/ONDEVICE-CHECKLIST.md` — requires a real flight controller (the
live data path can't be exercised in WSL):

- With an FC link connected, the toggle shows **● Live** and the chips track the
  real ATTITUDE/VFR_HUD/GPS/SYS_STATUS/… readings (cross-check against the MAVLink
  Inspector and a ground station).
- The previewed strings **match the burned-in graphic HUD** on the video (start a
  graphic stream and compare) — confirming the JS `formatHudElement()` ↔ Python
  `hudElementText()` parity holds against live data, including rounding/units and
  the `home distance/bearing` derivation.
- With **no** FC connected the status reads **● Waiting** and every readout shows
  `--`; pulling the link mid-session flips it back to Waiting within a few seconds
  (stale flag).
- `clock` ticks once per second from the device wall clock; `timer` shows `--:--`
  in the editor (no arm event off a snapshot — expected).
