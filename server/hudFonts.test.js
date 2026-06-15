const assert = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const settings = require('settings-store')
const HudFonts = require('./hudFonts')
const { FakeBin } = require('../test/fakeBin')

// a minimal but signature-valid sfnt (TrueType 0x00010000) buffer
const TTF = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('rpanion-test-font-body')])

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rpanion-hudfonts-'))
}

// a manager with its dirs redirected to temp space and the curated set bundled
function makeManager () {
  settings.clear()
  const hf = new HudFonts(settings)
  hf.dataHome = tmp()
  hf.fontsDir = path.join(hf.dataHome, 'fonts')
  hf.bundledDir = tmp()
  return hf
}

describe('HUD Fonts (#173)', function () {
  it('#isFont() recognises sfnt magic, rejects everything else', function () {
    assert.equal(HudFonts.isFont(Buffer.from([0x00, 0x01, 0x00, 0x00, 9])), true)
    assert.equal(HudFonts.isFont(Buffer.from('OTTOxx')), true) // OpenType
    assert.equal(HudFonts.isFont(Buffer.from('truexx')), true) // Apple
    assert.equal(HudFonts.isFont(Buffer.from('ttcfxx')), true) // collection
    assert.equal(HudFonts.isFont(Buffer.from('wOF2zz')), false) // woff2 not accepted
    assert.equal(HudFonts.isFont(Buffer.from([1, 2])), false) // too short
    assert.equal(HudFonts.isFont(null), false)
  })

  it('#list() returns generics + curated (incl. the DJI-style Oxanium) + imported', function () {
    settings.clear()
    settings.setValue('camera.hudFontsImported', [{ id: 'mine.ttf', family: 'My Font', file: 'mine.ttf' }])
    const hf = new HudFonts(settings)
    const l = hf.list()
    assert.deepEqual(l.generics, ['monospace', 'sans-serif', 'serif'])
    const ox = l.fonts.find(f => f.family === 'Oxanium')
    assert.ok(ox && ox.kind === 'curated' && /DJI/.test(ox.label))
    assert.ok(l.fonts.find(f => f.family === 'IBM Plex Mono' && f.kind === 'curated'))
    const imp = l.fonts.find(f => f.kind === 'imported')
    assert.deepEqual({ family: imp.family, id: imp.id, file: imp.file }, { family: 'My Font', id: 'mine.ttf', file: 'mine.ttf' })
  })

  it('#install() copies the bundled curated fonts in + rebuilds the cache (idempotent)', async function () {
    const hf = makeManager()
    fs.mkdirSync(hf.bundledDir, { recursive: true })
    for (const f of ['Oxanium-Medium.ttf', 'ChakraPetch-Regular.ttf', 'IBMPlexMono-Regular.ttf', 'IBMPlexSans-Regular.ttf']) {
      fs.writeFileSync(path.join(hf.bundledDir, f), TTF)
    }
    const calls = []
    hf._exec = async (cmd, args) => { calls.push([cmd, ...args]); return '' }
    await hf.install()
    assert.ok(fs.existsSync(path.join(hf.fontsDir, 'Oxanium-Medium.ttf')))
    assert.ok(calls.some(c => c[0] === 'fc-cache'))
    // second run: files already present (skip-copy branch), still no throw
    await hf.install()
  })

  it('#install() skips missing bundled fonts and swallows a fontconfig failure', async function () {
    // bundledDir is empty → nothing to copy (src-missing branch)
    const hf = makeManager()
    hf._exec = async () => { throw new Error('no fontconfig') } // fc-cache fails → caught
    await hf.install()
    assert.equal(fs.existsSync(path.join(hf.fontsDir, 'Oxanium-Medium.ttf')), false)
  })

  it('#fileFor() serves known on-disk fonts, rejects unknown/unsafe/missing', function () {
    const hf = makeManager()
    fs.mkdirSync(hf.fontsDir, { recursive: true })
    fs.writeFileSync(path.join(hf.fontsDir, 'Oxanium-Medium.ttf'), TTF) // curated on disk
    assert.equal(hf.fileFor('Oxanium-Medium.ttf'), path.join(hf.fontsDir, 'Oxanium-Medium.ttf'))
    hf.imported = [{ id: 'mine.ttf', family: 'Mine', file: 'mine.ttf' }]
    fs.writeFileSync(path.join(hf.fontsDir, 'mine.ttf'), TTF)
    assert.equal(hf.fileFor('mine.ttf'), path.join(hf.fontsDir, 'mine.ttf'))
    assert.equal(hf.fileFor('Unknown.ttf'), null) // known-shape but not registered
    assert.equal(hf.fileFor('../secret.ttf'), null) // path traversal
    assert.equal(hf.fileFor('evil.exe'), null) // wrong extension
    assert.equal(hf.fileFor(42), null) // not a string
    fs.unlinkSync(path.join(hf.fontsDir, 'Oxanium-Medium.ttf'))
    assert.equal(hf.fileFor('Oxanium-Medium.ttf'), null) // registered but gone
  })

  it('#importFont() validates, stores, caches, reads the family, registers + persists', async function () {
    const hf = makeManager()
    hf._exec = async (cmd) => cmd === 'fc-query' ? 'My OSD Font\n' : ''
    const font = await hf.importFont(TTF, 'My OSD Font.ttf')
    assert.equal(font.family, 'My OSD Font')
    assert.equal(font.file, 'My_OSD_Font.ttf')
    assert.ok(fs.existsSync(path.join(hf.fontsDir, font.file)))
    assert.ok(settings.value('camera.hudFontsImported', []).find(f => f.id === font.id))
    assert.ok(hf.list().fonts.find(f => f.family === 'My OSD Font' && f.kind === 'imported'))
    // a name that sanitises to nothing falls back to 'font'
    const f2 = await hf.importFont(TTF, '.ttf')
    assert.equal(f2.file, 'font.ttf')
  })

  it('#importFont() rejects non-fonts and oversized files', async function () {
    const hf = makeManager()
    await assert.rejects(hf.importFont(Buffer.from('not a font at all'), 'x.ttf'), /TrueType\/OpenType/)
    const big = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(5 * 1024 * 1024)])
    await assert.rejects(hf.importFont(big, 'big.ttf'), /too large/)
  })

  it('#importFont() rejects + removes the file when the family name is unusable', async function () {
    const hf = makeManager()
    hf._exec = async (cmd) => cmd === 'fc-query' ? 'Bad<Family>!!' : ''
    await assert.rejects(hf.importFont(TTF, 'bad.otf'), /Unsupported font family/)
    assert.deepEqual(fs.readdirSync(hf.fontsDir), []) // cleaned up
    assert.deepEqual(hf.imported, [])
  })

  it('#importFont() avoids filename collisions', async function () {
    const hf = makeManager()
    hf._exec = async (cmd) => cmd === 'fc-query' ? 'Fam' : ''
    const a = await hf.importFont(TTF, 'dup.ttf')
    const b = await hf.importFont(TTF, 'dup.ttf')
    assert.equal(a.file, 'dup.ttf')
    assert.equal(b.file, 'dup_1.ttf')
  })

  it('#removeFont() deletes + deregisters, tolerating a gone file / failing cache, rejects unknown', async function () {
    const hf = makeManager()
    hf._exec = async (cmd) => cmd === 'fc-query' ? 'Fam' : ''
    const font = await hf.importFont(TTF, 'rem.ttf')
    // file already gone + fc-cache failing are both non-fatal
    fs.unlinkSync(path.join(hf.fontsDir, font.file))
    hf._exec = async () => { throw new Error('fc down') }
    const list = await hf.removeFont(font.id)
    assert.ok(!list.fonts.find(f => f.id === font.id))
    await assert.rejects(hf.removeFont(font.id), /Unknown font/)
  })

  it('#_exec() runs fontconfig tools: resolves stdout, rejects with stderr, falls back to err.message', async function () {
    const fake = new FakeBin()
    fake.install('fc-query', 'printf "Oxanium\\n"')
    fake.install('fc-cache', 'exit 0')
    fake.install('fc-fail', '>&2 echo "boom"; exit 1')
    fake.activate()
    try {
      const hf = makeManager()
      assert.equal((await hf._family('/some/file.ttf')).trim(), 'Oxanium')
      await hf._fcCache() // resolves
      await assert.rejects(hf._exec('fc-fail', []), /boom/) // stderr branch
      await assert.rejects(hf._exec('rpanion-no-such-binary', []), /ENOENT|not found/) // err.message branch
    } finally {
      fake.cleanup()
    }
  })
})
