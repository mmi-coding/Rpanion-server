process.env.NODE_ENV = 'development'

const assert = require('assert')
const Path = require('path')
const fs = require('fs')
const os = require('os')
const logpaths = require('./paths')

const testRoot = fs.mkdtempSync(Path.join(os.tmpdir(), 'flightlogger-test-'))
logpaths.flightsLogsDir = Path.join(testRoot, 'flightlogs')
logpaths.kmzDir = Path.join(testRoot, 'flightlogs', 'kmzlogs')
logpaths.mediaDir = Path.join(testRoot, 'media')

const Logger = require('./flightLogger')

describe('Logging Functions', function () {
  beforeEach('Ensure cleared log folder', function () {
    if (fs.existsSync(logpaths.flightsLogsDir)) {
      fs.rmSync(logpaths.flightsLogsDir, { recursive: true, force: true })
    }
    if (fs.existsSync(logpaths.mediaDir)) {
      fs.rmSync(logpaths.mediaDir, { recursive: true, force: true })
    }
  })

  after(function () {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('#loggerinit()', function () {
    const Lgr = new Logger()

    // assert folders were created
    assert.ok(fs.existsSync(Lgr.topfolder))
  })

  it('#clearlogfiles()', function () {
    const Lgr = new Logger()

    // create a fake log
    fs.writeFileSync(Path.join(logpaths.flightsLogsDir, 'flight.tlog'), Buffer.from('tést'))

    Lgr.clearlogs('tlog', null)

    // ensure kmz log folder exists before clearing kmz logs
    fs.mkdirSync(logpaths.kmzDir, { recursive: true })
    fs.writeFileSync(Path.join(logpaths.kmzDir, 'flight.kmz'), Buffer.from('dummy'))

    Lgr.clearlogs('binlog', null)
    Lgr.clearlogs('kmzlog', null)

    // assert all files deleted
    assert.equal(fs.readdirSync(logpaths.flightsLogsDir).length, 1) // note that the kmzlogs folder counts as 1
    assert.equal(fs.readdirSync(logpaths.kmzDir).length, 0)
  })

  it('#clearlogsActiveBinlogKept()', function () {
    const Lgr = new Logger()

    // two binlogs, one of them is the actively-written file
    const activeLog = Path.join(logpaths.flightsLogsDir, 'active.bin')
    fs.writeFileSync(Path.join(logpaths.flightsLogsDir, 'old.bin'), Buffer.from('old'))
    fs.writeFileSync(activeLog, Buffer.from('active'))

    Lgr.clearlogs('binlog', activeLog)

    // the active log survives, the old one is gone
    assert.ok(fs.existsSync(activeLog))
    assert.ok(!fs.existsSync(Path.join(logpaths.flightsLogsDir, 'old.bin')))
  })

  it('#clearlogsMediaAndSubfolders()', function () {
    const Lgr = new Logger()

    // media files at the top level and inside a subfolder
    fs.writeFileSync(Path.join(logpaths.mediaDir, 'photo.jpg'), Buffer.from('jpg'))
    const subdir = Path.join(logpaths.mediaDir, '2026-06-12')
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(Path.join(subdir, 'video.mp4'), Buffer.from('mp4'))

    Lgr.clearlogs('media', null)

    // everything under media is removed, including the subfolder itself
    assert.equal(fs.readdirSync(logpaths.mediaDir).length, 0)
  })

  it('#clearlogsUnknownType()', function () {
    const Lgr = new Logger()

    // an unknown log type deletes nothing
    fs.writeFileSync(Path.join(logpaths.flightsLogsDir, 'flight.tlog'), Buffer.from('tést'))
    Lgr.clearlogs('floppydisk', null)
    assert.ok(fs.existsSync(Path.join(logpaths.flightsLogsDir, 'flight.tlog')))
  })

  // Create a log file of a given size with a deterministic mtime (seconds).
  function makeLog (filePath, size, mtimeSec) {
    fs.mkdirSync(Path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, Buffer.alloc(size, 1))
    const t = new Date(mtimeSec * 1000)
    fs.utimesSync(filePath, t, t)
  }

  it('#pruneLogsNoOpUnderCap()', function () {
    const Lgr = new Logger()
    const dir = logpaths.flightsLogsDir
    makeLog(Path.join(dir, 'a.bin'), 500, 100)
    makeLog(Path.join(dir, 'b.bin'), 500, 200)

    // caps far above what exists -> nothing is deleted
    const deleted = Lgr.pruneLogs(null, 1e12, 1000)
    assert.equal(deleted.length, 0)
    assert.ok(fs.existsSync(Path.join(dir, 'a.bin')))
    assert.ok(fs.existsSync(Path.join(dir, 'b.bin')))
  })

  it('#pruneLogsByCountRecursesAndIgnoresNonLogs()', function () {
    const Lgr = new Logger()
    const dir = logpaths.flightsLogsDir
    makeLog(Path.join(dir, 'a.bin'), 500, 100) // oldest log
    fs.writeFileSync(Path.join(dir, 'keep.txt'), Buffer.from('x')) // not a log
    makeLog(Path.join(dir, 'sub', 'b.tlog'), 500, 200) // newer, in a subdir

    // count cap of 1 with two logs -> the single oldest log is pruned
    const deleted = Lgr.pruneLogs(null, 1e12, 1)
    assert.equal(deleted.length, 1)
    assert.ok(!fs.existsSync(Path.join(dir, 'a.bin')))
    assert.ok(fs.existsSync(Path.join(dir, 'sub', 'b.tlog')))
    assert.ok(fs.existsSync(Path.join(dir, 'keep.txt'))) // non-log untouched
  })

  it('#pruneLogsBySize()', function () {
    const Lgr = new Logger()
    const dir = logpaths.flightsLogsDir
    makeLog(Path.join(dir, 'old.bin'), 1000, 100)
    makeLog(Path.join(dir, 'mid.bin'), 1000, 200)
    makeLog(Path.join(dir, 'new.bin'), 1000, 300)

    // 3000 bytes total, cap 2500 -> drop only the oldest to get under
    const deleted = Lgr.pruneLogs(null, 2500, 999)
    assert.equal(deleted.length, 1)
    assert.ok(!fs.existsSync(Path.join(dir, 'old.bin')))
    assert.ok(fs.existsSync(Path.join(dir, 'mid.bin')))
    assert.ok(fs.existsSync(Path.join(dir, 'new.bin')))
  })

  it('#pruneLogsSkipsActiveBinlog()', function () {
    const Lgr = new Logger()
    const dir = logpaths.flightsLogsDir
    const active = Path.join(dir, 'active.bin')
    makeLog(active, 500, 100) // oldest, but actively written
    makeLog(Path.join(dir, 'b.bin'), 500, 200)
    makeLog(Path.join(dir, 'c.bin'), 500, 300)

    // count cap of 1: the oldest is the active log, so it must be skipped and
    // the two newer logs pruned instead
    const deleted = Lgr.pruneLogs(active, 1e12, 1)
    assert.ok(fs.existsSync(active))
    assert.ok(!fs.existsSync(Path.join(dir, 'b.bin')))
    assert.ok(!fs.existsSync(Path.join(dir, 'c.bin')))
    assert.deepEqual(
      deleted.slice().sort(),
      [Path.join(dir, 'b.bin'), Path.join(dir, 'c.bin')].sort()
    )
  })

  it('#pruneLogsSurvivesUnlinkError()', function () {
    const Lgr = new Logger()
    const dir = logpaths.flightsLogsDir
    makeLog(Path.join(dir, 'a.bin'), 500, 100)
    makeLog(Path.join(dir, 'b.bin'), 500, 200)

    // an unlink failure (e.g. concurrent delete / not writable) must not crash
    const origUnlink = fs.unlinkSync
    fs.unlinkSync = function () { throw new Error('EACCES') }
    try {
      const deleted = Lgr.pruneLogs(null, 0, 0) // force everything over cap
      assert.equal(deleted.length, 0)
    } finally {
      fs.unlinkSync = origUnlink
    }
    // both files survive because every unlink threw and was swallowed
    assert.ok(fs.existsSync(Path.join(dir, 'a.bin')))
    assert.ok(fs.existsSync(Path.join(dir, 'b.bin')))
  })

  it('#getlogs()', function (done) {
    const Lgr = new Logger()

    // Ensure media directory exists before testing
    if (!fs.existsSync(logpaths.mediaDir)) {
      fs.mkdirSync(logpaths.mediaDir, { recursive: true })
    }

    // create a fake log
    fs.writeFileSync(Path.join(logpaths.flightsLogsDir, 'flight.tlog'), Buffer.from('tést'))

    Lgr.getLogs(function (err, tlogs, binlogs, kmzlogs, mediafiles) {
      assert.equal(tlogs.length, 1)
      assert.equal(binlogs.length, 0)
      assert.equal(kmzlogs.length, 0)
      assert.equal(mediafiles.length, 0)
      done()
    })
  })
})
