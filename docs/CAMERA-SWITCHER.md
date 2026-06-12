# Camera Switcher

Switch the active video source at runtime, driven by an RC channel on the
flight controller or manually from the web UI. The video stream is **not**
restarted on switch — the GCS keeps the same RTSP/RTP session.

## Modes

### GStreamer mode (dual source)

The video pipeline runs *two* sources into a GStreamer `input-selector`.
Both branches are normalized to identical caps (I420, primary resolution and
framerate), so flipping the selector pad never renegotiates the encoder.
One encoder instance is used, so the hardware H.264 encoder on Pi 4 /
Pi Zero 2 W keeps working as in single-source mode.

Use this for CSI + USB camera pairs, e.g. a Camera Module 3 (navigation) and
a USB inspection camera.

- **Primary source** is whatever is configured on the *Photo and Video* page.
- **Secondary source** is configured on the *Camera Switcher* page:
  - device path (`/dev/video1`), libcamera name (`/base/soc/...`) or
    `testsrc`/`testsrc2` for bench testing
  - format: raw (`video/x-raw`) or MJPEG (`image/jpeg`)
  - capture resolution/framerate (0 / -1 = same as primary)
- The secondary is scaled to the primary's output resolution.
- RTSP secondary sources are not supported.
- Changes apply on the **next stream start**.
- In RTSP mode the dual-source pipeline is shared between clients (the
  cameras can only be opened once), unlike single-source mode where each
  client gets its own pipeline.

### Command mode (CSI multiplexer boards)

For multiplexer boards (e.g. Arducam camarray) where both cameras share one
CSI interface and the active one is chosen by an i2c/GPIO command. The video
pipeline keeps using the same device; on switch, Rpanion runs your
user-defined shell command for source A or B, e.g.:

```
A: i2cset -y 1 0x70 0x00 0x01
B: i2cset -y 1 0x70 0x00 0x02
```

Commands run as the rpanion service user. Note the video may glitch for a few
frames while the multiplexer switches.

## RC channel switching

When enabled, Rpanion asks the flight controller to stream `RC_CHANNELS` at
2 Hz (`MAV_CMD_SET_MESSAGE_INTERVAL`) and watches the configured channel:

- value ≥ threshold + hysteresis → source **B**
- value ≤ threshold - hysteresis → source **A**
- inside the hysteresis band, or invalid (0 / 65535) → no change

The new position must be held for *Min hold time* (default 250 ms) before the
switch commits — this debounces noisy RC input. Defaults: channel 7,
threshold 1500 µs, hysteresis 50 µs.

Map a transmitter switch to a passthrough RC channel (e.g. `RC7_OPTION = 0`
on ArduPilot, or use a channel forwarded by your receiver) and configure that
channel number.

## API

- `GET /api/cameraswitcher` — `{settings, status}`
- `POST /api/cameraswitchermodify` — update settings (validated; errors are
  returned with the unchanged settings)
- `POST /api/cameraswitcherswitch` — `{source: "A"|"B"}` manual switch
- socket.io `CameraSwitcherStatus` (1 Hz) —
  `{enabled, activeSource, lastRcValue, rcLive, lastSwitchTime}`

## Implementation notes

- `server/cameraSwitcher.js` — RC decision logic (hysteresis + debounce),
  settings, command-mode execution
- `server/videostream.js` — passes `--secondary*` args to the python video
  server and forwards switch commands over its stdin (JSON lines)
- `python/video-server.py` — builds the dual-source `input-selector`
  pipeline; `{"cmd":"switch","source":"A"|"B"}` on stdin flips the selector
  of all running pipelines and prints `SWITCHED:<X>`
- The pipeline always starts on source A; the Node side resets its state on
  stream start and the RC logic re-switches if the transmitter switch is
  still flipped.

## Bench test (no cameras needed)

```bash
python3 ./python/video-server.py --videosource=testsrc --secondary=testsrc2 \
  --width=640 --height=480 --fps=15 --bitrate=1000 --transport=RTSP
# in another terminal:
gst-launch-1.0 rtspsrc location=rtsp://127.0.0.1:8554/testsrc latency=0 ! \
  queue ! decodebin ! autovideosink sync=false
# then type into the server's stdin:
{"cmd":"switch","source":"B"}
```

The picture flips between the "ball" (A) and "smpte" (B) test patterns.
