import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import axios from 'axios';
import HotelDetailPage from '../pages/HotelDetailsPage';

// Mock axios entirely so no real network calls happen
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

// Sample hotel detail response (trimmed to fields the component actually uses)
const mockHotel = {
    id: 'QDaO',
    name: 'Pan Pacific Singapore',
    address: '7 Raffles Boulevard',
    rating: 5.0,
    description: 'A lovely hotel near Marina Bay.',
    amenities: {
        airConditioning: true,
        outdoorPool: true,
        tennisCourt: false, // should be filtered out
    },
    amenities_ratings: [],
    latitude: 1.29,
    longitude: 103.85,
    image_details: {
        prefix: 'https://cdn.example.com/QDaO/',
        suffix: '.jpg',
        count: 15,
    },
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

    it('shows the loading state before data arrives', () => {
        // Never resolves during this test — simulates an in-flight request
        mockedAxios.get.mockReturnValue(new Promise(() => {}));

        renderPage();

        expect(screen.getByText(/finding your perfect stay/i)).toBeInTheDocument();
    });

    it('renders hotel details after a successful fetch', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) {
                return Promise.resolve({ data: { rooms: mockRooms } });
            }
            return Promise.resolve({ data: mockHotel });
        });

        renderPage();

        expect(await screen.findByText('Pan Pacific Singapore')).toBeInTheDocument();
        expect(screen.getByText('7 Raffles Boulevard')).toBeInTheDocument();
        expect(screen.getByText(/5/)).toBeInTheDocument();
        expect(screen.getByText('A lovely hotel near Marina Bay.')).toBeInTheDocument();
    });

    it('only shows amenities that are true', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) return Promise.resolve({ data: { rooms: [] } });
            return Promise.resolve({ data: mockHotel });
        });

        renderPage();

        await screen.findByText('Pan Pacific Singapore');

        expect(screen.getByText(/air conditioning/i)).toBeInTheDocument();
        expect(screen.getByText(/outdoor pool/i)).toBeInTheDocument();
        expect(screen.queryByText(/tennis court/i)).not.toBeInTheDocument();
    });

    it('shows a loading page with an error message when the hotel fetch fails with a server error', async () => {
        mockedAxios.isAxiosError = vi.fn().mockReturnValue(true) as any;
        mockedAxios.get.mockRejectedValue({
            response: { status: 404, statusText: 'Not Found', data: { error: 'Hotel not found' } },
        });

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/404/)).toBeInTheDocument();
        });
        // Still on the loading page shell, not a separate error page
        expect(screen.getByText(/finding your perfect stay/i)).toBeInTheDocument();
    });

    it('shows a connection-related error when the request never gets a response', async () => {
        mockedAxios.isAxiosError = vi.fn().mockReturnValue(true) as any;
        mockedAxios.get.mockRejectedValue({
            request: {},
            // no `.response` — simulates connection reset / no response
        });

        renderPage();

        await waitFor(() => {
            expect(screen.getByText(/no response from server/i)).toBeInTheDocument();
        });
    });

    it('does not fetch room prices when required query params are missing', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) return Promise.resolve({ data: { rooms: mockRooms } });
            return Promise.resolve({ data: mockHotel });
        });

        // Missing checkin/checkout/guests entirely
        renderPage('/hotel/QDaO?dest=RsBU');

        await screen.findByText('Pan Pacific Singapore');

        const priceCalls = mockedAxios.get.mock.calls.filter(([url]) => String(url).includes('/price'));
        expect(priceCalls.length).toBe(0);
    });

    it('renders the room list once room prices resolve', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) return Promise.resolve({ data: { rooms: mockRooms } });
            return Promise.resolve({ data: mockHotel });
        });

        renderPage();

        await screen.findByText('Pan Pacific Singapore');
        expect(await screen.findByText('Deluxe King Room')).toBeInTheDocument();
        expect(screen.getByText(/3 rooms left/i)).toBeInTheDocument();
        expect(screen.getByText(/free cancellation/i)).toBeInTheDocument();
    });

    it('shows the "no rooms available" message when the room list resolves empty', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) return Promise.resolve({ data: { rooms: [] } });
            return Promise.resolve({ data: mockHotel });
        });

        renderPage();

        await screen.findByText('Pan Pacific Singapore');
        expect(await screen.findByText(/no rooms available/i)).toBeInTheDocument();
    });

    it('switches the main image when a thumbnail is clicked', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) return Promise.resolve({ data: { rooms: [] } });
            return Promise.resolve({ data: mockHotel });
        });

        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Pan Pacific Singapore');

        const mainImage = screen.getByAltText('Pan Pacific Singapore') as HTMLImageElement;
        expect(mainImage.src).toContain('0.jpg');

        const secondThumbnail = screen.getByAltText('Pan Pacific Singapore photo 2');
        await user.click(secondThumbnail);

        expect(mainImage.src).toContain('1.jpg');
    });

    it('reveals more thumbnails when "+N more" is clicked', async () => {
        mockedAxios.get.mockImplementation((url: string) => {
            if (url.includes('/price')) return Promise.resolve({ data: { rooms: [] } });
            return Promise.resolve({ data: mockHotel }); // image_details.count = 15
        });

        const user = userEvent.setup();
        renderPage();

        await screen.findByText('Pan Pacific Singapore');

        // Initially only 12 thumbnails visible
        expect(screen.getByAltText('Pan Pacific Singapore photo 12')).toBeInTheDocument();
        expect(screen.queryByAltText('Pan Pacific Singapore photo 13')).not.toBeInTheDocument();

        const moreButton = screen.getByText(/more/i);
        await user.click(moreButton);

        expect(await screen.findByAltText('Pan Pacific Singapore photo 13')).toBeInTheDocument();
    });
});