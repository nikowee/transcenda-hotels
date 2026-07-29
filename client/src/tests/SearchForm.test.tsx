import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import axios from 'axios';
import SearchForm from '../components/SearchForm';

// Mock axios to prevent real API calls during tests
vi.mock('axios');

const mockSuggestions = [
  { uid: 'dest-1', term: 'Singapore, Singapore' },
  { uid: 'dest-2', term: 'Singapore, Malaysia' },
];

describe('SearchForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Renders all structural elements
  it('renders the search form with all fields', () => {
    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    // Labels are not associated via htmlFor, so use getByText
    expect(screen.getByText('Where')).toBeInTheDocument();
    expect(screen.getByText('Dates')).toBeInTheDocument();
    expect(screen.getByText('Who')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search destinations...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  // Test 2: Updates search input on user typing
  it('updates search input when user types', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    expect(input).toHaveValue('Singapore');
  });

  // Test 3: Shows alert for <2 characters (Boundary Test)
  it('shows alert when typing less than 2 characters', async () => {
    const user = userEvent.setup();
    const alertMock = vi.fn();
    window.alert = alertMock;

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 's');

    const button = screen.getByRole('button', { name: /search/i });
    await user.click(button);

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('Please select a valid destination from the dropdown!')
    );
  });

  // Test 4: Shows alert for check-out before check-in (Negative Test)
  it('shows alert when check-out is before check-in', async () => {
    const user = userEvent.setup();
    const alertMock = vi.fn();
    window.alert = alertMock;
    vi.mocked(axios.get).mockResolvedValue({ data: mockSuggestions });

    const { container } = render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    // First, select a destination to pass the first validation (!selectedDestId)
    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    await waitFor(() => {
      expect(screen.getByText('Singapore, Singapore')).toBeInTheDocument();
    }, { timeout: 500 });

    await user.click(screen.getByText('Singapore, Singapore'));

    // Now set dates: check-in before check-out (invalid)
    const dateInputs = container.querySelectorAll('input[type="date"]');
    const checkInInput = dateInputs[0];
    const checkOutInput = dateInputs[1];

    await user.clear(checkInInput);
    await user.type(checkInInput, '2026-08-15');
    await user.clear(checkOutInput);
    await user.type(checkOutInput, '2026-08-10');

    const button = screen.getByRole('button', { name: /search/i });
    await user.click(button);

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('Check-out date must be after Check-in date.')
    );
  });

  // Test 5: Shows suggestions after debounce (Async)
  it('shows suggestions after typing (with debounce)', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockResolvedValue({ data: mockSuggestions });

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    // Wait for debounce (300ms + buffer)
    await waitFor(() => {
      expect(screen.getByText('Singapore, Singapore')).toBeInTheDocument();
    }, { timeout: 500 });
  });

  // Test 6: Clears suggestions when input cleared (Edge Case)
  it('clears suggestions when input is cleared', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockResolvedValue({ data: mockSuggestions });

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    await waitFor(() => {
      expect(screen.getByText('Singapore, Singapore')).toBeInTheDocument();
    }, { timeout: 500 });

    // Clear input
    await user.clear(input);

    // Suggestions should disappear
    await waitFor(() => {
      expect(screen.queryByText('Singapore, Singapore')).not.toBeInTheDocument();
    });
  });
});