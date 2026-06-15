# Feature 32 — Telemetry HUD overlay on the video stream (#173)

Implements upstream feature request [#173](https://github.com/stephendade/Rpanion-server/issues/173):
burn a live flight-telemetry readout onto the video itself, so **any** viewer or
recording sees it — not just a ground station that has its own MAVLink link. This
first cut is a compact **text readout** (a graphical artificial-horizon HUD is the
documented follow-up — see "Phasing" below).

## What it shows

A three-line readout in the top-left corner, updated ~5× a second:

```
ALT 124m  SPD 14.2m/s
HDG 271°  BAT 15.8V 62%
AUTO  GPS 3D/11
```

altitude · ground speed · heading · battery voltage & remaining % · flight mode ·
GPS fix type & satellite count.

## How it works — three layers, almost all plumbing already existed

1. **MAVLink tap (`server/videostream.ts`).** `index.ts` already feeds every
   packet to `vManager.onMavPacket()`. A new `updateHudFromPacket()` reads the
   fields the HUD needs from `VFR_HUD` (74), `SYS_STATUS` (1), `GPS_RAW_INT` (24)
   and `HEARTBEAT` (0), keeps the latest values, and pushes a throttled
   (≥200 ms) update.
2. **Node → video-server control channel.** The existing
   `_sendStdinCommand()` (already proven by the runtime bitrate retune) now also
   sends `{"cmd":"hud","text":"…"}`. The text is built by the pure, fully-tested
   `server/hudOverlay.ts` (`formatHudText` + an ArduPilot `mavlinkModeName` map for
   copter / plane / rover, with a numeric `MODE n` fallback).
3. **Overlay element (`python/video-server.py`).** A `--hud` flag inserts a
   `textoverlay name=hud0` into the raw-video section of the pipeline (right where
   the existing `clockoverlay` timestamp sits), for single, dual-source (switcher)
   and multi-RTSP pipelines. `handleControlLine` routes the `hud` command to
   `doHud()`, which sets the element's `text` on every running pipeline; a
   late-joining RTSP client is seeded with the last text via `applyHudToPipeline`.

`textoverlay` ships in the same `gstreamer1.0-plugins-base` as the already-used
`clockoverlay`, so there is **no new system dependency**.

## UI

A self-documenting **Telemetry HUD** checkbox on the Video page (with a `HelpTip`),
next to the Timestamp control. It is **disabled with an inline explanation** when
the selected source is a pre-compressed H264 stream — see the constraint below.

## Hard constraint (mirrors the timestamp)

The overlay is drawn on **raw** video *before* the encoder, so it only works on
sources the companion computer re-encodes — CSI (libcamera), MJPEG, raw USB. It
**cannot** be added to a pre-compressed H264 USB camera or an RTSP passthrough
source without a decode/re-encode (which those low-latency paths deliberately
avoid). The UI disables the toggle for H264-native sources; RTSP sources never
show the control. The Jetson NVMM path is also skipped (the fork targets the Pi).

## Phasing

This shipped the **text readout** first. The **graphic artificial-horizon HUD**
has since been added (a HUD *style* choice on the Video page) — see the follow-up
below.

### Follow-up (shipped): graphic artificial-horizon HUD

Rather than the originally-considered `cairooverlay` (which would need a `pycairo`
dependency that is *not* installed), the graphic HUD is rendered as an **SVG via
`rsvgoverlay`** — a GStreamer element present on the Pi, so **no new dependency**.
A `--hud-style=graphic` flag swaps the `textoverlay name=hud0` for an
`rsvgoverlay name=hud0`; `video-server.py`'s `buildHudSvg()` draws a roll/pitch
artificial horizon + pitch ladder + corner readouts, fed live over the same stdin
control channel (`{"cmd":"hud","hud":{…}}`). `videostream.ts` now also captures
`ATTITUDE` (roll/pitch, radians→degrees) and, in graphic mode, pushes the raw
fields instead of formatted text. The Video page gains a **HUD Style** select
(Text / Graphic) shown when the HUD is enabled on a re-encodable source.
Verified on real GStreamer (the SVG renders through an `rsvgoverlay` pipeline to
PLAYING on both WSL and the Pi). Both suites stay 100/100/100/100.

### Follow-up (shipped): customizable HUD / OSD editor

The graphic HUD became **fully customizable**, iNav-style, via a new **HUD Editor**
page (`src/hudeditor.jsx`, Camera & Video nav): a black 16:9 canvas where each
telemetry element is a **draggable** chip, plus a palette to toggle which stats
show and whether each draws its **icon**. The artificial horizon is one
toggleable, positionable element.

- **Layout model** (`server/hudOverlay.ts`): a catalog of element types
  (`hudElements()`), a `defaultHudLayout()`, and `validateHudLayout()` that
  normalises a layout (known types only, booleans coerced, `x`/`y` clamped to the
  0–1 frame fraction, missing elements filled from defaults). Element set:
  altitude (MSL/AGL), ground speed, airspeed, heading, climb, throttle, battery
  V/%/current, flight mode, arm state, GPS, and horizon.
- **Telemetry tap** (`server/videostream.ts`): `updateHudFromPacket` now also
  reads `GLOBAL_POSITION_INT` (relative altitude) and the extra `VFR_HUD`
  (airspeed/climb/throttle), `SYS_STATUS` (current) and `HEARTBEAT` (armed) fields.
  The layout is loaded from settings, pushed to a graphic stream on start and on
  change (`{cmd:'hudlayout',…}`), and the field push is unchanged (`{cmd:'hud',…}`).
- **Rendering** (`python/video-server.py`): `buildHudSvg(layout, fields)` is
  layout-driven — for each enabled element it draws an icon glyph (if enabled) +
  the formatted value at its `x,y`, and the `horizon` element draws the artificial
  horizon at its position. Falls back to a built-in default layout if none has been
  pushed yet. Same SVG/`rsvgoverlay` path → still no new dependency.
- **Route**: `server/routes/hud.ts` — `GET /api/hudlayout` (layout + catalog),
  `POST /api/hudlayout` (validate + persist + live-apply).
- Verified on real GStreamer: a pushed layout + telemetry renders the selected
  elements (e.g. AGL + GPS + horizon, with the disabled ALT omitted) and the
  `rsvgoverlay` pipeline stays PLAYING. Both suites stay 100/100/100/100.

### Follow-up (shipped): full element set, grouped in sections

The catalog was expanded from 14 to ~45 elements, each tagged with a **section**
(Attitude, Altitude & Speed, Position & GPS, Navigation, Battery & Power, Link,
Environment, Status, Health). New elements include two more **graphic** ones (a
compass tape and a home-direction arrow) alongside many numeric readouts:
turn rate, G-load, rangefinder, lat/lon, GPS HDOP/course, distance & bearing to
home, distance/number to the next waypoint, crosstrack & altitude error, mAh
consumed, battery temp & time-remaining, autopilot load, RC RSSI, radio
RSSI/remote/noise, comm drop rate, wind speed/direction, baro temp & pressure,
vibration & clipping, a flight timer (time since arm) and a clock.

- `server/hudOverlay.ts`: the catalog carries `section`; pure `homeDistance()` /
  `homeBearing()` helpers (haversine + initial bearing).
- `server/videostream.ts`: `updateHudFromPacket` now also reads `BATTERY_STATUS`,
  `NAV_CONTROLLER_OUTPUT`, `MISSION_CURRENT`, `RC_CHANNELS`, `RADIO_STATUS`,
  `WIND`, `SCALED_PRESSURE`, `RANGEFINDER`, `SCALED_IMU`, `VIBRATION` and
  `HOME_POSITION` (the last stored to compute distance/bearing to home on each
  `GLOBAL_POSITION_INT`); a disarmed→armed transition starts the flight timer.
- `python/video-server.py`: a value formatter + icon glyph per element, the
  graphic compass tape + home arrow, and a clock from local time.
- `src/hudeditor.jsx`: the palette is grouped by section; graphic elements
  (horizon/compass/home arrow) have no icon toggle.

Deliberately omitted (unreliable / multi-message on ArduPilot): per-cell voltage,
ESC telemetry, EKF variances, a 2nd-GPS readout. Verified on real GStreamer: a
layout with all ~45 elements enabled renders and the `rsvgoverlay` pipeline stays
PLAYING. Both suites stay 100/100/100/100.

### Follow-up (shipped): modem GPS, WYSIWYG mock data, dynamic home arrow, text styling

Four refinements driven by "make the editor show what the user will actually see,
add the modem's own GPS, and let the user style the text":

- **LTE modem GPS (works with no flight controller).** The SIM7600 has its own
  GNSS. `ltemodem.ts` enables it once (`AT+CGPS=1`, guarded by a `gpsEnabled`
  flag) and reads `AT+CGPSINFO` each poll; the new pure `parseCGPSINFO()` converts
  the `ddmm.mmmmmm,N/S` / `dddmm.mmmmmm,E/W` fields to signed decimal degrees and
  returns `{lat,lon,alt}` (or `null` when there's no fix — every field empty), in
  its own `try/catch` so a GNSS-less modem never breaks the status poll. `index.ts`
  wires the modem into the video manager (`vManager.lteModem = lteModem`);
  `videostream.ts`'s `mergeModemGps()` folds the fix into the HUD as `modemFix`
  (`OK`/`NO`), `modemLat`, `modemLon`, `modemAlt` (a new *Modem GPS* catalog
  section). Because the HUD push was MAVLink-driven, a flight-controller-less drone
  would never push it — so a **periodic 1 Hz graphic-HUD push** (`startHudInterval`,
  `unref`'d, stopped on stream close / `stopCamera`) now drives the overlay
  independently, merging the modem GPS each tick.
- **Mock data on the editor canvas (WYSIWYG).** Each catalog entry carries a
  `mock` string (the value as the burned-in HUD renders it, e.g. `ALT 124m`,
  `mGPS OK`); the editor chips show that instead of the element label, so the
  black canvas previews real-looking values. Graphic elements expose a `graphic`
  flag instead.
- **Dynamic home arrow.** The home-direction element renders in the editor as an
  arrow inside a compass ring with a slow CSS rotation (`.hud-home-arrow`,
  `@keyframes hud-home-spin`) to convey that it tracks home — the burned-in HUD
  (`_homedir_svg`) already rotates it by the real bearing-to-home minus heading.
  The horizon and compass elements likewise render as live mini-SVG previews.
- **Font / size / colour, global + per-element.** `hudOverlay.ts` gained a
  `DEFAULT_GLOBAL_STYLE` + `HUD_FONTS` (`monospace`/`sans-serif`/`serif`, all
  always available to librsvg), `hudFonts()`, and validation:
  `validateGlobalStyle()` (fills defaults, clamps size to 10–120, validates a
  `#rgb`/`#rrggbb` colour) and `validateElementStyle()` (keeps only the valid,
  present overrides). `validateHudLayout()` now returns `{global, elements}` with
  per-element `font?/size?/color?`. `video-server.py`'s `buildHudSvg` reads the
  global style and per-element overrides (`size*0.3` baseline offset so any size
  stays vertically centred). The editor adds a **global text-style row** and a
  **per-element style panel** (select an element → font/size/colour, blank =
  inherit, "Use global" clears overrides); chips reflect the effective style and
  scale via CSS container-query units (`100cqw`) so the canvas matches how
  `rsvgoverlay fit-to-frame` scales the 1600-wide SVG onto the frame.
- **Route:** `GET /api/hudlayout` now also returns `fonts` (the allowed list).

Verified on real GStreamer (WSL): a layout with a non-default global style
(sans-serif/40/green) + per-element colour & size overrides + the *Modem GPS*
elements renders and the `rsvgoverlay` pipeline reaches PLAYING/EOS. New unit
tests: `parseCGPSINFO` (hemispheres, no-fix, short/empty lines), the modem-GPS
poll (enable-once gate + query-failure path), `mergeModemGps`, the periodic push
timer, the global/per-element style validation, and the editor's mock chips,
graphic previews, selection, global-style controls and per-element style panel.
Both suites stay 100/100/100/100.

### Follow-up (shipped): custom HUD fonts — curated set + user import

The font picker went from the 3 generic CSS families to a real font system, with
a curated set **and** user import.

The constraint that shaped the design: the editor preview is a **browser** font,
but the burned-in HUD is rendered on the device by `rsvgoverlay → librsvg → Pango
→ fontconfig`. For WYSIWYG, a font must resolve identically on both sides. So a
new `server/hudFonts.ts` keeps **one** fonts directory that is:

- **served to the browser** (`GET /api/hudfonts/file/:name`, unauthenticated — a
  CSS `@font-face url()` can't carry a bearer token, and only known path-safe font
  files are served), which the editor injects as `@font-face` so the preview uses
  the exact font the device will use; and
- visible to the spawned `video-server.py` via **`XDG_DATA_HOME`** — `videostream.ts`
  spawns the stream with `XDG_DATA_HOME=<fontDataHome>` (a new `_spawnEnv()`), and
  fontconfig scans `$XDG_DATA_HOME/fonts`. **No sudo, no `/usr/share/fonts`, no
  assumptions about the `rpanion` service user's home.**

- **Curated** (`assets/hudfonts/`, bundled in the `.deb`, all OFL): **Oxanium** (a
  DJI/FPV-OSD-style face — the variable font instanced to a medium weight),
  **Chakra Petch**, **IBM Plex Mono**, **IBM Plex Sans** (the IBM Plex + Chakra
  Petch files are the Latin subsets the app already bundles via `@fontsource`,
  converted `woff2 → ttf`). `HudFonts.install()` copies them into the fonts dir on
  startup and runs `fc-cache`.
- **Import**: `POST /api/hudfonts` (the existing global `express-fileupload`
  middleware, limit raised 1 KB → 6 MB) validates the upload (sfnt magic bytes,
  ≤5 MB), writes it to the fonts dir, `fc-cache`s, reads its family via `fc-query`,
  checks the family is a safe name, and registers it in settings. `DELETE
  /api/hudfonts/:id` removes it. The editor gains an **Import font…** control and a
  removable list of imported fonts.
- `hudOverlay.ts`'s style validation now accepts **any** safe family name
  (`/^[A-Za-z0-9 \-]{1,64}$/`, safe to interpolate into the SVG/CSS) instead of a
  fixed allow-list, since curated/imported family names are open-ended.
- Packaging: `assets` is added to the `node-deb` payload; `fontconfig` is added to
  the `.deb` dependencies (for `fc-cache`/`fc-query`).

Verified on real `fontconfig`/GStreamer (WSL **and** the Pi): with `XDG_DATA_HOME`
pointed at the fonts dir, `fc-match` resolves each curated family to its bundled
file (not a fallback), `fc-query` extracts families for the import path, and an
`rsvgoverlay` pipeline renders HUD text in **Oxanium** to PLAYING/EOS. New tests:
`hudFonts.test.js` (magic-byte validation, curated install incl. idempotent +
missing-source + failing-cache paths, list, path-safe file serving, import
success/duplicate/oversize/bad-family/non-font, remove, and the real `fc-*` exec
seam via `fakeBin`), the `/api/hudfonts` routes in `index.io.test.js`, `_spawnEnv`
in `videostream.test.js`, and the editor's font dropdown / `@font-face` injection
/ import / remove in `hudeditor.test.jsx`. Both suites stay 100/100/100/100.

## Verification — WSL-verified

- `lint` 0 · `typecheck` 0 · `covback` **100/100/100/100** (997 passing) ·
  `covfront` **100/100/100/100** (837 passing).
  - New `hudOverlay.test.js` (mode maps, gps-fix names, text formatting).
  - `videostream.test.js`: `updateHudFromPacket` per-message branches, battery
    unknown-value handling, the 5 Hz throttle, the `--hud` spawn arg.
  - `video.test.jsx`: HUD disabled+explained on H264, enabled+toggleable on raw,
    and the saved-flag load path.
- **Python** (`video-server.py`, run under the venv with real GStreamer):
  generated pipelines place `textoverlay name=hud0` correctly for raw + dual
  sources, omit it when `--hud` is off and for pre-compressed H264 sources, the
  control channel updates `hud_state` and rejects >500-char text, and the
  generated pipeline parses (`Gst.parse_launch`) with the `text` property settable
  (including newlines). Python is outside the JS coverage ratchet.

## Verified on-device (Pi 4, IMX708 attached, 2026-06-15)

- [x] Deployed: `video-server.py` carries the HUD support and `hudOverlay.js`
  (compiled) ships in the package; `textoverlay` is present in the Pi's GStreamer.
- [x] On the Pi's **real GStreamer**, the deployed generator builds the
  `… ! textoverlay name=hud0 ! … ! x264enc name=enc0 ! rtph264pay name=pay0`
  pipeline, it reaches **PLAYING** (so the overlay→encoder chain negotiates), and
  the stdin control channel updates the live overlay text
  (`'' → 'ALT 124m  SPD 14.2'`) on the running pipeline. `enc0` is intact (bitrate
  retune unaffected).

Remaining (manual, needs an app login + a flight controller + a viewer): stream
the IMX708 with the HUD enabled and a FC connected, and confirm real telemetry
(alt/speed/heading/battery/mode/GPS) tracks in a recording / VLC with acceptable
CPU; confirm the toggle is disabled on a pre-compressed H264 source; spot-check
the `mavlinkModeName` label against a copter / plane / rover. No FC was connected
during this pass, so the live MAVLink→overlay path is unverified end-to-end (the
Node-side tap is fully unit-tested; the Python overlay + control channel are now
verified on-device).
