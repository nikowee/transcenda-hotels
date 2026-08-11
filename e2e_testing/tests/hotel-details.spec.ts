import { test, expect, type Page } from '@playwright/test';

const SEARCH_PARAMS = 'dest=RsBU&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1';
const DETAILS_URL = `/hotel/e2e-hotel?${SEARCH_PARAMS}`;

//the live Ascenda search and room poll are slow, so the journey test needs
//more than the default 30s budget
const LIVE_JOURNEY_TIMEOUT = 120000;

const hotelPayload = {
  id: 'e2e-hotel',
  name: 'E2E Test Hotel',
  address: '1 Test Street, Singapore',
  rating: 5,
  description: 'A calm harbour-side hotel used by the end-to-end suite.',
  latitude: 1.29,
  longitude: 103.85,
  amenities: { airConditioning: true, outdoorPool: true, tennisCourt: false },
  amenities_ratings: [],
  image_details: { prefix: 'https://cdn.example.com/e2e/', suffix: '.jpg', count: 3 },
  trustyou: { score: { overall: 92 } },
  number_reviews: 1847,
};

const roomsPayload = {
  completed: true,
  currency: 'SGD',
  rooms: [
    {
      key: 'rate-deluxe',
      roomDescription: 'Deluxe King Room',
      long_description: '',
      free_cancellation: true,
      rooms_available: 3,
      images: [{ url: 'https://cdn.example.com/room1.jpg', high_resolution_url: '', hero_image: true }],
      amenities: ['WiFi', 'Breakfast'],
      price: 620,
      converted_price: 620,
      points: 1240,
    },
    {
      key: 'rate-suite',
      roomDescription: 'Bay View Suite',
      long_description: '',
      free_cancellation: false,
      rooms_available: 1,
      images: [{ url: 'https://cdn.example.com/room2.jpg', high_resolution_url: '', hero_image: true }],
      amenities: ['Lounge Access'],
      price: 940,
      converted_price: 940,
      points: 1880,
    },
  ],
};

//stubs the two endpoints the details page calls, so these specs exercise the UI
//rather than Ascenda's live latency. The price pattern is registered first and
//the two patterns do not overlap: * never spans a / segment.
async function stubHotelApis(
  page: Page,
  options: { rooms?: unknown; detailsStatus?: number } = {}
): Promise<void> {
  const { rooms = roomsPayload, detailsStatus } = options;

  await page.route('**/api/hotels/*/price*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rooms),
    })
  );

  await page.route('**/api/hotels/*', (route) =>
    route.fulfill({
      status: detailsStatus ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        detailsStatus ? { error: 'Failed to fetch hotel details' } : hotelPayload
      ),
    })
  );
}

test.describe('Hotel Room Details', () => {

  test('Selecting a hotel from the results page opens its details page', async ({ page }) => {
    test.setTimeout(LIVE_JOURNEY_TIMEOUT);

    //start from a valid results page backed by the real search API
    await page.goto(`/results?${SEARCH_PARAMS}`);

    //wait for hotel cards to render
    const selectHotel = page.getByText(/Select Hotel/i).first();
    await expect(selectHotel).toBeVisible({ timeout: 60000 });

    //select the first hotel
    await selectHotel.click();

    //verify redirect to the details route with the search params preserved
    await expect(page).toHaveURL(/\/hotel\/[^/?]+\?/, { timeout: 30000 });
    await expect(page).toHaveURL(/dest=RsBU/);
    await expect(page).toHaveURL(/guests=2/);

    //verify the details page actually renders for the selected hotel
    await expect(page.getByRole('heading', { name: /About this hotel/i })).toBeVisible({ timeout: 60000 });
  });

  test('Details page shows hotel information sections', async ({ page }) => {
    await stubHotelApis(page);

    await page.goto(DETAILS_URL);

    //verify the hotel identity is rendered
    await expect(page.getByRole('heading', { name: 'E2E Test Hotel' })).toBeVisible();
    await expect(page.getByText('1 Test Street, Singapore')).toBeVisible();

    //verify the descriptive sections are rendered
    await expect(page.getByRole('heading', { name: /About this hotel/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Amenities/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Location/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Available rooms/i })).toBeVisible();

    //verify the location map is embedded
    await expect(page.locator('iframe[title="Hotel location"]')).toBeAttached();
    await expect(page.getByRole('link', { name: /Open in Google Maps/i })).toBeVisible();
  });

  test('Guest rating badge is shown when the hotel has a rating', async ({ page }) => {
    await stubHotelApis(page);

    await page.goto(DETAILS_URL);

    //trustyou overall of 92 renders on a ten-point scale
    await expect(page.getByText('9.2')).toBeVisible();
    await expect(page.getByText(/1,847 reviews/i)).toBeVisible();
  });

  test('Room list shows the available rooms', async ({ page }) => {
    await stubHotelApis(page);

    await page.goto(DETAILS_URL);

    //wait for the rooms request to settle
    await expect(page.getByText(/Checking live room rates/i)).toBeHidden();

    //verify each room renders with its price and cancellation terms
    await expect(page.getByText('Deluxe King Room')).toBeVisible();
    await expect(page.getByText('Bay View Suite')).toBeVisible();
    await expect(page.getByText(/S\$620/)).toBeVisible();
    await expect(page.getByText(/Free cancellation/i)).toBeVisible();
  });

  test('Selecting a room proceeds to checkout with the selected room', async ({ page }) => {
    await stubHotelApis(page);

    await page.goto(DETAILS_URL);
    await expect(page.getByText('Deluxe King Room')).toBeVisible();

    //select the first room
    await page.getByRole('button', { name: /^Select$/ }).first().click();

    //the /booking seam validates the params and forwards to checkout,
    //so assert the destination the user actually lands on
    await expect(page).toHaveURL(/\/checkout\?/);
    await expect(page).toHaveURL(/hotelId=e2e-hotel/);
    await expect(page).toHaveURL(/roomTypes=rate-deluxe/);
    await expect(page).toHaveURL(/startDate=2026-08-15/);
    await expect(page).toHaveURL(/endDate=2026-08-20/);
    await expect(page).toHaveURL(/adults=2/);
  });

  test('Selecting the second room carries that room to checkout', async ({ page }) => {
    await stubHotelApis(page);

    await page.goto(DETAILS_URL);
    await expect(page.getByText('Bay View Suite')).toBeVisible();

    //select the second room
    await page.getByRole('button', { name: /^Select$/ }).nth(1).click();

    await expect(page).toHaveURL(/roomTypes=rate-suite/);
  });

  test('No-rooms state offers a way back to the results page', async ({ page }) => {
    //force an empty room list from the API
    await stubHotelApis(page, { rooms: { completed: true, currency: 'SGD', rooms: [] } });

    await page.goto(DETAILS_URL);

    //verify the empty-state message and action
    await expect(page.getByText(/No rooms available for this hotel/i)).toBeVisible();
    const backButton = page.getByRole('button', { name: /Back to results/i });
    await expect(backButton).toBeVisible();

    //verify no room rows were rendered alongside the message
    await expect(page.getByRole('button', { name: /^Select$/ })).toHaveCount(0);
  });

  test('Shows an error page when the hotel details request fails', async ({ page }) => {
    //force the details endpoint to fail
    await stubHotelApis(page, { detailsStatus: 502 });

    await page.goto(DETAILS_URL);

    //verify the failure is surfaced to the user
    await expect(page.getByText(/Failed to load hotel details/i)).toBeVisible();
  });
});
