import { test, expect } from '@playwright/test';

test.describe('Signup Error Handling - Gibberish Email', () => {
  test('Shows an error message when signing up with gibberish format or failed backend response', async ({ page }) => {
    // ─── 1. Navigate to signup page ─────────────────────────
    await page.goto('/signup');

    // ─── 2. Fill inputs with random gibberish format ────────
    await page.getByPlaceholder('Email').fill('not-a-valid-email-string');
    await page.getByPlaceholder('Password').fill('SecurePassword123!');

    // ─── 3. Click submit button ─────────────────────────────
    await page.getByRole('button', { name: /Sign Up/i }).click();

    // ─── 4. Verify validation or rejection error shows up ───
    const errorMessage = page.locator('text=/Unable to validate|Signup failed|invalid|not valid|format/i');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });
});