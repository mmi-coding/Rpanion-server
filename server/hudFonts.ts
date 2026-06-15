/*
 * hudFonts.ts — custom OSD/HUD font management (#173).
 *
 * The graphic HUD is rendered on the device by rsvgoverlay → librsvg → Pango →
 * fontconfig, so a font only renders if fontconfig can resolve it. To keep the
 * editor WYSIWYG (the browser preview must match the burned-in output), every
 * non-generic font is a real .ttf living in one directory that is BOTH:
 *   - served to the browser as an @font-face source, and
 *   - made visible to a spawned video-server.py via XDG_DATA_HOME (fontconfig
 *     scans $XDG_DATA_HOME/fonts) — no sudo, no system dirs, no service-user
 *     home assumptions.
 *
 * Curated fonts ship in assets/hudfonts (bundled in the .deb) and are copied
 * into the writable fonts dir on startup; imported fonts are uploaded there.
 */
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const logpaths = require('./paths')

// generic CSS families — always resolvable by librsvg and every browser
const GENERIC_FONTS = ['monospace', 'sans-serif', 'serif']

// curated fonts bundled with the app. `file` is the ttf in assets/hudfonts;
// `family` is what fontconfig/CSS match on; `label` is shown in the editor.
const CURATED = [
  { family: 'Oxanium', file: 'Oxanium-Medium.ttf', label: 'Oxanium — DJI / FPV OSD style' },
  { family: 'Chakra Petch', file: 'ChakraPetch-Regular.ttf', label: 'Chakra Petch' },
  { family: 'IBM Plex Mono', file: 'IBMPlexMono-Regular.ttf', label: 'IBM Plex Mono' },
  { family: 'IBM Plex Sans', file: 'IBMPlexSans-Regular.ttf', label: 'IBM Plex Sans' }
]

// a font family safe to interpolate into SVG/CSS (also enforced in hudOverlay)
const FAMILY_RE = /^[A-Za-z0-9 \-]{1,64}$/
// served/stored font filename (no path traversal)
const FONT_FILE_RE = /^[\w\-]+\.(ttf|otf|ttc)$/i
// sfnt magic for the first 4 bytes of a real font: ttf, OpenType, Apple, collection
const FONT_MAGIC = [
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.from('OTTO'), Buffer.from('true'), Buffer.from('ttcf')
]
const MAX_FONT_BYTES = 5 * 1024 * 1024

class HudFonts {
  settings: any
  dataHome: string
  fontsDir: string
  bundledDir: string
  imported: any[]
  constructor (settings: any) {
    this.settings = settings
    this.dataHome = logpaths.fontDataHome
    this.fontsDir = logpaths.hudFontsDir
    this.bundledDir = logpaths.bundledFontsDir
    // [{ id, family, file }] — imported fonts (id === file)
    this.imported = this.settings.value('camera.hudFontsImported', [])
  }

  static isFont (buf: any): boolean {
    if (!buf || buf.length < 4) {
      return false
    }
    const head = buf.subarray(0, 4)
    return FONT_MAGIC.some((m: any) => head.equals(m))
  }

  // execFile seam (single stub point for tests). Runs fontconfig tools with
  // XDG_DATA_HOME pointed at our data home so they see the HUD fonts dir.
  _exec (cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { env: { ...process.env, XDG_DATA_HOME: this.dataHome } }, (err: Error | null, stdout: string, stderr: string) => {
        if (err) {
          return reject(new Error((stderr && stderr.toString().trim()) || err.message))
        }
        return resolve(stdout.toString())
      })
    })
  }

  _fcCache () {
    return this._exec('fc-cache', ['-f', this.fontsDir])
  }

  _family (file: string) {
    return this._exec('fc-query', ['--format=%{family[0]}', file])
  }

  // Ensure the fonts dir exists, the curated ttf are present and the fontconfig
  // cache is built so a spawned video-server.py can resolve every family.
  // Best-effort: on any failure the HUD simply falls back to the generic fonts.
  async install () {
    try {
      fs.mkdirSync(this.fontsDir, { recursive: true })
      for (const c of CURATED) {
        const dst = path.join(this.fontsDir, c.file)
        const src = path.join(this.bundledDir, c.file)
        if (!fs.existsSync(dst) && fs.existsSync(src)) {
          fs.copyFileSync(src, dst)
        }
      }
      await this._fcCache()
    } catch (e) {
      console.log('HUD fonts: install skipped: ' + e.message)
    }
  }

  // The editor's selectable list: generics + curated + imported. Each non-generic
  // font carries its served filename so the browser can @font-face it (WYSIWYG).
  list () {
    const curated = CURATED.map((c) => ({ family: c.family, label: c.label, file: c.file, kind: 'curated' }))
    const imported = this.imported.map((f) => ({ family: f.family, label: f.family, file: f.file, kind: 'imported', id: f.id }))
    return { generics: GENERIC_FONTS, fonts: [...curated, ...imported] }
  }

  // Absolute path of a servable font file (curated or imported), or null if the
  // name is unknown / unsafe / missing on disk.
  fileFor (name: string): string | null {
    if (typeof name !== 'string' || !FONT_FILE_RE.test(name)) {
      return null
    }
    const known = CURATED.some((c) => c.file === name) || this.imported.some((f) => f.file === name)
    if (!known) {
      return null
    }
    const p = path.join(this.fontsDir, name)
    return fs.existsSync(p) ? p : null
  }

  // Import an uploaded font: validate, store in the fonts dir, rebuild the cache,
  // read its family via fontconfig, and register it. Returns the new font or
  // throws with a user-facing message.
  async importFont (buffer: any, originalName: string) {
    if (!HudFonts.isFont(buffer)) {
      throw new Error('Not a TrueType/OpenType font (.ttf/.otf)')
    }
    if (buffer.length > MAX_FONT_BYTES) {
      throw new Error('Font file too large (max 5 MB)')
    }
    fs.mkdirSync(this.fontsDir, { recursive: true })
    const ext = /\.otf$/i.test(originalName) ? 'otf' : 'ttf'
    const base = originalName.replace(/\.[^.]*$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40) || 'font'
    let file = `${base}.${ext}`
    let n = 1
    while (fs.existsSync(path.join(this.fontsDir, file)) || this.imported.some((f) => f.file === file)) {
      file = `${base}_${n++}.${ext}`
    }
    const dst = path.join(this.fontsDir, file)
    fs.writeFileSync(dst, buffer)
    try {
      await this._fcCache()
      const family = (await this._family(dst)).trim()
      if (!FAMILY_RE.test(family)) {
        throw new Error('Unsupported font family name')
      }
      const entry = { id: file, family, file }
      this.imported.push(entry)
      this.settings.setValue('camera.hudFontsImported', this.imported)
      return entry
    } catch (e) {
      try { fs.unlinkSync(dst) } catch (unlinkErr) { /* already gone */ }
      throw e
    }
  }

  // Remove an imported font by id; returns the refreshed list.
  async removeFont (id: string) {
    const f = this.imported.find((x) => x.id === id)
    if (!f) {
      throw new Error('Unknown font')
    }
    try { fs.unlinkSync(path.join(this.fontsDir, f.file)) } catch (unlinkErr) { /* already gone */ }
    this.imported = this.imported.filter((x) => x.id !== id)
    this.settings.setValue('camera.hudFontsImported', this.imported)
    try { await this._fcCache() } catch (cacheErr) { /* cache rebuild best-effort */ }
    return this.list()
  }
}

export = HudFonts
