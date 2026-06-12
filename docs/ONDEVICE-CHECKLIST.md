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
