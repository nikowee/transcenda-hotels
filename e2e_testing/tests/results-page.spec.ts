import { test, expect } from '@playwright/test';

test.describe('Results Page', () => {

  test('Full search flow leads to results page with hotels', async ({ page }) => {
    // ─── 1. Navigate to home page ──────────────────────────
    await page.goto('/');

    // ─── 2. Verify page loads ──────────────────────────────
    await expect(page.getByText('Find your next escape')).toBeVisible();

    // ─── 3. Type a destination ──────────────────────────────
    const searchInput = page.getByPlaceholder('Search destinations...');
    await searchInput.fill('Singapore');

    // ─── 4. Wait for suggestions and select the exact match ─
    await expect(page.getByText('Singapore, Singapore', { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByText('Singapore, Singapore', { exact: true }).click();

    // ─── 5. Set dates ──────────────────────────────────────
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.first().fill('2026-08-15');
    await dateInputs.last().fill('2026-08-20');

    // ─── 6. Set guests and rooms ────────────────────────────
    await page.selectOption('select:first-of-type', '2');
    await page.selectOption('select:last-of-type', '1');

    // ─── 7. Click search ────────────────────────────────────
    await page.getByRole('button', { name: /search/i }).click();

    // ─── 8. Verify redirect to results page ──────────────────
    await expect(page).toHaveURL(/.*results/);

    // ─── 9. Wait for hotel cards to load ─────────────────────
    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 15000 });

    // ─── 10. Verify hotels are displayed ─────────────────────
    // At least one "Select Hotel" button should appear
    await expect(page.getByText(/Select Hotel/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('Shows error when navigating to results without search params', async ({ page }) => {
    // ─── 1. Navigate directly to /results without params ────
    await page.goto('/results');

    // ─── 2. Verify error message appears ─────────────────────
    await expect(page.getByText(/Missing search parameters/i)).toBeVisible();

    // ─── 3. Verify Go Back button is present ─────────────────
    await expect(page.getByRole('button', { name: /Go Back/i })).toBeVisible();
  });

  test('Displays hotel details when navigating with valid params', async ({ page }) => {
    // ─── 1. Navigate directly to results with valid params ──
    await page.goto('/results?dest=RsBU&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // ─── 2. Verify search summary appears ────────────────────
    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 15000 });

    // ─── 3. Verify hotel count is shown ──────────────────────
    await expect(page.getByText(/hotels found/i)).toBeVisible({ timeout: 15000 });

    // ─── 4. Verify dates are displayed ───────────────────────
    await expect(page.getByText(/2026-08-15/i)).toBeVisible();

    // ─── 5. Verify at least one hotel card is rendered ───────
    await expect(page.getByText(/Select Hotel/i).first()).toBeVisible({ timeout: 15000 });

    // ─── 6. Verify filter panel is visible ───────────────────
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible();

    // ─── 7. Verify sort dropdown is visible ──────────────────
    await expect(page.getByText(/Sort by:/i)).toBeVisible();
  });
});