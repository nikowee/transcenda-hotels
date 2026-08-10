import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import axios from 'axios';
import HotelDetailPage from '../pages/HotelDetailsPage';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

vi.mock('../components/Navbar', () => ({
    default: () => <nav data-testid="navbar" />,
}));

const mockHotel = {
    id: 'QDaO',
    name: 'Pan Pacific Singapore',
    address: '7 Raffles Boulevard',
    rating: 5,
    description: 'A lovely hotel near Marina Bay.',
    amenities: {
        airConditioning: true,
        outdoorPool: true,
        tennisCourt: false,
    },
    amenities_ratings: [],
    latitude: 1.29,
    longitude: 103.85,
    image_details: {
        prefix: 'https://cdn.example.com/QDaO/',
        suffix: '.jpg',
        count: 15,
    },
    trustyou: { score: { overall: 92 } },
    number_reviews: 1847,
};

const mockRooms = [
    {
        key: 'room-1',
        roomDescription: 'Deluxe King Room',
        long_description: '<p>Spacious room</p>',
        free_cancellation: true,
        rooms_available: 3,
        images: [{ url: 'https://cdn.example.com/room1.jpg', high_resolution_url: '', hero_image: true }],
        amenities: [],
        price: 250,
        converted_price: 250,
        points: 0,
    },
];

function mockBothEndpoints(hotel: unknown = mockHotel, rooms: unknown = mockRooms) {
    mockedAxios.get.mockImplementation((url: string) => {
        if (String(url).includes('/price')) return Promise.resolve({ data: { rooms } });
        return Promise.resolve({ data: hotel });
    });
}

