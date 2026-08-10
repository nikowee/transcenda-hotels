import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import RoomList from '../components/RoomList';
import type { RoomOption } from '../types/room';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return { ...actual, useNavigate: () => mockNavigate };
});

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

function renderRoomList(
    rooms: RoomOption[],
    url = '/hotel/QDaO?dest=RsBU&in=2026-10-10&out=2026-10-17&guests=2'
) {
    return render(
        <MemoryRouter initialEntries={[url]}>
            <Routes>
                <Route path="/hotel/:id" element={<RoomList rooms={rooms} />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('RoomList', () => {
    beforeEach(() => {
        mockNavigate.mockClear();
    });

    describe('empty state', () => {
        it('shows a "no rooms available" message when the list is empty', () => {
            renderRoomList([]);

            expect(screen.getByText(/no rooms available/i)).toBeInTheDocument();
        });

        it('offers a "Back to results" button that navigates back', async () => {
            const user = userEvent.setup();
            renderRoomList([]);

            await user.click(screen.getByRole('button', { name: /back to results/i }));

            expect(mockNavigate).toHaveBeenCalledWith(-1);
        });

        it('renders no room rows when the list is empty', () => {
            renderRoomList([]);

            expect(screen.queryByRole('button', { name: /^select$/i })).not.toBeInTheDocument();
        });
    });

    describe('room rendering', () => {
        it('renders one row per room', () => {
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
            renderRoomList([makeRoom({ converted_price: 12345.678 })]);

            expect(screen.getByText(/S\$(12,346|12346)/)).toBeInTheDocument();
        });

        it('singularises the availability label when one room is left', () => {
            renderRoomList([makeRoom({ rooms_available: 1 })]);

            expect(screen.getByText(/1 room left/i)).toBeInTheDocument();
            expect(screen.queryByText(/1 rooms left/i)).not.toBeInTheDocument();
        });

        it('shows the "Free cancellation" badge only when free_cancellation is true', () => {
            const freeRoom = makeRoom({ key: 'free', roomDescription: 'Free Cancel Room', free_cancellation: true });
            const paidRoom = makeRoom({ key: 'paid', roomDescription: 'No Cancel Room', free_cancellation: false });

            renderRoomList([freeRoom, paidRoom]);

            expect(screen.getAllByText(/free cancellation/i)).toHaveLength(1);
        });

        it('uses room.key as a stable React key even with identical descriptions', () => {
            const rooms = [
                makeRoom({ key: 'room-1', roomDescription: 'Standard Room' }),
                makeRoom({ key: 'room-2', roomDescription: 'Standard Room' }),
            ];

            renderRoomList(rooms);

            expect(screen.getAllByText('Standard Room')).toHaveLength(2);
        });
    });

    describe('loyalty points', () => {
        it('shows earnable points when points is greater than zero', () => {
            renderRoomList([makeRoom({ points: 1240 })]);

            expect(screen.getByText(/earn 1,240 pts/i)).toBeInTheDocument();
        });

        it('hides the points row when points is zero', () => {
            renderRoomList([makeRoom({ points: 0 })]);

            expect(screen.queryByText(/earn/i)).not.toBeInTheDocument();
        });
    });

    describe('room amenities', () => {
        it('renders room amenities capped at four', () => {
            const room = makeRoom({
                amenities: ['WiFi', 'Breakfast', 'City View', 'Lounge Access', 'Airport Transfer'],
            });

            renderRoomList([room]);

            expect(screen.getByText('WiFi')).toBeInTheDocument();
            expect(screen.getByText('Lounge Access')).toBeInTheDocument();
            expect(screen.queryByText('Airport Transfer')).not.toBeInTheDocument();
        });

        it('renders the room without amenity pills when there are none', () => {
            renderRoomList([makeRoom({ amenities: [] })]);

            expect(screen.getByText('Deluxe King Room')).toBeInTheDocument();
        });
    });

    describe('room images', () => {
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
            renderRoomList([makeRoom({ roomDescription: 'No Image Room', images: [] })]);

            expect(screen.queryByAltText('No Image Room')).not.toBeInTheDocument();
        });

        it('lazy-loads room images', () => {
            renderRoomList([makeRoom({ roomDescription: 'Lazy Room' })]);

            expect(screen.getByAltText('Lazy Room')).toHaveAttribute('loading', 'lazy');
        });
    });

    describe('room selection', () => {
        it('renders a "Select" button for each room', () => {
            const rooms = [
                makeRoom({ key: 'room-1', roomDescription: 'Room A' }),
                makeRoom({ key: 'room-2', roomDescription: 'Room B' }),
            ];

            renderRoomList(rooms);

            expect(screen.getAllByRole('button', { name: /select/i })).toHaveLength(2);
        });

        it('navigates to /booking with the hotel id, search params and room key', async () => {
            const user = userEvent.setup();
            renderRoomList([makeRoom({ key: 'rate-abc-123' })]);

            await user.click(screen.getByRole('button', { name: /select/i }));

            expect(mockNavigate).toHaveBeenCalledTimes(1);
            const destination = mockNavigate.mock.calls[0][0] as string;
            expect(destination).toContain('/booking?');
            expect(destination).toContain('hotel=QDaO');
            expect(destination).toContain('dest=RsBU');
            expect(destination).toContain('in=2026-10-10');
            expect(destination).toContain('out=2026-10-17');
            expect(destination).toContain('guests=2');
            expect(destination).toContain('key=rate-abc-123');
        });

        it('passes the key of the room that was actually selected', async () => {
            const user = userEvent.setup();
            const rooms = [
                makeRoom({ key: 'first-room', roomDescription: 'Room A' }),
                makeRoom({ key: 'second-room', roomDescription: 'Room B' }),
            ];

            renderRoomList(rooms);

            await user.click(screen.getAllByRole('button', { name: /select/i })[1]);

            expect(mockNavigate.mock.calls[0][0]).toContain('key=second-room');
        });

        it('still navigates when optional search params are missing', async () => {
            const user = userEvent.setup();
            renderRoomList([makeRoom({ key: 'rate-1' })], '/hotel/QDaO');

            await user.click(screen.getByRole('button', { name: /select/i }));

            const destination = mockNavigate.mock.calls[0][0] as string;
            expect(destination).toContain('hotel=QDaO');
            expect(destination).toContain('key=rate-1');
        });
    });
});
