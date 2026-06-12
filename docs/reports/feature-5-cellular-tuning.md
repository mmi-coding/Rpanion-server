# Feature 5 report: Cellular low-latency tuning preset

**Branch:** `feature/cellular-tuning` (commit `f440167`), merged `--no-ff` into `dev` (`e5d4821`)
**Status:** complete, WSL-verified end-to-end (wire-rate measurements included); on-device items at the end
**Docs:** `docs/CELLULAR-TUNING.md` · checklist: `docs/ONDEVICE-CHECKLIST.md` (Feature 5 section)

## What was built

A **Cellular Video Tuning** page with two independent capabilities for
constrained 4G/LTE links:

1. **Low-latency preset** — a stream-start pipeline re-tune for cellular:
   - keyframe interval = **1 second of frames** (GOP = configured fps, 30 if
     unset) instead of 25 frames (x264/x265) or 5 frames (hardware encoders)
   - **CBR-style rate control**: x264 VBV buffer capped at 500 ms
     (`vbv-buf-capacity=500`); `v4l2h264enc` switched to CBR
     (`video_bitrate_mode=1`) — no bitrate bursts that turn into queueing
     delay on a thin uplink
   - `queue max-size-buffers=1 leaky=downstream` before the payloader —
     **drop frames instead of buffering** when the link chokes
   - `udpsink ... sync=false` in RTP mode — packets leave as soon as they're
     encoded
   - applies to generated and dual-camera (switcher) pipelines, RTSP and RTP
2. **Signal-adaptive bitrate** — scales the *running* stream's encoder
   bitrate with the LTE modem's signal (Feature 4's monitor is the source):
   - tiers from **RSRP** (≥ −95 good / ≥ −105 fair / else poor), RSSI dBm
     fallback (≥ −85 / ≥ −97); factors **100% / 60% / 35%**
   - **2-poll hysteresis** (5 s poll) so a one-sample blip never thrashes the
     encoder; configurable **minimum-bitrate floor** (default 250 kbps),
     never above the configured bitrate
   - missing signal data → hold; stream stopped → state reset; signal
     recovery or feature disable → configured bitrate restored

The two are connected by a new **runtime bitrate channel**: the Node side
writes `{"cmd":"bitrate","kbps":N}` to the video server's stdin; the video
server retargets every live encoder named `enc0` (per-factory property
mapping: x264/x265 kbps, nvv4l2 h26x bps, `v4l2h264enc` via `extra-controls`
`video_bitrate`) and acks with `BITRATE:<kbps>` on stdout, which the Node
side parses back into status (`applied` on the page). No stream restart, no
client reconnect. Generated pipelines now name their encoder `enc0`; custom
pipelines (Feature 2) opt in with the same name and otherwise get a clean
`BITRATE-NOENCODER` ack.

## What changed, by file

| File | Change |
|---|---|
| `python/video-server.py` | `--lowlatency` flag + `LOW_LATENCY` pipeline variants factored into helpers (`nvEncStr`/`v4l2EncStr`/`swEncStr`/`payQueueStr`/`udpSinkStr`); all generated encoders named `enc0` (incl. `getEncodeTail`, which now takes the framerate); `live_pipelines` registry — RTP pipelines appended directly, RTSP per-client medias tracked in `MyFactory`/`SwitcherFactory.do_configure` and removed on the `unprepared` signal; `doBitrate()` + `handleControlLine()` dispatch; **stdin watcher rewritten** (raw `os.read` + persistent buffer, drains every complete line per wakeup) and now active for all non-multirtsp modes |
| `server/cellularTuning.js` (new) | The tuner: `tierForSignal` static mapping, 5 s evaluation loop, hysteresis, min-floor clamp, hold/reset rules, restore-on-disable, settings validation. All dependencies (signal source, stream state, bitrate setter/ack) injected for testability |
| `server/cellularTuning.test.js` (new) | 8 tests (see below) |
| `server/videostream.js` | `getCellularTuningArgs()` (`--lowlatency` pass-through), `setBitrate(kbps)` (validated stdin write), `currentBitrate` ack parsing from `BITRATE:` stdout lines |
| `server/videostream.test.js` | 2 new test groups (args + setBitrate plumbing/validation) |
| `server/index.js` | `CellularTuning` instantiation wired to `lteModem` (signal) and `vManager` (stream state/bitrate), `GET /api/cellulartuning`, `POST /api/cellulartuningmodify` (express-validator), `CellularTuningStatus` socket emit at 1 Hz, shutdown hook |
| `src/cellulartuning.jsx` (new) | Page: status table (stream/tier badges, RSRP/RSSI, configured vs adapted vs applied bitrate, last change), settings form, contextual alerts (adaptive without stream / without signal) |
| `src/AppRouter.jsx`, `src/App.test.jsx` | Route + sidebar link + render test |
| `docs/CELLULAR-TUNING.md` (new), `docs/CUSTOM-PIPELINES.md` (enc0 note), `docs/ONDEVICE-CHECKLIST.md`, `CHANGELOG.md` | Docs |

## Design decisions

- **Retune the running encoder instead of restarting the stream.** A restart
  drops the RTSP client / interrupts RTP for seconds and renegotiates
  everything; a property set on a live encoder is glitch-free. The `enc0`
  naming convention makes this work uniformly across generated, dual-source
  and custom pipelines, and gives custom pipelines an explicit opt-in.
- **RSRP preferred over RSSI.** On LTE, RSSI includes interference and
  serving-cell load; RSRP is the actual reference-signal power and maps much
  better to usable uplink. RSSI remains as the fallback for non-LTE RATs.
