# Modem data path: RNDIS / QMI / PPP

The LTE Modem page (`/ltemodem`) can carry IP data over three paths, chosen with
the **Data path mode** selector. AT status polling (signal, registration,
operator, IP) is the same in every mode; only the data call differs.

> **ModemManager is still never used** in any mode. It auto-probes serial ports
> and can seize the flight-controller UART, so QMI uses **libqmi** and PPP uses
> **pppd** directly. `flightController.js` still hard-errors if ModemManager is
> installed.

| Mode | Interface | How the data call is made | Packages |
|---|---|---|---|
| **RNDIS** (default) | `usb0` | `AT$QCRMCALL=1,1` over the AT port | none (built-in) |
| **QMI** | `wwan0` | `qmicli --wds-start-network` + DHCP (`udhcpc`) | `libqmi-utils` |
| **PPP** | `ppp0` | `pppd` dials `*99#` via a chat script | `ppp` |

Set **Data network interface** to match the mode (`usb0` / `wwan0` / `ppp0`) so
usage accounting and the connection test watch the right interface.

## Connect / Disconnect

The Status section has **Connect** (uses the configured mode) and **Disconnect**:

- RNDIS: `AT$QCRMCALL=1,1` / `AT$QCRMCALL=0,1`
- QMI: `qmicli --wds-start-network` (handle/CID captured) / `--wds-stop-network`
- PPP: `pppd … connect "chat … ATD*99#"` / `poff`

Auto-reconnect (registered but no IP) uses the same mode-aware path.

### PPP and the flight-controller UART

PPP dials on **PPP port** (or the AT port if blank). The server **refuses to dial
the flight-controller's serial port** (checked against `flightcontroller.activeDevice`),
so a PPP data call can never disrupt the FC link.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/ltemodemmodify` | POST | now also takes `dataPathMode` (`rndis`/`qmi`/`ppp`), `qmiDevice`, `pppPort`, `pppBaud` |
| `/api/ltemodemconnect` | POST | bring the data call up using the configured mode |
| `/api/ltemodemdisconnect` | POST | bring the data call down |

`server/ltemodem.js` routes every QMI/PPP shell-out through one `_exec` seam, so
the wrappers are unit-tested via fake binaries with no hardware. The real
`qmicli`/`udhcpc`/`pppd` round-trips are verified on-device.

## On-device prerequisites

- **QMI:** `sudo apt install libqmi-utils`; expose `/dev/cdc-wdm0` (USB composition
  with a QMI interface); the SIM7600 typically needs raw-IP on `wwan0`.
- **PPP:** `sudo apt install ppp`.
- Both need `sudo` rights for the respective tools under the service user.
