# Feature 20 report: Multi-mode modem data path (RNDIS / QMI / PPP)

**Branch:** `feature/lte-data-path`, merged `--no-ff` into `dev` (`7aa95db`)
**Status:** complete, WSL-verified (wrappers/dispatch/validation via fakeBin + UI); real QMI/PPP data calls on-device
**Docs:** `docs/MODEM-DATA-PATH.md` · `CLAUDE.md` (hard constraint updated) · `docs/ROADMAP.md` · `docs/ONDEVICE-CHECKLIST.md` (feature 20)

## What was built

The modem can now carry IP data over **RNDIS** (default), **QMI** (libqmi) or
**PPP** (pppd), selectable on the LTE Modem page with per-mode Connect/Disconnect.
This **overrides the former RNDIS-only hard constraint** — done at the user's
explicit request, after confirming the approach.

- **Backend (`server/ltemodem.js`)**:
  - New settings `dataPathMode` (`rndis`/`qmi`/`ppp`), `qmiDevice`, `pppPort`,
    `pppBaud` (all persisted + validated; default `rndis` keeps existing behaviour).
  - One `_exec` seam wraps every shell-out (single stub point).
  - `connectData()` / `disconnectData()` dispatch on the mode.
  - **QMI**: `_qmiConnect` runs `qmicli --wds-start-network`, parses the
    packet-data handle/CID for a clean `_qmiStop` (`--wds-stop-network`), then
    `udhcpc`. **PPP**: `_pppConnect` runs `pppd` dialling `*99#` via a chat script,
    `_pppStop` runs `poff`.
  - Auto-reconnect in `doPoll` is now mode-aware; AT status polling
    (signal/registration/IP via `AT+CGPADDR`) stays mode-agnostic.
  - Endpoints `/api/ltemodemconnect` + `/api/ltemodemdisconnect`; `ltemodemmodify`
    validates the four new fields.
- **Frontend (`src/ltemodem.jsx`)**: a Data-path selector, mode-conditional fields
  (QMI device; PPP port/baud), and Connect/Disconnect buttons. `config` is now
  merged over defaults on load/save (so a server omitting a field can't blank it).
  Self-documenting (HelpTips per control).

## Flight-controller safety (the reason ModemManager stays banned)

PPP dials on **PPP port** (or the AT port if blank), and `_pppConnect`
**refuses to dial the flight-controller's serial port** (checked against
`flightcontroller.activeDevice`). ModemManager remains banned and
`flightController.js` still hard-errors on it — libqmi/pppd are driven directly so
nothing auto-probes and seizes the FC UART. `CLAUDE.md`'s hard constraint was
updated to record this policy.

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (4215 stmts). `ltemodem.test.js` adds a
  data-path describe: FakeBin for `qmicli`/`udhcpc`/`ip`/`pppd`/`poff`, `_exec`
  resolve + stderr-reject + ENOENT branches, `connectData`/`disconnectData`
  3-way dispatch, QMI handle-parse (present/absent) and stop (tracked/untracked),
  PPP dial + AT-port fallback + FC-port refusal, and the new setSettings
  validators (valid + invalid). `index.routes.test.js` adds the connect/disconnect
  routes (200 + 422).
- Frontend `covfront`: **100/100/100/100**. `ltemodem.test.jsx` adds Connect/
  Disconnect (success / data.error / catch / missing-response) and QMI/PPP
  conditional-field rendering.
- e2e: **64 passed**; `npm run lint` clean.

## Design notes / deviations from the brief

- Status stays AT-based for all modes (no separate `_qmiStatus`) — simpler and the
  modem reports its PDP IP via `AT+CGPADDR` regardless of data path.
- PPP uses daemonising `pppd` + `poff` (no tracked child process), keeping
  `quitting()` unchanged and coverage clean.

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 20)

Install `libqmi-utils`/`ppp`; real QMI bearer + raw-IP + DHCP on `wwan0`; real
PPP dial bringing up `ppp0`; FC-port refusal with a live FC; `sudo` rights for the
tools; auto-reconnect per mode.
