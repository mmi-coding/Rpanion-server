// spec: specs/webui-e2e-plan.md  §2 Page smoke — every route renders
import { test, expect, gotoPage } from './fixtures.js'
import { ROUTES } from './routes.js'

test.describe('Page smoke — every route renders', () => {
  for (const route of ROUTES) {
    test(`${route.path} renders "${route.title}" with the shell intact`, async ({ page }) => {
      // Direct navigation exercises the Vite SPA fallback for the client route.
      await gotoPage(page, route.path)
      await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible()
      await expect(page.locator('#sidebar-wrapper')).toBeVisible()
      // The uncaughtErrors fixture asserts no page crashed during load.
    })
  }
})
