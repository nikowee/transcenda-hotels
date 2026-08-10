import { test, expect } from '@playwright/test';

test.describe('Integration: User Login Flow', () => {
  // Use the exact credentials of the user you manually verified
  const VERIFIED_EMAIL = 'ezra1909@gmail.com';
  const VALID_PASSWORD = '123456';

  test('Successfully authenticates user, fetches token, and updates UI state', async ({ page }) => {
    
    // ─── 1. The Actual Login Integration ────────────────────────
    await page.goto('/login');
    
    await page.getByPlaceholder(/email/i).fill(VERIFIED_EMAIL);
    await page.getByPlaceholder(/password/i).fill(VALID_PASSWORD);

    // Intercept the network request to prove the app talks to Supabase GoTrue
    const loginRequestPromise = page.waitForRequest(request => 
      request.url().includes('/auth/v1/token') && request.method() === 'POST'
    );

    await page.getByRole('button', { name: /Log In/i }).click();

    // ─── 2. Assert Network & UI State ───────────────────────────
    const loginRequest = await loginRequestPromise;
    expect(loginRequest).toBeTruthy();

    // Verify the UI updates to reflect an authenticated state 
    await expect(page.getByRole('button', { name: /Log Out/i })).toBeVisible({ timeout: 5000 });
  });
});