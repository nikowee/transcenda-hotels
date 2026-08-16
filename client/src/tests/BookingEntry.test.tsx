import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import BookingEntry from '../pages/BookingEntry';

/** The seam between Feature 3 (hotel details) and UC4. */

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

const renderEntry = (query: string) =>
  render(
    <MemoryRouter initialEntries={[`/booking?${query}`]}>
      <LocationProbe />
      <Routes>
        <Route path="/booking" element={<BookingEntry />} />
        <Route path="/checkout" element={<div>checkout page</div>} />
        <Route path="/" element={<div>landing page</div>} />
      </Routes>
    </MemoryRouter>
  );

const landedAt = () => new URL(screen.getByTestId('location').textContent ?? '', 'http://x');

/** Exactly what RoomList builds, copied from its handleSelect. */
const FROM_ROOM_LIST =
  'hotel=diH7&dest=WD0M&in=2026-10-01&out=2026-10-04&guests=2' +
  '&key=2eb243ba-2f54-561b-8069-0db1439138f1';

describe('BookingEntry', () => {
  it('translates a RoomList selection into the checkout contract', () => {
    renderEntry(FROM_ROOM_LIST);

    expect(screen.getByText('checkout page')).toBeInTheDocument();

    const { pathname, searchParams } = landedAt();
    expect(pathname).toBe('/checkout');
    expect(Object.fromEntries(searchParams)).toEqual({
      destinationId: 'WD0M',
      hotelId: 'diH7',
      roomTypes: '2eb243ba-2f54-561b-8069-0db1439138f1',
      startDate: '2026-10-01',
      endDate: '2026-10-04',
      adults: '2',
      children: '0',
    });
  });

  /** hotelName is absent by design — RoomList does not have it. */
  it('forwards no hotel name and no price', () => {
    renderEntry(FROM_ROOM_LIST);

    const query = landedAt().search;
    expect(query).not.toMatch(/hotelName/);
    expect(query).not.toMatch(/price|total|amount|rate/i);
  });

  /** Ascenda's pipe-per-room spelling reaches us when more than one room is booked. */
  it('totals a pipe-separated guest count', () => {
    renderEntry(FROM_ROOM_LIST.replace('guests=2', 'guests=2%7C3'));

    expect(landedAt().searchParams.get('adults')).toBe('5');
  });

  /** The failure that actually happens: ResultsPage links to /hotel/:id without `dest`, so HotelDetailsPage reads null and RoomList forwards an empty string. */
  it('names the missing parameter instead of pricing an incomplete stay', () => {
    renderEntry(FROM_ROOM_LIST.replace('dest=WD0M', 'dest='));

    expect(screen.getByText(/room selection is incomplete/i)).toBeInTheDocument();
    expect(screen.getByText('dest', { selector: 'code' })).toBeInTheDocument();
    expect(screen.queryByText('checkout page')).toBeNull();
  });

  it('refuses a selection with no room key rather than quoting the hotel', () => {
    renderEntry(FROM_ROOM_LIST.replace(/&key=[^&]*/, ''));

    expect(screen.getByText(/room selection is incomplete/i)).toBeInTheDocument();
    expect(screen.getByText('key', { selector: 'code' })).toBeInTheDocument();
  });

  it('treats a zero or unparseable guest count as missing', () => {
    for (const guests of ['0', 'two', '']) {
      const { unmount } = renderEntry(FROM_ROOM_LIST.replace('guests=2', `guests=${guests}`));
      expect(screen.getByText(/room selection is incomplete/i), guests).toBeInTheDocument();
      unmount();
    }
  });
});
