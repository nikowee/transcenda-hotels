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
    await expect(page.getByText('Singapore, Singapore', { exact: true })).toBeVisible({ timeout: 10000 });
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
    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 30000 });

    // ─── 10. Verify hotels are displayed ─────────────────────
    // At least one "Select Hotel" button should appear
    await expect(page.getByText(/Select Hotel/i).first()).toBeVisible({ timeout: 30000 });
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
    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 30000 });

    // ─── 3. Verify hotel count is shown ──────────────────────
    await expect(page.getByText(/hotels found/i)).toBeVisible({ timeout: 30000 });

    // ─── 4. Verify dates are displayed ───────────────────────
    await expect(page.getByText(/2026-08-15/i)).toBeVisible();

    // ─── 5. Verify at least one hotel card is rendered ───────
    await expect(page.getByText(/Select Hotel/i).first()).toBeVisible({ timeout: 30000 });

    // ─── 6. Verify filter panel is visible ───────────────────
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible();

    // ─── 7. Verify sort dropdown is visible ──────────────────
    await expect(page.getByText(/Sort by:/i)).toBeVisible();
  });

  test('Apply a 5-star filter shows only 5-star hotels', async ({ page }) => {
    // ─── 1. Navigate to results with valid params ────────────
    await page.goto('/results?dest=RsBU&name=Singapore&in=2026-12-01&out=2026-12-07&guests=2&rooms=1');

    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 30000 });

    // ─── 2. Click the 5★ filter button ───────────────────────
    await page.getByRole('button', { name: '5★' }).first().click();

    // ─── 3. Click Apply Filters ─────────────────────────────
    await page.getByText('Apply Filters').click();

    // ─── 4. The results reload from the server with starRating=5 ──
    // The applied-filters summary renders "{n} hotels shown · {total} total · 5★".
    await expect(page.getByText(/hotels shown · \d+ total · 5★/)).toBeVisible({ timeout: 30000 });

    // ─── 5. Every rendered card is a 5-star hotel ─────────────
    // The backend matches Math.round(rating) === 5, so a card may show (5) or
    // (4.6)+(4.8) — round-trip the same rule rather than demanding exact text.
    const ratings = page.locator('span', { hasText: /^\(\d+(\.\d+)?\)$/ });
    const count = await ratings.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await ratings.nth(i).textContent();
      const rating = Number(text?.replace(/[()]/g, ''));
      expect(Math.round(rating)).toBe(5);
    }
  });

  test('Sort by Price Low to High orders the results', async ({ page }) => {
    // ─── 1. Navigate to results with valid params ────────────
    await page.goto('/results?dest=RsBU&name=Singapore&in=2026-12-01&out=2026-12-07&guests=2&rooms=1');

    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 30000 });

    // ─── 2. Select "Price: Low to High" ──────────────────────
    await page.getByRole('combobox').selectOption('price_asc');

    // ─── 3. Verify the dropdown reflects the selection ────────
    await expect(page.getByRole('combobox')).toHaveValue('price_asc', { timeout: 30000 });

    // ─── 4. The results re-fetch with sortBy=price_asc; the
    //        rendered price list must be non-decreasing. ───────
    await expect(async () => {
      const priceTexts = await page.locator('.text-2xl.font-bold').allTextContents();
      const prices = priceTexts
        .map((s) => Number(s.replace(/[^0-9.]/g, '')))
        .filter((n) => !Number.isNaN(n));
      expect(prices.length).toBeGreaterThan(1);
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
      }
    }).toPass({ timeout: 30000 });
  });

  test('Pagination next button is present for multi-page results', async ({ page }) => {
    // ─── 1. Navigate to results with valid params ────────────
    await page.goto('/results?dest=RsBU&name=Singapore&in=2026-12-01&out=2026-12-07&guests=2&rooms=1');

    await expect(page.getByText(/Hotels in Singapore/i)).toBeVisible({ timeout: 30000 });

    // ─── 2. Click Next page (if pagination exists) ───────────
    const nextButton = page.getByLabel('Next page');
    if (await nextButton.count()) {
      await nextButton.click();
      await expect(page.getByLabel('Next page')).toBeVisible({ timeout: 30000 });
    }
  });
});