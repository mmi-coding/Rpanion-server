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

## Feature 4: LTE Modem (feature/lte-modem)

- [ ] SIM7600G in RNDIS mode (`AT+CUSBPIDSWITCH=9011,1,1`): `usb0` netdev + `/dev/ttyUSB0-3` enumerate; ModemManager NOT installed
- [ ] AT port appears in the page's port list; status populates with a real SIM (operator, LTE band, RSSI/RSRP/SINR, WAN IP)
- [ ] Data usage counters move with real traffic; sanity-check against the carrier's reported usage; totals survive a reboot
- [ ] Auto-reconnect: force-drop the data call (`AT+CFUN=4` then `AT+CFUN=1`, or antenna pull) → call re-established within ~30 s, reconnect count increments
- [ ] APN setting applied on reconnect (check `AT+CGDCONT?` afterwards)
- [ ] AT console round-trip on device
- [ ] Port contention: mavlink-router and PPP are not configured on the modem's AT ports; monitor + Mission Planner telemetry run simultaneously
- [ ] Monitor auto-starts on boot when enabled; status correct after modem USB replug (lazy port reopen)
- [ ] Pi Zero 2 W: AT polling at 5 s has no impact on stream CPU

## Feature 5: Cellular Video Tuning (feature/cellular-tuning)

- [ ] Low-latency preset with IMX708 + `v4l2h264enc` on Pi 4: stream starts, pipeline print shows `h264_i_frame_period=<fps>`, `video_bitrate_mode=1` and the leaky payloader queue; encoder accepts the CBR control (no `extra-controls` error in the service log)
- [ ] Runtime bitrate change on the real hardware encoder: with a stream running, change the LTE signal tier (or use the bench stdin command) → `BITRATE:` ack and a visible wire-rate change (`iftop`/`nload` on the VPN interface) — `v4l2h264enc` runtime `extra-controls` retuning is the one path WSL could not exercise
- [ ] Glass-to-glass latency with and without the preset (phone stopwatch in frame, Mission Planner HUD over VPN on LTE) — expect a measurable drop with the preset on
- [ ] Adaptive bitrate against the real SIM7600: enable modem monitoring + adaptive bitrate, attenuate the antenna (or drive into weak coverage) → tier drops after 2 polls, bitrate steps down, stream stays up; signal recovery restores the configured bitrate
- [ ] Tier boundaries sane for the actual carrier/band (RSRP −95/−105 defaults) — adjust thresholds in `server/cellularTuning.js` if the local network behaves differently
- [ ] RTSP mode: bitrate retune with a connected client (Mission Planner/VLC) — ack flips from `BITRATE-NOENCODER` to `BITRATE:` once a client is connected
- [ ] Dual-camera switcher + low-latency preset together: A↔B switch and a bitrate retune on the same stdin channel mid-stream
- [ ] Custom pipeline with `enc0`-named hardware encoder: runtime retune works (x264 path verified in WSL; verify `v4l2h264enc` on device)
- [ ] Pi Zero 2 W: CPU headroom with the preset at 1080p30 (CBR + 1 s GOP costs a little more encoder work); adaptive loop adds no measurable CPU

## Feature 6: Modem discovery + connection test (feature/modem-discovery)

- [ ] USB scan on Pi 4 with a real SIM7600G: all four `/dev/ttyUSB*` probed, the two AT ports answer, `/dev/ttyUSB2` recommended with the SIMCOM model string; NMEA (`ttyUSB1`) and diag (`ttyUSB0`) correctly time out without wedging the scan
- [ ] UART scan: SIM7600 HAT wired to GPIO 14/15, serial console disabled - `/dev/serial0` found at 115200; scan duration acceptable (multi-baud probing of silent UARTs)
- [ ] FC exclusion: with the Pixhawk connected and the FC link active, its port shows as "Skipped - in use by the flight controller link" and no AT bytes reach the FC (check MAVLink stream stays clean during a scan)
- [ ] Scan while monitoring: monitor resumes by itself after the scan (lazy reopen) on real hardware
- [ ] Interface discovery: `usb0` listed with driver `rndis_host` and recommended; wrong-mode modem (e.g. PID 9001) → no modem-driver interface and the RNDIS hint shown
- [ ] Connection test, all-pass: real SIM, registered, data call up → 8/8 including ping through `usb0` (verify the ping really egresses the modem: `tcpdump -i usb0 icmp`)
- [ ] Connection test failure modes: SIM removed (SIM step fails with "SIM not inserted"), antenna off (signal step), wrong APN (data call step), USB data cable pulled with UART control connected (interface step shows the UART-only hint)
- [ ] Ping with the VPN up: confirm `-I usb0` bypasses the VPN default route as intended
- [ ] Pi Zero 2 W: scan + test CPU/time acceptable

## Feature 7: Self-documenting UI (feature/self-documenting-ui)

Needs any real browser (desktop or the Pi's webUI from a phone) - WSL has none:

- [ ] Tooltips ("?") show on hover and on keyboard focus on all four fork pages; no viewport clipping (HelpTip placement defaults to right)
- [ ] HelpSections expand/collapse; the RSRP tier table renders inside the Cellular Tuning section
- [ ] Phone-sized screen: pages read compact with sections collapsed; "?" markers are tappable (touch shows the tooltip)

## Feature 14: E2E Playwright (feature/e2e-playwright)

The e2e suite runs in WSL against the dev stack with **auth disabled**, so the
login/logout flow and production-mode serving can only be checked on device
(`/etc/rpanion-server/config/*` + backend-served build). See docs/E2E-TESTING.md.

- [ ] Production install (`.deb`): unauthenticated visit to any page redirects to / and shows the login form (`authEnabled:true`)
- [ ] Login with the configured admin credentials succeeds, token persists, pages load, the sidebar shows the Logout link
- [ ] Wrong password shows the error modal and does not authenticate
- [ ] Logout returns to the login state; protected `/api/*` calls 401 without a token
- [ ] Backend-served SPA (no Vite): deep-link to a client route (e.g. `/network`) loads via the production catch-all, not a 404
- [ ] Optional: run `npm run e2e` against the device's IP/build (set `baseURL`) to smoke the same routes with real hardware values present
