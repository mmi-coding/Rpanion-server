# Feature 25 — WireGuard Hub (VPS setup-script generator)

A new **WireGuard Hub** page (`/wireguardhub`) that generates a turnkey bash
script for standing up a self-hosted WireGuard rendezvous server on a fresh VPS.
It closes the gap from the VPN comparison: plain WireGuard can't reach the
CGNAT'd drone directly (no public inbound IP), so both the drone and the ground
station must dial *out* to a public hub. This page produces that hub's setup
script — for users who want a vendor-free path (vs ZeroTier/Tailscale, which use
hosted coordination/relay infra, [feature-17](feature-17-tailscale.md)).

## Design decisions (confirmed with the user)

- **Domain = WireGuard `Endpoint` only** — no web server / TLS on the VPS. The
  configs use the domain so a VPS IP change is a DNS update, not new configs. The
  user creates the A record (the script has no registrar credentials).
- **Pi + one laptop** — two output configs.
- **Fully turnkey + SSH-safe firewall** — installs WireGuard, IP forwarding +
  NAT, `ufw` allowing only the existing SSH port + the WG UDP port, generates
  keys, enables on boot. Idempotent.

## What was built

- **`server/wireguardHub.ts`** — pure generator (`generateScript`). Derives hub
  `.1` / pi `.2` / laptop `.3` from the subnet base; bakes the validated config
  into a self-contained script. No keys here — the script generates all three
  keypairs **on the VPS** (no private key ever touches the companion computer).
- **`server/routes/wireguardHub.ts`** — `POST /api/wireguardhubscript`. Strict
  validation (`isIP` / `isFQDN` / `isInt` port / CIDR `matches`) because the
  inputs are interpolated into a bash script; invalid → 422 before generation.
- **`src/wireguardhub.jsx`** — self-documenting page (intro + collapsed
  `HelpSection`, a `HelpTip` on every field). Generates, then Copy / Download .sh.
- Wired into `server/index.ts` (require + mount, DI context) and
  `src/AppRouter.jsx` (nav link + route), mirroring the Tailscale page so the
  heavily-tested upstream VPN page stays untouched.
- **Docs:** `docs/WIREGUARD-HUB.md`; CHANGELOG entry.

## Script behaviour (run on the VPS, `sudo bash setup-wireguard-hub.sh`)

`set -euo pipefail` + root check → install `wireguard`/`wireguard-tools`/`ufw` →
`net.ipv4.ip_forward=1` → auto-detect WAN interface → generate `hub`/`pi`/`laptop`
keys (reused if present) → write/start `wg0.conf` (two `[Peer]`s, `MASQUERADE`
PostUp/Down) → `ufw allow $SSH_PORT/tcp` + `$WG_PORT/udp` → enable on boot →
print `pi.conf` + `laptop.conf` (split-tunnel `AllowedIPs` = VPN subnet,
`PersistentKeepalive = 25`, `Endpoint` = domain:port).

## WSL-verified

- `npm run typecheck` clean, `npm run lint` clean.
- `covback` **100/100/100/100** (947→948 tests; `wireguardHub.ts` 100%, route
  200 + 422 paths via the index harness).
- `covfront` **100/100/100/100** (`wireguardhub.jsx` 100% — render, the
  `!vpsIp || !domain` disabled branches, generate success + catch, copy,
  download).
- `npm run e2e` **68 passed**.
- Generator output asserted to contain the shebang, strict mode, baked port/SSH/
  domain, derived addresses (default + custom subnet), install/ufw/NAT/keepalive
  lines, and both client-config heredocs.

## Needs on-device / real-world (append to ONDEVICE-CHECKLIST)

- **End-to-end on a real VPS:** run the generated script on a fresh
  Debian/Ubuntu VPS; confirm `wg0` comes up, `ufw` keeps SSH reachable, and the
  printed `pi.conf`/`laptop.conf` are valid. (The generator output is unit-tested;
  actually executing apt/ufw/wg-quick on a VPS is not reproducible in WSL.)
- **Tunnel verification:** upload `pi.conf` on the drone's VPN page + activate;
  import `laptop.conf` on the ground station; confirm the laptop reaches the drone
  at its VPN IP (e.g. ping `10.13.13.2`) and Mission Planner connects through it
  over the LTE link.
- **DNS:** the A record (`domain → VPS IP`) is a manual prerequisite.

## Note (environment)

Local `covback` briefly showed `customPipelines.ts:90` uncovered — unrelated to
this feature: the `.venv` had been rebuilt from a pyenv Python 3.13 (no `gi`),
losing GStreamer access for the pipeline-validator path. Rebuilding the venv from
the system `/usr/bin/python3` (3.12, `python3-gi` present) restored
100/100/100/100. `setup-venv.sh` is unchanged (correct on the Pi, where `python3`
is the system interpreter with `gi`).
