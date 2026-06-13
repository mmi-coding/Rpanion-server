// spec: specs/webui-e2e-plan.md  §4 Self-documenting UI (fork rule)
// See docs/UI-GUIDELINES.md: every fork page gets a collapsed HelpSection and
// HelpTips on its controls (src/components/Help.jsx).
import { test, expect, gotoPage } from './fixtures.js'
import { SELF_DOCUMENTING_PAGES } from './routes.js'

test.describe('Self-documenting UI (fork rule)', () => {
  for (const { path, title } of SELF_DOCUMENTING_PAGES) {
    // 4.1 Fork pages expose HelpTips on controls
    test(`${title} exposes help tips on its controls`, async ({ page }) => {
      await gotoPage(page, path)
      await expect(page.locator('[aria-label="help"]').first()).toBeVisible()
      expect(await page.locator('[aria-label="help"]').count()).toBeGreaterThan(0)
    })

    // 4.2 The HelpSection collapses/expands
    test(`${title} has a HelpSection that expands and collapses`, async ({ page }) => {
      await gotoPage(page, path)
      const toggle = page.locator('a[role="button"][aria-expanded]').first()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })
  }

  // 4.3 Hovering a HelpTip reveals its tooltip
  test('hovering a help marker reveals its tooltip', async ({ page }) => {
    await gotoPage(page, '/cameraswitcher')
    await page.locator('[aria-label="help"]').first().hover()
    await expect(page.getByRole('tooltip').first()).toBeVisible()
  })
})
