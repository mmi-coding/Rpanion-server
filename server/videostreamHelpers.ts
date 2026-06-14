/*
 * videostreamHelpers.ts
 * Pure (stateless) helpers extracted from videostream.js so they can be unit
 * tested in isolation and keep the class focused on stateful camera control.
 * The videoStream class delegates to these.
 *
 * First file of the gradual TypeScript migration (Wave 1 pilot).
 */
import * as path from 'path'
import * as os from 'os'
// paths is still plain JS during the migration; require() so tsc doesn't pull it
// into the emittable program (avoids TS5055 with outDir '.'). Switch to `import`
// once server/paths is converted to .ts.
const logpaths = require('./paths')

interface SelectOption { value: string; label: string }

// Convert an absolute media path to one relative to the media root (for the UI).
export function toRelativePath (dest: string): string {
  if (!dest || dest === '.') return ''
  if (path.isAbsolute(dest)) {
    dest = path.relative(logpaths.mediaDir, dest)
    /* istanbul ignore next -- unreachable on Linux (relative() returns '' not '.') */
    if (dest === '.') return ''
  }
  return dest
}

// The compression (codec) select option for a given value (defaults to H.264).
export function getCompressionSelect (val: string): SelectOption {
  const options: SelectOption[] = [
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
export function getTransportSelect (val: string): SelectOption {
  const options: SelectOption[] = [
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
export function getTransportOptions (): SelectOption[] {
  return [
    { value: 'RTP', label: 'RTP' },
    { value: 'RTSP', label: 'RTSP' }
  ]
}

// All local IPv4 addresses (an interface may have more than one).
export function scanInterfaces (): string[] {
  const iface: string[] = []
  const ifaces = os.networkInterfaces()
  for (const ifacename in ifaces) {
    // for...in only yields keys present in `ifaces`, so the lookup is always
    // defined — assert it (no runtime branch) rather than guard a dead path.
    const list = ifaces[ifacename]!
    for (let j = 0; j < list.length; j++) {
      if (list[j].family === 'IPv4') {
        iface.push(list[j].address)
      }
    }
  }
  return iface
}

// Encode a JS string into the fixed-length char[] array node-mavlink expects.
export function toMavChars (str: string, length: number): Uint8Array {
  const buf = new Uint8Array(length)
  if (!str) return buf
  const encoded = new TextEncoder().encode(str)
  buf.set(encoded.slice(0, length))
  return buf
}
