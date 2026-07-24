import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import Login from '../pages/Login';
import Signup from '../pages/Signup';
import { supabase } from '../lib/supabaseClient';

// --- Global Mocks ---
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
  },
}));

// Mock react-router-dom to manipulate useSearchParams for the Login component
let mockSearchParams = new URLSearchParams();
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useSearchParams: () => [mockSearchParams],
    useNavigate: () => mockNavigate,
  };
});

describe('Authentication Components Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams(); // Reset URL params before each test
  });

  // --- Login Tests ---
  describe('<Login /> Component', () => {
    it('renders standard login form elements', () => {
      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      );

      expect(screen.getByPlaceholderText('Email')).toBeDefined();
      expect(screen.getByPlaceholderText('Password')).toBeDefined();
      expect(screen.getByRole('button', { name: /Log In/i })).toBeDefined();
    });

    // FIXED: Made the function async and used await screen.findByText
    it('displays success banner when ?verified=true is in URL', async () => {
      // Simulate the redirect from the backend verification link
      mockSearchParams.set('verified', 'true');
      
      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      );

      // findByText automatically waits for the useEffect to trigger the re-render!
      expect(await screen.findByText(/Verification successful! Please log in/i)).toBeDefined();
    });

    it('displays an error banner for invalid credentials', async () => {
        // Simulate Supabase throwing a credential error
        vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
          data: { user: null, session: null },
          error: { message: 'Invalid login credentials' } as any,
        });
  
        render(
          <MemoryRouter>
            <Login />
          </MemoryRouter>
        );
  
        // Fill form
        fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'wrong@user.com' } });
        fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrongpass' } });
        
        // Submit
        fireEvent.click(screen.getByRole('button', { name: /Log In/i }));
  
        // Assert the custom error boundary is triggered
        expect(await screen.findByText(/User not found or incorrect password/i)).toBeDefined();
      });

    it('calls signInWithPassword with correct credentials on form submit', async () => {
      vi.mocked(supabase.auth.signInWithPassword).mockResolvedValueOnce({
        data: { user: { id: 'user-123' }, session: null },
        error: null,
      } as any);

      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      );

      // Fill form
      fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@transcenda.com' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'SecurePass123!' } });
      
      // Submit
      fireEvent.click(screen.getByRole('button', { name: /Log In/i }));

      await waitFor(() => {
        expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
          email: 'user@transcenda.com',
          password: 'SecurePass123!',
        });
      });
    });
  });

  // --- Signup Tests ---
  describe('<Signup /> Component', () => {
    it('shows green success message and clears inputs on successful signup', async () => {
      vi.mocked(supabase.auth.signUp).mockResolvedValueOnce({
        // A truly new user will have at least one identity in the array
        data: { user: { id: 'new-user', identities: [{ id: 'identity-1' }] }, session: null },
        error: null,
      } as any);

      render(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>
      );

      const emailInput = screen.getByPlaceholderText(/Email/i) as HTMLInputElement;
      const passwordInput = screen.getByPlaceholderText(/Password/i) as HTMLInputElement;
      const submitButton = screen.getByRole('button', { name: /Sign Up/i });

      // Fill form
      fireEvent.change(emailInput, { target: { value: 'new@transcenda.com' } });
      fireEvent.change(passwordInput, { target: { value: 'ValidPass123!' } });
      
      // Submit
      fireEvent.click(submitButton);

      await waitFor(() => {
        // Assert success banner appears
        expect(screen.getByText(/Signup successful! Please check your email/i)).toBeDefined();
        
        // Assert inputs were wiped clean
        expect(emailInput.value).toBe('');
        expect(passwordInput.value).toBe('');
      });
    });

    it('detects existing user via empty identities array to show custom UI message', async () => {
      vi.mocked(supabase.auth.signUp).mockResolvedValueOnce({
        // Simulate Supabase's silent failure for existing users: error is null, but identities is empty []
        data: { user: { id: 'existing-user', identities: [] }, session: null },
        error: null, 
      } as any);

      render(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'existing@transcenda.com' } });
      fireEvent.change(screen.getByPlaceholderText(/Password/i), { target: { value: 'Pass123!' } });
      fireEvent.click(screen.getByRole('button', { name: /Sign Up/i }));

      await waitFor(() => {
        // Assert the custom, user-friendly error boundary is displayed
        expect(screen.getByText(/This email is already registered and verified/i)).toBeDefined();
      });
    });

    it('shows generic error message on failed signup due to weak password', async () => {
      vi.mocked(supabase.auth.signUp).mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Password should be at least 6 characters' } as any,
      });

      render(
        <MemoryRouter>
          <Signup />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'weak@transcenda.com' } });
      fireEvent.change(screen.getByPlaceholderText(/Password/i), { target: { value: '123' } }); // Intentionally weak
      fireEvent.click(screen.getByRole('button', { name: /Sign Up/i }));

      await waitFor(() => {
        expect(screen.getByText(/Password should be at least 6 characters/i)).toBeDefined();
      });
    });
  });
});