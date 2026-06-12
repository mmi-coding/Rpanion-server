# Fork Notes — LTE Companion Computer Stack

Fork of [stephendade/Rpanion-server](https://github.com/stephendade/Rpanion-server) extending it into a
4G LTE companion-computer stack for ArduPilot drones (UAVcast-Pro feature parity and beyond).

**Targets:** Raspberry Pi 4 (primary), Pi Zero 2 W (secondary) · Camera Module 3 (IMX708, libcamera-only)
· SimCom SIM7600G (USB RNDIS data path) · ArduPilot FC · Mission Planner over VPN (CGNAT-safe).

## Branch strategy

- `master` — tracks upstream `stephendade/Rpanion-server`. No feature work.
- `dev` — integration branch. Fork docs + merged features.
- `feature/*` — one branch per feature, branched from `dev`, merged back after tests pass.

## Green baseline (recorded 2026-06-12)

Upstream master @ `5226f95` (v0.12.0), Node 22.17.0, npm 10.9.2, Python 3.13.

| Suite | Command | Result |
|---|---|---|
| Backend (mocha) | `npm run testback` | **91 passing, 0 failing** |
| Frontend (vitest) | `npm run testfront` | **11 passing (1 file)** |
| Lint | `npm run lint` | 0 errors, 1 pre-existing warning |
| Dev server | `npm run dev` | backend :3001 → 200, frontend :3000 → 200 |

### Dev environment provisioning (WSL2, mirrors CI)

Per `.github/workflows/unitests.yml` + `deploy/install_common_libraries.sh`:

1. apt: GStreamer (good/bad/ugly/base-apps/rtsp-server/x/tools), network-manager, python3-gst-1.0,
   python3-opencv, python3-lxml, python3-numpy, python3-venv/dev/pip, ppp, dnsmasq, wireless-tools, iw,
   gpsbabel, zip, wireguard(+tools).
2. ZeroTier via official installer; auth token copied to `~/.zeroTierOneAuthToken` (CI does the same).
3. Prebuilt `mavlink-routerd` v4 (x86_64) → `/usr/local/bin` (CI downloads the same binary; on a Pi the
   deploy scripts build/install an ARM build).
4. **`modemmanager` purged** — `flightController.js:495` hard-errors if installed (serial port conflicts).
   ⚠ Design constraint: the LTE feature must drive the SIM7600G directly (AT commands), never via ModemManager.
5. `npm run build` must run before `testback` (`index.test.js` serves `build/`).
6. Sudoers drop-in mirroring `debian/postinst` `allow-vpn-control` for the dev user
   (zerotier-cli/wg/wg-quick/nmcli/pppd/systemctl wg-quick@*).
7. Python venv: `./python/setup-venv.sh` → `python/.venv` (pymavlink, piexif; `--system-site-packages`).
8. WSL-specific safeguards (not needed on Pi/CI): NetworkManager `unmanaged-devices` for eth0/docker,
   standalone `dnsmasq.service` masked.

## Codebase map (verified against 5226f95)

```
server/index.js       Express + socket.io on :3001. All /api/* routes, JWT auth middleware
                      (skipped when NODE_ENV=development or DISABLE_AUTH=1), 1 Hz status
                      broadcasts: FCStatus, NTRIPStatus, CloudBinStatus, LogConversionStatus,
                      PPPStatus, VideoStreamStatus. Managers instantiated ~line 68.
server/videostream.js videoStream class, settings ns `camera.*`. Spawns python helpers:
                      - streaming: python/video-server.py (GStreamer RTSP server :8554, or RTP/UDP
                        via --udp=IP:PORT) — args: --video --width --height --format --bitrate
                        --rotation --fps --udp --compression [--timestamp]
                      - photo/video: python/photovideo.py (picamera2/OpenCV; SIGUSR1 = capture/toggle)
                      Single active source (`this.deviceStream`); device discovery via
                      python/gstcaps.py (JSON on stdout). MAVLink camera protocol handled in
                      onMavPacket (CAMERA_INFORMATION, VIDEO_STREAM_INFORMATION, CAMERA_SETTINGS,
                      DO_DIGICAM_CONTROL) via events wired in index.js.
server/flightController.js
                      Spawns mavlink-routerd (`which` lookup, or binary next to app root) with FC
                      serial device + UDP endpoints (incl. user "UDP outputs" — already multi-GCS
                      capable). Creates mavManager on a local UDP endpoint. ModemManager check at
                      :495. Settings ns `flightcontroller.*`.
mavlink/mavManager.js node-mavlink splitter/parser over the local UDP endpoint. Locks onto first
                      non-GCS heartbeat (sysid/compid), emits `gotMessage(packet, data)` for every
                      decoded packet → THE hook for RC_CHANNELS (msgid 65). Sends datastream
                      requests at 4 Hz only if enableDSRequest; otherwise RC_CHANNELS may never be
                      streamed — camera-switch feature must request it explicitly
                      (SET_MESSAGE_INTERVAL / REQUEST_DATA_STREAM).
server/pppConnection.js
                      PPP-over-serial to the FC (ArduPilot PPP networking) — NOT a cellular modem
                      manager. No AT commands, no signal monitoring. LTE page is new code.
server/vpn.js         zerotier-cli / wg / wg-quick wrappers (sudo).
server/networkManager.js, adhocManager.js, networkClients.js — nmcli wrappers.
server/serialDetection.js  Board detection: Pi via /proc/device-tree/compatible, Jetson ttyTHS*,
                      OrangePi ttyS5/ttyAS5. No Pi4-vs-Zero2W granularity (video-server.py has
                      is_pi_5_or_later() for the Pi 5 no-HW-encoder case).
src/ (React 19 + Vite) One page per .jsx, all extend basePage.jsx (JWT from localStorage, optional
                      socket.io). Routing in AppRouter.jsx. Pattern: GET /api/<x>config → form →
                      POST /api/<x>modify.
python/               Helpers spawned by Node (venv at python/.venv via paths.getPythonPath()).
config/settings.json  settings-store persistence (per-manager namespaces).
debian/, deploy/      node-deb packaging, systemd unit, sudoers drop-in, install scripts.
```

## Gap analysis — verified against the code

| Claim | Verdict |
|---|---|
| UDP/TCP telemetry, multiple destinations | ✅ Present (mavlink-routerd UDP outputs + TCP) |
| HD video RTSP | ✅ Present (video-server.py, H.264/H.265, timestamp overlay) |
| **UDP RTP video output** | ✅ **Already present** (`useUDP` → `--udp=IP:PORT`, RTP/H.264 udpsink; advertised in VIDEO_STREAM_INFORMATION as RTPUDP). Feature 3 = verify on hardware, harden (multi-dest? MP ingest docs), not green-field. |
| VPN (ZeroTier/WireGuard) GUI | ✅ Present |
| RC_CHANNELS parsing / RC camera switching | ❌ Absent — Feature 1 is new code |
| Editable per-camera GStreamer pipelines | ❌ Absent (pipelines hardcoded in video-server.py) — Feature 2 is new code |
| LTE modem management (AT, RSSI, reconnect, data usage) | ❌ Absent (pppConnection.js is FC-PPP, not cellular) — Feature 4 is new code |
| Cellular low-latency preset | ❌ Absent — Feature 5 is new code |
| Multi-camera switching | ❌ Absent — single `deviceStream` only |

## On-device verification backlog

Anything touching libcamera/IMX708, the hardware H.264 encoder, SIM7600G USB/RNDIS, or real serial
ports can only be smoke-tested on the Pi 4 / Zero 2 W. Each feature's report lists its on-device
steps; they accumulate in [ONDEVICE-CHECKLIST.md](ONDEVICE-CHECKLIST.md).
