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

## Feature 15: RBAC — Admin/Read-only roles (feature/rbac)

RBAC is enforced only when auth is enabled (production mode); dev/WSL bypasses it.
Verify on a production install. See docs/USER-ROLES.md.

- [ ] Create a read-only user from the Add User dialog (role selector = Read-only); it appears with role `readonly` in the table
- [ ] Log in as that read-only user: a "read-only" badge shows by the sidebar title; every page still loads
- [ ] As the read-only user, attempt a change on any page (e.g. save a setting) → backend returns 403 and the change is rejected
- [ ] Direct API check: `POST /api/<anything>` with the read-only token returns 403; `GET` still returns 200; `POST /api/logout` still works
- [ ] As an admin, toggle the user to Admin (Make Admin) → they can now save changes; toggle back to Read-only
- [ ] Pre-RBAC upgrade: an existing `config/user.json` without a `role` field still logs in as admin (no lock-out)

## Feature 16: Settings backup & restore (feature/settings-backup)

Mostly WSL-verified (endpoints + UI unit/e2e tested). Confirm the round-trip on real hardware:

- [ ] Backup on a configured Pi downloads a non-empty `rpanion-settings.json` with the real config
- [ ] Restore that file on a freshly-flashed Pi, restart the service → all settings (network/video/modem/NTRIP/cellular) come back
- [ ] Clone: restore a backup from device A onto identical device B; verify nothing device-specific breaks
- [ ] With RBAC on, a read-only user cannot restore (Restore returns 403)

## Feature 17: Tailscale VPN (feature/vpn-tailscale)

The CLI wrappers are fakeBin-tested in WSL; real tailnet behaviour needs the device.

- [ ] Install tailscale on the Pi; generate an auth key in the admin console
- [ ] Connect from the Tailscale VPN page with the auth key → status shows Connected: Yes, the device's Tailscale IP, and tailnet peers
- [ ] From a ground station on the same tailnet, reach Mission Planner telemetry over the modem link (CGNAT, no port-forward)
- [ ] Disconnect → `tailscale down`; reconnect without a new key
- [ ] Confirm `sudo tailscale` has the needed rights on the Pi (no password prompt under the service user)
- [ ] With RBAC on, a read-only user cannot Connect/Disconnect (403)

## Feature 18: Dynamic DNS (feature/dynamic-dns)

The updater logic is fully unit-tested (HTTP client stubbed); real DNS round-trips need the device.

- [ ] DuckDNS: enable with a real subdomain + token → Update now shows Success and the hostname resolves to the device's public IP
- [ ] No-IP: enable with real credentials → Success; verify basic-auth update works
- [ ] Public-IP detection (api.ipify.org) reachable over the modem link; behind CGNAT the detected IP is the carrier address (expected — pair with VPN)
- [ ] Timer: leave enabled, confirm periodic updates happen at the configured interval (check provider "last update")
- [ ] With RBAC on, a read-only user cannot Save/Update (403)

## Feature 19: Network priority + bandwidth (feature/network-priority)

The wrapper, parsing and rate maths are unit-tested in WSL; real failover needs the Pi.

- [ ] Bandwidth table shows real interfaces (eth0/wlan0/usb0) with live RX/TX rates under traffic
- [ ] Set WiFi priority higher / metric lower than the SIM7600 (`usb0`) connection; verify with `nmcli -f connection.autoconnect-priority,ipv4.route-metric connection show <uuid>`
- [ ] Pull the WiFi link → traffic fails over to the modem (`usb0`); restore WiFi → it preempts again (check the default route / `ip route`)
- [ ] Confirm `sudo nmcli connection modify` has polkit rights under the service user
- [ ] With RBAC on, a read-only user cannot set priority (403)

## Feature 20: Multi-mode modem data path — QMI/PPP (feature/lte-data-path)

Wrappers are fakeBin-tested in WSL; the real data calls need the modem. See docs/MODEM-DATA-PATH.md.

- [ ] Prereqs installed: `libqmi-utils` (QMI), `ppp` (PPP); ModemManager NOT installed
- [ ] QMI: expose `/dev/cdc-wdm0`; select QMI mode, set interface `wwan0`, Connect → `qmicli --wds-start-network` succeeds, `udhcpc` leases an IP on wwan0, data flows; Disconnect stops the network cleanly
- [ ] QMI raw-IP: SIM7600 may need `echo Y > /sys/class/net/wwan0/qmi/raw_ip` before the lease — confirm/automate as needed
- [ ] PPP: select PPP mode, set PPP port to the modem's AT port (NOT the FC UART), Connect → `pppd` dials *99#, `ppp0` comes up with an IP; Disconnect (`poff`) tears it down
- [ ] PPP FC-safety: with the flight controller active, setting PPP port = the FC serial is refused (error), and a PPP dial never disturbs the MAVLink link
- [ ] Auto-reconnect works in each mode (registered but no IP → mode-aware reconnect)
- [ ] Data-usage accounting and the connection test follow the active interface (usb0/wwan0/ppp0)
- [ ] `sudo` rights for qmicli/udhcpc/pppd/poff under the service user

