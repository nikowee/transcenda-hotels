import { test, expect } from '@playwright/test';
import { CHECK_IN, CHECK_OUT_TOO_EARLY } from './fixtures/dates.js';

test.describe('Error Handling', () => {
  
  test('Shows validation errors for empty search', async ({ page }) => {
    // ─── 1. Capture the alert, assert in the body ────────────
    // The handler must stay — registering a dialog listener disables
    // auto-dismiss, so click() cannot resolve until something accepts. But an
    // expectation *inside* it is silent when no dialog fires: the handler never
    // runs, nothing is asserted, and the test reports green.
    let alertMessage = '';
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    // ─── 2. Navigate to home ───────────────────────────────
    await page.goto('/');

    // ─── 3. Click search without selecting anything ──────────
    await page.getByRole('button', { name: /search/i }).click();

    // ─── 4. The guard fired, and nothing navigated ───────────
    expect(alertMessage).toContain('Please select a valid destination from the dropdown!');
    await expect(page).not.toHaveURL(/\/results/);
  });

  test('Shows validation errors for invalid dates', async ({ page }) => {
    // ─── 1. Handle alert dialog ──────────────────────────────
    let alertMessage = '';
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
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
    await dateInputs.first().fill(CHECK_IN);
    await dateInputs.last().fill(CHECK_OUT_TOO_EARLY);  // ❌ Before check-in
    
    // ─── 5. Click search ────────────────────────────────────
    await page.getByRole('button', { name: /search/i }).click();

    // ─── 6. The guard fired, and nothing navigated ───────────
    expect(alertMessage).toContain('Check-out date must be after Check-in date.');
    await expect(page).not.toHaveURL(/\/results/);
  });

  test('Login and Signup buttons redirect to respective pages', async ({ page }) => {
    // ─── 1. Navigate to home ───────────────────────────────
    await page.goto('/');
    
    // ─── 2. Click Log In and verify redirect to /login ───────
    await page.getByRole('link', { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    
    // ─── 3. Navigate back to home ──────────────────────────
    await page.goto('/');
    
    // ─── 4. Click Sign Up and verify redirect to /signup ─────
    await page.getByRole('link', { name: /sign up/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
});
