# Tailscale VPN

A third VPN option alongside ZeroTier and WireGuard, on its own **Tailscale VPN**
page (`/tailscale`). Tailscale builds a private mesh VPN (a "tailnet"); once this
companion computer joins, a ground station on the same tailnet can reach it over
the modem link **through CGNAT, without port-forwarding**.

> It lives on a dedicated page rather than the existing VPN page to keep the
> heavily-tested upstream `vpnconfig` page untouched (merge friction). Tailscale
> runs over the existing RNDIS/USB modem data path — no ModemManager, no
> constraint conflict.

## Usage

1. Generate an **auth key** in the Tailscale admin console (reusable or ephemeral
   recommended so it survives re-flashes).
2. Paste it into **Auth key** and click **Connect** (`tailscale up --authkey=...`).
3. The status table lists this device and tailnet peers (host, Tailscale IP,
   online). **Disconnect** runs `tailscale down` (leaves the tailnet but keeps the
   node authorised).

Without an auth key, `tailscale up` requires an interactive login that must be
done on the device itself.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/vpntailscale` | GET | `which tailscale` → `sudo tailscale status --json`; returns `{ error, statusTailscale: { installed, status, text[] } }` |
| `/api/vpntailscaleconnect` | POST | `{ authkey }` (validated, no shell metacharacters) → `tailscale up` |
| `/api/vpntailscaledisconnect` | POST | → `tailscale down` |

`server/vpn.js` adds `getVPNStatusTailscale` / `connectTailscale` /
`disconnectTailscale`, mirroring the ZeroTier/WireGuard wrappers.

## Notes

- The status load never raises a blocking error dialog for a benign
  `tailscale`/`sudo` stderr — only Connect/Disconnect actions surface errors.
- With RBAC enabled, Connect/Disconnect are mutating POSTs, so read-only users
  cannot change the Tailscale state.
