// spec: specs/webui-e2e-plan.md  §3 Graceful degradation without companion hardware
//
// These assertions describe how the UI behaves against a *real* backend with no
// flight controller, modem or camera attached — i.e. the WSL/dev environment.
// On a fully-equipped Pi the live values differ; that path is on-device.
import { test, expect, gotoPage } from './fixtures.js'

test.describe('Graceful degradation without companion hardware', () => {
  // 3.1 Photo and Video reports OpenCV unavailable
  test('Photo and Video page reports OpenCV unavailable', async ({ page }) => {
    await gotoPage(page, '/video')
    await expect(page.getByText(/OpenCV is not installed/i)).toBeVisible()
  })

  // 3.2 LTE Modem reports monitoring disabled
  test('LTE Modem page reports monitoring disabled', async ({ page }) => {
    await gotoPage(page, '/ltemodem')
    await expect(page.getByText(/Modem monitoring is disabled/i)).toBeVisible()
  })

  // 3.3 Home shows disconnected / inactive subsystem statuses
  test('Home page shows disconnected and inactive subsystem statuses', async ({ page }) => {
    await gotoPage(page, '/')
    await expect(page.getByText('Not connected').first()).toBeVisible()
    await expect(page.getByText('Inactive').first()).toBeVisible()
  })
})