function renderPage(url = '/hotel/QDaO?dest=RsBU&in=2026-10-10&out=2026-10-17&guests=2') {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/hotel/:id" element={<HotelDetailPage />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('HotelDetailPage', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('loading and error states', () => {
        it('shows the loading state before data arrives', () => {
            mockedAxios.get.mockReturnValue(new Promise(() => {}));

            renderPage();

            expect(screen.getByText(/finding your perfect stay/i)).toBeInTheDocument();
        });

        it('shows an error message when the hotel fetch fails with a server error', async () => {
            mockedAxios.isAxiosError = vi.fn().mockReturnValue(true) as never;
            mockedAxios.get.mockRejectedValue({
                response: { status: 404, statusText: 'Not Found', data: { error: 'Hotel not found' } },
            });

            renderPage();

            await waitFor(() => {
                expect(screen.getByText(/404/)).toBeInTheDocument();
            });
            expect(screen.getByText(/hotel not found/i)).toBeInTheDocument();
        });

        it('shows a connection-related error when the request never gets a response', async () => {
            mockedAxios.isAxiosError = vi.fn().mockReturnValue(true) as never;
            mockedAxios.get.mockRejectedValue({ request: {} });

            renderPage();

            await waitFor(() => {
                expect(screen.getByText(/no response from server/i)).toBeInTheDocument();
            });
        });

        it('shows a generic error when a non-axios error is thrown', async () => {
            mockedAxios.isAxiosError = vi.fn().mockReturnValue(false) as never;
            mockedAxios.get.mockRejectedValue(new Error('boom'));

            renderPage();

            await waitFor(() => {
                expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
            });
        });
    });

    describe('hotel information', () => {
        it('renders hotel details after a successful fetch', async () => {
            mockBothEndpoints();

            renderPage();

            expect(await screen.findByText('Pan Pacific Singapore')).toBeInTheDocument();
            expect(screen.getByText('7 Raffles Boulevard')).toBeInTheDocument();
            expect(screen.getByText('A lovely hotel near Marina Bay.')).toBeInTheDocument();
            expect(screen.getByText(/5-star hotel/i)).toBeInTheDocument();
        });

        it('renders the guest rating badge on a ten-point scale with the review count', async () => {
            mockBothEndpoints();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            expect(screen.getByText('9.2')).toBeInTheDocument();
            expect(screen.getByText(/1,847 reviews/i)).toBeInTheDocument();
        });

        it('omits the guest rating badge when the hotel has no trustyou score', async () => {
            const { trustyou, number_reviews, ...hotelWithoutRating } = mockHotel;
            void trustyou;
            void number_reviews;
            mockBothEndpoints(hotelWithoutRating);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            expect(screen.queryByText(/guest rating/i)).not.toBeInTheDocument();
        });

        it('only shows amenities that are true', async () => {
            mockBothEndpoints(mockHotel, []);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            expect(screen.getByText(/air conditioning/i)).toBeInTheDocument();
            expect(screen.getByText(/outdoor pool/i)).toBeInTheDocument();
            expect(screen.queryByText(/tennis court/i)).not.toBeInTheDocument();
        });

        it('falls back to the raw amenity key when no friendly label exists', async () => {
            mockBothEndpoints({ ...mockHotel, amenities: { someUnmappedAmenity: true } }, []);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            expect(screen.getByText('someUnmappedAmenity')).toBeInTheDocument();
        });

        it('renders an external maps link built from the hotel coordinates', async () => {
            mockBothEndpoints(mockHotel, []);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            const mapsLink = screen.getByRole('link', { name: /open in google maps/i });
            expect(mapsLink).toHaveAttribute('href', expect.stringContaining('1.29,103.85'));
        });

        it('renders a location map framed on the hotel coordinates', async () => {
            mockBothEndpoints(mockHotel, []);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            const map = screen.getByTitle('Hotel location');
            expect(map).toHaveAttribute('src', expect.stringContaining('marker=1.29%2C103.85'));
        });
    });

    describe('photo gallery', () => {
        it('switches the main image when a thumbnail is clicked', async () => {
            mockBothEndpoints(mockHotel, []);
            const user = userEvent.setup();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            const mainImage = screen.getByAltText('Pan Pacific Singapore') as HTMLImageElement;
            expect(mainImage.src).toContain('0.jpg');

            await user.click(screen.getByAltText('Pan Pacific Singapore photo 2'));

            expect(mainImage.src).toContain('1.jpg');
        });

        it('advances and rewinds the gallery with the next and previous controls', async () => {
            mockBothEndpoints(mockHotel, []);
            const user = userEvent.setup();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');
            const mainImage = screen.getByAltText('Pan Pacific Singapore') as HTMLImageElement;

            await user.click(screen.getByRole('button', { name: /next photo/i }));
            expect(mainImage.src).toContain('1.jpg');

            await user.click(screen.getByRole('button', { name: /previous photo/i }));
            expect(mainImage.src).toContain('0.jpg');
        });

        it('wraps around to the last photo when going back from the first', async () => {
            mockBothEndpoints(mockHotel, []);
            const user = userEvent.setup();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');
            const mainImage = screen.getByAltText('Pan Pacific Singapore') as HTMLImageElement;

            await user.click(screen.getByRole('button', { name: /previous photo/i }));

            expect(mainImage.src).toContain('14.jpg');
        });

        it('reveals more thumbnails when the "+N more" button is clicked', async () => {
            mockBothEndpoints(mockHotel, []);
            const user = userEvent.setup();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            expect(screen.getByAltText('Pan Pacific Singapore photo 12')).toBeInTheDocument();
            expect(screen.queryByAltText('Pan Pacific Singapore photo 13')).not.toBeInTheDocument();

            await user.click(screen.getByText(/more/i));

            expect(await screen.findByAltText('Pan Pacific Singapore photo 13')).toBeInTheDocument();
        });

        it('hides the gallery controls when the hotel has a single photo', async () => {
            mockBothEndpoints({ ...mockHotel, image_details: { ...mockHotel.image_details, count: 1 } }, []);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            expect(screen.queryByRole('button', { name: /next photo/i })).not.toBeInTheDocument();
        });

        it('renders the page without a gallery when the hotel has no photos', async () => {
            mockBothEndpoints({ ...mockHotel, image_details: { ...mockHotel.image_details, count: 0 } }, []);

            renderPage();

            expect(await screen.findByText('Pan Pacific Singapore')).toBeInTheDocument();
            expect(screen.queryByAltText('Pan Pacific Singapore')).not.toBeInTheDocument();
        });
    });

    describe('room pricing', () => {
        it('requests room prices separately from the hotel details using the session params', async () => {
            mockBothEndpoints();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');

            const priceCall = mockedAxios.get.mock.calls.find(([url]) => String(url).includes('/price'));
            expect(priceCall).toBeDefined();
            expect(String(priceCall![0])).toContain('/api/hotels/QDaO/price');
            expect((priceCall![1] as { params: Record<string, string> }).params).toMatchObject({
                destination_id: 'RsBU',
                checkin: '2026-10-10',
                checkout: '2026-10-17',
                guests: '2',
            });
        });

        it('does not fetch room prices when required query params are missing', async () => {
            mockBothEndpoints();

            renderPage('/hotel/QDaO?dest=RsBU');

            await screen.findByText('Pan Pacific Singapore');

            const priceCalls = mockedAxios.get.mock.calls.filter(([url]) => String(url).includes('/price'));
            expect(priceCalls).toHaveLength(0);
        });

        it('shows a rooms loading indicator until prices resolve', async () => {
            mockedAxios.get.mockImplementation((url: string) => {
                if (String(url).includes('/price')) return new Promise(() => {});
                return Promise.resolve({ data: mockHotel });
            });

            renderPage();

            await screen.findByText('Pan Pacific Singapore');
            expect(screen.getByText(/checking live room rates/i)).toBeInTheDocument();
        });

        it('renders the room list once room prices resolve', async () => {
            mockBothEndpoints();

            renderPage();

            await screen.findByText('Pan Pacific Singapore');
            expect(await screen.findByText('Deluxe King Room')).toBeInTheDocument();
            expect(screen.getByText(/3 rooms left/i)).toBeInTheDocument();
            expect(screen.getByText(/free cancellation/i)).toBeInTheDocument();
        });

        it('shows the "no rooms available" message when the room list resolves empty', async () => {
            mockBothEndpoints(mockHotel, []);

            renderPage();

            await screen.findByText('Pan Pacific Singapore');
            expect(await screen.findByText(/no rooms available/i)).toBeInTheDocument();
        });

        it('shows the "no rooms available" message when the price request fails', async () => {
            mockedAxios.get.mockImplementation((url: string) => {
                if (String(url).includes('/price')) return Promise.reject(new Error('price down'));
                return Promise.resolve({ data: mockHotel });
            });

            renderPage();

            await screen.findByText('Pan Pacific Singapore');
            expect(await screen.findByText(/no rooms available/i)).toBeInTheDocument();
        });
    });
});
