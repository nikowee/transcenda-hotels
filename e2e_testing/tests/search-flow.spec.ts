import { test, expect } from '@playwright/test';

test.describe('Search Flow', () => {
  
  test('User can search for a destination and see results', async ({ page }) => {
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
  });

  test('User can search with typo tolerance', async ({ page }) => {
    // ─── 1. Navigate to home ───────────────────────────────
    await page.goto('/');
    
    // ─── 2. Type with a typo ───────────────────────────────
    const searchInput = page.getByPlaceholder('Search destinations...');
    await searchInput.fill('sinagpore');  // Typo: "sinagpore" instead of "Singapore"
    
    // ─── 3. Suggestions should still show Singapore ──────────
    await expect(page.getByText('Singapore, Singapore', { exact: true })).toBeVisible({ timeout: 5000 });
    
    // ─── 4. Select it ───────────────────────────────────────
    await page.getByText('Singapore, Singapore', { exact: true }).click();
    
    // ─── 5. Verify input was filled correctly ──────────────
    await expect(searchInput).toHaveValue('Singapore, Singapore');
  });
});