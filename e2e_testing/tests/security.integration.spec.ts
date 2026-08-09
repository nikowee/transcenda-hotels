import { test, expect } from '@playwright/test';

test.describe('Integration: Supabase Security & Authentication', () => {
  
  test('System actively rejects invalid credentials and prevents session creation', async ({ page }) => {
    
    // ─── 1. Attempt to breach the login with fake credentials ───
    await page.goto('/login');
    
    await page.getByPlaceholder(/email/i).fill('malicious.actor@transcenda.com');
    await page.getByPlaceholder(/password/i).fill('TotallyWrongPassword123!');

    // ─── 2. Intercept the network request to prove Supabase blocks it ───
    // We listen for the specific response from Supabase's auth endpoint
    const authResponsePromise = page.waitForResponse(response => 
      response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
    );

    await page.getByRole('button', { name: /Log In/i }).click();
    const authResponse = await authResponsePromise;

    // ─── 3. Assert the Security Integration ──────────────────────
    
    // Prove the Supabase backend explicitly rejected the request (Status 400 Bad Request)
    expect(authResponse.status()).toBe(400);
    
    // Prove the frontend accurately caught the error and displayed it to the user
    // (Adjust the regex text to match exactly what your UI displays on a failed login)
    await expect(page.getByText(/User not found or incorrect password/i)).toBeVisible({ timeout: 5000 });

    // Prove the security block held firm and the protected "Log Out" button was never rendered
    await expect(page.getByRole('button', { name: /Log Out/i })).toBeHidden();
  });
});