// MAVLink telemetry accumulator.
//
// Keeps the latest decoded value of every MAVLink message type seen on the
// flight-controller link(s), plus a smoothed update-rate estimate, so the webUI
// can show a live "all values" inspector + summary without a ground station.
// It is fed from the fcManager 'gotMessage' stream (see server/index.ts) and a
// sorted snapshot is pushed to the browser on the existing 1 Hz status loop.
const { minimal, common, ardupilotmega } = require('node-mavlink')

// message-id → message class (carries the canonical MSG_NAME, e.g. 'ATTITUDE')
const REGISTRY: { [id: number]: { MSG_NAME: string } } = {
  ...minimal.REGISTRY,
  ...common.REGISTRY,
  ...ardupilotmega.REGISTRY
}

// a message older than this (no update) is flagged stale in the snapshot
const STALE_MS = 5000

type FieldValue = number | string | boolean | null

interface MsgState {
  msgid: number
  sysid: number
  compid: number
  fields: { [k: string]: FieldValue }
  count: number
  lastMs: number
  intervalMs: number
}

interface MsgSnapshot {
  name: string
  msgid: number
  sysid: number
  compid: number
  rate: number
  count: number
  stale: boolean
  fields: { [k: string]: FieldValue }
}

class MavTelemetry {
  messages: { [name: string]: MsgState }

  constructor () {
    this.messages = {}
  }

  // record one decoded MAVLink packet (packet, data) from the FC link
  onMessage (packet: any, data: any): void {
    if (packet === null || packet === undefined || packet.header === undefined) {
      return
    }
    const msgid: number = packet.header.msgid
    const clazz = REGISTRY[msgid]
    const name: string = (clazz !== undefined) ? clazz.MSG_NAME : ('UNKNOWN_' + msgid)

    // flatten the decoded message into displayable scalar fields
    const fields: { [k: string]: FieldValue } = {}
    if (data !== null && data !== undefined && typeof data === 'object') {
      for (const key of Object.keys(data)) {
        const v: any = data[key]
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
          fields[key] = v
        } else if (v === null || v === undefined) {
          fields[key] = null
        } else if (Array.isArray(v)) {
          fields[key] = v.join(', ')
        } else {
          fields[key] = String(v)
        }
      }
    }

    const now: number = Date.now()
    const prev: MsgState | undefined = this.messages[name]
    let intervalMs = 0
    if (prev !== undefined) {
      const delta = now - prev.lastMs
      // exponential smoothing once a prior interval exists, else seed with delta
      intervalMs = (prev.intervalMs > 0) ? Math.round(prev.intervalMs * 0.7 + delta * 0.3) : delta
    }

    this.messages[name] = {
      msgid,
      sysid: packet.header.sysid,
      compid: packet.header.compid,
      fields,
      count: ((prev !== undefined) ? prev.count : 0) + 1,
      lastMs: now,
      intervalMs
    }
  }

  // name-sorted snapshot for the webUI, with rate (Hz) and a staleness flag
  getSnapshot (): MsgSnapshot[] {
    const now: number = Date.now()
    return Object.keys(this.messages).sort().map((name): MsgSnapshot => {
      const m = this.messages[name]
      const rate = (m.intervalMs > 0) ? Math.round((1000 / m.intervalMs) * 10) / 10 : 0
      return {
        name,
        msgid: m.msgid,
        sysid: m.sysid,
        compid: m.compid,
        rate,
        count: m.count,
        stale: (now - m.lastMs) > STALE_MS,
        fields: m.fields
      }
    })
  }

  // drop all accumulated messages (e.g. when links are torn down)
  clear (): void {
    this.messages = {}
  }
}

export = MavTelemetry
