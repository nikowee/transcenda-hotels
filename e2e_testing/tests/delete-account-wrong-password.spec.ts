import { test, expect } from '@playwright/test';

test.describe('Account Deletion Error Handling - Wrong Password', () => {
  test('Shows error message and prevents account deletion when an incorrect password is provided', async ({ page }) => {
    // ─── 0. Generate Credentials ────────────────────────────────
    const uniqueEmail = `delete.wrongpass.${Date.now()}@transcenda.com`;
    const correctPassword = 'Password123!';
    const wrongPassword = 'WrongPassword999!';

    // ─── 1. Register a Fresh User ───────────────────────────────
    await page.goto('/signup');
    await page.getByPlaceholder('Email').fill(uniqueEmail);
    await page.getByPlaceholder('Password').fill(correctPassword);
    await page.getByRole('button', { name: /Sign Up/i }).click();

    // Wait for signup success box
    await expect(page.locator('text=/successful/i')).toBeVisible({ timeout: 5000 });

    // ─── 2. Log In ──────────────────────────────────────────────
    await page.goto('/login');
    await page.getByPlaceholder('Email').fill(uniqueEmail);
    await page.getByPlaceholder('Password').fill(correctPassword);
    await page.getByRole('button', { name: /Log In/i }).click();

    // Confirm session is active
    await expect(page.getByRole('button', { name: /Log Out/i })).toBeVisible();

    // ─── 3. Open Profile & Open Layer 2 Deletion Prompt ─────────
    await page.getByText(uniqueEmail).click();
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();

    // Click Danger Zone delete button
    await page.getByRole('button', { name: 'Delete Account' }).click();

    // Assert Layer 2 modal is open
    await expect(page.getByRole('heading', { name: 'Are you absolutely sure?' })).toBeVisible();

    // ─── 4. Enter WRONG Password and Submit ──────────────────────
    await page.getByPlaceholder('Enter your password').fill(wrongPassword);
    await page.getByRole('button', { name: 'Confirm Deletion' }).click();

    // ─── 5. Assert Rejection Error Banner & Session Security ────
    const errorMessage = page.locator('text=/Incorrect password/i');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    // Confirm that the user remains on the prompt and wasn't logged out
    await expect(page.getByRole('heading', { name: 'Are you absolutely sure?' })).toBeVisible();
  });
});