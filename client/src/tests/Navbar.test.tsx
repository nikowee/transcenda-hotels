import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import LandingPage from '../pages/LandingPage';
import { supabase } from '../lib/supabaseClient';

// Mock Supabase
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

// Mock SearchForm to isolate Navbar testing
vi.mock('../components/SearchForm', () => ({
  default: () => <div data-testid="mock-search-form" />
}));

describe('Navbar Component Unit Tests (in LandingPage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders logged out state by default (Login and Signup links)', async () => {
    // Mock getSession to return null (no active session)
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as any);

    // Mock the listener setup
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    // Wait for the async useEffect to process
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Log In/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /Sign Up/i })).toBeDefined();
    });

    // Ensure the authenticated UI elements are not present
    expect(screen.queryByRole('button', { name: /Log Out/i })).toBeNull();
  });

  it('renders logged in state dynamically (User Pill and Logout button)', async () => {
    // Mock getSession to return an active user session
    const mockUser = { id: 'user-123', email: 'traveler@transcenda.com' };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: mockUser } },
      error: null,
    } as any);

    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    // Wait for the async useEffect to update the state
    await waitFor(() => {
      // The user pill should display the email
      expect(screen.getByText('traveler@transcenda.com')).toBeDefined();
      expect(screen.getByRole('button', { name: /Log Out/i })).toBeDefined();
    });

    // Ensure public links are hidden
    expect(screen.queryByRole('link', { name: /Log In/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Sign Up/i })).toBeNull();
  });

  it('triggers supabase.auth.signOut when the Log Out button is clicked', async () => {
    // Start with a logged-in state
    const mockUser = { id: 'user-123', email: 'traveler@transcenda.com' };
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: mockUser } },
      error: null,
    } as any);
    
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    // Wait for the button to appear in the DOM
    await waitFor(() => screen.getByRole('button', { name: /Log Out/i }));
    
    // Simulate user click
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));

    // Assert the Supabase SDK was called correctly
    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });
});