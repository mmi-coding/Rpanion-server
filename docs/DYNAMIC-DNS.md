# Dynamic DNS

The **Dynamic DNS** page (`/ddns`) keeps a hostname pointed at this device's
current public IP, so you can reach it by name as the IP changes. Supports
**DuckDNS** and **No-IP**.

## Usage

1. Tick **Enable dynamic DNS updates**.
2. Choose a **Provider**:
   - **DuckDNS** — enter the subdomain (**Hostname**) and your **Token**.
   - **No-IP** — enter the **Hostname**, **Username** and **Password**.
3. Set the **Update interval** (1–1440 min) and **Save** (starts the timer).
   **Update now** pushes the IP immediately.

The **Status** section shows the last result, the last IP pushed, and when.

> On a mobile/4G link the public IP is usually a carrier-NAT (CGNAT) address, so
> DDNS is most useful **alongside a VPN** (ZeroTier / WireGuard / Tailscale). It
> still helps when the device has a routable IP.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/ddns` | GET | `{ settings, status }` — the password is never returned, only `hasPassword` |
| `/api/ddnsmodify` | POST | `{ enabled, provider, hostname, token, username, password, intervalMin }`; empty `password` keeps the saved one; (re)starts the timer |
| `/api/ddnsupdate` | POST | Trigger an immediate update; returns `{ status }` |

`server/dynamicDns.js` detects the public IP (api.ipify.org) and pushes it to the
provider on a timer. The HTTP client is injectable, so the module is fully
unit-tested without touching the network.

With RBAC enabled, save/update are mutating POSTs, so read-only users cannot
change DDNS settings.

## Notes

- New providers are easy to add in `buildRequest()` (URL template + a success
  predicate).
- Actual public-IP detection and live provider round-trips are verified on-device
  (tests stub the HTTP client).
