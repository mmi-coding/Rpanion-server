# Cellular Video Tuning

Tune the video stream for constrained 4G/LTE links from the **Cellular Video
Tuning** page: a low-latency encoder preset and signal-adaptive bitrate so the
stream degrades gracefully instead of stalling when the link gets worse.

Both features are independent — you can run either one alone.

## Low-latency preset

A checkbox that re-tunes the generated GStreamer pipeline for cellular links.
Takes effect the next time the stream is started (it changes how the pipeline
is built, not a running pipeline).

What it changes versus the default pipeline:

| Knob | Default | Low-latency |
|---|---|---|
| Keyframe interval | 25 frames (x264/x265) or 5 frames (hw encoders) | 1 second of frames (= configured fps, 30 if unset) |
| Rate control | ABR (x264 default) / VBR (hw) | x264: VBV buffer capped at 500 ms (`vbv-buf-capacity=500`); `v4l2h264enc`: CBR (`video_bitrate_mode=1`) |
| Queue before payloader | unbounded `queue` | `queue max-size-buffers=1 leaky=downstream` — drop frames instead of buffering them |
| UDP send (RTP mode) | clocked (`udpsink` default sync) | `sync=false` — send packets as soon as they're encoded |

Rationale for a 4G uplink:

- **1 s keyframes**: on a lossy link the decoder recovers at the next
  keyframe. The hardware-encoder default of 5 frames burns bitrate on
  keyframes; the x264 default of 25 frames at low fps means seconds of
  smearing after loss. 1 second is the usual compromise for live links.
- **CBR / VBV capping**: ABR lets the encoder burst well above the target on
  complex scenes; a cellular uplink can't absorb the burst, so it turns into
  queueing delay (rubber-banding latency). Constant-rate output keeps the
  latency flat.
- **Leaky queues + `sync=false`**: when the link chokes, drop the oldest
  frame and keep going. A late frame is worthless for FPV-style piloting;
  a stalled, buffering stream is worse.

Applies to both RTSP and RTP transports, generated and dual-camera
(switcher) pipelines. For **custom pipelines** the preset doesn't rewrite
your pipeline string — tune it yourself — but the runtime-bitrate channel
below still works if you name your encoder `enc0`.

## Adaptive bitrate

When enabled, the encoder bitrate is scaled with the LTE signal quality
reported by the [LTE Modem](LTE-MODEM.md) monitor — **modem monitoring must
be enabled** on that page for this to do anything.

- Signal tiers, preferring RSRP (LTE) and falling back to RSSI:

  | Tier | RSRP | RSSI | Bitrate factor |
  |---|---|---|---|
  | good | ≥ −95 dBm | ≥ −85 dBm | 100 % |
  | fair | ≥ −105 dBm | ≥ −97 dBm | 60 % |
  | poor | below | below | 35 % |

- Evaluated every 5 s; a tier change is applied only after **2 consecutive**
  evaluations agree (hysteresis), so a one-poll blip doesn't thrash the
  encoder.
- The target is `configured bitrate × factor`, floored at the configurable
  **minimum bitrate** (default 250 kbps) and never above the configured
  bitrate. When the signal recovers (or adaptation is disabled), the
  configured bitrate is restored.
- No signal data (monitor off, modem unplugged) → hold the current bitrate.
  Stream not running → nothing to do; adaptation state resets.

The change is applied to the **running** stream over the video server's
stdin control channel — no restart, no keyframe renegotiation, the encoder
just retargets:

```json
{"cmd":"bitrate","kbps":1000}
```

The video server acks with `BITRATE:<kbps>` on stdout (surfaced as
"applied" on the page), or `BITRATE-NOENCODER:<kbps>` if no retunable
encoder is live (e.g. RTSP with no client connected yet, or a custom
pipeline without an `enc0`-named encoder). Supported encoders: `x264enc`,
`x265enc` (kbps), `nvv4l2h264enc`/`nvv4l2h265enc` (bps), `v4l2h264enc`
(via `extra-controls` `video_bitrate`).

## Page

- **Status** (1 Hz over the existing socket connection): stream running,
  signal tier + RSRP/RSSI, configured vs adapted bitrate, last applied
  (acked) bitrate, time of last change.
- **Settings**: low-latency preset on/off, adaptive bitrate on/off,
  minimum bitrate (50–10000 kbps).

## API

- `GET /api/cellulartuning` — `{settings, status}`
- `POST /api/cellulartuningmodify` — `{lowLatency, adaptiveBitrate, minBitrate}`
  (validated; errors returned with unchanged settings)
- socket.io `CellularTuningStatus` (1 Hz)

## Implementation notes

- `server/cellularTuning.js` — tier mapping (`tierForSignal`), 5 s
  evaluation loop with 2-poll hysteresis, min-floor clamping, restore on
  disable. Dependencies (signal source, stream state, bitrate setter) are
  injected, so the logic is unit-testable without a modem or a stream.
- `server/videostream.js` — `--lowlatency` flag pass-through,
  `setBitrate(kbps)` writes the JSON command to the video server's stdin,
  `BITRATE:` acks parsed from stdout into `currentBitrate`.
- `python/video-server.py` — `LOW_LATENCY` pipeline variants, a
  `live_pipelines` registry (RTP pipelines and RTSP per-client medias) and
  `doBitrate()` which retargets every live `enc0` it finds. The stdin
  watcher reads the fd raw and drains complete lines, so coalesced
  commands (e.g. a switch and a bitrate change in one chunk) aren't lost.

## Bench test (no modem, no camera needed)

Drive the running video server by hand:

```bash
./python/.venv/bin/python ./python/video-server.py --videosource=testsrc \
  --width=640 --height=480 --fps=15 --bitrate=2000 --format=video/x-raw \
  --rotation=0 --compression=H264 --transport=RTP --udp=127.0.0.1:5600 --lowlatency
# then type on its stdin:
{"cmd":"bitrate","kbps":300}
# expect BITRATE:300 on stdout and the wire rate to drop accordingly
```

For the adaptive loop end-to-end, `python/fake-sim7600.py` (see
[LTE-MODEM.md](LTE-MODEM.md)) provides the signal source. It emulates LTE,
so the tuner uses the RSRP field of its `AT+CPSI?` response — the `-850`
(= −85.0 dBm) maps to the *good* tier; edit that field to drive the other
tiers (`-1000` → −100 dBm *fair*, `-1100` → −110 dBm *poor*) and watch the
tier and adapted bitrate change on the page.
