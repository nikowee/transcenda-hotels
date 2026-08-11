import { test, expect } from '@playwright/test';

const SEARCH_PARAMS = 'dest=RsBU&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1';

test.describe('Hotel Room Details', () => {

  test('Selecting a hotel from the results page opens its details page', async ({ page }) => {
    //start from a valid results page
    await page.goto(`/results?${SEARCH_PARAMS}`);

    //wait for hotel cards to render
    const selectHotel = page.getByText(/Select Hotel/i).first();
    await expect(selectHotel).toBeVisible({ timeout: 20000 });

    //select the first hotel
    await selectHotel.click();

    //verify redirect to the details route with params
    await expect(page).toHaveURL(/\/hotel\/[^/?]+\?/, { timeout: 20000 });
    await expect(page).toHaveURL(/dest=RsBU/);
    await expect(page).toHaveURL(/guests=2/);
  });

  test('Details page shows hotel information sections', async ({ page }) => {
    //reach the details page through the results page
    await page.goto(`/results?${SEARCH_PARAMS}`);
    await page.getByText(/Select Hotel/i).first().click({ timeout: 20000 });
    await expect(page).toHaveURL(/\/hotel\//, { timeout: 20000 });

    //verify the descriptive sections are rendered
    await expect(page.getByRole('heading', { name: /About this hotel/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: /Location/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Available rooms/i })).toBeVisible();

    //verify the location map is embedded
    await expect(page.frameLocator('iframe[title="Hotel location"]').locator('body')).toBeAttached();
    await expect(page.getByRole('link', { name: /Open in Google Maps/i })).toBeVisible();
  });

  test('Room list resolves to either room options or a no-rooms message', async ({ page }) => {
    //navigate to a hotel details page
    await page.goto(`/results?${SEARCH_PARAMS}`);
    await page.getByText(/Select Hotel/i).first().click({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: /Available rooms/i })).toBeVisible({ timeout: 20000 });

    //wait for the rooms poll to settle
    await expect(page.getByText(/Checking live room rates/i)).toBeHidden({ timeout: 45000 });

    //either outcome is valid, but one must be shown
    const selectRoom = page.getByRole('button', { name: /^Select$/ }).first();
    const noRooms = page.getByText(/No rooms available for this hotel/i);
    await expect(selectRoom.or(noRooms)).toBeVisible({ timeout: 20000 });
  });

  test('Selecting a room proceeds to the booking page with a room key', async ({ page }) => {
    //navigate to a hotel details page
    await page.goto(`/results?${SEARCH_PARAMS}`);
    await page.getByText(/Select Hotel/i).first().click({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: /Available rooms/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Checking live room rates/i)).toBeHidden({ timeout: 45000 });

    //skip when this hotel has no availability
    const selectRoom = page.getByRole('button', { name: /^Select$/ }).first();
    if (!(await selectRoom.isVisible())) {
      test.skip(true, 'No rooms returned for these dates');
    }

    //select a room
    await selectRoom.click();

    // Verify the handoff carries the room key. Asserted on the settled URL,
    // not on /booking?key=…: BookingEntry is a pure redirect, so that address
    // survives about one render before becoming /checkout?roomTypes=… and any
    // assertion against it races the redirect.
    await expect(page).toHaveURL(/\/checkout\?/, { timeout: 20000 });
    await expect(page).toHaveURL(/roomTypes=/);
    await expect(page).toHaveURL(/hotelId=/);
  });

  test('No-rooms state offers a way back to the results page', async ({ page }) => {
    //force an empty room list from the API
    await page.route('**/api/hotels/*/price*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ completed: true, currency: 'SGD', rooms: [] }),
      })
    );

    //navigate to a hotel details page
    await page.goto(`/results?${SEARCH_PARAMS}`);
    await page.getByText(/Select Hotel/i).first().click({ timeout: 20000 });

    //verify the empty-state message and action
    await expect(page.getByText(/No rooms available for this hotel/i)).toBeVisible({ timeout: 20000 });
    const backButton = page.getByRole('button', { name: /Back to results/i });
    await expect(backButton).toBeVisible();

    //verify it returns the user to the results page
    await backButton.click();
    await expect(page).toHaveURL(/\/results/, { timeout: 20000 });
  });

  test('Shows an error page when the hotel details request fails', async ({ page }) => {
    //force the details endpoint to fail
    await page.route('**/api/hotels/*', (route) => {
      if (route.request().url().includes('/price')) return route.fallback();
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to fetch hotel details' }),
      });
    });

    //navigate straight to a hotel details URL
    await page.goto(`/hotel/does-not-exist?${SEARCH_PARAMS}`);

    //verify the failure is surfaced to the user
    await expect(page.getByText(/Failed to load hotel details/i)).toBeVisible({ timeout: 20000 });
  });
});
