# Telemetry Injectors

The **Telemetry Injector** page (`/telemetryinjector`) lets external processes
push sensor data into the MAVLink stream, so custom readings show up in your GCS
alongside the autopilot telemetry — **without** opening a separate link to the
GCS.

Readings are encoded as standard MAVLink messages and sent to the local
mavlink-router endpoint (`127.0.0.1:14540`). The router rebroadcasts to the
flight-controller link and to **every** connected GCS output, so the values
appear wherever you already watch telemetry.

## Reading shapes

Each reading is one line of JSON, in one of two shapes:

| JSON | Becomes | Notes |
|---|---|---|
| `{"name":"co2","value":412}` | `NAMED_VALUE_FLOAT` | `name` truncated to 10 chars; `value` is a float |
| `{"text":"pump on","severity":6}` | `STATUSTEXT` | `text` truncated to 50 chars; `severity` 0–7 (defaults to 6/INFO) |

## Sources

Three sources feed readings in, each toggled independently. The **master switch**
must also be on; it auto-starts the enabled sources on boot.

- **HTTP** — POST one reading as JSON to `/api/telemetryinject`. Best for scripts
  already running on the companion computer.
  ```sh
  curl -XPOST localhost:3001/api/telemetryinject \
       -H 'Content-Type: application/json' \
       -d '{"name":"co2","value":412}'
  ```
- **UDP** — send newline-delimited JSON datagrams to the listen port (default
  `14600`). Best for a sensor or microcontroller on the local network.
  ```sh
  printf '{"name":"co2","value":412}\n' | nc -u -w0 <device-ip> 14600
  ```
- **Serial** — newline-delimited JSON on a serial device (e.g. `/dev/ttyUSB0`).
  **Never select the flight-controller port.** Leave the device path blank to
  disable serial even if the source is ticked.

## MAVLink identity

Injected messages are stamped with the configured **System ID** (usually the
vehicle's, so the readings group with it) and **Component ID** (pick a value
distinct from the autopilot — `158` by default — so injected readings are clearly
attributable).

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/telemetryinjector` | GET | `{ settings, status }` |
| `/api/telemetryinjectormodify` | POST | `{ enabled, httpEnabled, udpEnabled, udpPort, serialEnabled, serialPort, serialBaud, sysid, compid }`; validates + restarts the listeners |
| `/api/telemetryinject` | POST | One reading (`{name,value}` or `{text,severity}`); `409` if the injector or HTTP source is disabled, `422` on a malformed reading |

Live status (sources up, counters, last reading) is also pushed over socket.io as
`TelemetryInjectorStatus`.

`server/telemetryInjector.js` owns the encoding and the source listeners. The
UDP/serial transports and the dgram send are isolated behind small seams
(`_send`, `_makeSerial`), so the module is fully unit-tested without real
hardware (a pty-backed serial port is used for the real-open path).

With RBAC enabled, all three endpoints are mutating POSTs / authenticated GETs, so
read-only users cannot change the configuration or inject readings.

## Notes

- The endpoint is bidirectional/routed: mavlink-router already binds
  `127.0.0.1:14540` and rebroadcasts, so no extra GCS configuration is needed.
- Severity values map to MAVLink `MAV_SEVERITY` (0 EMERGENCY … 7 DEBUG; 6 = INFO).
- Serial baud must match the device; the selector offers the common rates
  9600–921600.
