/*
 * videostreamHelpers.js
 * Pure (stateless) helpers extracted from videostream.js so they can be unit
 * tested in isolation and keep the class focused on stateful camera control.
 * The videoStream class delegates to these.
 */
const path = require('path')
const os = require('os')
const logpaths = require('./paths.js')

// Convert an absolute media path to one relative to the media root (for the UI).
function toRelativePath (dest) {
  if (!dest || dest === '.') return ''
  if (path.isAbsolute(dest)) {
    dest = path.relative(logpaths.mediaDir, dest)
    /* istanbul ignore next -- unreachable on Linux (relative() returns '' not '.') */
    if (dest === '.') return ''
  }
  return dest
}

// The compression (codec) select option for a given value (defaults to H.264).
function getCompressionSelect (val) {
  const options = [
    { value: 'H264', label: 'H.264' },
    { value: 'H265', label: 'H.265' }
  ]
  const sel = options.filter(it => it.value === val)
  if (sel.length === 1) {
    return sel[0]
  } else {
    return options[0]
  }
}

// The transport select option for a given value (defaults to RTSP).
function getTransportSelect (val) {
  const options = [
    { value: 'RTP', label: 'RTP' },
    { value: 'RTSP', label: 'RTSP' }
  ]
  const sel = options.filter(it => it.value === val)
  if (sel.length === 1) {
    return sel[0]
  } else {
    return options[1]
  }
}

// All transport options.
function getTransportOptions () {
  return [
    { value: 'RTP', label: 'RTP' },
    { value: 'RTSP', label: 'RTSP' }
  ]
}

// All local IPv4 addresses (an interface may have more than one).
function scanInterfaces () {
  const iface = []
  const ifaces = os.networkInterfaces()
  for (const ifacename in ifaces) {
    for (let j = 0; j < ifaces[ifacename].length; j++) {
      if (ifaces[ifacename][j].family === 'IPv4') {
        iface.push(ifaces[ifacename][j].address)
      }
    }
  }
  return iface
}

// Encode a JS string into the fixed-length char[] array node-mavlink expects.
function toMavChars (str, length) {
  const buf = new Uint8Array(length)
  if (!str) return buf
  const encoded = new TextEncoder().encode(str)
  buf.set(encoded.slice(0, length))
  return buf
}

module.exports = {
  toRelativePath,
  getCompressionSelect,
  getTransportSelect,
  getTransportOptions,
  scanInterfaces,
  toMavChars
}
