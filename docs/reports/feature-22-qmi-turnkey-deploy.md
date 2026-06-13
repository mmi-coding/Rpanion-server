# Feature 22 report: Turnkey QMI + deploy friction fixes

**Branch:** `feature/qmi-turnkey`, merged `--no-ff` into `dev` (`c89c390`)
**Status:** complete, WSL-verified + redeployed to the Pi
**Docs:** `docs/MODEM-DATA-PATH.md` · `CHANGELOG.md`

Driven by the live on-device deploy: make the QMI path turnkey and bake every
snag hit during deployment into the repo so the next deploy is frictionless.

## QMI vs RNDIS (the question raised)

Not a hardware limitation. SIM7600-class modules present their data interface as
**QMI** (`qmi_wwan` → `cdc-wdm0`+`wwan0`) or **RNDIS/ECM** (`usb0`) depending on
the USB **PID**, switchable with `AT+CUSBPIDSWITCH`. The bench unit is on PID
`1e0e:9001` = QMI, hence no `usb0`. QMI is the more robust interface, so the fork
makes QMI turnkey rather than switching the modem to RNDIS. Documented in
`docs/MODEM-DATA-PATH.md`.

## Turnkey QMI

- `debian/postinst` ships:
  - **udev rule** `77-rpanion-qmi-rawip.rules` → `ATTR{qmi/raw_ip}="Y"` for
    `qmi_wwan` on add/change, so raw-IP framing is set automatically (no manual
    `echo Y > /sys/.../raw_ip`).
  - **NetworkManager drop-in** `rpanion-wwan-unmanaged.conf` → `wwan0` unmanaged,
    so NM doesn't fight the qmicli/udhcpc data call.
- `server/ltemodem.js`: `_qmiConnect` brings the interface up (`sudo ip link set
  <iface> up`) before `qmicli`/`udhcpc`; raw-IP is already set by udev.

## Deploy friction → baked into the repo

| Snag during deploy | Fix |
|---|---|
| node-deb left `${DEB_HOST_ARCH}` literal → invalid-arch `.deb` | `deploy/build-deb.sh` substitutes `dpkg --print-architecture`; `npm run package` calls it |
| `apt upgrade`/`resolvconf`/git-submodule/mid-script reboot in the old script | `deploy/deploy-fork.sh` — one-shot, targeted installs, no reboot, no `.git` assumption |
| `udhcpc` missing (dhclient removed in Debian 13); `libqmi-utils` not declared | added to `install_common_libraries.sh` + `.deb` deps + deploy-fork |
| libcamera install gated to bookworm only | `RasPi3-4-5-deploy.sh` now covers **trixie** too |

Next deploy on a fresh Pi is now: copy the repo → `./deploy/deploy-fork.sh`.

## Tests

Backend **100/100/100/100** (the new `ip link set up` line is covered by the
existing `_qmiConnect` test via the `sudo` passthrough fake), frontend
**100/100/100/100**, e2e **64 passed**, lint clean.

## On-device

Redeployed: rebuilt the `.deb` with the new `build-deb.sh`, reinstalled; verified
the udev rule + NM drop-in are present and `wwan0` is unmanaged / raw-IP set.
Cellular data still needs a SIM + APN (bench modem has no SIM).
