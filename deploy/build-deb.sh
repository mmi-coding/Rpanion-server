#!/bin/bash
# Build the Rpanion-server .deb with the correct Debian architecture.
#
# node-deb does not expand the `${DEB_HOST_ARCH}` placeholder in package.json,
# which produced an invalid-architecture package when `npm run package` was run
# standalone. This wrapper substitutes the real architecture (dpkg) into a
# temporary package.json, builds, then restores the original.
#
# It also (a) compiles the TypeScript backend to JS so node-deb packages runnable
# JS, and (b) packages a PRODUCTION-ONLY node_modules — the build/test toolchain
# (typescript, ts-node, vite, vitest, eslint, playwright, ...) is devDeps-only and
# must not ship to the device.
set -e
cd "$(dirname "$0")/.."

ARCH=$(dpkg --print-architecture 2>/dev/null || echo arm64)
echo "Building .deb for architecture: $ARCH"

# Compile the TypeScript backend to JS in place (server/*.ts -> server/*.js,
# mavlink/*.ts -> mavlink/*.js) so node-deb packages runnable JS and systemd's
# `node server/index.js` works unchanged. Needs the devDeps (typescript) present.
echo "Compiling TypeScript backend (tsc)..."
npm run build:server

cp package.json package.json.debbak
# Always restore package.json and the full (dev) node_modules, even on failure.
trap 'mv -f package.json.debbak package.json 2>/dev/null || true; if [ -d node_modules.dev ]; then rm -rf node_modules; mv node_modules.dev node_modules; fi' EXIT
sed -i "s/\"architecture\": \"[^\"]*\"/\"architecture\": \"$ARCH\"/" package.json

# Stage a production-only node_modules for packaging: copy the full tree, then
# prune devDeps from the copy. node-deb is itself a devDep, so it is run from the
# intact backup (node_modules.dev). prune only deletes dirs — no native rebuild.
echo "Staging production-only node_modules (pruning devDeps)..."
mv node_modules node_modules.dev
cp -a node_modules.dev node_modules
npm prune --omit=dev --no-audit --no-fund >/dev/null

rm -rf ./python/.venv
mkdir -p ./additional/etc/rpanion-server/config
cp ./config/user.json ./additional/etc/rpanion-server/config
mkdir -p ./additional/usr/share/rpanion-server/app/server
node_modules.dev/.bin/node-deb --verbose --extra-files additional -- server mavlink build python
rm -r ./additional

echo "Built: $(ls -1 rpanion-server_*_${ARCH}.deb 2>/dev/null | tail -1)"
