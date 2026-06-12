# Feature 1 report — Dual-camera switching via RC channel

Branch: `feature/rc-camera-switching` (merged into `dev`, commit `6c12cfa`)
Date: 2026-06-12

## What changed

A camera switcher subsystem that flips the active video source at runtime,
driven by a MAVLink RC channel (`RC_CHANNELS`, msg 65) or manually from a new
web page, **without restarting the video stream** (the GCS keeps its
RTSP/RTP session).

Two switch modes:

1. **GStreamer (dual source)** — the python video server builds one pipeline
   with two source branches into an `input-selector`. Both branches are
   normalized to identical caps (I420 at the primary's resolution/framerate),
   so flipping the selector pad never renegotiates the single shared encoder
   — the Pi 4 / Zero 2 W hardware H.264 path (`v4l2h264enc`) is preserved.
   Node forwards switch commands to the python process over stdin as JSON
   lines; python answers `SWITCHED:<X>` on stdout.
   Source abstraction handled: CSI/libcamera (`/base/soc/...`), USB/V4L2 raw
   and MJPEG (with `v4l2jpegdec` hardware JPEG decode when available), and
   `testsrc`/`testsrc2` for camera-free bench testing.
2. **Command (CSI multiplexer boards)** — user-defined shell command per
   source (e.g. `i2cset` for Arducam camarray); the pipeline keeps using the
   same device.

RC logic: configurable channel (1-18), threshold (800-2200 µs), hysteresis
dead-band (0-500 µs), and a min-hold debounce (default 250 ms). Invalid PWM
(0 / 65535) is ignored. When enabled, Rpanion requests the `RC_CHANNELS`
stream at 2 Hz via `MAV_CMD_SET_MESSAGE_INTERVAL` once per FC link, and
re-requests after link drop. Node is authoritative for switch state: the
pipeline always starts on source A and Node resets accordingly on stream
start; the RC logic re-switches if the TX switch is still flipped.

## Files

| File | Change |
|---|---|
| `server/cameraSwitcher.js` | new — RC decision logic, settings, modes |
| `server/cameraSwitcher.test.js` | new — 9 tests |
| `server/videostream.js` | `getSecondarySourceArgs()`, `switchSource()` |
| `server/videostream.test.js` | +2 tests |
| `mavlink/mavManager.js` | `sendSetMessageInterval()` |
| `mavlink/mavManager.test.js` | +1 test (decodes emitted COMMAND_LONG 511) |
| `python/video-server.py` | dual-source pipeline builder, `SwitcherFactory` (shared RTSP), stdin control channel, `--secondary*` args, dual RTSP/RTP main branches |
| `server/index.js` | instantiation, MAVLink wiring, switch-event routing, REST API, 1 Hz `CameraSwitcherStatus`, source reset on stream start |
| `src/cameraswitcher.jsx` | new page (config + live status + manual switch) |
| `src/AppRouter.jsx` | route + sidebar link |
| `src/App.test.jsx` | +1 render test |
| `docs/CAMERA-SWITCHER.md` | user + implementation docs |
| `docs/ONDEVICE-CHECKLIST.md` | Feature 1 hardware items |
| `CHANGELOG.md` | Unreleased (fork) section |

API: `GET /api/cameraswitcher`, `POST /api/cameraswitchermodify`,
`POST /api/cameraswitcherswitch` — all behind `authenticateToken` +
express-validator, matching the existing auth model.

## How tested (WSL, CI replica)

- `npm run testback`: **103 passing** (91 baseline + 12 new), after
  `npm run build`, settings.json cleared between suites (CI parity)
- `npm run testfront`: **12 passing** (11 + 1)
- `npm run lint`: 0 errors (1 pre-existing warning in adhocManager.test.js)
- Python smoke tests (venv `python/.venv-dev`, system gi):
  - dual-source **RTP**: testsrc/testsrc2 pipeline runs, stdin
    `{"cmd":"switch","source":"B"}` → `SWITCHED:B`, A↔B↔B sequence OK,
    bogus/invalid commands rejected, no GStreamer errors
  - dual-source **RTSP**: server mounts `/testsrc` (same URL as
    single-source), gst-launch client streamed 8 s continuously while
    switching A→B→A live, zero client/server errors
- REST smoke on dev server (`NODE_ENV=development`): GET config, valid
  modify persists, invalid modify (gstreamer mode without secondary device)
  returns the validation error and keeps old settings, manual switch flips
  status, `source:"C"` rejected 422

## Needs on-device verification (Pi 4 / Pi Zero 2 W)

See `docs/ONDEVICE-CHECKLIST.md` § Feature 1:

- IMX708 via `libcamerasrc` as primary of the dual pipeline (WSL has no
  libcamera); hardware encoder engaged (encoder element + CPU check)
- Pi Zero 2 W CPU headroom — secondary branch adds videoconvert/videoscale;
  may need reduced secondary capture resolution
- Switch latency/glitch with a real GCS (Mission Planner via VPN), RTSP & RTP
- RC end-to-end: TX switch → Pixhawk → RC_CHANNELS 2 Hz → switch; re-request
  after FC reboot
- USB secondary camera hot-unplug behaviour; missing-secondary error path
- Command mode with a real multiplexer board (if available)
- Deployed `python/.venv` has gi access (deb postinst uses system-site-packages?)

## Notes / deviations

- In dual-source RTSP mode the pipeline is **shared** between clients
  (cameras can only be opened once) — single-source mode keeps per-client
  pipelines. Documented in CAMERA-SWITCHER.md.
- Secondary RTSP sources are rejected by design (would add latency and a
  network dependency inside the selector).
- Known upstream bug (UI "RTP" never passes `--transport=RTP` to python) is
  unchanged here; it is Feature 3's scope. The dual-source RTP path itself is
  implemented and bench-verified.
