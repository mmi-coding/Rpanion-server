# Roadmap — UAVcast-Pro 6 parity

Gaps identified by comparing this fork (16 web UI routes + `CHANGELOG.md`) against
UAVcast-Pro 6's public docs (`docs.uavmatrix.com/docs/6.x`). Triaged against the
fork's hard constraints in [CLAUDE.md](../CLAUDE.md).

Legend: `[ ]` planned · `[~]` partial today · `[x]` done.

---

## A. Browser-based GCS layer — DEFERRED ("for later")

The in-browser ground-control-station visualisation features. These are larger
front-end builds; parked here by request. **All of them depend on one shared
prerequisite**, so build that first:

- [ ] **MAVLink → browser telemetry bridge.** Decode the common messages in
  `mavManager` (GLOBAL_POSITION_INT, ATTITUDE, SYS_STATUS, GPS_RAW_INT, VFR_HUD,
  RC_CHANNELS, HEARTBEAT, STATUSTEXT, MISSION_*) and push them to the web UI over
  socket.io. The map, inspector, analytics and dashboards all consume this one
  stream — do it once.

Then, each as its own page/feature:

- [ ] **Live video preview in the web UI.** Today we only emit RTSP/RTP to an
  external GCS; add an in-browser player (HLS or WebRTC) so the operator sees the
  feed without a separate GCS.
- [ ] **Flight Map.** Leaflet map with live vehicle position, heading, flight
  path trail, and mission waypoints.
- [ ] **Mission Planner.** Create/edit/upload/download missions from the web UI
  (MISSION_COUNT / MISSION_ITEM_INT upload+download protocol via `mavManager`).
- [ ] **MAVLink Inspector.** Live raw-message viewer — message id, rate (Hz) and
  decoded fields; filter/search.
- [ ] **Flight Analytics.** Graph telemetry over time (attitude, battery, GPS,
  RSSI, altitude) from the bridge; pause/zoom; export.
- [ ] **Data Streams.** User-built dashboards — charts/gauges/sparklines/tiles
  bound to MAVLink fields, with a persisted layout.
- [ ] **Radio page.** Display current RC channel values and configured mapping
  (we already request RC_CHANNELS for the camera switcher).

Each must follow the self-documenting UI rule ([UI-GUIDELINES.md](UI-GUIDELINES.md))
and land at 100% coverage on both suites.

---

## B. Companion-computer features (non-GCS)

### B1. Buildable now — WSL-testable, within constraints

- [x] **RBAC: Admin / Read-only roles.** Role in `config/user.json`, carried in
  the JWT, enforced at `authenticateToken` (read-only → 403 on non-allowlisted
  POST); UI gains a Role column, role toggle, Add-User role selector and a
  sidebar read-only badge. Done — see docs/USER-ROLES.md, feature-15 report.
- [x] **Settings backup & restore.** Download `config/settings.json` and restore
  it from a file, on the About page (`/api/settingsbackup` + `/api/settingsrestore`).
  Done — see docs/BACKUP-RESTORE.md, feature-16 report.
- [ ] **Tailscale VPN.** Add alongside ZeroTier/WireGuard on the VPN page (status
  / up / down / IP) via the `tailscale` CLI — wrapper unit-tested with
  `test/fakeBin.js`; real auth verified on-device.
- [ ] **Dynamic DNS.** Periodic updater for a DDNS provider (DuckDNS / No-IP /
  Cloudflare) with a config page; HTTP calls mocked in tests.
- [ ] **Network priority + failover + bandwidth monitoring.** Prefer WiFi, fall
  back to cellular via NetworkManager connection metrics (`nmcli`); show live
  per-interface throughput (`/proc/net/dev`). Wrapper + monitoring unit-tested;
  real failover verified on-device.
- [ ] **Telemetry injectors.** Accept external sensor data over HTTP/UDP/serial
  and inject it into the MAVLink stream; auto-start on boot.

### B2. Deferred — needs design first

- [ ] **Fleet management (multi-device).** Requires a central registry/relay
  component and a cross-device protocol — out of scope for a single companion
  app until that server-side design exists.

### B3. Won't do — conflicts with hard constraints / hardware

- **Traditional (PPP/QMI) modem types.** The fork is **RNDIS-only** and must
  never install ModemManager (CLAUDE.md). HiLink (= RNDIS) is already supported,
  which is the in-constraint half of UAVcast's "Traditional + HiLink".
- **5G.** The RNDIS data path is already modem-agnostic — a 5G RNDIS modem works
  on it unchanged. Only the SIM7600-specific AT monitoring is 4G-tuned; that's an
  on-bench tweak when such hardware exists, not a software gap.

---

## Already at parity (for reference)

Multi-GCS telemetry routing (UDP/TCP/serial), RTSP+RTP video, custom GStreamer
pipelines, multi-camera RC hot-switching, signal-adaptive cellular bitrate, LTE
modem monitoring + discovery + data accounting, NTRIP/RTK (TLS), ZeroTier +
WireGuard VPN, WiFi AP/client + ethernet config, tlog/bin-log recording, system
monitoring, user authentication.
