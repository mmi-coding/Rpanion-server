# On-device verification checklist

Steps that can only be verified on the target hardware (Pi 4 / Pi Zero 2 W). Each feature appends
its items here. Tick on the bench, note board + date.

## Baseline

- [ ] Flash Raspberry Pi OS (Bookworm, 64-bit lite recommended for Zero 2 W RAM headroom)
- [ ] `deploy/RasPi*.sh` install of this fork's `.deb`; service starts on boot
- [ ] Camera Module 3 detected via libcamera (`rpicam-hello --list-cameras` shows imx708)
- [ ] RTSP 1080p30 H.264 stream from IMX708, hardware-encoded (check `v4l2h264enc`/encoder in pipeline, CPU < ~40% on Zero 2 W)
- [ ] FC link: mavlink-routerd ←→ Pixhawk on GPIO UART (`/dev/serial0`) and USB
- [ ] SIM7600G enumerates on USB: RNDIS netdev (`usb0`) + AT ports (`/dev/ttyUSB2` typical)
- [ ] WireGuard or ZeroTier up over the LTE link (CGNAT traversal), Mission Planner UDP telemetry through VPN
- [ ] RTP/UDP video into Mission Planner/QGC through VPN

## Feature 1: Camera Switcher (feature/rc-camera-switching)

- [ ] Dual-source RTSP: IMX708 (libcamerasrc, `/base/soc/i2c...`) primary + USB cam (`/dev/video1`, MJPEG) secondary on Pi 4 — stream starts, hardware encoder (`v4l2h264enc`) in use (verify pipeline print + CPU)
- [ ] Same on Pi Zero 2 W — check CPU headroom with the extra videoscale/videoconvert on the secondary branch (may need lower secondary capture res)
- [ ] Runtime switch A↔B from the web UI while a GCS client is connected — stream stays up, no encoder renegotiation, < 1 s glitch
- [ ] RC switching: transmitter switch on the configured channel flips the source (RC_CHANNELS arrives at 2 Hz after enabling — check with `mavproxy` or the FC messages)
- [ ] RC_CHANNELS stream re-requested after FC reboot / link drop (stopLink → resetLink path)
- [ ] Dual-source RTP/UDP mode to Mission Planner via VPN
- [ ] CSI contention check: secondary USB cam unplug/replug behaviour; pipeline error handling when secondary missing at start
- [ ] 'Command' mode with a CSI multiplexer board (i2cset commands) if hardware available
- [ ] Verify `python/.venv` on the deployed image has gi/GStreamer access (system-site-packages)

## Feature 2: Custom Pipelines (feature/custom-pipelines)

- [ ] Custom pipeline with real hardware elements on Pi 4: `libcamerasrc` (IMX708) → `v4l2h264enc` → `h264parse` → `rtph264pay name=pay0` — validates on save, streams in RTSP and RTP modes, hardware encoder confirmed (CPU + pipeline print)
- [ ] Same custom pipeline on Pi Zero 2 W — CPU headroom at 1080p30
- [ ] Save-time validation works on the deployed image (validator runs in `/usr/share/rpanion-server/app/python/.venv`, gi available — not `valid: null`)
- [ ] Runtime fallback on device: enable a deliberately broken pipeline, start stream → `CUSTOM-PIPELINE-FALLBACK` warning appears on the Pipeline Editor page and the generated pipeline streams
- [ ] "Last used pipeline" populated after a real IMX708 stream; Copy-into-editor → tweak (e.g. bitrate) → save → restart → new value in effect
- [ ] Custom pipeline correctly suppresses camera-switcher dual-source mode when both are configured for the same device

## Feature 3: UDP/RTP video sink (feature/udp-rtp-sink)

- [ ] RTP mode from the Photo and Video page with IMX708 + `v4l2h264enc` on Pi 4: packets arrive at the configured destination (verify with the gst receive string from the page)
- [ ] RTP into Mission Planner over the WireGuard/ZeroTier VPN on LTE (destination = GCS VPN address) — video latency acceptable
- [ ] RTP into QGroundControl (UDP h.264 source, matching port)
- [ ] RTSP mode still works after the transport fix (regression)
- [ ] RTP + camera switcher dual-source: runtime A↔B switch while pushing UDP through the VPN
- [ ] RTP + custom pipeline: udpsink auto-appended, hardware encode confirmed
- [ ] Multicast destination address (if used on the local network)
- [ ] Camera heartbeat enabled: GCS auto-discovers the RTP stream via VIDEO_STREAM_INFORMATION (type RTPUDP, destination port)
