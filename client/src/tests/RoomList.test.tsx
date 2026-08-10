import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import RoomList from '../components/RoomList';
import type { RoomOption } from '../types/room';

/** RoomList calls useNavigate, useParams and useSearchParams — it is the component that starts a booking — so it cannot render outside a Router. */
const renderRoomList = (rooms: RoomOption[]) =>
    render(
        <MemoryRouter initialEntries={['/hotel/diH7?dest=WD0M&in=2026-10-01&out=2026-10-04&guests=2']}>
            <Routes>
                <Route path="/hotel/:id" element={<RoomList rooms={rooms} />} />
                <Route path="/booking" element={<div>booking entry</div>} />
            </Routes>
        </MemoryRouter>
    );

function makeRoom(overrides: Partial<RoomOption> = {}): RoomOption {
    return {
        key: 'room-1',
        roomDescription: 'Deluxe King Room',
        long_description: '<p>Spacious room with a view</p>',
        free_cancellation: true,
        rooms_available: 3,
        images: [
            { url: 'https://cdn.example.com/room1-standard.jpg', high_resolution_url: '', hero_image: false },
            { url: 'https://cdn.example.com/room1-hero.jpg', high_resolution_url: '', hero_image: true },
        ],
        amenities: [],
        price: 250,
        converted_price: 250,
        points: 0,
        ...overrides,
    };
}

describe('RoomList', () => {
    it('shows a "no rooms available" message when the list is empty', () => {
        renderRoomList([]);

        expect(screen.getByText(/no rooms available/i)).toBeInTheDocument();
    });

    it('renders one card per room', () => {
        const rooms = [
            makeRoom({ key: 'room-1', roomDescription: 'Deluxe King Room' }),
            makeRoom({ key: 'room-2', roomDescription: 'Twin Room' }),
        ];

        renderRoomList(rooms);

        expect(screen.getByText('Deluxe King Room')).toBeInTheDocument();
        expect(screen.getByText('Twin Room')).toBeInTheDocument();
    });

    it('shows room description, availability count, and price', () => {
        const room = makeRoom({
            roomDescription: 'Ocean View Suite',
            rooms_available: 5,
            converted_price: 480,
        });

        renderRoomList([room]);

        expect(screen.getByText('Ocean View Suite')).toBeInTheDocument();
        expect(screen.getByText(/5 rooms left/i)).toBeInTheDocument();
        expect(screen.getByText(/S\$480/)).toBeInTheDocument();
    });

    it('formats converted_price with locale grouping and no decimals', () => {
        const room = makeRoom({ converted_price: 12345.678 });

        renderRoomList([room]);

        // toLocaleString(undefined, { maximumFractionDigits: 0 }) → "12,346" in en-US-like locales
        expect(screen.getByText(/12,346|12346/)).toBeInTheDocument();
    });

    it('shows the "Free cancellation" badge only when free_cancellation is true', () => {
        const freeRoom = makeRoom({ key: 'free', roomDescription: 'Free Cancel Room', free_cancellation: true });
        const paidRoom = makeRoom({ key: 'paid', roomDescription: 'No Cancel Room', free_cancellation: false });

        renderRoomList([freeRoom, paidRoom]);

        const badges = screen.getAllByText(/free cancellation/i);
        expect(badges.length).toBe(1);
    });

    it('uses the image marked hero_image as the displayed image', () => {
        const room = makeRoom({
            roomDescription: 'Hero Image Room',
            images: [
                { url: 'https://cdn.example.com/first.jpg', high_resolution_url: '', hero_image: false },
                { url: 'https://cdn.example.com/hero.jpg', high_resolution_url: '', hero_image: true },
                { url: 'https://cdn.example.com/third.jpg', high_resolution_url: '', hero_image: false },
            ],
        });

        renderRoomList([room]);

        const img = screen.getByAltText('Hero Image Room') as HTMLImageElement;
        expect(img.src).toBe('https://cdn.example.com/hero.jpg');
    });

    it('falls back to the first image when no image is marked hero_image', () => {
        const room = makeRoom({
            roomDescription: 'No Hero Room',
            images: [
                { url: 'https://cdn.example.com/first.jpg', high_resolution_url: '', hero_image: false },
                { url: 'https://cdn.example.com/second.jpg', high_resolution_url: '', hero_image: false },
            ],
        });

        renderRoomList([room]);

        const img = screen.getByAltText('No Hero Room') as HTMLImageElement;
        expect(img.src).toBe('https://cdn.example.com/first.jpg');
    });

    it('does not render an image when the images array is empty', () => {
        const room = makeRoom({ roomDescription: 'No Image Room', images: [] });

        renderRoomList([room]);

        expect(screen.queryByAltText('No Image Room')).not.toBeInTheDocument();
    });

    it('renders a "Select" button for each room', () => {
        const rooms = [
            makeRoom({ key: 'room-1', roomDescription: 'Room A' }),
            makeRoom({ key: 'room-2', roomDescription: 'Room B' }),
        ];

        renderRoomList(rooms);

        expect(screen.getAllByRole('button', { name: /select/i }).length).toBe(2);
    });

    it('uses room.key as a stable React key (no duplicate-key console errors) even with same descriptions', () => {
        const rooms = [
            makeRoom({ key: 'room-1', roomDescription: 'Standard Room' }),
            makeRoom({ key: 'room-2', roomDescription: 'Standard Room' }),
        ];

        renderRoomList(rooms);

        expect(screen.getAllByText('Standard Room').length).toBe(2);
    });
});