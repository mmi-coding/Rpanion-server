# LTE Modem (SimCom SIM7600 series)

Monitor and manage a SimCom SIM7600-series LTE modem from the **LTE Modem**
page: signal strength, network registration, operator, band, WAN IP, data
usage, and (re)starting the data call.

## Architecture

The modem is used in **USB RNDIS mode**: the data path is the modem's RNDIS
network interface (`usb0`), which behaves like a normal ethernet device — no
PPP, no ModemManager. Rpanion only talks to the modem's **AT command port**
(typically `/dev/ttyUSB2`) for status and control.

**Do not install ModemManager** — it probes and grabs the AT ports and will
fight this module (and mavlink-router) for them. The Rpanion install scripts
do not install it; if present, remove it (`sudo apt purge modemmanager`).

A SIM7600 in RNDIS mode (`AT+CUSBPIDSWITCH=9011,1,1` once, persists) usually
enumerates as:

| Port | Function |
|---|---|
| `/dev/ttyUSB0` | diag |
| `/dev/ttyUSB1` | NMEA (GPS) |
| `/dev/ttyUSB2` | **AT commands** ← use this one |
| `/dev/ttyUSB3` | AT/modem |
| `usb0` | RNDIS network interface (data) |

## USB or UART?

The modem's **AT control link** can be either:

- **USB** (typical for SIM7600 dongles/HATs with the USB cable connected):
  the AT ports enumerate as `/dev/ttyUSB0-3`.
- **UART** (HATs wired to the Pi's GPIO header, pins 8/10): the AT link is
  the board UART, `/dev/serial0` on Raspberry Pi OS. Free the UART first
  (`raspi-config` → Interface Options → Serial Port → console **off**, port
  **on**) and don't assign it to the flight controller at the same time.
  SIM7600 UART default is 115200 baud (autobaud also syncs at common rates).

The **data path is always USB RNDIS** (`usb0`). A UART-only connection
carries AT control and nothing else — there is no high-bandwidth data
without the USB cable, and PPP-over-UART is far too slow for video, so it
is intentionally not supported. The connection test says exactly this when
it finds a working AT link but no RNDIS interface.

## Modem discovery

The **Scan for modem** button probes every candidate serial port with an AT
handshake and identifies what answers (`AT+CGMM`/`AT+CGMI`):

- Candidates: all detected USB serial ports, the board UARTs
  (`/dev/serial0`, `/dev/ttyAMA*`), and the currently configured port.
- The **flight controller's serial link is never probed** — AT chatter must
  not land in the MAVLink stream. It shows as *Skipped* in the results.
- USB CDC ports ignore the baud setting, so they get one attempt; real
  UARTs are tried at 115200 / 921600 / 460800 / 9600.
- A SIM7600 answers AT on two of its USB ports — the scan recommends the
  SIMCOM-identified, lowest-numbered one.
- Candidate **data interfaces** are listed with their kernel driver; an
  RNDIS/CDC one (`rndis_host`, `cdc_ether`, …) is recommended. If none
  appears, the modem is not in RNDIS mode (`AT+CUSBPIDSWITCH=9011,1,1`,
  once, persists) or is connected by UART only.
- **Use** fills the settings form; press Save to apply.

The monitor is paused during a scan (its port must be probed too) and
resumes by itself on the next poll.

## Connection test

The **Run connection test** button checks the whole chain end-to-end and
reports pass/fail per step with a one-line diagnosis:

1. **AT port** — opens the configured port, modem answers `AT` → `OK`
2. **Modem model** — `AT+CGMM`
3. **SIM card** — `AT+CPIN?` (`READY`, or e.g. *SIM not inserted* / *SIM PIN*)
4. **Signal** — `AT+CSQ` (fails on 99 = no reading; check the antenna)
5. **Network registration** — `AT+CREG?` + operator
6. **Data call** — `AT+CGPADDR=1` has a PDP address
7. **Network interface** — the configured interface exists and has an IPv4
   address (with RNDIS-mode / UART-only hints when it doesn't)
8. **Internet** — `ping -I <interface> <target>` *through the modem's
   interface*, not the default route (target configurable, default 8.8.8.8)

Steps whose prerequisites failed are *Skipped*, not failed. The test works
with monitoring disabled too — it opens the port for the test and closes it
again.

## Page features

- **Status** (updates at 1 Hz over the existing socket connection; the modem
  itself is polled at the configured interval, default 5 s): modem
  responding, registration state (home/roaming/searching/denied), operator,
  RAT + band (`AT+CPSI?`), RSSI in dBm with a quality label (plus RSRP/SINR
  on LTE), WAN IP (`AT+CGPADDR`).
- **Data usage**: session and persistent totals, counted on the RNDIS
  interface (`/sys/class/net/usb0/statistics`). Survives reboots and
  interface counter resets. Reset button included.
- **Auto-reconnect**: when enabled, if the modem is registered on the
  network but holds no IP address, the data call is restarted
  (`AT+CGDCONT` with your APN if set, then `AT$QCRMCALL=1,1`), with a 30 s
  backoff between attempts. Reconnect count and last-attempt time are shown.
- **Reconnect data call** button for a manual kick.
- **AT console**: send raw AT commands (must start with `AT`, ≤ 128 chars)
  and see the response — handy for `AT+CPIN?`, `AT+CUSBPIDSWITCH?`, etc.

## API

- `GET /api/ltemodem` — `{settings, status, serialPorts}`
- `POST /api/ltemodemmodify` — update settings (validated; errors returned
  with unchanged settings)
- `POST /api/ltemodemdetect` — scan for the modem →
  `{ports: [{path, baud, ok, model, manufacturer, recommended}], interfaces:
  [{name, driver, modemLike, operstate, ipv4, recommended}]}` (long-running,
  up to ~20 s)
- `POST /api/ltemodemtest` — `{pingHost?}` → `{steps: [{name, pass, detail}]}`
  (`pass` is `null` for skipped steps)
- `POST /api/ltemodemreconnect` — restart the data call
- `POST /api/ltemodemresetusage` — zero the usage counters
- `POST /api/ltemodemcommand` — `{command}` → `{response: [lines]}`
- socket.io `LTEStatus` (1 Hz)

## Implementation notes

- `server/ltemodem.js` — serial AT session (queued commands, echo disabled
  via `ATE0`, OK/ERROR terminated, timeout-protected), pure static parsers
  (`parseCSQ/CREG/COPS/CPSI/CGPADDR`), usage accounting, reconnect logic.
  The AT port is opened lazily and reopened on the next poll after errors,
  so an unplugged/replugged modem recovers without a restart.
- The poll loop never runs concurrently with itself, and user AT commands
  are queued behind status commands on the same serial session.

## Bench test (no modem needed)

`python/fake-sim7600.py` emulates the AT port on a pty:

```bash
python3 ./python/fake-sim7600.py
# prints e.g. /dev/pts/3 - then on the LTE Modem page set the AT port to
# that path, interface to "lo", enable, and the status fills with the
# emulated values (TestTel, LTE band 3, -71 dBm, 10.64.12.34)
```

With the AT port set to the pty, **Scan for modem** finds and recommends it
(identified as `SIMCOM_SIM7600G-H`), and the **connection test** passes all
eight steps when the interface is set to a real one with an IP (the
emulator answers the AT legs; interface + ping run against the real
network stack).
