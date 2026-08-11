import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterPanel from '../components/hotels/FilterPanel';
import type { SearchFilters } from '../types';

const emptyFilters: SearchFilters = {
  starRating: null,
  minGuestRating: null,
  minPrice: null,
  maxPrice: null,
};

describe('FilterPanel Component', () => {
  it('renders star rating, guest rating, price range and action buttons', () => {
    render(
      <FilterPanel filters={emptyFilters} onFilterChange={() => {}} onApply={() => {}} onClear={() => {}} />
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Star Rating')).toBeInTheDocument();
    expect(screen.getByText('Guest Rating')).toBeInTheDocument();
    expect(screen.getByText('Price Range (SGD)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5★' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1★' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByText('Apply Filters')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('selecting a star calls onFilterChange with that rating, and toggling off clears it', () => {
    const onFilterChange = vi.fn();
    const { rerender } = render(
      <FilterPanel filters={emptyFilters} onFilterChange={onFilterChange} onApply={() => {}} onClear={() => {}} />
    );

    const star5 = screen.getByRole('button', { name: '5★' });

    // First click: not selected → enables 5★.
    fireEvent.click(star5);
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...emptyFilters, starRating: 5 });

    // Parent re-renders with the new filter state → button is now selected.
    rerender(
      <FilterPanel
        filters={{ ...emptyFilters, starRating: 5 }}
        onFilterChange={onFilterChange}
        onApply={() => {}}
        onClear={() => {}}
      />
    );

    // Second click: selected → clears back to null.
    fireEvent.click(screen.getByRole('button', { name: '5★' }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...emptyFilters, starRating: null });
  });

  it('selects an "All" guest rating which sets minGuestRating to null', () => {
    const onFilterChange = vi.fn();
    const activeFilters: SearchFilters = { ...emptyFilters, minGuestRating: 4 };
    render(
      <FilterPanel filters={activeFilters} onFilterChange={onFilterChange} onApply={() => {}} onClear={() => {}} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onFilterChange).toHaveBeenCalledWith({ ...activeFilters, minGuestRating: null });
  });

  it('updates min and max price via number inputs', () => {
    const onFilterChange = vi.fn();
    // A stateful wrapper mirrors how ResultsPage drives FilterPanel.
    function Harness() {
      const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
      return (
        <FilterPanel
          filters={filters}
          onFilterChange={(next) => {
            setFilters(next);
            onFilterChange(next);
          }}
          onApply={() => {}}
          onClear={() => {}}
        />
      );
    }
    render(<Harness />);

    const minInput = screen.getByPlaceholderText('Min') as HTMLInputElement;
    const maxInput = screen.getByPlaceholderText('Max') as HTMLInputElement;

    fireEvent.change(minInput, { target: { value: '100' } });
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...emptyFilters, minPrice: 100 });

    fireEvent.change(maxInput, { target: { value: '500' } });
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...emptyFilters, minPrice: 100, maxPrice: 500 });

    // Clearing the input maps back to null for that field.
    fireEvent.change(minInput, { target: { value: '' } });
    expect(onFilterChange).toHaveBeenLastCalledWith({ ...emptyFilters, minPrice: null, maxPrice: 500 });
  });

  it('calls onApply and onClear when the buttons are clicked', () => {
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <FilterPanel filters={emptyFilters} onFilterChange={() => {}} onApply={onApply} onClear={onClear} />
    );

    fireEvent.click(screen.getByText('Apply Filters'));
    expect(onApply).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});