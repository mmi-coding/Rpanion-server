# Feature 23 report: USB composition switch (QMI/RNDIS) in the UI

**Branch:** `feature/usb-mode-switch`, merged `--no-ff` into `dev` (`ce3f6f1`)
**Status:** complete, WSL-verified (unit + e2e); modem reboot/re-enumeration is on-device
**Docs:** `docs/MODEM-DATA-PATH.md` · `CHANGELOG.md`

Answers the "why QMI not RNDIS" question operationally: the data interface is a
**USB-composition setting**, and you can now flip it from the web UI.

## What was built

- **Backend (`server/ltemodem.js`)**: `setUsbMode(pid)` sends
  `AT+CUSBPIDSWITCH=<pid>,1,1` over the AT port (this reboots the modem and
  re-enumerates its USB interfaces).
- **Endpoint (`server/index.js`)**: `POST /api/ltemodemusbmode` validates
  `mode ∈ {qmi, rndis}` and maps it to a PID (`qmi`→`9001`, `rndis`→`9011`) — the
  raw PID isn't exposed to the client.
- **Frontend (`src/ltemodem.jsx`)**: a **USB composition** section (QMI/RNDIS
  selector + *Switch USB mode & reboot modem* button) with a HelpTip warning that
  it reboots the modem (~30 s) and that the **Data path mode** should be set to
  match afterwards.

## Tests (100% on both suites)

- Backend `covback` **100/100/100/100**: `setUsbMode` asserts the exact AT command
  (`AT+CUSBPIDSWITCH=9011,1,1`); route tests cover 200 (mode→PID mapping asserted),
  422 invalid mode, 422 on reject.
- Frontend `covfront` **100/100/100/100**: USB-mode select change + switch button
  → POST (asserts `mode`), plus `data.error` and fetch-catch paths.
- e2e **64 passed**, lint clean.

## Notes

- PIDs are firmware-specific; `9001`/`9011` match the SIM7600G here. The AT console
  remains available for other compositions (ECM `9016`, MBIM `9018`).
- Switching to RNDIS makes `usb0` appear and removes `cdc-wdm0`/`wwan0`; set Data
  path mode to `rndis` (interface `usb0`) afterwards. QMI remains recommended.
