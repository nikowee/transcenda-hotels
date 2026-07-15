import { test, expect } from '@playwright/test';

test.describe('Error Handling', () => {
  
  test('Shows validation errors for empty search', async ({ page }) => {
    // ─── 1. Handle the alert dialog ──────────────────────────
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Please select a valid destination from the dropdown!');
      await dialog.accept();
    });
    
    // ─── 2. Navigate to home ───────────────────────────────
    await page.goto('/');
    
    // ─── 3. Click search without selecting anything ──────────
    await page.getByRole('button', { name: /search/i }).click();
  });

  test('Shows validation errors for invalid dates', async ({ page }) => {
    // ─── 1. Handle alert dialog ──────────────────────────────
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Check-out date must be after Check-in date.');
      await dialog.accept();
    });
    
    // ─── 2. Navigate to home ───────────────────────────────
    await page.goto('/');
    
    // ─── 3. Type and select a destination ──────────────────
    const searchInput = page.getByPlaceholder('Search destinations...');
    await searchInput.fill('Singapore');
    await expect(page.getByText('Singapore, Singapore', { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByText('Singapore, Singapore', { exact: true }).click();
    
    // ─── 4. Set invalid dates (check-out before check-in) ──
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.first().fill('2026-08-15');
    await dateInputs.last().fill('2026-08-10');  // ❌ Before check-in
    
    // ─── 5. Click search ────────────────────────────────────
    await page.getByRole('button', { name: /search/i }).click();
  });

  test('Login and Signup buttons show alerts', async ({ page }) => {
    // ─── 1. Navigate to home ───────────────────────────────
    await page.goto('/');
    
    // ─── 2. Handle login dialog ──────────────────────────────
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Login Modal will open here!');
      await dialog.accept();
    });
    await page.getByRole('button', { name: /log in/i }).click();
    
    // ─── 3. Handle signup dialog ─────────────────────────────
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Signup Modal will open here!');
      await dialog.accept();
    });
    await page.getByRole('button', { name: /sign up/i }).click();
  });
});