- **Hysteresis over smoothing.** Two consecutive agreeing polls (10 s) is
  simple, predictable, and prevents oscillation at a tier boundary without
  hiding a genuine sustained drop for long.
- **Hold on missing signal.** No data is not the same as bad signal —
  dropping to the floor because the monitor is off would be wrong, and
  jumping to 100% could overrun a genuinely bad link.
- **Floor below everything.** A pilot would rather have 250 kbps of ugly
  video than no video; the floor is configurable down to 50 kbps.
- **The preset is start-time, adaptation is runtime.** GOP/rate-control/queue
  topology can't be changed on a live pipeline safely; bitrate can. The UI
  says so explicitly.

## Bug found and fixed along the way

`stdinWatch` used `sys.stdin.readline()` once per GLib `IO_IN` wakeup. When
two commands coalesced into one pipe chunk (e.g. a camera switch and a
bitrate change written back-to-back), the second line sat in Python's
buffered reader — the fd never polled readable again, so the command was
silently lost. This was a **latent Feature 1 bug** exposed by the new second
command type. Fixed by reading the fd raw (`os.read`) into a persistent
buffer and draining every complete line per wakeup; verified with a
deliberately coalesced two-command write.

## How it was tested (WSL)

CI parity green: `npm run lint` (0 errors), `rm -f ./config/settings.json &&
npm run build && npm run testback` → **138/138** (10 new), `rm -f
./config/settings.json && npm run testfront` → **15/15** (1 new).

Unit tests:

- `cellularTuning.test.js` (8): defaults; `tierForSignal` boundary fixtures
  (RSRP/RSSI edges, null, neither); hysteresis (2 polls to act, no repeat
  applications, blip ignored, flapping resets the count, recovery restores);
  min-floor (280 → 400, and floor never exceeds a configured 300); hold on
  null signal + reset on stream stop + re-arm on resume; settings validation
  (floor 10/20000 rejected) incl. loop start/stop; restore-on-disable
  (`setBitrate` calls = `[700, 2000]`); `quitting()` stops the timer.
- `videostream.test.js` (+2 groups): `--lowlatency` arg gated on the
  setting; `setBitrate` writes the exact JSON line to a mocked stdin,
  rejects out-of-range/non-integer/wrong-mode.

Live smoke tests (real GStreamer pipelines, real UDP sockets):

- **Pipeline strings**: default mode unchanged except `name=enc0`;
  `--lowlatency` yields `key-int-max=<fps>`, `vbv-buf-capacity=500`, the
  leaky queue, and `sync=false` (checked at fps 10 and 15).
- **Runtime bitrate, measured on the wire**: incompressible
  `videotestsrc is-live=true pattern=snow` through x264 at 2000 kbps →
  **252,553 B/s (2.02 Mbps)**; after `{"cmd":"bitrate","kbps":300}` →
  **38,352 B/s (307 kbps)** with the `BITRATE:300` ack — an exact 6.6×
  drop matching 2000→300. (First attempts taught two test-environment
  lessons: a non-live testsrc with `sync=false` encodes faster than
  wall-clock, and `pattern=ball` is too compressible to measure a cap —
  neither applies to real live cameras.)
- **Custom pipeline opt-in**: the same measurement was driven through
  `--custom-pipeline` with `x264enc name=enc0`, validating the enc0
  contract and the stdin watch in custom-pipeline mode.
- **Dual-source shared channel**: `SWITCHED:B` + `BITRATE:400` +
  `SWITCHED:A` on one stdin, including the deliberately coalesced
  two-command write (regression test for the stdin fix).
- **RTSP client lifecycle**: `BITRATE-NOENCODER` with no client →
  `BITRATE:400` with a live `rtspsrc` client (proves the
  `do_configure`/`unprepared` media tracking) → `NOENCODER` again after
  disconnect.
- **Node adaptive loop end-to-end** (real `videostream.js` →
  `video-server.py`, faked LTE signal): pipeline has enc0 + low-latency
  markers, RTP flowing, `setBitrate(300)` acked to `currentBitrate`;
  RSRP −110 × 2 polls → tier `poor`, target **350** (1000 × 0.35), python
  ack 350; RSRP −80 × 2 polls → restored to **1000**, acked.
- **REST + socket**: GET defaults; `minBitrate: 20` → 422; valid POST
  persisted under `cellularTuning.*`; `CellularTuningStatus` observed at
  1 Hz via socket.io-client.

## Needs on-device verification (Pi 4 / Pi Zero 2 W + SIM7600G)

Tracked in `docs/ONDEVICE-CHECKLIST.md` (Feature 5 section):

- **`v4l2h264enc` runtime retune** — the one code path WSL could not
  exercise: setting `extra-controls` `video_bitrate` on a *live* hardware
  encoder. The V4L2 control is documented as runtime-settable, but this
  must be confirmed on the real Pi encoder (watch the service log for
  control errors and the wire rate for the change).
- `video_bitrate_mode=1` (CBR) acceptance by the Pi encoder at stream start.
- Glass-to-glass latency with/without the preset over the real LTE + VPN
  path (expect a measurable drop; WSL can only verify pipeline structure).
- Adaptive loop against the real SIM7600 RSRP while attenuating the antenna
  / driving into weak coverage; sanity-check the −95/−105 RSRP thresholds
  against the actual carrier.
- RTSP retune with Mission Planner/VLC connected; dual-camera switch +
  retune on the same stdin mid-flight.
- Pi Zero 2 W CPU headroom with the preset at 1080p30 (CBR + 1 s GOP is
  slightly more encoder work).
