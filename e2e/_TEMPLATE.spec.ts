/**
 * _TEMPLATE.spec.ts
 * Playwright E2E spec template.
 *
 * Copilot generates real specs from this template during Phase 6.
 * The generated file is named after the actual ticket:
 *   e2e/<ticket-id-lowercase>-<feature-slug>.spec.ts
 *   e.g. e2e/abc-101-add-user-export.spec.ts
 *
 * Rules:
 *   - Replace ALL placeholder values (marked with <ANGLE_BRACKETS>) with real values
 *   - Derive the spec filename from ticket.json — never copy this filename literally
 *   - Every selector must use data-testid — add missing ones to components in Phase 4
 *   - Do NOT run this template file directly in CI
 *
 * Local run:
 *   npx playwright test e2e/<ticket-id>-<slug>.spec.ts
 *   npx playwright test e2e/<ticket-id>-<slug>.spec.ts --headed
 *   npx playwright test e2e/<ticket-id>-<slug>.spec.ts --ui
 */

import { test, expect } from '@playwright/test';
import { LoginPage }    from './pages/LoginPage';
// import { <FeaturePage> } from './pages/<FeaturePage>';  // create POM if it doesn't exist

// ── Replace with real values from ticket.json ─────────────────────────────────
const TICKET_ID    = '<TICKET-ID>';       // e.g. 'ABC-101'
const FEATURE_NAME = '<Feature Name>';    // e.g. 'Add User Export'

// ── Auth setup — reuse saved auth state, no re-login per test ────────────────
test.use({ storageState: 'e2e/.auth/user.json' });

test.describe(`[${TICKET_ID}] ${FEATURE_NAME}`, () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.BASE_URL + '/<start-path>');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy path — main acceptance criterion ────────────────────────────────
  test('should successfully complete <main AC description>', async ({ page }) => {
    // Arrange
    // await page.getByTestId('<some-testid>').fill('<value>');

    // Act
    // await page.getByTestId('<action-button-testid>').click();

    // Assert
    // await expect(page.getByTestId('<result-testid>')).toBeVisible();
  });

  // ── Validation / edge case ────────────────────────────────────────────────
  test('should show validation error when <edge case condition>', async ({ page }) => {
    // await page.getByTestId('<submit-testid>').click();
    // await expect(page.getByTestId('<error-testid>')).toContainText('<expected message>');
  });

  // ── Error handling — simulate downstream failure ──────────────────────────
  test('should handle <downstream failure> gracefully', async ({ page }) => {
    await page.route('**/api/<resource>', route => route.abort('failed'));
    // await page.getByTestId('<trigger-testid>').click();
    // await expect(page.getByTestId('<error-banner-testid>')).toBeVisible();
  });

  // ── Accessibility ─────────────────────────────────────────────────────────
  test('new UI elements should pass basic accessibility checks', async ({ page }) => {
    // Use @axe-core/playwright if available in your project
    // const { checkA11y } = await import('axe-playwright');
    // await checkA11y(page, '#<feature-container-id>');
    await expect(page.getByTestId('<main-region-testid>')).toBeVisible();
  });

  // ── Mobile viewport ───────────────────────────────────────────────────────
  test('should be usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(process.env.BASE_URL + '/<start-path>');
    // await expect(page.getByTestId('<mobile-element-testid>')).toBeVisible();
  });

  // ── API mock — controlled response ───────────────────────────────────────
  test('should render correctly when API returns <specific scenario>', async ({ page }) => {
    await page.route('**/api/<resource>', route =>
      route.fulfill({
        status:      200,
        contentType: 'application/json',
        body:        JSON.stringify({ /* mock response shape */ }),
      }),
    );
    // await expect(page.getByTestId('<result-testid>')).toBeVisible();
  });

});