## Feature 24: Telemetry injectors (feature/telemetry-injectors)

Encoding + the HTTP/UDP/serial sources are unit-tested in WSL (serial via a
pty-backed port); actual MAVLink delivery needs the live router + a GCS. See
docs/TELEMETRY-INJECTORS.md.

- [ ] With mavlink-router running and a GCS connected: enable the injector + HTTP source, POST `{"name":"co2","value":412}` to `/api/telemetryinject` → the NAMED_VALUE_FLOAT `co2` appears in the GCS
- [ ] POST `{"text":"pump on","severity":6}` → a STATUSTEXT shows in the GCS message log
- [ ] UDP source: enable + set listen port, send NDJSON datagrams from another host → readings appear; status shows "Listening on <port>" and the float/text counters climb
- [ ] Serial source: point at a real serial device emitting NDJSON (NOT the FC port) → readings ingested; status shows "Open (<dev>)"
- [ ] Component ID is distinct from the autopilot, so injected values are attributable in the GCS
- [ ] Master switch off → all sources stop, `/api/telemetryinject` returns 409, no messages injected; on reboot the saved enabled state auto-starts the sources
- [ ] With RBAC on, a read-only user cannot modify settings or inject (403)

## Feature 25: WireGuard Hub (feature/wireguard-hub)

The generated script's *content* is unit-tested in WSL; actually running it on a
VPS and bringing up the tunnel is real-world only. See docs/WIREGUARD-HUB.md.

- [ ] Generate a script on the page, run it on a fresh Debian/Ubuntu VPS (`sudo bash setup-wireguard-hub.sh`) → `wg0` comes up (`wg show`), `ufw` keeps SSH reachable, UDP port open
- [ ] Re-run the script (idempotency) → keys/config reused, no breakage
- [ ] Create the DNS A record (domain → VPS IP) beforehand; confirm the Endpoint resolves
- [ ] Upload the printed `pi.conf` on the drone's VPN page + Activate → handshake with the hub (`wg show` latest-handshake)
- [ ] Import `laptop.conf` on the ground station + activate → laptop pings the drone's VPN IP (e.g. `10.13.13.2`) over the LTE link
- [ ] Mission Planner connects to the drone through the tunnel (UDP/TCP to the VPN IP)
- [ ] VPS provider firewall/security group allows inbound UDP on the chosen port

## Feature 26: Ground Station theme (feature/ground-station-theme)

Pure frontend/CSS — fully WSL-verifiable (build + 822 frontend tests + visual
preview against the compiled bundle). The only on-device items are confirming it
renders correctly on the real device/browser and that the self-hosted fonts load
with no internet. See docs/GROUND-STATION-THEME.md.

- [ ] Load the webUI on the deployed Pi (over the VPN / LAN) → the dark Ground Station theme renders; Chakra Petch / IBM Plex fonts are applied (not the system fallback), confirming the bundled woff2 served offline
- [ ] Sidebar collapse toggle (☰) shrinks the rail to the waypoint-code strip and re-expands; active route is highlighted
- [ ] Home dashboard status badges show as green/amber/red lamps; `code`/`pre` blocks render in mono
- [ ] Spot-check a form-heavy page (LTE Modem / WireGuard Hub) at the Pi's typical screen size — controls legible, focus rings visible, no contrast regressions

## Feature 27: Light/dark toggle + mobile responsive (feature/theme-toggle-responsive)

Pure frontend/CSS — WSL-verified via build + 825 frontend tests + headless-Chromium
screenshots of dark/light/mobile against the compiled bundle. On-device checks are
real-browser confirmations on the deployed Pi. See docs/GROUND-STATION-THEME.md.

- [ ] Toggle light/dark from the sidebar footer → theme switches; reload → choice persists (localStorage); first paint shows the saved theme with no dark→light flash
- [ ] Light mode is legible on the Pi (status badges, mono `code`/`pre`, form controls, nav contrast)
- [ ] On a phone/narrow browser: the sidebar is hidden behind the top-bar hamburger; tapping it opens the drawer with a backdrop; tapping a nav link or the backdrop closes it
- [ ] Dashboard cards stack and page content fits the viewport width (no horizontal scroll) on a phone
- [ ] Desktop collapse rail (waypoint codes) still works ≥ 768px and is not used on phones

## Bug fix #356: video device scan timeout

- [ ] Attach a USB analog capture grabber (EasyCAP / MacroSilicon) and open the Video page → it loads within ~15 s (with a "scan timed out" notice if the device is unresponsive) instead of hanging and bouncing to login
- [ ] Normal cameras (Pi Camera / standard USB webcam) still enumerate with full caps

