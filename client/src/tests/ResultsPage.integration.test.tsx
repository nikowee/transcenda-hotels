import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import ResultsPage from '../pages/ResultsPage';

// Helper to render ResultsPage with URL params
function renderWithParams(params: string = '') {
  const initialEntries = params ? [`/?${params}`] : ['/'];
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ResultsPage />
    </MemoryRouter>
  );
}

describe('ResultsPage Integration Tests (MSW)', () => {
  // Test 1: Successful search returns hotels
  it('fetches and displays hotels when page loads', async () => {
    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for hotels to appear (MSW intercepts the request)
    await waitFor(() => {
      expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    });

    // Verify multiple hotels are displayed
    expect(screen.getByText('Hotel Boss')).toBeInTheDocument();
    expect(screen.getByText('Shangri-La Singapore')).toBeInTheDocument();

    // Search summary should be shown
    expect(screen.getByText(/Hotels in Singapore/i)).toBeInTheDocument();
    expect(screen.getByText(/5 hotels found/i)).toBeInTheDocument();

    // Each hotel should have a "Select Hotel" button
    const selectButtons = screen.getAllByText(/Select Hotel/i);
    expect(selectButtons.length).toBeGreaterThanOrEqual(5);
  });

  // Test 2: Network error shows error UI
  it('handles network errors gracefully', async () => {
    const consoleErrorMock = vi.fn();
    console.error = consoleErrorMock;

    // Override the handler to simulate a network error
    server.use(
      http.get('http://localhost:5000/api/hotels/search', () => {
        return HttpResponse.error();
      })
    );

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Should show error UI
    await waitFor(() => {
      expect(screen.getByText(/Oops!/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to load hotels/i)).toBeInTheDocument();
    expect(screen.getByText(/Go Back/i)).toBeInTheDocument();

    // Error should be logged
    await waitFor(() => {
      expect(consoleErrorMock).toHaveBeenCalled();
    });
  });

  // Test 3: Empty results shows "no hotels" message
  it('shows empty state when no hotels match', async () => {
    // Override handler to return empty results
    server.use(
      http.get('http://localhost:5000/api/hotels/search', () => {
        return HttpResponse.json({
          hotels: [],
          total: 0,
          page: 1,
          pageSize: 10,
          totalPages: 0,
        });
      })
    );

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    await waitFor(() => {
      expect(screen.getByText(/No hotels match your filters/i)).toBeInTheDocument();
    });
  });

  // Test 4: Pagination navigation works
  it('navigates between pages when pagination is clicked', async () => {
    // Override handler to return multi-page results (page 1 of 3)
    const manyHotels = Array.from({ length: 25 }, (_, i) => ({
      id: `hotel-${i + 1}`,
      name: `Hotel ${i + 1}`,
      price: 100 + i * 10,
      searchRank: i + 1,
      rating: (i % 5) + 1,
      categories: ['Budget'],
      address: `${i + 1} Test St, Singapore`,
      latitude: 1.3,
      longitude: 103.8,
      description: 'A test hotel.',
      amenities: ['WiFi'],
      images: [],
    }));

    server.use(
      http.get('http://localhost:5000/api/hotels/search', ({ request }) => {
        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const pageSize = 10;
        const start = (page - 1) * pageSize;
        const paginatedHotels = manyHotels.slice(start, start + pageSize);

        return HttpResponse.json({
          hotels: paginatedHotels,
          total: 25,
          page,
          pageSize,
          totalPages: 3,
        });
      })
    );

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for page 1 hotels to load
    await waitFor(() => {
      expect(screen.getByText('Hotel 1')).toBeInTheDocument();
    });

    // Should show page 1 hotels (Hotel 1 through Hotel 10)
    expect(screen.getByText('Hotel 10')).toBeInTheDocument();
    expect(screen.queryByText('Hotel 11')).not.toBeInTheDocument();

    // Click page 2
    const page2Button = screen.getByText('2');
    await userEvent.click(page2Button);

    // Should now show page 2 hotels (Hotel 11 through Hotel 20)
    await waitFor(() => {
      expect(screen.getByText('Hotel 11')).toBeInTheDocument();
    });

    expect(screen.getByText('Hotel 20')).toBeInTheDocument();
    expect(screen.queryByText('Hotel 1')).not.toBeInTheDocument();
  });
});