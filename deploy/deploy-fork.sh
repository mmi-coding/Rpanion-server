#!/bin/bash
# One-shot deploy of the Rpanion-server fork onto a Raspberry Pi (RasPiOS
# Bookworm or Trixie, arm64). Run from a copy of the repo on the Pi:
#
#   ./deploy/deploy-fork.sh
#
# Idempotent enough to re-run. Does NOT reboot; enabling the serial UART for the
# flight controller takes effect on the next reboot (a note is printed at the end).
set -x
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 1
step () { echo "###### $* ######"; }

step "swap bump to 1024MB (npm build headroom on 2GB Pis)"
if [ -f /etc/dphys-swapfile ]; then
  sudo dphys-swapfile swapoff || true
  sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
  sudo dphys-swapfile setup && sudo dphys-swapfile swapon
fi

step "apt dependencies"
sudo apt-get update
sudo apt-get install -y gstreamer1.0-plugins-good libgstrtspserver-1.0-0 gir1.2-gst-rtsp-server-1.0 gstreamer1.0-plugins-base-apps gstreamer1.0-plugins-ugly gstreamer1.0-plugins-bad
sudo apt-get install -y network-manager python3 python3-gst-1.0 python3-pip dnsmasq git jq wireless-tools iw python3-dev gstreamer1.0-x ppp python3-venv
sudo apt-get install -y python3-opencv python3-lxml python3-numpy gpsbabel zip fakeroot
# camera (RasPiOS, Bookworm/Trixie)
sudo apt-get install -y gstreamer1.0-libcamera python3-picamera2 python3-libcamera python3-kms++
# LTE modem data paths: QMI (libqmi) + udhcpc (dhclient is gone in Debian 13)
sudo apt-get install -y libqmi-utils udhcpc
# VPN
sudo apt-get install -y wireguard wireguard-tools

step "purge ModemManager (it grabs the flight-controller serial port)"
sudo apt-get purge -y modemmanager || true

step "Node.js 24"
NODEMAJ=0; command -v node >/dev/null && NODEMAJ=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODEMAJ" -lt 22 ]; then
  sudo apt-get remove -y nodejs nodejs-doc || true
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

step "ZeroTier"
curl -s https://install.zerotier.com | sudo bash || true

step "enable serial UART, disable serial console"
sudo raspi-config nonint do_serial 2 || true

step "NetworkManager: disable dnsmasq, enable NM, allow nmcli without polkit"
sudo systemctl disable dnsmasq || true
sudo systemctl enable NetworkManager || true
grep -q 'auth-polkit=false' /etc/NetworkManager/NetworkManager.conf || sudo sed -i '/^\[main\]/aauth-polkit=false' /etc/NetworkManager/NetworkManager.conf

step "Python venv"
( cd "$REPO/python" && ./setup-venv.sh )

step "mavlink-routerd binary"
( cd "$REPO/deploy" && ./devExtras.sh )
sudo cp "$REPO/mavlink-routerd" /usr/local/bin/mavlink-routerd && sudo chmod +x /usr/local/bin/mavlink-routerd

step "npm install + build"
npm install --no-audit --no-fund
npm run build

step "build + install the .deb (postinst: rpanion user, venv, sudoers, udev raw-IP, service)"
npm run package
sudo apt-get install -y "$REPO"/rpanion-server_*.deb

step "DONE"
systemctl is-active rpanion-server && echo "rpanion-server is running on :3001"
echo "NOTE: reboot to apply the serial-UART change for the flight controller."
