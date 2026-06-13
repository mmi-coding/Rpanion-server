# Feature 21 report: QMI/PPP least-privilege sudo

**Branch:** `feature/qmi-sudo`, merged `--no-ff` into `dev` (`052e055`)
**Status:** complete, WSL-verified (unit) + on-device (deployed to the Pi)
**Docs:** `docs/MODEM-DATA-PATH.md` · `CHANGELOG.md`

Follow-up to feature 20 (multi-mode modem data path), prompted by the on-device
deploy: the bench SIM7600 enumerates in **QMI mode** (`/dev/cdc-wdm0` + `wwan0`,
no RNDIS `usb0`), so the QMI path is the one that matters — and it didn't work
under the unprivileged service user.

## Problem

The QMI/PPP helpers shelled out to `qmicli`, `udhcpc`, `ip link set`, `pppd`,
`poff` without `sudo`. But `/dev/cdc-wdm0` is root-only, and `pppd` is
setuid-root restricted to the `dip` group — neither usable by the `rpanion`
service user. So QMI/PPP connect would fail on device (RNDIS was fine: the
service user opens the AT serial port via the `dialout` group).

## Fix

- **`server/ltemodem.js`**: the five privileged commands now run via `sudo`
  (`sudo qmicli …`, `sudo udhcpc …`, `sudo ip link set …`, `sudo pppd …`,
  `sudo poff`), all through the existing single `_exec` seam.
- **`debian/postinst`**: extended the `/etc/sudoers.d/allow-vpn-control` drop-in
  to grant `rpanion` passwordless access to exactly `qmicli`, `udhcpc`,
  `ip link set`, `pppd`, `poff` — nothing broader.
- **`package.json`** (`node_deb.dependencies`): added `libqmi-utils` (qmicli) and
  `udhcpc` — `dhclient` is removed in Debian 13, so `udhcpc` (busybox) is the
  DHCP client for QMI raw-IP on `wwan0`.

RNDIS is unchanged (no sudo needed).

## Tests (100% on both suites)

`server/ltemodem.test.js` installs a `sudo` passthrough fake (`exec "$@"`) so the
existing `qmicli`/`udhcpc`/`ip`/`pppd` command fakes and their assertions keep
working unchanged; `poff` (no args, nothing logged) is asserted via the `sudo`
call log. Backend **100/100/100/100**, frontend **100/100/100/100**, e2e **64
passed**, lint clean.

## On-device

Rebuilt the `.deb` and reinstalled on the Pi; verified the `rpanion` user can
`sudo -n` the new commands. Still needs a SIM + carrier APN for an actual data
call (the bench modem had no SIM). QMI raw-IP (`/sys/class/net/wwan0/qmi/raw_ip`)
remains a one-time on-device step — see `docs/MODEM-DATA-PATH.md`.
