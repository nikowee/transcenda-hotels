// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router'; 
import Signup from '../pages/Signup';
import { supabase } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
    },
  },
}));

describe('Authentication: Signup Constraints and Execution Paths', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. NEGATIVE CONSTRAINT: DUPLICATE EMAIL
  it('should render an error state when a duplicate email is detected', async () => {
    const mockDuplicateError = {
      data: { user: null, session: null },
      error: { message: 'User already registered', status: 400, name: 'AuthApiError' }
    };
    (supabase.auth.signUp as any).mockResolvedValueOnce(mockDuplicateError);

    render(<MemoryRouter><Signup /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'duplicate@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'securepassword123' } });
    
    const form = screen.getByRole('button', { name: /sign up/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
        expect(supabase.auth.signUp).toHaveBeenCalled();
        expect(screen.getByText(/User already registered/i)).toBeInTheDocument();
    });
  });

  // 2. NEGATIVE CONSTRAINT: INVALID FORMAT
  it('should bypass HTML validation and render an error for gibberish emails', async () => {
    const mockInvalidEmailError = {
      data: { user: null, session: null },
      error: { message: 'Invalid email format', status: 400, name: 'AuthApiError' }
    };
    (supabase.auth.signUp as any).mockResolvedValueOnce(mockInvalidEmailError);

    render(<MemoryRouter><Signup /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'not-an-email-at-all' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'securepassword123' } });
    
    const form = screen.getByRole('button', { name: /sign up/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalled();
      expect(screen.getByText(/Invalid email format/i)).toBeInTheDocument();
    });
  });

  // 3. INFRASTRUCTURE RESILIENCE: NETWORK FAILURE
  it('should gracefully handle unexpected network failures', async () => {
    const mockNetworkError = {
      data: { user: null, session: null },
      error: { message: 'Failed to fetch', status: 500, name: 'TypeError' }
    };
    (supabase.auth.signUp as any).mockResolvedValueOnce(mockNetworkError);

    render(<MemoryRouter><Signup /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secure123' } });
    
    const form = screen.getByRole('button', { name: /sign up/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalled();
      expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
    });
  });

  // 4. SECURITY CONSTRAINT: WEAK PASSWORD
  it('should reject passwords that do not meet length constraints', async () => {
    const mockWeakPasswordError = {
      data: { user: null, session: null },
      error: { message: 'Password should be at least 6 characters', status: 400, name: 'AuthApiError' }
    };
    (supabase.auth.signUp as any).mockResolvedValueOnce(mockWeakPasswordError);

    render(<MemoryRouter><Signup /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: '123' } });
    
    const form = screen.getByRole('button', { name: /sign up/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signUp).toHaveBeenCalled();
      expect(screen.getByText(/Password should be at least 6 characters/i)).toBeInTheDocument();
    });
  });

  // 5. EXECUTION SUCCESS: THE HAPPY PATH
  it('should execute successfully given a valid payload', async () => {
    const mockSuccessResponse = {
      data: { user: { id: 'uuid-1234' }, session: null },
      error: null
    };
    (supabase.auth.signUp as any).mockResolvedValueOnce(mockSuccessResponse);

    render(<MemoryRouter><Signup /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'newuser@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'securepassword123' } });
    
    const form = screen.getByRole('button', { name: /sign up/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      const baseUrl = import.meta.env.VITE_API_URL;
      
      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: 'newuser@test.com',
        password: 'securepassword123',
        options: {
          emailRedirectTo: `${baseUrl}/login`,
        },
      });
    });
  });

});