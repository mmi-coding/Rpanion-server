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
