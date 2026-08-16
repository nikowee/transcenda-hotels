import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import axios from 'axios';
import SearchForm from '../components/SearchForm';

vi.mock('axios');

// Navigation is the only observable success signal — without it a "valid
// submission" test passes even when the form silently rejects the input.
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockSuggestions = [
  { uid: 'dest-1', term: 'Singapore, Singapore' },
  { uid: 'dest-2', term: 'Singapore, Malaysia' },
];

/**
 * Dates relative to the run. SearchForm sets the check-in input's `min` to
 * today + 3, so a hardcoded literal ages into that boundary and the guard
 * under test stops firing — which is exactly how this suite went red.
 */
const daysFromNow = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const CHECK_IN = daysFromNow(30);
const CHECK_OUT = daysFromNow(36);
const CHECK_OUT_TOO_EARLY = daysFromNow(25);

describe('SearchForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    await user.type(checkInInput, CHECK_IN);
    await user.clear(checkOutInput);
    await user.type(checkOutInput, CHECK_OUT_TOO_EARLY);

    const button = screen.getByRole('button', { name: /search/i });
    await user.click(button);

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('Check-out date must be after Check-in date.')
    );
  });

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

  // ── Boundary / robustness ──

  it('shows alert when travel dates are missing', async () => {
    const user = userEvent.setup();
    const alertMock = vi.fn();
    window.alert = alertMock;
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
    await user.click(screen.getByText('Singapore, Singapore'));

    const button = screen.getByRole('button', { name: /search/i });
    await user.click(button);

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('Please select your travel dates.')
    );
  });

  it('shows alert when check-in is less than 3 days from today', async () => {
    const alertMock = vi.fn();
    window.alert = alertMock;
    vi.mocked(axios.get).mockResolvedValue({ data: mockSuggestions });

    const { container } = render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await fireEvent.change(input, { target: { value: 'Singapore' } });
    await waitFor(() => {
      expect(screen.getByText('Singapore, Singapore')).toBeInTheDocument();
    }, { timeout: 500 });
    fireEvent.click(screen.getByText('Singapore, Singapore'));

    // Set check-in to today and check-out to tomorrow. The check-in input has
    // `min` = today+3, so native constraint validation would block a click on
    // the submit button before React's onSubmit ever runs. Dispatch a submit
    // event directly on the <form> to exercise the handler itself.
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: today } });
    fireEvent.change(dateInputs[1], { target: { value: tomorrow } });

    fireEvent.submit(container.querySelector('form')!);

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('Check-in date must be at least 3 days from today.')
    );
  });

  it('does not call the API for whitespace-only input', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, '   ');

    await new Promise((r) => setTimeout(r, 400));
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('calls the API for exactly 2 characters (lower boundary)', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockResolvedValue({ data: mockSuggestions });

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Si');

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalled();
    }, { timeout: 500 });

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('q=Si'));
  });

  it('shows a loading spinner while suggestions are fetching', async () => {
    const user = userEvent.setup();
    // Keep the promise pending so isLoading stays true.
    vi.mocked(axios.get).mockImplementationOnce(() => new Promise(() => {}));

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    // Spinner appears once the 300ms debounce fires and the fetch starts.
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it('selecting a suggestion sets the destination id and closes the dropdown', async () => {
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

    await user.click(screen.getByText('Singapore, Singapore'));

    // Input now reflects the selected suggestion.
    expect(input).toHaveValue('Singapore, Singapore');
    // Dropdown closes.
    await waitFor(() => {
      expect(screen.queryByText('Singapore, Malaysia')).not.toBeInTheDocument();
    });
  });

  it('resets the selected destination id when the user re-types', async () => {
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

    await user.click(screen.getByText('Singapore, Singapore'));
    expect(input).toHaveValue('Singapore, Singapore');

    // Re-type (clears the selection, resets selectedDestId).
    await user.clear(input);
    await user.type(input, 'Tokyo');

    // A submit attempt must go back to the "no destination" alert, proving the
    // previously selected dest id was cleared.
    const alertMock = vi.fn();
    window.alert = alertMock;
    const button = screen.getByRole('button', { name: /search/i });
    await user.click(button);

    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining('Please select a valid destination from the dropdown!')
    );
  });

  it('navigates to /results with the search params on a valid submission', async () => {
    const user = userEvent.setup();
    vi.mocked(axios.get).mockResolvedValue({ data: mockSuggestions });
    const alertMock = vi.fn();
    window.alert = alertMock;

    const { container } = render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');
    await waitFor(() => {
      expect(screen.getByText('Singapore, Singapore')).toBeInTheDocument();
    }, { timeout: 500 });
    await user.click(screen.getByText('Singapore, Singapore'));

    const dateInputs = container.querySelectorAll('input[type="date"]');
    await user.clear(dateInputs[0]);
    await user.type(dateInputs[0], CHECK_IN);
    await user.clear(dateInputs[1]);
    await user.type(dateInputs[1], CHECK_OUT);

    const button = screen.getByRole('button', { name: /search/i });
    await user.click(button);

    expect(alertMock).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      `/results?dest=dest-1&name=${encodeURIComponent('Singapore, Singapore')}` +
        `&in=${CHECK_IN}&out=${CHECK_OUT}&guests=2&rooms=1`
    );
  });
});
