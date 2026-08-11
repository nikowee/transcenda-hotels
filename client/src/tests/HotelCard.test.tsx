import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HotelCard from '../components/hotels/HotelCard';
import type { Hotel } from '../types';

const baseHotel: Hotel = {
  id: 'hotel-1',
  name: 'Marina Bay Sands',
  price: 450,
  searchRank: 1,
  rating: 5,
  categories: ['Luxury', 'City'],
  address: '10 Bayfront Ave, Singapore',
  latitude: 1.2837,
  longitude: 103.8591,
  description: 'Iconic luxury hotel with infinity pool.',
  amenities: ['Pool', 'Spa', 'Gym', 'Restaurant'],
  images: ['https://example.com/mbs.jpg'],
};

describe('HotelCard Component', () => {
  it('renders hotel name, address, price and star rating', () => {
    render(<HotelCard hotel={baseHotel} onSelect={() => {}} />);

    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    expect(screen.getByText('10 Bayfront Ave, Singapore')).toBeInTheDocument();
    expect(screen.getByText('$450')).toBeInTheDocument();
    expect(screen.getByText('(5)')).toBeInTheDocument();
    expect(screen.getByText('Luxury')).toBeInTheDocument();
    expect(screen.getByText('City')).toBeInTheDocument();
    expect(screen.getByText(/Select Hotel/i)).toBeInTheDocument();
  });

  it('falls back to the placeholder image when the hotel has no images', () => {
    const hotel = { ...baseHotel, images: [] };
    render(<HotelCard hotel={hotel} onSelect={() => {}} />);

    const img = screen.getByAltText('Marina Bay Sands') as HTMLImageElement;
    expect(img.src).toContain('placeholder-hotel.jpg');
  });

  it('falls back to the placeholder image when the image fails to load', () => {
    render(<HotelCard hotel={baseHotel} onSelect={() => {}} />);

    const img = screen.getByAltText('Marina Bay Sands') as HTMLImageElement;
    expect(img.src).toContain('https://example.com/mbs.jpg');

    // Simulate a broken image → onError should swap to the placeholder.
    fireEvent.error(img);
    expect(img.src).toContain('placeholder-hotel.jpg');
  });

  it('shows a fallback address when the hotel has none', () => {
    const hotel = { ...baseHotel, address: '' };
    render(<HotelCard hotel={hotel} onSelect={() => {}} />);

    expect(screen.getByText('Location not available')).toBeInTheDocument();
  });

  it('does not render category badges when there are no categories', () => {
    const hotel = { ...baseHotel, categories: [] };
    render(<HotelCard hotel={hotel} onSelect={() => {}} />);

    expect(screen.queryByText('Luxury')).not.toBeInTheDocument();
    expect(screen.queryByText('City')).not.toBeInTheDocument();
  });

  it('calls onSelect when the Select Hotel button is clicked', () => {
    const onSelect = vi.fn();
    render(<HotelCard hotel={baseHotel} onSelect={onSelect} />);

    fireEvent.click(screen.getByText(/Select Hotel/i));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});