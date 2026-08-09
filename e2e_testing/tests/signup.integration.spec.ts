import { test, expect } from '@playwright/test';

test.describe('Integration: User Registration Flow', () => {
  test('Successfully creates a new user in the database and updates UI', async ({ page }) => {
    // 1. Generate a strictly unique email so Supabase always treats it as a new registration
    const uniqueEmail = `integration.test.${Date.now()}@transcenda.com`;
    const password = 'IntegrationSecure123!';

    // 2. Navigate to the actual running application
    await page.goto('/signup');

    // 3. Fill out the form
    await page.getByPlaceholder(/email/i).fill(uniqueEmail);
    await page.getByPlaceholder(/password/i).fill(password);

    // 4. Intercept the network request to prove the app talks to Supabase
    const requestPromise = page.waitForRequest(request => 
      request.url().includes('/auth/v1/signup') && request.method() === 'POST'
    );
    
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/auth/v1/signup') && response.status() === 200
    );

    // 5. Trigger the integration
    await page.getByRole('button', { name: /sign up/i }).click();

    // 6. Assert the Network Layer Integration
    const request = await requestPromise;
    const response = await responsePromise;
    
    expect(request).toBeTruthy();
    expect(response.ok()).toBeTruthy();

    // 7. Assert the Frontend React State Integration (UI Update)
    // Adjust this text to match your actual success banner/redirect!
    await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: 5000 });
  });
});