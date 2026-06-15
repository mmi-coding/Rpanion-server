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

This ships the **text readout**. A graphical artificial-horizon HUD (pitch/roll
ladders + compass tape via a `cairooverlay` draw callback) is a natural follow-up
but costs measurable CPU on a Pi and adds a `pycairo` dependency, so it was
deliberately deferred.

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
