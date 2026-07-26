import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import SearchForm from '../components/SearchForm';

describe('SearchForm Integration Tests (MSW)', () => {
  it('fetches and displays suggestions when user types', async () => {
    const user = userEvent.setup();
    
    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    // Wait for suggestions to appear (MSW intercepts the request)
    await waitFor(() => {
      expect(screen.getByText('Singapore, Singapore')).toBeInTheDocument();
      expect(screen.getByText('Singapore, Malaysia')).toBeInTheDocument();
    });
  });

  it('returns empty array when query is less than 2 characters', async () => {
    const user = userEvent.setup();
    
    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 's');

    // No suggestions should appear (MSW returns empty array)
    await waitFor(() => {
      expect(screen.queryByText('Singapore, Singapore')).not.toBeInTheDocument();
    });
  });

  it('handles network errors gracefully', async () => {
    const user = userEvent.setup();
    const consoleErrorMock = vi.fn();
    console.error = consoleErrorMock;

    // Override the handler to simulate a network error
    server.use(
      http.get('http://localhost:5000/api/destinations/search', () => {
        return HttpResponse.error();
      })
    );

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    await user.type(input, 'Singapore');

    // Should not show suggestions (error handled gracefully)
    // Wait for debounce (300ms) + API call to complete
    await waitFor(() => {
      expect(screen.queryByText('Singapore, Singapore')).not.toBeInTheDocument();
    });

    // Error should be logged (wait for axios catch block to fire)
    await waitFor(() => {
      expect(consoleErrorMock).toHaveBeenCalled();
    });
  });

  it('debounces requests (only makes one request after typing stops)', async () => {
    const user = userEvent.setup();
    
    // Track how many times the handler is called
    let callCount = 0;
    server.use(
      http.get('http://localhost:5000/api/destinations/search', () => {
        callCount++;
        return HttpResponse.json([]);
      })
    );

    render(
      <MemoryRouter>
        <SearchForm />
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/search destinations/i);
    
    // Type rapidly (should only trigger 1 request after debounce)
    await user.type(input, 'S');
    await user.type(input, 'i');
    await user.type(input, 'n');
    await user.type(input, 'g');
    await user.type(input, 'a');
    await user.type(input, 'p');
    await user.type(input, 'o');
    await user.type(input, 'r');
    await user.type(input, 'e');

    // Wait for debounce to finish
    await waitFor(() => {
      // Only 1 request should have been made
      expect(callCount).toBe(1);
    }, { timeout: 500 });
  });
});