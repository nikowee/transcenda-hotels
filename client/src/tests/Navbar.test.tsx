// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import LandingPage from '../pages/LandingPage';
import { supabase } from '../lib/supabaseClient';

// Mock Supabase SDK
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

// Mock SearchForm to isolate the Navbar/LandingPage testing from form logic
vi.mock('../components/SearchForm', () => ({
  default: () => <div data-testid="mock-search-form" />
}));

describe('Navbar Component Unit Tests (in LandingPage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Verify Unauthenticated State
  it('renders logged out state by default (Login and Signup links)', async () => {
    // Scenario: User is not signed in
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
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

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Log In/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /Sign Up/i })).toBeDefined();
    });

    expect(screen.queryByRole('button', { name: /Log Out/i })).toBeNull();
  });

  // 2. Verify Authenticated State
  it('renders logged in state dynamically (User Pill and Logout button)', async () => {
    // Scenario: User has an active session
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

    await waitFor(() => {
      expect(screen.getByText('traveler@transcenda.com')).toBeDefined();
      expect(screen.getByRole('button', { name: /Log Out/i })).toBeDefined();
    });

    expect(screen.queryByRole('link', { name: /Log In/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Sign Up/i })).toBeNull();
  });

  // 3. Verify Logout Interaction
  it('triggers supabase.auth.signOut when the Log Out button is clicked', async () => {
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

    await waitFor(() => screen.getByRole('button', { name: /Log Out/i }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));

    expect(supabase.auth.signOut).toHaveBeenCalledOnce();
  });

  // 4. Verify Auth Listener Subscription
  it('registers an auth state change listener on mount', async () => {
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as any);

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    expect(supabase.auth.onAuthStateChange).toHaveBeenCalled();
  });

  // 5. Verify Resilience against API Failures
  it('handles sign out errors gracefully without crashing the UI', async () => {
    // Scenario: Session exists, but the sign-out action returns an error response
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { user: { id: 'user-123' } } },
      error: null,
    } as any);
    
    // Supabase SDK methods return an error object rather than throwing exceptions
    vi.mocked(supabase.auth.signOut).mockResolvedValue({
      error: { message: 'Network error' },
    } as any);

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByRole('button', { name: /Log Out/i }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));

    await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Log Out/i })).toBeDefined();
  });
});