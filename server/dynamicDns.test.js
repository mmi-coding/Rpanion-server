const assert = require('assert')
const sinon = require('sinon')
const DynamicDns = require('./dynamicDns.js')

// Minimal in-memory stand-in for settings-store
function makeSettings (initial = {}) {
  const store = { ...initial }
  return {
    value: (k, d) => (k in store ? store[k] : d),
    setValue: (k, v) => { store[k] = v }
  }
}

// fetchFn that branches on URL: ipify (public IP) vs the provider call
function fakeFetch (opts = {}) {
  return async (url) => {
    if (url.includes('ipify')) {
      if (opts.ipFail) { throw new Error('no network') }
      return { json: async () => ({ ip: '203.0.113.7' }) }
    }
    if (opts.providerThrow) { throw new Error('provider netfail') }
    return { ok: opts.ok !== false, status: opts.status || 200, text: async () => (opts.text !== undefined ? opts.text : 'OK') }
  }
}

describe('Dynamic DNS', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('starts disabled by default with no timer', function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch() })
    assert.equal(d.getStatus().status, 'Disabled')
    assert.equal(d.timer, null)
  })

  it('starts the loop when constructed enabled', function () {
    const spy = sinon.stub(DynamicDns.prototype, 'performUpdate').resolves({})
    const d = new DynamicDns(makeSettings({ 'ddns.enabled': true }), { fetchFn: fakeFetch() })
    assert.notEqual(d.timer, null)
    assert.ok(spy.called)
    d.quitting()
    assert.equal(d.timer, null)
  })

  it('fires the update on the interval', function () {
    const clock = sinon.useFakeTimers()
    const spy = sinon.stub(DynamicDns.prototype, 'performUpdate').resolves({})
    const d = new DynamicDns(makeSettings({ 'ddns.enabled': true, 'ddns.intervalMin': 5 }), { fetchFn: fakeFetch() })
    assert.equal(spy.callCount, 1) // initial run
    clock.tick(5 * 60000)
    assert.equal(spy.callCount, 2) // interval run
    d.quitting()
    clock.restore()
  })

  it('builds a DuckDNS request', function () {
    const d = new DynamicDns(makeSettings({ 'ddns.provider': 'duckdns', 'ddns.hostname': 'mypi', 'ddns.token': 'tok' }), { fetchFn: fakeFetch() })
    const req = d.buildRequest('1.2.3.4')
    assert.ok(req.url.includes('duckdns.org'))
    assert.ok(req.url.includes('domains=mypi'))
    assert.equal(req.ok('OK'), true)
    assert.equal(req.ok('KO'), false)
  })

  it('builds a No-IP request with basic auth', function () {
    const d = new DynamicDns(makeSettings({ 'ddns.provider': 'noip', 'ddns.hostname': 'h', 'ddns.username': 'u', 'ddns.password': 'p' }), { fetchFn: fakeFetch() })
    const req = d.buildRequest('1.2.3.4')
    assert.ok(req.url.includes('no-ip.com'))
    assert.ok(req.init.headers.Authorization.startsWith('Basic '))
    assert.equal(req.ok('good 1.2.3.4'), true)
    assert.equal(req.ok('nochg'), true)
    assert.equal(req.ok('nohost'), false)
  })

  it('performUpdate succeeds (DuckDNS)', async function () {
    const d = new DynamicDns(makeSettings({ 'ddns.enabled': true, 'ddns.provider': 'duckdns', 'ddns.hostname': 'mypi', 'ddns.token': 'tok' }), { fetchFn: fakeFetch({ text: 'OK' }) })
    d.stopLoop() // ignore the constructor's auto-run
    const status = await d.performUpdate()
    assert.equal(status.status, 'Success')
    assert.equal(status.lastIp, '203.0.113.7')
  })

  it('performUpdate succeeds (No-IP)', async function () {
    const d = new DynamicDns(makeSettings({ 'ddns.provider': 'noip', 'ddns.hostname': 'h', 'ddns.username': 'u', 'ddns.password': 'p' }), { fetchFn: fakeFetch({ text: 'good 203.0.113.7' }) })
    d.options.enabled = true
    const status = await d.performUpdate()
    assert.equal(status.status, 'Success')
  })

  it('performUpdate reports a provider rejection', async function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch({ text: 'badauth' }) })
    d.options.enabled = true
    const status = await d.performUpdate()
    assert.ok(status.status.includes('provider rejected'))
  })

  it('performUpdate reports a fetch failure', async function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch({ providerThrow: true }) })
    d.options.enabled = true
    const status = await d.performUpdate()
    assert.ok(status.status.startsWith('Error:'))
  })

  it('performUpdate reports a public-IP detection failure', async function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch({ ipFail: true }) })
    d.options.enabled = true
    const status = await d.performUpdate()
    assert.ok(status.status.includes('cannot detect public IP'))
  })

  it('performUpdate is a no-op when disabled', async function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch() })
    const status = await d.performUpdate()
    assert.equal(status.status, 'Disabled')
  })

  it('updateNow delegates to performUpdate', async function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch() })
    const status = await d.updateNow()
    assert.equal(status.status, 'Disabled')
  })

  it('setSettings persists, enables and disables', function (done) {
    const settings = makeSettings()
    const d = new DynamicDns(settings, { fetchFn: fakeFetch() })
    sinon.stub(d, 'startLoop')
    d.setSettings({ enabled: true, provider: 'duckdns', hostname: 'mypi', token: 'tok', username: '', password: 'secret', intervalMin: 10 }, (err) => {
      assert.equal(err, null)
      assert.ok(d.startLoop.called)
      assert.equal(settings.value('ddns.hostname'), 'mypi')
      const s = d.getSettings()
      assert.equal(s.hasPassword, true)
      // disabling stops the loop and clears status
      d.setSettings({ enabled: false, provider: 'duckdns', hostname: 'mypi', token: 'tok', username: '', password: '', intervalMin: 10 }, (err2) => {
        assert.equal(err2, null)
        assert.equal(d.getStatus().status, 'Disabled')
        // empty password kept the existing one
        assert.equal(d.options.password, 'secret')
        done()
      })
    })
  })

  it('setSettings logs a persistence error without throwing', function (done) {
    const settings = makeSettings()
    settings.setValue = () => { throw new Error('disk full') }
    const d = new DynamicDns(settings, { fetchFn: fakeFetch() })
    const logSpy = sinon.spy(console, 'log')
    d.setSettings({ enabled: false, provider: 'duckdns', hostname: 'h', token: 't', username: '', password: '', intervalMin: 5 }, (err) => {
      assert.equal(err, null)
      assert.ok(logSpy.called)
      done()
    })
  })

  it('getSettings reports hasPassword false when none set', function () {
    const d = new DynamicDns(makeSettings(), { fetchFn: fakeFetch() })
    assert.equal(d.getSettings().hasPassword, false)
  })

  it('falls back to the global fetch when no fetchFn is injected', async function () {
    const fetchStub = sinon.stub(global, 'fetch').resolves({ json: async () => ({ ip: '198.51.100.9' }) })
    const d = new DynamicDns(makeSettings())
    const ip = await d.detectPublicIp()
    assert.equal(ip, '198.51.100.9')
    assert.ok(fetchStub.called)
  })
})
