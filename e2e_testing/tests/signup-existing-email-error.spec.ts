import { test, expect } from '@playwright/test';

test.describe('Signup Error Handling - Existing Email', () => {
  test('Shows an error message when trying to sign up with an already approved/existing email', async ({ page }) => {
    // ─── 0. Generate a unique email for this specific test run 
    const uniqueEmail = `existing.user.${Date.now()}@transcenda.com`;

    // ─── 1. Navigate to signup page ─────────────────────────
    await page.goto('/signup');

    // ─── 2. Register for the FIRST time (creates the user) ──
    await page.getByPlaceholder('Email').fill(uniqueEmail);
    await page.getByPlaceholder('Password').fill('Password123!');
    await page.getByRole('button', { name: /Sign Up/i }).click();

    // Wait for the success message to ensure they are in the DB
    await expect(page.locator('text=/Signup successful/i')).toBeVisible({ timeout: 5000 });

    // ─── 3. Refill the inputs with the EXACT same email ─────
    // (The form clears on success, so we must type it again)
    await page.getByPlaceholder('Email').fill(uniqueEmail);
    await page.getByPlaceholder('Password').fill('Password123!');
    await page.getByRole('button', { name: /Sign Up/i }).click();

    // ─── 4. Verify duplicate registration error message shows ──
    const errorMessage = page.locator('text=/already registered|already exists/i');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });
  });
});