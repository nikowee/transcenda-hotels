import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import ProfileModal from '../components/ProfileModal';
import { supabase } from '../lib/supabaseClient';
import type { BookingRecord } from '../types/booking';
import type { User } from '@supabase/supabase-js';

/** ProfileModal — the Booking History tab. */

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      updateUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const USER_ID = '11111111-2222-3333-4444-555555555555';
const ACCESS_TOKEN = 'test-access-token';

const USER = { id: USER_ID, email: 'jane@example.com' } as User;

const booking = (overrides: Partial<BookingRecord> = {}): BookingRecord => ({
  id: 'bk-1',
  userId: USER_ID,
  destinationId: 'RsBU',
  hotelId: 'marina-bay',
  hotelName: 'Marina Bay Sands',
  roomTypes: ['deluxe-king'],
  startDate: '2099-08-12',
  endDate: '2099-08-15',
  nights: 3,
  adults: 2,
  children: 0,
  specialRequests: null,
  guest: {
    salutation: 'Ms',
    firstName: 'Jane',
    lastName: 'Tan',
    email: 'jane@example.com',
    phone: '+65 9123 4567',
  },
  billing: null,
  pricePaid: 784.8,
  paymentId: 'pi_test',
  payeeId: 'acct_test',
  card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** Answers the history endpoint for this user, capturing what it was sent. */
const historyHandler = (
  bookings: BookingRecord[],
  onRequest?: (request: Request) => void
) =>
  http.get('*/api/bookings/user/:userId', ({ request }) => {
    onRequest?.(request);
    return HttpResponse.json({ bookings });
  });

const openBookingsTab = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /booking history/i }));
  return user;
};

const renderModal = () =>
  render(<ProfileModal isOpen onClose={vi.fn()} user={USER} />);

describe('ProfileModal — Booking History', () => {
  beforeEach(() => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: ACCESS_TOKEN, user: USER } },
      error: null,
    } as never);
  });

  it('does not fetch anything until the tab is opened', async () => {
    let called = false;
    server.use(historyHandler([], () => { called = true; }));

    renderModal();
    // Account Details is the default tab; give any stray effect a chance to run.
    await screen.findByText('jane@example.com');

    expect(called).to.equal(false);
  });

  it('sends the access token as a bearer credential', async () => {
    // The whole authorisation story depends on this header arriving: without
    // it the server answers 401, and with someone else's it answers 403.
    let authorization: string | null = null;
    server.use(
      historyHandler([], (request) => {
        authorization = request.headers.get('authorization');
      })
    );

    renderModal();
    await openBookingsTab();

    await waitFor(() => expect(authorization).to.equal(`Bearer ${ACCESS_TOKEN}`));
  });

  it('requests the signed-in account, not some other one', async () => {
    let requestedPath: string | null = null;
    server.use(
      historyHandler([], (request) => {
        requestedPath = new URL(request.url).pathname;
      })
    );

    renderModal();
    await openBookingsTab();

    await waitFor(() =>
      expect(requestedPath).to.equal(`/api/bookings/user/${USER_ID}`)
    );
  });

  it('shows a loading state while the request is in flight', async () => {
    server.use(
      http.get('*/api/bookings/user/:userId', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ bookings: [] });
      })
    );

    renderModal();
    await openBookingsTab();

    expect(screen.getByText(/loading your bookings/i)).toBeInTheDocument();
  });

  it('renders a returned booking', async () => {
    server.use(historyHandler([booking()]));

    renderModal();
    await openBookingsTab();

    expect(await screen.findByText('Marina Bay Sands')).toBeInTheDocument();
    expect(screen.getByText('S$784.80')).toBeInTheDocument();
    expect(screen.getByText(/3 nights · 1 room/)).toBeInTheDocument();
  });

  it('labels a stay that has already ended as completed', async () => {
    // Derived from the checkout date rather than stored: bookings has no status
    // column, because a row only exists once the charge has cleared.
    server.use(
      historyHandler([booking({ startDate: '2020-01-01', endDate: '2020-01-04' })])
    );

    renderModal();
    await openBookingsTab();

    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  it('labels a future stay as upcoming', async () => {
    server.use(historyHandler([booking()]));

    renderModal();
    await openBookingsTab();

    expect(await screen.findByText('Upcoming')).toBeInTheDocument();
  });

  it('says so when there are no bookings, rather than showing nothing', async () => {
    server.use(historyHandler([]));

    renderModal();
    await openBookingsTab();

    expect(await screen.findByText(/no bookings found yet/i)).toBeInTheDocument();
  });

  it('surfaces the server\'s message when the read is refused', async () => {
    // A 403 here means the token and the path disagree, which is a real bug
    // worth showing rather than rendering as an empty history.
    server.use(
      http.get('*/api/bookings/user/:userId', () =>
        HttpResponse.json({ error: 'You can only view your own bookings.' }, { status: 403 })
      )
    );

    renderModal();
    await openBookingsTab();

    expect(await screen.findByText(/only view your own bookings/i)).toBeInTheDocument();
    expect(screen.queryByText(/no bookings found yet/i)).to.equal(null);
  });

  it('does not report an empty history when the request failed', async () => {
    // The distinction that matters: "you have no bookings" and "we could not
    // ask" must never look the same, or an outage reads as data loss.
    server.use(
      http.get('*/api/bookings/user/:userId', () => HttpResponse.error())
    );

    renderModal();
    await openBookingsTab();

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/no bookings found yet/i)).to.equal(null);
  });

  it('retries after a failure', async () => {
    let attempts = 0;
    server.use(
      http.get('*/api/bookings/user/:userId', () => {
        attempts += 1;
        return attempts === 1
          ? HttpResponse.error()
          : HttpResponse.json({ bookings: [booking()] });
      })
    );

    renderModal();
    const user = await openBookingsTab();

    await user.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Marina Bay Sands')).toBeInTheDocument();
  });
});