## Bug fix #187 / #158: Adhoc Wi-Fi page robustness

- [ ] Open the Adhoc Wi-Fi page on a board whose adapter reports no channels → the page renders (no blank screen) instead of crashing
- [ ] On a card that rejects ad-hoc/WEP, enabling shows the backend error and the HelpSection explains the adapter caveat

## Bug #293 / #278: Zero 2 W hotspot gone after reboot — DIAGNOSIS NEEDED

The AP NetworkManager profile is created with `connection.autoconnect=yes`, so this
looks like a boot race / NM state issue specific to the Zero 2 W rather than a code
bug. After reproducing (stop service → `shutdown` → power on), capture:

- [ ] `nmcli -f NAME,TYPE,AUTOCONNECT,AUTOCONNECT-PRIORITY connection show` — is the AP profile present, AUTOCONNECT=yes?
- [ ] `sudo nmcli connection up <AP-uuid>` — does it bring the hotspot back manually? (yes ⇒ boot race; candidate fix: raise `connection.autoconnect-priority` + a oneshot `nmcli con up` after NetworkManager is up)
- [ ] `journalctl -b -u NetworkManager | grep -i wlan0` — any "device not ready" / rfkill / timeout around AP activation on boot?
- [ ] `nmcli radio wifi` and `rfkill list` — is wlan0 soft/hard-blocked after boot?
- [ ] Share the output so a *verified* fix can be implemented (the change is too risky to ship blind on the shared AP-activation path).

## Bug #221: new USB-WiFi AP not active until reboot

- [ ] Add an AP on a second (USB) Wi-Fi adapter → the page now prompts to **Activate** it; click Activate on the new connection in the list → the hotspot moves to the USB card without a reboot

## Bug #364: Pi 5 serial telemetry (out-of-target board)

The fork targets Pi 4 (primary) / Zero 2 W. On a Pi 5 the GPIO UART differs and must
be enabled before serial telemetry to the FC works:

- [ ] Enable the GPIO UART: `enable_uart=1` in `/boot/firmware/config.txt` (and free the serial console / Bluetooth as needed); the GPIO serial on Pi 5 enumerates as `/dev/ttyAMA0`
- [ ] Loopback test (jumper TX↔RX): `stty -F /dev/ttyAMA0 57600 && (cat /dev/ttyAMA0 &) && echo hello > /dev/ttyAMA0` → should echo back
- [ ] Point the Flight Controller page at the correct `/dev/ttyAMA0` device

## Feature #31: live system stats

- [ ] Home dashboard "System" card shows a real CPU temperature (°C, not N/A) plus live CPU load, RAM and disk usage, and uptime — updating every few seconds

## Feature #396: MAVLink camera-capture commands

- [ ] From a GCS / MAVProxy, send IMAGE_START_CAPTURE (2000) to the camera component → a photo is captured (CAMERA_TRIGGER emitted)
- [ ] In video mode, VIDEO_START_CAPTURE (2500) starts recording and VIDEO_STOP_CAPTURE (2501) stops it; repeated identical commands are no-ops

## Feature #224: set the system time zone from the web UI

`POST /api/timezone` runs `sudo timedatectl set-timezone <zone>`; the service user
needs a password-less sudoers grant for it (the page will otherwise hang on a
prompt). Add to the rpanion sudoers drop-in, e.g.:
`rpanion ALL=(ALL) NOPASSWD: /usr/bin/timedatectl set-timezone *`

The `timedatectl set-timezone` sudoers grant is now shipped by `debian/postinst`
(no manual step) — redeploy/reinstall the `.deb` so the drop-in is regenerated.

- [x] **(Pi 4, 2026-06-15)** sudoers grant present; `setTimezone()`'s
  `sudo timedatectl set-timezone <zone>` runs non-interactively as the `rpanion`
  user (Paris→London→Paris round-trip verified, restored).
- [ ] About page → **Time Zone**: the select is populated and defaults to the box's current zone
- [ ] Pick a different zone → **Set Time Zone** → success message; `timedatectl` (and log timestamps) reflect the new zone
- [ ] Reboot → the zone persists (no password prompt was needed for the apply)

## Feature #173: telemetry HUD overlay on the video stream

The HUD is drawn on raw video before encoding (like the timestamp), so it needs a
re-encoded source (CSI / MJPEG / raw USB) and a connected flight controller.

