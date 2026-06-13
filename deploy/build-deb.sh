#!/bin/bash
# Build the Rpanion-server .deb with the correct Debian architecture.
#
# node-deb does not expand the `${DEB_HOST_ARCH}` placeholder in package.json,
# which produced an invalid-architecture package when `npm run package` was run
# standalone. This wrapper substitutes the real architecture (dpkg) into a
# temporary package.json, builds, then restores the original.
set -e
cd "$(dirname "$0")/.."

ARCH=$(dpkg --print-architecture 2>/dev/null || echo arm64)
echo "Building .deb for architecture: $ARCH"

cp package.json package.json.debbak
trap 'mv -f package.json.debbak package.json 2>/dev/null || true' EXIT
sed -i "s/\"architecture\": \"[^\"]*\"/\"architecture\": \"$ARCH\"/" package.json

rm -rf ./python/.venv
mkdir -p ./additional/etc/rpanion-server/config
cp ./config/user.json ./additional/etc/rpanion-server/config
mkdir -p ./additional/usr/share/rpanion-server/app/server
node-deb --verbose --extra-files additional -- server mavlink build python
rm -r ./additional

echo "Built: $(ls -1 rpanion-server_*_${ARCH}.deb 2>/dev/null | tail -1)"
