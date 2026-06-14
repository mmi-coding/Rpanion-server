'use strict'

/*
 * Unit tests for the WireGuard hub setup-script generator (server/wireguardHub).
 * Pure string templating — assert the generated bash bakes in the validated
 * config and derives the peer addresses from the subnet base.
 */

const assert = require('assert')
const { describe, it } = require('mocha')

const wireguardHub = require('./wireguardHub')

describe('wireguardHub.generateScript()', function () {
  const cfg = { vpsIp: '203.0.113.10', domain: 'wg.example.com', port: 51820, subnet: '10.13.13.0/24', sshPort: 22 }

  it('returns a bash script with shebang + strict mode + root check', function () {
    const s = wireguardHub.generateScript(cfg)
    assert.ok(s.startsWith('#!/usr/bin/env bash'))
    assert.ok(s.includes('set -euo pipefail'))
    assert.ok(s.includes('if [ "$(id -u)" -ne 0 ]'))
  })

  it('bakes in the port, ssh port and domain (Endpoint uses the domain)', function () {
    const s = wireguardHub.generateScript(cfg)
    assert.ok(s.includes('WG_PORT=51820'))
    assert.ok(s.includes('SSH_PORT=22'))
    assert.ok(s.includes('ENDPOINT=wg.example.com'))
    assert.ok(s.includes('Endpoint = wg.example.com:51820'))
  })

  it('derives hub/pi/laptop addresses from the subnet base', function () {
    const s = wireguardHub.generateScript(cfg)
    assert.ok(s.includes('HUB_ADDR=10.13.13.1'))
    assert.ok(s.includes('PI_ADDR=10.13.13.2'))
    assert.ok(s.includes('LAPTOP_ADDR=10.13.13.3'))
    assert.ok(s.includes('VPN_CIDR=10.13.13.0/24'))
  })

  it('respects a custom subnet base', function () {
    const s = wireguardHub.generateScript({ ...cfg, subnet: '10.20.30.0/24' })
    assert.ok(s.includes('HUB_ADDR=10.20.30.1'))
    assert.ok(s.includes('PI_ADDR=10.20.30.2'))
    assert.ok(s.includes('LAPTOP_ADDR=10.20.30.3'))
    assert.ok(s.includes('VPN_CIDR=10.20.30.0/24'))
  })

  it('installs wireguard + firewall, sets NAT, and emits both client configs', function () {
    const s = wireguardHub.generateScript(cfg)
    assert.ok(s.includes('apt-get install -y wireguard'))
    assert.ok(s.includes('ufw allow "$SSH_PORT"/tcp'))
    assert.ok(s.includes('ufw allow "$WG_PORT"/udp'))
    assert.ok(s.includes('MASQUERADE'))
    assert.ok(s.includes('PersistentKeepalive = 25'))
    assert.ok(s.includes('clients/pi.conf'))
    assert.ok(s.includes('clients/laptop.conf'))
    // VPS IP appears in the DNS reminder
    assert.ok(s.includes('203.0.113.10'))
  })

  it('prints ready-to-run scp commands and drops sudo-user-owned copies', function () {
    const s = wireguardHub.generateScript(cfg)
    // sudo-user fallback so scp works without root SSH login (set -u safe default)
    assert.ok(s.includes('if [ -n "${SUDO_USER:-}" ]'))
    assert.ok(s.includes('install -m 600 -o "$SUDO_USER"'))
    // ready-to-run scp lines: VPS IP baked in, user/path resolved at run time
    assert.ok(s.includes('scp $SCP_USER@203.0.113.10:$PI_PATH .'))
    assert.ok(s.includes('scp $SCP_USER@203.0.113.10:$LAPTOP_PATH .'))
  })
})
