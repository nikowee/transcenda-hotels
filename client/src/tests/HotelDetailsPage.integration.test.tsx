import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import HotelDetailPage from '../pages/HotelDetailsPage';

vi.mock('../components/Navbar', () => ({
    default: () => <nav data-testid="navbar" />,
}));

const HOTEL_ROUTE = '*/api/hotels/:id';
const PRICE_ROUTE = '*/api/hotels/:id/price';

const hotelPayload = {
    id: 'QDaO',
    name: 'Pan Pacific Singapore',
    address: '7 Raffles Boulevard',
    rating: 5,
    description: 'A lovely hotel near Marina Bay.',
    latitude: 1.29,
    longitude: 103.85,
    amenities: { airConditioning: true, outdoorPool: true, tennisCourt: false },
    amenities_ratings: [],
    image_details: { prefix: 'https://cdn.example.com/QDaO/', suffix: '.jpg', count: 3 },
    trustyou: { score: { overall: 92 } },
    number_reviews: 1847,
};

const roomsPayload = {
    completed: true,
    currency: 'SGD',
    rooms: [
        {
            key: 'rate-deluxe',
            roomDescription: 'Deluxe King Room',
            long_description: '',
            free_cancellation: true,
            rooms_available: 3,
            images: [{ url: 'https://cdn.example.com/room1.jpg', high_resolution_url: '', hero_image: true }],
            amenities: ['WiFi', 'Breakfast'],
            price: 620,
            converted_price: 620,
            points: 1240,
        },
        {
            key: 'rate-suite',
            roomDescription: 'Bay View Suite',
            long_description: '',
            free_cancellation: false,
            rooms_available: 1,
            images: [{ url: 'https://cdn.example.com/room2.jpg', high_resolution_url: '', hero_image: true }],
            amenities: ['Lounge Access'],
            price: 940,
            converted_price: 940,
            points: 1880,
        },
    ],
};

function useHotelHandlers(rooms: any = roomsPayload) {
    server.use(
        http.get(HOTEL_ROUTE, () => HttpResponse.json(hotelPayload)),
        http.get(PRICE_ROUTE, () => HttpResponse.json(rooms as any))
    );
}

function renderPage(url = '/hotel/QDaO?dest=RsBU&in=2026-10-10&out=2026-10-17&guests=2') {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/hotel/:id" element={<HotelDetailPage />} />
                <Route path="/booking" element={<div>Booking page</div>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('HotelDetailsPage Integration Tests (MSW)', () => {
    it('loads hotel information and available rooms end to end', async () => {
        useHotelHandlers();

        renderPage();

        expect(await screen.findByText('Pan Pacific Singapore')).toBeInTheDocument();
        expect(screen.getByText('7 Raffles Boulevard')).toBeInTheDocument();
        expect(screen.getByText('A lovely hotel near Marina Bay.')).toBeInTheDocument();
        expect(screen.getByText('9.2')).toBeInTheDocument();

        expect(screen.getByText(/air conditioning/i)).toBeInTheDocument();
        expect(screen.queryByText(/tennis court/i)).not.toBeInTheDocument();

        expect(await screen.findByText('Deluxe King Room')).toBeInTheDocument();
        expect(screen.getByText('Bay View Suite')).toBeInTheDocument();
        expect(screen.getByText(/S\$620/)).toBeInTheDocument();
        expect(screen.getByText(/earn 1,240 pts/i)).toBeInTheDocument();
    });

    it('sends the session search params on the room price request', async () => {
        let receivedUrl: URL | null = null;
        server.use(
            http.get(HOTEL_ROUTE, () => HttpResponse.json(hotelPayload)),
            http.get(PRICE_ROUTE, ({ request }) => {
                receivedUrl = new URL(request.url);
                return HttpResponse.json(roomsPayload);
            })
        );

        renderPage();

        await screen.findByText('Deluxe King Room');

        expect(receivedUrl!.searchParams.get('destination_id')).toBe('RsBU');
        expect(receivedUrl!.searchParams.get('checkin')).toBe('2026-10-10');
        expect(receivedUrl!.searchParams.get('checkout')).toBe('2026-10-17');
        expect(receivedUrl!.searchParams.get('guests')).toBe('2');
    });

    it('fetches hotel details and room prices as two independent requests', async () => {
        const paths: string[] = [];
        server.use(
            http.get(HOTEL_ROUTE, ({ request }) => {
                paths.push(new URL(request.url).pathname);
                return HttpResponse.json(hotelPayload);
            }),
            http.get(PRICE_ROUTE, ({ request }) => {
                paths.push(new URL(request.url).pathname);
                return HttpResponse.json(roomsPayload);
            })
        );

        renderPage();

        await screen.findByText('Deluxe King Room');

        expect(paths.some((p) => p.endsWith('/api/hotels/QDaO'))).toBe(true);
        expect(paths.some((p) => p.endsWith('/api/hotels/QDaO/price'))).toBe(true);
    });

    it('shows the empty-rooms message when the API returns no rooms', async () => {
        useHotelHandlers({ completed: true, currency: 'SGD', rooms: [] });

        renderPage();

        await screen.findByText('Pan Pacific Singapore');
        expect(await screen.findByText(/no rooms available/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /back to results/i })).toBeInTheDocument();
    });

    it('navigates to the booking page when a room is selected', async () => {
        useHotelHandlers();
        const user = userEvent.setup();

        renderPage();

        await screen.findByText('Deluxe King Room');
        await user.click(screen.getAllByRole('button', { name: /select/i })[0]);

        expect(await screen.findByText('Booking page')).toBeInTheDocument();
    });

    it('surfaces an error when the hotel endpoint fails', async () => {
        server.use(
            http.get(HOTEL_ROUTE, () =>
                HttpResponse.json({ error: 'Failed to fetch hotel details' }, { status: 502 })
            ),
            http.get(PRICE_ROUTE, () => HttpResponse.json(roomsPayload))
        );

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/502/)).toBeInTheDocument();
        });
    });

    it('still renders hotel information when only the price endpoint fails', async () => {
        server.use(
            http.get(HOTEL_ROUTE, () => HttpResponse.json(hotelPayload)),
            http.get(PRICE_ROUTE, () =>
                HttpResponse.json({ error: 'Failed to fetch room prices' }, { status: 502 })
            )
        );

        renderPage();

        expect(await screen.findByText('Pan Pacific Singapore')).toBeInTheDocument();
        expect(await screen.findByText(/no rooms available/i)).toBeInTheDocument();
    });
});
