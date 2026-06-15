# Feature 34 — Multiple (secondary) video streams (#398/#289/#9)

Implements the upstream multiple-simultaneous-streams requests
([#398](https://github.com/stephendade/Rpanion-server/issues/398),
[#289](https://github.com/stephendade/Rpanion-server/issues/289),
[#9](https://github.com/stephendade/Rpanion-server/issues/9)): run more than one
video stream at the same time.

## Architecture — secondary streams alongside the full primary (chosen with the user)

The single `videoStream` singleton (~1100 lines) carries the *entire* feature set
on one stream (camera switcher, telemetry HUD, custom pipelines, cellular bitrate
tuning, recording, the MAVLink camera protocol). Rewriting all of that into N equal
instances would be an enormous, high-risk change. Instead — matching the fork's
separate-page pattern (Camera Switcher, Pipeline Editor, Cellular Tuning) — the
**primary stream keeps every feature**, and a new **Secondary Streams** page adds a
small number of **basic** extra streams: each a *different* camera on its **own
`video-server.py` process** and its own RTSP/RTP endpoint (device, resolution, fps,
bitrate, rotation, compression, transport). Independent processes give fault
isolation — one bad camera can't take the others down.

- **`python/video-server.py`** — new `--rtsp-port` (default `8554`). Secondary RTSP
  streams run their own RTSP server on a distinct port (`8555 + slot`) so they don't
  clash with the primary's `:8554`. RTP secondaries just push to their UDP
  destination (no port to bind).
- **`server/secondaryStreams.ts` (new)** — `SecondaryStreams`: a manager of up to 3
  basic streams. `addStream` / `removeStream` (validated, **de-duplicated against the
  primary's live camera + the other secondaries** so no camera is opened twice),
  `getStatus()` (per-stream `running` + RTSP/RTP address), and settings persistence /
  restore on boot. Each stream is its own `video-server.py` spawn.
- **`server/routes/secondaryStreams.ts` (new)** — `GET /api/secondarystreams`
  (streams + in-use devices), `POST /api/secondarystreamadd`, `POST
  /api/secondarystreamremove`.
- **`server/index.ts`** — instantiates the manager (passing the primary `vManager` so
  it knows which camera the primary holds) and mounts the route.
- **`src/secondarystreams.jsx` (new)** — a self-documenting page (intro +
  `HelpSection` + `HelpTip`s): a status card per stream (running/stopped + endpoint +
  Remove) and an add form whose camera dropdown only offers cameras not already in
  use. Added to the **Camera & Video** nav group (`AppRouter.jsx`).

## Hardware constraints (surfaced in the UI)

- **Camera contention** — a CSI/USB camera can only be opened once, so each stream
  must use a different device; the add form excludes in-use cameras and the backend
  rejects a duplicate.
- **CPU / encoder limits** — the page warns that two 1080p H264 streams can saturate a
  Pi 4 and will overwhelm a Pi Zero 2 W, so pick modest resolutions for extras.
- **MAVLink camera protocol** still advertises only the primary stream (multi-stream
  GCS discovery is a documented follow-up).

## Verification — WSL-verified

- `lint` 0 · `typecheck` 0 · `covback` **100/100/100/100** (998 passing) ·
  `covfront` **100/100/100/100** (842 passing).
  - New `server/secondaryStreams.test.js` (manager against a fake `video-server.py`
    process — add/remove/validate/duplicate/max, restore, status, RTSP/RTP args).
  - `server/index.io.test.js` — the three new routes.
  - New `src/secondarystreams.test.jsx` — the page (seed/select camera, add/remove,
    error/catch, no-spare-camera, RTP fields).
- **Python**: `GstServer(port)` honours `--rtsp-port` (verified with real GStreamer:
  a secondary server binds `:8556`, the primary default stays `:8554`).

## Needs on-device

- [ ] Primary stream (IMX708) running on the Photo & Video page, plus a **secondary**
  stream from a *second* camera (USB) on the Secondary Streams page → both stream at
  once; pull each into a viewer (RTSP on `:8555`, or RTP to the GCS).
- [ ] CPU headroom on a Pi 4 with two streams (drop the secondary's resolution if the
  encoder/CPU saturates); confirm a Pi Zero 2 W needs low secondary resolutions.
- [ ] The add form refuses the primary's camera (and another secondary's) — no
  double-open.
- [ ] Remove a secondary → its `video-server.py` process exits and the camera frees.
- [ ] Secondary streams restored after a reboot (saved in settings).
