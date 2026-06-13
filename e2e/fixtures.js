import { test as base, expect } from '@playwright/test'

// Extend the base test with an auto-fixture that fails any test whose page
// throws an *uncaught exception* during the test — a genuine crash signal.
//
// Note: several upstream pages log React "controlled/uncontrolled input" and
// "value prop should not be null" *warnings* to console.error. Those are
// pre-existing and are intentionally NOT treated as failures here; only real
// uncaught exceptions (page errors) fail the test.
export const test = base.extend({
  uncaughtErrors: [async ({ page }, use) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    await use(errors)
    expect(errors, `page threw uncaught exception(s):\n${errors.join('\n')}`).toHaveLength(0)
  }, { auto: true }],
})

export { expect }

// Navigate to a route and wait until the app shell and the page <h1> are
// rendered, so individual assertions don't race the initial /api/auth round-trip.
export async function gotoPage (page, path) {
  await page.goto(path)
  await expect(page.locator('#sidebar-wrapper')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}
