# Feature 30 — Complete the MAVLink camera-capture protocol (#396)

Implements upstream request [#396](https://github.com/stephendade/Rpanion-server/issues/396):
support the *take picture* and *record video* MAVLink messages. The fork already
answered `CAMERA_INFORMATION` / `VIDEO_STREAM_INFORMATION` / `CAMERA_SETTINGS` and
the legacy `DO_DIGICAM_CONTROL` (#169); this adds the modern camera-protocol
capture commands so a GCS can trigger photo/video without `DO_DIGICAM_CONTROL`.

## What was built (`server/videostream.ts`)

- **`onMavPacket()`** now also dispatches, alongside the existing handlers:
  - `MAV_CMD_IMAGE_START_CAPTURE` (**2000**) → `captureStillPhoto()` (same path as
    `DO_DIGICAM_CONTROL`, emits `CAMERA_TRIGGER`).
  - `MAV_CMD_VIDEO_START_CAPTURE` (**2500**) → `setVideoRecording(true)`.
  - `MAV_CMD_VIDEO_STOP_CAPTURE` (**2501**) → `setVideoRecording(false)`.
- **`setVideoRecording(record)`** — drives recording to an explicit state from the
  existing `toggleVideoRecording()` primitive, toggling only when the desired state
  differs from `videoSettings.isRecording` (so repeated START/STOP are idempotent;
  null `videoSettings` is treated as not-recording).

## Verification — WSL-verified

- `lint` 0 · `typecheck` 0 · `covback` **100/100/100/100** (added 3 `onMavPacket`
  command tests + 3 `setVideoRecording` branch tests). No frontend change.

## Needs on-device

- [ ] From a GCS / MAVProxy, `IMAGE_START_CAPTURE` (2000) → a photo is captured.
- [ ] In video mode, `VIDEO_START_CAPTURE` (2500) starts recording and
      `VIDEO_STOP_CAPTURE` (2501) stops it; repeated identical commands are no-ops.

## Notes / follow-on

Capture and streaming are still mutually exclusive (single `deviceStream`) — true
*record-while-streaming* is the architectural item #398. These commands map to the
existing photo/video-mode capture.
