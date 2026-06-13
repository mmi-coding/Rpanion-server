# Network priority, failover & bandwidth

The **Network Priority** page (`/networkpriority`) shows live per-interface
throughput and lets you choose which network the device prefers — e.g. WiFi,
falling back to the cellular modem automatically when WiFi drops.

## Bandwidth

A table of every interface (loopback excluded) with RX/TX totals and the live
rate, refreshed every couple of seconds. Rates are computed from the kernel byte
counters in `/sys/class/net/<iface>/statistics/{rx,tx}_bytes` between samples
(counter resets are handled).

## Priority / failover

NetworkManager chooses the active link by **autoconnect priority** (higher wins)
and, when several are up, the **route metric** (lower wins for the default route).
Give WiFi a higher priority and lower metric than the cellular connection and the
device prefers WiFi, falling back to the modem when WiFi drops.

For each connection, set a **Priority** and **Metric** and click **Set**. Changes
apply on that connection's next reconnect.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/networkpriority` | GET | Lists NetworkManager connections (name / uuid / type) via `nmcli` |
| `/api/networkbandwidth` | GET | Per-interface `{ rxBytes, txBytes, rxRate, txRate }` (rate = delta since last call) |
| `/api/networksetpriority` | POST | `{ conName(uuid), priority, metric }` → `nmcli connection modify … autoconnect-priority … ipv4.route-metric …` |

`server/networkPriority.js` is self-contained (its own `nmcli` shell-outs and an
injectable `/sys/class/net` base), so the wrapper, parsing and rate maths are
fully unit-tested without hardware. With RBAC enabled, setting priority is a
mutating POST, so read-only users cannot change it.

## Notes

- Actual failover (traffic moving to the SIM7600 `usb0` when WiFi drops), live
  counters under real traffic, and that `sudo nmcli` honours the metric/priority
  changes are verified on-device.
