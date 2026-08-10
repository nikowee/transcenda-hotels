// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router'; 
import Login from '../pages/Login';
import { supabase } from '../lib/supabaseClient';

vi.mock('../lib/supabaseClient', () => ({
    supabase: {
      auth: {
        signInWithPassword: vi.fn().mockImplementation(() => 
          Promise.resolve({ data: {}, error: null })
        ),
      },
    },
  }));

describe('Authentication: Login Constraints and Execution Paths', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. NEGATIVE CONSTRAINT: INVALID CREDENTIALS
  it('should render an error state when incorrect credentials are provided', async () => {
    const mockAuthError = {
      data: { user: null, session: null },
      error: { message: 'User not found or incorrect password', status: 400, name: 'AuthApiError' }
    };
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce(mockAuthError);

    render(<MemoryRouter><Login /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'wrong@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'wrongpassword123' } });
    
    const form = screen.getByRole('button', { name: /log in/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
        expect(supabase.auth.signInWithPassword).toHaveBeenCalled();
        expect(screen.getByText(/User not found or incorrect password/i)).toBeInTheDocument();
    });
  });

  // 2. INFRASTRUCTURE RESILIENCE: NETWORK FAILURE
  it('should gracefully handle unexpected network failures during login', async () => {
    const mockNetworkError = {
      data: { user: null, session: null },
      error: { message: 'Failed to fetch', status: 500, name: 'TypeError' }
    };
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce(mockNetworkError);

    render(<MemoryRouter><Login /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'secure123' } });
    
    const form = screen.getByRole('button', { name: /log in/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalled();
      expect(screen.getByText(/Failed to fetch/i)).toBeInTheDocument();
    });
  });

  // 3. EXECUTION SUCCESS: THE HAPPY PATH
  it('should execute successfully given valid credentials', async () => {
    const mockSuccessResponse = {
      data: { user: { id: 'uuid-1234' }, session: { access_token: 'mock-token' } },
      error: null
    };
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce(mockSuccessResponse);

    render(<MemoryRouter><Login /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'user@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'correctpassword123' } });
    
    const form = screen.getByRole('button', { name: /log in/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'user@test.com',
        password: 'correctpassword123',
      });
    });
  });

  // 4. NEGATIVE CONSTRAINT: EMPTY FIELDS
  it('should submit empty strings to Supabase and handle the validation error', async () => {
    const mockEmptyError = {
      data: { user: null, session: null },
      error: { message: 'Email and password are required', status: 400, name: 'AuthApiError' }
    };
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce(mockEmptyError);

    render(<MemoryRouter><Login /></MemoryRouter>);

    const form = screen.getByRole('button', { name: /log in/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: '',
        password: '',
      });
      expect(screen.getByText(/Email and password are required/i)).toBeInTheDocument();
    });
  });

  // 5. NEGATIVE CONSTRAINT: MALFORMED EMAIL FORMAT
  it('should handle API-level rejections for improperly formatted emails', async () => {
    const mockInvalidEmailError = {
      data: { user: null, session: null },
      error: { message: 'Unable to validate email address: invalid format', status: 422, name: 'AuthApiError' }
    };
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce(mockInvalidEmailError);

    render(<MemoryRouter><Login /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'notanemail' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'somepassword123' } });
    
    const form = screen.getByRole('button', { name: /log in/i }).closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(supabase.auth.signInWithPassword).toHaveBeenCalled();
      expect(screen.getByText(/Unable to validate email address: invalid format/i)).toBeInTheDocument();
    });
  });

});