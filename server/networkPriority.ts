/*
 * networkPriority.js
 * Two related network features:
 *  - Bandwidth monitoring: per-interface RX/TX byte counters and the rate
 *    between successive samples, read from /sys/class/net (injectable base so
 *    it is fully unit-testable against a fixture directory).
 *  - Priority / failover: set a NetworkManager connection's autoconnect
 *    priority and IPv4 route metric via nmcli, so the device prefers (e.g.)
 *    WiFi and falls back to the cellular link.
 *
 * Self-contained (its own nmcli shell-outs) so it can be tested greenfield
 * without touching the large networkManager test suite.
 */

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

class NetworkPriority {
  netStatsBase: string
  lastSample: any

  constructor () {
    this.netStatsBase = '/sys/class/net'
    this.lastSample = null
  }

  // Read rx/tx byte counters for every interface (skipping loopback).
  readNetStats () {
    const result = {}
    let ifaces
    try {
      ifaces = fs.readdirSync(this.netStatsBase)
    } catch (e) {
      return result
    }
    for (const iface of ifaces) {
      if (iface === 'lo') {
        continue
      }
      try {
        const rx = parseInt(fs.readFileSync(path.join(this.netStatsBase, iface, 'statistics', 'rx_bytes'), 'utf8'), 10)
        const tx = parseInt(fs.readFileSync(path.join(this.netStatsBase, iface, 'statistics', 'tx_bytes'), 'utf8'), 10)
        if (!isNaN(rx) && !isNaN(tx)) {
          result[iface] = { rx, tx }
        }
      } catch (e) {
        // interface without byte counters — skip it
      }
    }
    return result
  }

  // Take a sample and return per-interface totals + rate since the last sample.
  sample (now = Date.now()) {
    const cur = { t: now, perIface: this.readNetStats() }
    if (!this.lastSample) {
      this.lastSample = cur
      return []
    }
    const dt = (cur.t - this.lastSample.t) / 1000
    const out = []
    for (const name of Object.keys(cur.perIface)) {
      const prev = this.lastSample.perIface[name]
      const b = cur.perIface[name]
      let dRx = prev ? b.rx - prev.rx : 0
      let dTx = prev ? b.tx - prev.tx : 0
      if (dRx < 0) { dRx = b.rx } // counter reset → count from zero
      if (dTx < 0) { dTx = b.tx }
      out.push({
        name,
        rxBytes: b.rx,
        txBytes: b.tx,
        rxRate: dt > 0 ? Math.round(dRx / dt) : 0,
        txRate: dt > 0 ? Math.round(dTx / dt) : 0
      })
    }
    this.lastSample = cur
    return out
  }

  getBandwidth (now) {
    return this.sample(now)
  }

  // List NetworkManager connections (name / uuid / type).
  listConnections (callback) {
    execFile('sudo', ['nmcli', '-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show'], (error, stdout, stderr) => {
      if (stderr && stderr.toString().trim() !== '') {
        console.error(`exec error: ${error}`)
        return callback(stderr.toString().trim(), [])
      }
      const list = stdout.toString().trim().split('\n').filter(line => line !== '').map(line => {
        const parts = line.split(':')
        return { name: parts[0], uuid: parts[1], type: parts[2] }
      })
      return callback(null, list)
    })
  }

  // Set a connection's autoconnect priority (higher wins) and IPv4 route
  // metric (lower wins for the default route).
  setPriority (conName, priority, metric, callback) {
    execFile('sudo', ['nmcli', 'connection', 'modify', conName,
      'connection.autoconnect-priority', String(priority),
      'ipv4.route-metric', String(metric)], (error, stdout, stderr) => {
      if (stderr && stderr.toString().trim() !== '') {
        console.error(`exec error: ${error}`)
        return callback(stderr.toString().trim())
      }
      return callback(null)
    })
  }
}

export = NetworkPriority
