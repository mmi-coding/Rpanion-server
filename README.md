# Rpanion Server **Plus**

**A 4G/LTE-first companion-computer stack for ArduPilot drones — an extended, independent fork of [stephendade/Rpanion-server](https://github.com/stephendade/Rpanion-server).**

> Built on the **excellent** [Rpanion-server](https://github.com/stephendade/Rpanion-server) by Stephen Dade and its contributors — all credit for the original platform (MAVLink telemetry routing, video streaming, network / NTRIP / logging, VPN, the web UI foundation) belongs to that project. This fork keeps `master` tracking upstream and layers a cellular-first feature set on top. It is an **unofficial** fork, **not affiliated with or endorsed by** the upstream project or rpanion.com. License: **GPL-3.0** (same as upstream).

It runs on a Raspberry Pi carried by the drone and serves a web interface to configure MAVLink telemetry, HD video, networking, cellular modems and VPNs — so you can fly and stream over 4G/LTE (including behind carrier-grade NAT) to Mission Planner from anywhere.

> **Note on screenshots/docs:** the upstream user documentation at <https://www.docs.rpanion.com/software/rpanion-server> covers the shared base. Fork-specific features are documented under [`docs/`](docs/). The UI has been redesigned (see [Ground Station theme](docs/GROUND-STATION-THEME.md)).

## What this fork adds

On top of upstream Rpanion-server (each with docs in [`docs/`](docs/)):

- **LTE modem management** — SimCom SIM7600 driven directly over AT commands (never via ModemManager): signal/registration/RSRP, operator & band, persistent data-usage accounting, optional auto-reconnect, and a raw AT console. Selectable data path: **RNDIS / QMI (libqmi) / PPP**. ([LTE-MODEM](docs/LTE-MODEM.md), [MODEM-DATA-PATH](docs/MODEM-DATA-PATH.md))
- **Cellular video tuning** — a low-latency preset (1 s keyframe, CBR-style VBV capping, leaky queues) plus runtime encoder bitrate retuning over a control channel. ([CELLULAR-TUNING](docs/CELLULAR-TUNING.md))
- **Multi-camera switching** — switch between two cameras from an RC channel (with hysteresis/debounce) or manually, without restarting the stream. ([CAMERA-SWITCHER](docs/CAMERA-SWITCHER.md))
- **Custom GStreamer pipelines** — per-camera pipeline overrides with a parse/dry-run validator and a runtime fallback so the stream never bricks. ([CUSTOM-PIPELINES](docs/CUSTOM-PIPELINES.md))
- **Self-hosted WireGuard Hub** — generates a turnkey VPS setup script for a vendor-free WireGuard rendezvous server, solving the CGNAT inbound problem without relying on ZeroTier/Tailscale relays. ([WIREGUARD-HUB](docs/WIREGUARD-HUB.md))
- **Tailscale VPN** and **Dynamic DNS** (DuckDNS / No-IP). ([TAILSCALE](docs/TAILSCALE.md), [DYNAMIC-DNS](docs/DYNAMIC-DNS.md))
- **Network priority / failover** with bandwidth monitoring. ([NETWORK-PRIORITY](docs/NETWORK-PRIORITY.md))
- **Telemetry injector** — inject external sensor data into the MAVLink stream as `NAMED_VALUE_FLOAT` / `STATUSTEXT` (HTTP / UDP / serial sources). ([TELEMETRY-INJECTORS](docs/TELEMETRY-INJECTORS.md))
- **Role-based access control** — `admin` / `read-only` users. ([USER-ROLES](docs/USER-ROLES.md))
- **"Ground Station" UI** — a redesigned, self-documenting web interface with a **light/dark toggle**, a **mobile-responsive** layout, and collapsible navigation. ([GROUND-STATION-THEME](docs/GROUND-STATION-THEME.md))
- **Engineering** — TypeScript backend, **100 % unit-test coverage** on both suites, plus a Playwright e2e suite.

The full design rationale and per-feature reports are in [docs/FORK-NOTES.md](docs/FORK-NOTES.md) and [`docs/reports/`](docs/reports/).

## Feature comparison

How this fork sits between upstream Rpanion-server and the commercial **UAVcast-Pro**.

**Legend:** ✓ supported · ◑ partial / different approach · ✗ not available · `?` not stated in public docs

| Capability | Rpanion-server (upstream) | **Rpanion Server Plus** (this fork) | UAVcast-Pro 6.x |
|---|:---:|:---:|:---:|
| License / source | Open-source (GPL-3.0) | Open-source (GPL-3.0) | Commercial, closed-source |
| Price | Free | Free | Paid licence |
| MAVLink routing to multiple GCS (UDP/TCP) | ✓ | ✓ | ✓ |
| HD video to GCS (RTSP + RTP/UDP, H.264/H.265) | ✓ | ✓ | ✓ |
| In-browser live video preview | ✗ | ✗ | ✓ (HLS) |
| Low-latency cellular preset + runtime bitrate retune | ✗ | ✓ | ◑ (configurable bitrate) |
| Custom per-camera GStreamer pipelines | ✗ | ✓ | ✓ |
| Multi-camera switching (RC channel) | ✗ | ✓ | `?` |
| Cellular modem mgmt (signal, data usage, auto-reconnect, AT console) | ✗ | ✓ (SIM7600, direct AT) | ✓ (Traditional + HiLink) |
| Selectable modem data path (RNDIS / QMI / PPP) | ✗ | ✓ | ◑ (Traditional / HiLink) |
| Network config + WiFi access point | ✓ | ✓ | ✓ |
| Network failover + bandwidth monitoring | ✗ | ✓ | ✓ |
| VPN — ZeroTier | ✓ | ✓ | ✓ |
| VPN — WireGuard | ✓ | ✓ | `?` |
| Self-hosted WireGuard hub generator (CGNAT, vendor-free) | ✗ | ✓ | ✗ |
| VPN — Tailscale | ✗ | ✓ | ✓ |
| Dynamic DNS | ✗ | ✓ | ✓ |
| NTRIP (RTK corrections) input | ✓ | ✓ | `?` |
| Telemetry injection (`NAMED_VALUE_FLOAT` / `STATUSTEXT`) | ✗ | ✓ | `?` |
| Flight log / media management | ✓ | ✓ | ✓ |
| Cloud upload | ✓ | ✓ | `?` |
| **Live map / fleet dashboard** (GPS tracking, flight path) | ✗ | ✗ | ✓ |
| Role-based access (admin / read-only) | ✗ (single login) | ✓ | `?` |
| Web UI | ✓ | ✓ (light/dark, mobile, self-documenting) | ✓ (React + live map) |
| Supported boards | Pi 3+, Jetson Orin, OrangePi, Le Potato | Pi 4 / Pi Zero 2 W (focus) | Pi Zero 2 W / 3 / 4 / 5 |
| Commercial support / managed updates | community | community (personal fork) | ✓ vendor-backed |

> The **UAVcast-Pro** column reflects its public **6.x** documentation (<https://docs.uavmatrix.com>) as of **June 2026**. UAVcast-Pro is a mature, polished, vendor-supported product — notably it ships a **live map / fleet dashboard** and an **in-browser video preview** that this fork does not, and offers broad plug-and-play modem support. This table is best-effort and not exhaustive; verify current capabilities on their site before relying on it.

**In short:** pick **upstream Rpanion-server** for the broadest board support (Jetson/OrangePi/Le Potato) and a rock-solid open base; **UAVcast-Pro** for a turnkey commercial product with a map/fleet dashboard and support; **this fork** if you want a free/open, cellular-first stack with deep SIM7600 control, a self-hosted (vendor-free) WireGuard hub, telemetry injection, RBAC, and a self-documenting UI.

## Supported boards

The fork is developed and tested primarily on the **Raspberry Pi 4** (primary) and **Pi Zero 2 W**. The upstream board matrix still applies to the shared base:

| Board | Compatible OS |
|-------|--------------|
| Raspberry Pi 3B or later | Raspberry Pi OS, Ubuntu 22.04 LTS |
| Nvidia Jetson Orin | Ubuntu 22.04 LTS |
| Orange Pi Zero 3 | Ubuntu 24.04 LTS |
| Libre Computer Le Potato | Raspberry Pi OS |

> [!NOTE]
> The cellular / camera features target a Pi 4 (or Zero 2 W) with a SimCom SIM7600-series modem and a libcamera-compatible camera (e.g. Camera Module 3 / IMX708). Other boards run the shared base but those specific features are unverified there.

## Installing (this fork)

There are no prebuilt release packages for this fork yet — it is installed **from source on the device**. On a fresh 64-bit Raspberry Pi OS (Bookworm/Trixie):

```bash
git clone https://github.com/mmi-coding/Rpanion-server.git
cd Rpanion-server
./deploy/deploy-fork.sh   # installs deps (apt/Node 24/Python venv/VPNs), builds, packages + installs the systemd service
```

`deploy-fork.sh` is idempotent. For later code updates, pull and rebuild on the device:

```bash
git pull && ./deploy/redeploy.sh
```

After installation the web UI is at `http://<device_ip>:3001`.

> [!IMPORTANT]
> **ModemManager must not be installed** — the flight-controller link auto-fails if it is, because ModemManager probes serial ports and can seize the FC UART. `deploy-fork.sh` purges it; the LTE feature drives the modem directly (libqmi / pppd / AT) instead.

<details>
<summary>Manual prerequisites (if not using <code>deploy-fork.sh</code>)</summary>

```bash
sudo apt install -y gstreamer1.0-plugins-good libgstrtspserver-1.0-0 gir1.2-gst-rtsp-server-1.0
sudo apt install -y gstreamer1.0-plugins-base-apps gstreamer1.0-plugins-ugly gstreamer1.0-plugins-bad
sudo apt install -y network-manager python3 python3-gst-1.0 python3-pip dnsmasq git jq wireless-tools iw
sudo apt install -y python3-lxml python3-numpy gpsbabel zip python3-dev gstreamer1.0-x ppp python3-venv
# RasPiOS camera:
sudo apt install -y gstreamer1.0-libcamera python3-picamera2 python3-libcamera python3-kms++
# LTE data paths (QMI) + VPNs:
sudo apt install -y libqmi-utils udhcpc wireguard wireguard-tools
# Node.js 24:
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y nodejs
```

Then `npm install && npm run build && npm run package && sudo dpkg -i rpanion-server_*.deb`.
</details>

## Building and running in development mode

The dev stack is a node.js backend on port 3001 and a Vite/React frontend on port 3000:

```bash
npm run dev
```

> Use `npm run dev` **only** during development — it skips login/authentication. The UI is then at `http://<ip>:3000`.

To produce a `.deb` package: `npm run build && npm run package`.

## Default username and password

Access control prevents unauthorised changes via the web UI (it does **not** apply to MAVLink or video streams). The default login is `admin` / `admin`, changeable on the **User Management** page (this fork adds **read-only** users alongside `admin` — see [USER-ROLES](docs/USER-ROLES.md)).

Credentials are stored in `config/user.json`. Set `DISABLE_AUTH=1` on the node process (e.g. in the `rpanion-server.service` unit) to disable access control on a trusted network.

## Tests

```bash
npm run testback     # backend (mocha)
npm run testfront    # frontend (vitest)
npm run lint         # eslint
npm run e2e          # Playwright end-to-end (see docs/E2E-TESTING.md)
```

This fork targets **100 % coverage on both suites** via a ratchet — see [docs/TESTING.md](docs/TESTING.md).

## Credits & licence

Original **Rpanion-server** © Stephen Dade and contributors — <https://github.com/stephendade/Rpanion-server>. This fork is distributed under the same **GPL-3.0** licence. UAVcast-Pro and UAVmatrix are trademarks of their respective owners and are referenced here for comparison only.
