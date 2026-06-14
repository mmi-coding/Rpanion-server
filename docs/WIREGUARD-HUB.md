# WireGuard Hub

A webUI helper (**WireGuard Hub** page, `/wireguardhub`) that generates a
turnkey setup script for a self-hosted WireGuard "hub" — the public rendezvous
server the drone and the ground station both connect out to.

## Why a hub is needed

Plain WireGuard is a point-to-point tunnel to a fixed `Endpoint`; it does no peer
discovery or NAT traversal. On the LTE link the drone sits behind **carrier-grade
NAT (CGNAT)** — it has no public inbound IP, so nothing can connect *to* it. The
fix is a small public **hub** (any cheap VPS): the drone and the laptop each dial
*out* to it, and it relays between them. (ZeroTier and Tailscale solve the same
problem with their own hosted coordination/relay infrastructure — see
[TAILSCALE.md](TAILSCALE.md). This page is for users who want a self-hosted,
vendor-free WireGuard path.)

The companion computer never touches the VPS. The page only produces the *script
text*; the user runs it on the VPS themselves. **All keys are generated on the
VPS** — no private key is ever created on or sent from the drone.

## Usage

1. **Create a DNS A record** for your domain/subdomain pointing at the VPS public
   IP (e.g. `wg.example.com → 203.0.113.10`). The configs use the domain as the
   `Endpoint`, so a future VPS IP change only needs a DNS update, not new configs.
2. On the **WireGuard Hub** page, fill in:
   - **VPS public IP** — the A-record target.
   - **Domain / subdomain** — used as the `Endpoint` host.
   - **WireGuard UDP port** (default `51820`), **VPN subnet** (default
     `10.13.13.0/24`: hub `.1`, drone `.2`, laptop `.3`), **SSH port** (default
     `22`, kept open by the firewall so you can't be locked out).
3. Click **Generate**, then **Copy** or **Download .sh**.
4. Run it once on a fresh VPS as root: `sudo bash setup-wireguard-hub.sh`. It is
   idempotent (safe to re-run; existing keys are reused).
5. The script prints two configs:
   - **`pi.conf`** — upload it on the [VPN page](../src/vpnconfig.jsx) as a
     WireGuard profile and **Activate** it on the drone.
   - **`laptop.conf`** — import it into the laptop's WireGuard client and
     activate it. Mission Planner then connects to the drone at its VPN IP
     (e.g. `10.13.13.2`).

### Getting the configs off the VPS (no USB needed)

A VPS is remote — the configs come back over your SSH session, three ways:

- **Copy-paste:** the script prints both configs between `--- pi.conf ---` /
  `--- laptop.conf ---` markers. Paste `laptop.conf` straight into the WireGuard
  app (Add empty tunnel), and save `pi.conf` to a file to upload on the VPN page.
- **`scp` (ready-to-run):** the script prints the exact `scp` commands to run on
  your **laptop**, e.g. `scp root@<vps-ip>:/etc/wireguard/clients/pi.conf .`. If
  you ran the script via `sudo` as a non-root login user, it also drops
  user-owned copies in that user's home and prints `scp <user>@...` lines so scp
  works without root SSH login.
- **SFTP GUI:** WinSCP / FileZilla → `/etc/wireguard/clients/`.

## What the script does on the VPS

- Installs `wireguard`/`wireguard-tools` + `ufw`.
- Enables IPv4 forwarding and adds a `MASQUERADE` NAT rule on the auto-detected
  public interface (so the two peers can reach each other through the hub).
- Generates three keypairs (`hub`, `pi`, `laptop`) in `/etc/wireguard`.
- Writes/starts `wg0.conf` and enables it on boot (`wg-quick@wg0`).
- Configures `ufw` to allow **only** the existing SSH port and the WireGuard UDP
  port.
- Writes + prints `pi.conf` and `laptop.conf` (split-tunnel: `AllowedIPs` is the
  VPN subnet only, with `PersistentKeepalive = 25` to hold the CGNAT mapping).
- Prints ready-to-run `scp` commands to fetch the configs to your laptop, and
  (when run via `sudo`) drops login-user-owned copies so scp needs no root login.

## API

| Endpoint | Method | Notes |
|---|---|---|
| `/api/wireguardhubscript` | POST | `{ vpsIp, domain, port, subnet, sshPort }` — strictly validated (IP / FQDN / port / CIDR; values are interpolated into a bash script) → `{ script }` |

`server/wireguardHub.js` (`generateScript`) is pure templating; the route
(`server/routes/wireguardHub.js`) does the validation. No state is stored on the
companion computer.

## Notes / scope

- The domain is used **only** as the WireGuard `Endpoint` (no web server / TLS on
  the VPS). You must create the DNS A record yourself; the script can't (it has no
  registrar credentials).
- Your VPS provider's firewall/security group must also allow inbound UDP on the
  chosen port.
- Generates one drone + one laptop config. Add more peers by hand on the VPS if
  needed (copy a `[Peer]` block + a client config).
