#!/bin/bash
# Fast code-only redeploy of the fork on the Pi. Run from the repo checkout on
# the Pi (which tracks origin/dev):
#
#   cd ~/Rpanion-server && ./deploy/redeploy.sh
#
# Pulls the latest dev, reinstalls deps, rebuilds the frontend, repackages and
# force-installs the .deb (same version → dpkg -i, since apt would skip an equal
# version), then restarts + verifies the service. The .deb must be built ON the
# Pi: it bundles native arm64 node modules (serialport etc.), so it can't be
# cross-built from an x86 dev box.
#
# For a full *environment* refresh (apt packages, Node, Python venv, ZeroTier,
# serial UART, swap) use deploy-fork.sh instead — this script assumes that
# one-time setup is already done and only ships new application code.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
step () { echo "###### $* ######"; }

step "git pull (fast-forward origin/dev)"
git pull --ff-only

step "npm install (deps may have changed)"
npm install --no-audit --no-fund

step "vite build (frontend + self-hosted fonts → build/)"
npm run build

step "build the .deb"
npm run package

DEB="$(ls -t rpanion-server_*.deb | head -1)"
step "install $DEB (force same-version) + restart service"
sudo dpkg -i "./$DEB"
sudo systemctl restart rpanion-server
sleep 2
systemctl is-active rpanion-server && echo "rpanion-server is running on :3001"
