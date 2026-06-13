// spec: specs/webui-e2e-plan.md  §1 Application shell and navigation
import { test, expect } from './fixtures.js'
import { ROUTES } from './routes.js'

test.describe('Application shell and navigation', () => {
  // 1.1 Home page loads with the status overview
  test('home page loads with the status overview and sidebar', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#sidebar-wrapper')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'System Status Overview' })).toBeVisible()
  })

  // 1.2 Sidebar lists every navigation link
  test('sidebar lists every navigation link and hides logout in dev mode', async ({ page }) => {
    await page.goto('/')
    for (const route of ROUTES) {
      await expect(page.getByRole('link', { name: route.nav, exact: true })).toBeVisible()
    }
    // Auth is disabled in dev mode, so the Logout link must not be rendered.
    await expect(page.getByRole('link', { name: 'Logout', exact: true })).toHaveCount(0)
  })

  // 1.3 Every sidebar link opens its page
  for (const route of ROUTES) {
    test(`sidebar link "${route.nav}" opens ${route.path}`, async ({ page }) => {
      await page.goto('/')
      await page.getByRole('link', { name: route.nav, exact: true }).click()
      await expect(page).toHaveURL(route.path)
      await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible()
    })
  }

  // 1.4 Unknown route shows the 404 page
  test('unknown route shows the 404 page with the shell intact', async ({ page }) => {
    await page.goto('/does-not-exist')
    await expect(page.getByRole('heading', { name: '404 - Page Not Found' })).toBeVisible()
    await expect(page.locator('#sidebar-wrapper')).toBeVisible()
  })

  // 1.5 Logout route is unavailable in dev mode
  test('logout route is not registered when auth is disabled', async ({ page }) => {
    await page.goto('/logoutconfirm')
    await expect(page.getByRole('heading', { name: '404 - Page Not Found' })).toBeVisible()
  })
})
