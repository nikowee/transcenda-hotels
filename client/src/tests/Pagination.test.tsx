import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Pagination from '../components/hotels/Pagination';

describe('Pagination Component', () => {
  it('shows all page numbers when totalPages is small', () => {
    render(<Pagination currentPage={1} totalPages={3} onPageChange={() => {}} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('disables Previous on the first page and Next on the last page', () => {
    const { rerender } = render(
      <Pagination currentPage={1} totalPages={5} onPageChange={() => {}} />
    );

    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).toBeEnabled();

    rerender(<Pagination currentPage={5} totalPages={5} onPageChange={() => {}} />);

    expect(screen.getByLabelText('Previous page')).toBeEnabled();
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });

  it('calls onPageChange with the previous/next page', () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={3} totalPages={5} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(onPageChange).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByLabelText('Next page'));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('renders an ellipsis window for many pages (1 … 5 6 7 … 10)', () => {
    render(<Pagination currentPage={6} totalPages={10} onPageChange={() => {}} />);

    // First and last pages always visible.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();

    // Ellipses on both sides.
    expect(screen.getAllByText('...')).toHaveLength(2);

    // Current page and its neighbours.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('disables both arrows for a single page (totalPages=1)', () => {
    render(<Pagination currentPage={1} totalPages={1} onPageChange={() => {}} />);

    // The component itself always renders; the ResultsPage gates visibility
    // with `totalPages > 1`. Both arrows must be disabled here.
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    expect(screen.getByLabelText('Next page')).toBeDisabled();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
