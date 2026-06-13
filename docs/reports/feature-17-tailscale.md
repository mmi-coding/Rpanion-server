# Feature 17 report: Tailscale VPN

**Branch:** `feature/vpn-tailscale`, merged `--no-ff` into `dev` (`c787e2a`)
**Status:** complete, WSL-verified (CLI wrappers via fakeBin, UI via unit + e2e); real tailnet auth on-device
**Docs:** `docs/TAILSCALE.md` · `docs/ROADMAP.md` · `docs/ONDEVICE-CHECKLIST.md` (feature 17)

Third UAVcast-Pro-6 parity feature (`docs/ROADMAP.md §B1`).

## What was built

Tailscale as a third VPN option alongside ZeroTier and WireGuard, so a ground
station on the same tailnet reaches the companion computer through CGNAT without
port-forwarding.

- **Backend (`server/vpn.js`)** — three wrappers mirroring the ZeroTier/WireGuard
  callback style (`(stderr, {installed,status,text})`):
  - `getVPNStatusTailscale` — `which tailscale`, then `sudo tailscale status --json`,
    parsed into a self+peers list (host / Tailscale IP / online); `JSON.parse` in a
    try/catch so malformed output is a reachable branch.
  - `connectTailscale` — `tailscale up --authkey=<key>`, then refresh status.
  - `disconnectTailscale` — `tailscale down`, then refresh status.
  - Endpoints `/api/vpntailscale` (GET), `/api/vpntailscaleconnect` (POST, auth-key
    validated with the WireGuard-style no-metacharacters check), and
    `/api/vpntailscaledisconnect` (POST) in `server/index.js`.
- **Frontend** — a new `src/tailscale.jsx` (basePage) page: status (installed /
  connected), a peer table, an auth-key field, Connect/Disconnect, all
  self-documenting (HelpSection + HelpTips). Wired into `AppRouter` (route +
  sidebar link) and the e2e route tables.

## Design decision: a dedicated page

The brief originally targeted the existing VPN page, but adding a fetch there would
have forced edits to ~21 fetch-mock sites in the 700-line upstream `vpnconfig.test.jsx`
(high risk to its 100%). A dedicated `/tailscale` fork page is greenfield — clean
100% coverage, self-documenting from the start, and **zero churn to the upstream VPN
page**. The backend endpoints are page-agnostic. UX cost: a separate sidebar entry,
which is reasonable for Tailscale's distinct auth-key workflow.

## Notable fix

`tailscale` is actually installed on the WSL dev box, so the real `/api/vpntailscale`
runs `sudo tailscale status`, which emits stderr without a tty. The page originally
set `this.state.error` from that passive status load, popping a Bootstrap modal that
intercepted clicks (caught by the e2e self-documenting test). Fixed so the status GET
only adopts `statusTailscale`; only Connect/Disconnect actions raise the error modal.

## How it was tested (WSL)

- Backend `covback`: **100/100/100/100** (3977 stmts). `vpn.test.js` extends the
  fakeBin `which`/`sudo` scripts with tailscale scenarios (running/stopped/missing/
  empty-which/stderr/bad-json, connect & disconnect success+stderr);
  `index.routes.test.js` adds the three endpoints (GET 200, connect 422+200,
  disconnect 200).
- Frontend `covfront`: **100/100/100/100**. `tailscale.test.jsx` covers connected &
  not-installed renders, HelpTips/HelpSection, Connect (asserts auth-key body),
  Disconnect, and the mount/connect/disconnect catch paths.
- e2e: **56 passed** — `/tailscale` added to smoke, navigation and self-documenting
  sets. `npm run lint` clean.

## Needs on-device (see `docs/ONDEVICE-CHECKLIST.md` feature 17)

Connect with a real auth key; reach a GCS over the tailnet through CGNAT; confirm
`sudo tailscale` rights under the service user; verify read-only users can't
Connect/Disconnect (403).
