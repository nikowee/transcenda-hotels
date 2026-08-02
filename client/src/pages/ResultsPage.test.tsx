import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter} from 'react-router';
import axios from 'axios';
import ResultsPage from './ResultsPage';

// Mock axios to prevent real API calls during tests
vi.mock('axios');

// Mock useNavigate to track navigation
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockHotels = [
  {
    id: 'hotel-1',
    name: 'Marina Bay Sands',
    price: 450,
    searchRank: 1,
    rating: 5,
    categories: ['Luxury', 'City'],
    address: '10 Bayfront Ave, Singapore',
    latitude: 1.2837,
    longitude: 103.8591,
    description: 'Iconic luxury hotel with infinity pool.',
    amenities: ['Pool', 'Spa', 'Gym', 'Restaurant'],
    images: ['https://example.com/mbs.jpg'],
  },
  {
    id: 'hotel-2',
    name: 'Hotel Boss',
    price: 120,
    searchRank: 2,
    rating: 3,
    categories: ['Budget', 'City'],
    address: '500 Jalan Sultan, Singapore',
    latitude: 1.3057,
    longitude: 103.8619,
    description: 'Affordable stay in the city center.',
    amenities: ['WiFi', 'Restaurant'],
    images: [],
  },
];

const mockSearchResponse = {
  data: {
    hotels: mockHotels,
    total: 2,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  },
};

// Helper to render ResultsPage with URL params
function renderWithParams(params: string = '') {
  const initialEntries = params ? [`/?${params}`] : ['/'];
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ResultsPage />
    </MemoryRouter>
  );
}

describe('ResultsPage Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Renders loading state
  it('renders loading skeleton while fetching', () => {
    // Don't resolve the axios mock so loading persists
    vi.mocked(axios.get).mockImplementationOnce(() => new Promise(() => {}));

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // The loading state shows skeleton cards with animate-pulse class
    const skeletonCards = document.querySelectorAll('.animate-pulse');
    expect(skeletonCards.length).toBeGreaterThan(0);
  });

  // Test 2: Renders error state for missing params
  it('renders error when search parameters are missing', () => {
    renderWithParams('');

    expect(screen.getByText(/Missing search parameters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go Back/i })).toBeInTheDocument();
  });

  // Test 3: Renders error state on API failure
  it('renders error when API call fails', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network Error'));

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    await waitFor(() => {
      expect(screen.getByText(/Oops!/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to load hotels/i)).toBeInTheDocument();
    expect(screen.getByText(/Go Back/i)).toBeInTheDocument();
  });

  // Test 4: Renders hotels successfully
  it('renders hotel cards when API returns results', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce(mockSearchResponse);

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for hotels to appear
    await waitFor(() => {
      expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    });

    expect(screen.getByText('Hotel Boss')).toBeInTheDocument();
    // Search summary should be shown
    expect(screen.getByText(/Hotels in Singapore/i)).toBeInTheDocument();
    expect(screen.getByText(/2 hotels found/i)).toBeInTheDocument();
    // Each hotel should have a "Select Hotel" button
    const selectButtons = screen.getAllByText(/Select Hotel/i);
    expect(selectButtons).toHaveLength(2);
  });

  // Test 5: Renders empty results
  it('renders empty state when no hotels match', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        hotels: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      },
    });

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    await waitFor(() => {
      expect(screen.getByText(/No hotels match your filters/i)).toBeInTheDocument();
    });
  });

  // Test 6: Pagination appears for multi-page results
  it('renders pagination when there are multiple pages', async () => {
    // Create 15 hotels to get 2 pages (pageSize=10)
    const manyHotels = Array.from({ length: 15 }, (_, i) => ({
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

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        hotels: manyHotels.slice(0, 10),
        total: 15,
        page: 1,
        pageSize: 10,
        totalPages: 2,
      },
    });

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    await waitFor(() => {
      expect(screen.getByText('Hotel 1')).toBeInTheDocument();
    });

    // Pagination should be visible
    expect(screen.getByLabelText(/Previous page/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Next page/i)).toBeInTheDocument();
    // Page 1 and 2 buttons should exist
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  // Test 7: Apply filters triggers re-fetch
  it('re-fetches hotels when filters are applied', async () => {
    // Mock needs to resolve for both the initial load and the filter-triggered re-fetch
    vi.mocked(axios.get).mockResolvedValue(mockSearchResponse);

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    });

    // Find the 5-star button by its exact label. The buttons read "5★", not
    // "5★+" — the filter is exact-match server-side (hotelController), and the
    // label was aligned with that.
    const starButtons = screen.getAllByRole('button', { name: '5★' });
    await userEvent.click(starButtons[0]);

    // Click Apply Filters
    const applyButton = screen.getByText('Apply Filters');
    await userEvent.click(applyButton);

    // Should have made a second API call with filter params
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    // The second call should include starRating=5
    const secondCall = vi.mocked(axios.get).mock.calls[1];
    expect(secondCall[1]?.params?.starRating).toBe(5);
  });

  // Test 8: Clear filters resets state
  it('resets filters and re-fetches when Clear is clicked', async () => {
    vi.mocked(axios.get).mockResolvedValue(mockSearchResponse);

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    });

    // Apply a filter first by clicking the 5-star button (exact label, no '+')
    const starButtons = screen.getAllByRole('button', { name: '5★' });
    await userEvent.click(starButtons[0]);

    const applyButton = screen.getByText('Apply Filters');
    await userEvent.click(applyButton);

    // Wait for the filtered call (second call)
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    // Now clear filters
    const clearButton = screen.getByText('Clear');
    await userEvent.click(clearButton);

    // Should have made a third API call
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(3);
    });
  });

  // Test 9: Sort change triggers re-fetch
  it('re-fetches hotels when sort option changes', async () => {
    vi.mocked(axios.get).mockResolvedValue(mockSearchResponse);

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    });

    // Change sort dropdown to "Price: Low to High"
    const sortSelect = screen.getByRole('combobox');
    await userEvent.selectOptions(sortSelect, 'price_asc');

    // Should have made a second API call with sortBy=price_asc
    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    const secondCall = vi.mocked(axios.get).mock.calls[1];
    expect(secondCall[1]?.params?.sortBy).toBe('price_asc');
  });

  // Test 10: Hotel selection navigates
  it('navigates to hotel detail page when Select Hotel is clicked', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce(mockSearchResponse);

    renderWithParams('dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1');

    // Wait for hotels to load
    await waitFor(() => {
      expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    });

    // Click "Select Hotel" on the first hotel
    const selectButtons = screen.getAllByText(/Select Hotel/i);
    await userEvent.click(selectButtons[0]);

    // useNavigate should have been called with the hotel detail URL
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/hotel/hotel-1?dest=dest-1&name=Singapore&in=2026-08-15&out=2026-08-20&guests=2&rooms=1'
      );
    });
  });
});