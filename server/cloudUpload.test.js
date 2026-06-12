const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const sinon = require('sinon')
const settings = require('settings-store')
const { FakeBin } = require('../test/fakeBin')
const CloudTest = require('./cloudUpload')

describe('Cloud Upload Functions', function () {
  // fake ssh-keygen/rsync; HOME is pointed at temp dirs so the real
  // ~/.ssh is never touched
  let fake
  let realHome

  before(function () {
    realHome = process.env.HOME
    fake = new FakeBin()
    fake.install('ssh-keygen', 'mkdir -p "$HOME/.ssh" && printf "ssh-rsa FAKEKEY test\\n" > "$HOME/.ssh/id_rsa.pub"')
    fake.install('rsync', 'if [ "$FAKE_SCENARIO" = "fail" ]; then exit 12; fi\necho synced')
    fake.activate()
  })

  after(function () {
    fake.cleanup()
  })

  afterEach(function () {
    sinon.restore()
    process.env.HOME = realHome
    delete process.env.FAKE_SCENARIO
  })

  function tmpHome () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-home-'))
    process.env.HOME = dir
    return dir
  }

  it('#cloudinit()', function () {
    settings.clear()
    const cloudVar = new CloudTest(settings)

    // check initial status
    assert.equal(cloudVar.options.doBinUpload, false)
    assert.equal(cloudVar.options.syncDeletions, false)

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudlocalupload()', function () {
    // Getting starting client with local copy
    settings.clear()
    const cloudVar = new CloudTest(settings)

    // check initial status
    assert.equal(cloudVar.options.doBinUpload, false)
    assert.equal(cloudVar.conStatusBinStr(), 'Disabled')

    cloudVar.setSettingsBin(true, 'tmpfolder', false)

    assert.equal(cloudVar.conStatusBinStr(), 'Waiting for first run')
    assert.equal(cloudVar.options.doBinUpload, true)

    clearInterval(cloudVar.intervalObj)
  })

  it('#cloudinitNoSshDir()', function () {
    // no ~/.ssh at all: constructor must not create keys
    settings.clear()
    const home = tmpHome()
    const clock = sinon.useFakeTimers()
    try {
      const cloudVar = new CloudTest(settings)
      assert.ok(!fs.existsSync(path.join(home, '.ssh')))

      // upload disabled: the interval fires and does nothing
      clock.tick(20000)
      assert.equal(cloudVar.rsyncPid, null)

      // quitting without an rsync process
      cloudVar.quitting()
    } finally {
      clock.restore()
    }
  })

  it('#cloudinitEmptySshDir()', function () {
    // an empty ~/.ssh: constructor generates a default key
    settings.clear()
    const home = tmpHome()
    fs.mkdirSync(path.join(home, '.ssh'))

    const cloudVar = new CloudTest(settings)
    assert.ok(fs.existsSync(path.join(home, '.ssh', 'id_rsa.pub')))
    clearInterval(cloudVar.intervalObj)
  })

  it('#getSettingsReadsPubkeys()', function (done) {
    settings.clear()
    const home = tmpHome()
    fs.mkdirSync(path.join(home, '.ssh'))
    fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'PRIVATE')
    fs.writeFileSync(path.join(home, '.ssh', 'id_rsa.pub'), 'ssh-rsa EXISTINGKEY')

    const cloudVar = new CloudTest(settings)
    cloudVar.getSettings((doBinUpload, binUploadLink, syncDeletions, pubkey) => {
      assert.equal(doBinUpload, false)
      assert.deepEqual(pubkey, ['ssh-rsa EXISTINGKEY'])
      clearInterval(cloudVar.intervalObj)
      done()
    })
  })

  it('#getSettingsCreatesKey()', function (done) {
    settings.clear()
    // .ssh present (so the constructor skips keygen) but holds no .pub files
    const home = tmpHome()
    fs.mkdirSync(path.join(home, '.ssh'))
    fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), '')
    const cloudVar = new CloudTest(settings)

    // remove ~/.ssh entirely: getSettings regenerates a default key
    fs.rmSync(path.join(home, '.ssh'), { recursive: true, force: true })
    cloudVar.getSettings((doBinUpload, binUploadLink, syncDeletions, pubkey) => {
      assert.equal(pubkey.length, 1)
      assert.ok(pubkey[0].includes('FAKEKEY'))
      clearInterval(cloudVar.intervalObj)
      done()
    })
  })

  it('#uploadIntervalRunsRsync()', async function () {
    this.timeout(10000)
    settings.clear()
    settings.setValue('cloud.doBinUpload', true)
    settings.setValue('cloud.binUploadLink', 'user@example.com:uploads')
    settings.setValue('cloud.syncDeletions', true)
    const home = tmpHome()
    fs.mkdirSync(path.join(home, '.ssh'))
    fs.writeFileSync(path.join(home, '.ssh', 'id_rsa.pub'), 'ssh-rsa KEY')

    const logSpy = sinon.spy(console, 'log')
    // only fake the interval timers: faking setImmediate (sinon's default)
    // stops the child process 'close' event from ever being delivered
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    let cloudVar
    try {
      cloudVar = new CloudTest(settings)

      // wait for 'close' (not 'exit') - the rsync lib's completion callback
      // runs on 'close', and that only fires once the stdio pipes are
      // drained (the lib leaves them paused when no output handler is set)
      const rsyncDone = () => {
        cloudVar.rsyncPid.stdout.resume()
        cloudVar.rsyncPid.stderr.resume()
        return new Promise((resolve) => cloudVar.rsyncPid.on('close', resolve))
      }

      // first run: rsync succeeds (with --delete)
      clock.tick(20000)
      assert.notEqual(cloudVar.rsyncPid, null)
      await rsyncDone()

      // second run: the old pid is killed, the new rsync fails
      cloudVar.options.syncDeletions = false
      process.env.FAKE_SCENARIO = 'fail'
      clock.tick(20000)
      await rsyncDone()
    } finally {
      clock.restore()
    }

    // the failed run was logged with its exit code
    const sawError = logSpy.getCalls().some((c) => c.args[0] instanceof Error)
    const sawCode = logSpy.getCalls().some((c) => c.args[0] === 12)
    assert.ok(sawError, 'rsync failure was not logged')
    assert.ok(sawCode, 'rsync exit code was not logged')
    assert.equal(cloudVar.conStatusBinStr(), 'Error running Rsync')

    // quitting kills the (exited) rsync process handle
    cloudVar.quitting()
  })

  it('#setSettingsBinSaveFailure()', function () {
    settings.clear()
    const cloudVar = new CloudTest(settings)
    cloudVar.settings = { setValue: () => { throw new Error('disk full') } }
    const logSpy = sinon.spy(console, 'log')

    cloudVar.setSettingsBin(true, 'somewhere', false)
    // option still applied in memory, error logged
    assert.equal(cloudVar.options.doBinUpload, true)
    assert.ok(logSpy.getCalls().some((c) => c.args[0] instanceof Error))
    clearInterval(cloudVar.intervalObj)
  })

  it('#conStatusBinStr()', function () {
    settings.clear()
    const cloudVar = new CloudTest(settings)
    cloudVar.options.doBinUpload = true

    cloudVar.rsyncPid = { exitCode: null, kill: () => {} }
    assert.equal(cloudVar.conStatusBinStr(), 'Running')
    cloudVar.rsyncPid = { exitCode: 0, kill: () => {} }
    assert.equal(cloudVar.conStatusBinStr(), 'Success')
    cloudVar.rsyncPid = { exitCode: 12, kill: () => {} }
    assert.equal(cloudVar.conStatusBinStr(), 'Error running Rsync')

    clearInterval(cloudVar.intervalObj)
  })
})