- [x] **(Pi 4, 2026-06-15)** Deployed code + Pi GStreamer: the `textoverlay name=hud0` pipeline reaches PLAYING through the x264 encoder and the stdin control channel updates the live overlay text (verified with `testsrc`; `textoverlay` present, `enc0` intact). No FC attached this pass, so the items below remain.
- [ ] Stream from a CSI/MJPEG camera with **Telemetry HUD** enabled + FC connected → the readout appears top-left and tracks altitude / speed / heading / battery / mode / GPS live (~5 Hz), and is present in a recording and in a dumb viewer (VLC), with acceptable CPU on the Pi
- [ ] Flight-mode label matches the FC's actual mode (spot-check across copter / plane / rover if available — `hudOverlay.mavlinkModeName`)
- [ ] Select a pre-compressed **H264** USB source → the HUD toggle is disabled with the "not available" note (overlay correctly absent)
- [ ] Battery reads `--` when the FC reports unknown voltage/percent (0xFFFF / -1) rather than a bogus number

## Feature #311: multiple serial telemetry links

- [ ] Add two links at once (e.g. FC on `/dev/serial0` + a second MAVLink device on USB, or a UDP server link) → both show as separate cards with independent live status, and both vehicles appear in Mission Planner via a UDP-client destination (distinct system IDs)
- [ ] Unplug one link's cable → only that card goes "Not connected" and auto-reconnects on replug; the other link keeps streaming (fault isolation)
- [ ] The UDP-Server (broadcast) / TCP-Server outputs carry the first link; an explicit UDP-client destination carries every vehicle
- [ ] An existing single-link config still works after upgrade (migrated to a one-element links list)
- [ ] Removing a link stops its router/monitor and frees its slot for a new link

## Feature #398/#289/#9: multiple (secondary) video streams

- [ ] Primary stream (IMX708) on the Photo & Video page + a secondary stream from a second (USB) camera on the Secondary Streams page → both run at once; pull each into a viewer (secondary RTSP on `:8555`, or RTP to the GCS)
- [ ] CPU headroom on a Pi 4 with two streams (drop the secondary resolution if the encoder/CPU saturates); a Pi Zero 2 W needs low secondary resolutions
- [ ] The add form refuses the primary's camera (and another secondary's) — no double-open; backend rejects a duplicate device
- [ ] Remove a secondary → its `video-server.py` process exits and the camera frees
- [ ] Secondary streams are restored after a reboot (persisted in settings)

## Feature #173 follow-up: graphic artificial-horizon HUD

- [ ] On the Video page, enable the HUD on a CSI/MJPEG source and set **HUD Style = Graphic** + a FC connected → an artificial-horizon overlay (roll/pitch horizon + ladder + corner readouts) appears and tracks attitude live in a recording / VLC; CPU acceptable on the Pi (rsvgoverlay redraw)
- [ ] Switch back to **Text readout** → the corner text HUD returns
- [ ] No new package needed (rsvgoverlay ships with gstreamer1.0-plugins-bad, already present)

## Feature #398 follow-up: multi-stream MAVLink discovery

- [ ] With a primary stream + a secondary stream running, connect QGroundControl (which uses the MAVLink camera protocol) → it discovers BOTH streams (count = 2) and can select either; each stream's URI / resolution / encoding is correct
- [ ] A request for a specific streamId returns only that stream

## Feature #173: customizable HUD / OSD editor

- [ ] HUD Editor page: drag elements on the black canvas, toggle stats + icons, Save → with a graphic HUD streaming (FC connected), the live overlay matches the layout (positions, which elements, icons) and updates live on Save
- [ ] Untick the Artificial Horizon → text-only OSD; re-tick + drag it → recentres
- [ ] Each new stat (AGL, airspeed, climb, throttle, current, arm state) shows real values from the FC
- [ ] Reset to Defaults restores the default layout
- [ ] Layout persists across a stream restart / reboot (saved in settings)

## Feature #173 follow-up: modem GPS, mock data, dynamic home arrow, text styling

- [ ] With the SIM7600 modem enabled and a GNSS antenna attached, enable the *Modem GPS* elements (modemFix/lat/lon/alt) in the HUD Editor → on a graphic stream they show the modem's own fix; **with NO flight controller connected** they still update (the periodic 1 Hz push), and `modemFix` reads `NO` until the modem gets a fix, then `OK` with live coordinates (`AT+CGPSINFO` returns a fix outdoors / by a window — it can take a minute on cold start)
- [ ] The modem GPS poll does not disturb the AT status poll (signal/registration/operator/IP keep updating) and is absent/`NO` cleanly when the modem has no GNSS antenna
- [ ] Editor canvas shows **mock values** (e.g. `ALT 124m`, `mGPS OK`) on the chips, and the **home arrow** renders as a rotating arrow; on a real graphic stream the burned-in home arrow points toward home as heading changes
- [ ] Set a **global** font/size/colour → all text fields on the burned-in HUD change; set a **per-element** override (e.g. red battery, larger altitude) → only that field changes; "Use global" clears it. Confirm the on-stream sizes/positions match the editor preview (the `100cqw` scaling vs `rsvgoverlay fit-to-frame`)
