import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingPage from '../pages/LoadingPage';

describe('LoadingPage', () => {
    it('shows the default message when no props are given', () => {
        render(<LoadingPage />);

        expect(screen.getByText(/finding your perfect stay/i)).toBeInTheDocument();
    });

    it('shows a custom message when one is provided', () => {
        render(<LoadingPage message="Loading rooms..." />);

        expect(screen.getByText('Loading rooms...')).toBeInTheDocument();
        expect(screen.queryByText(/finding your perfect stay/i)).not.toBeInTheDocument();
    });

    it('renders no error text while loading', () => {
        render(<LoadingPage />);

        expect(screen.getByText('🏨')).toBeInTheDocument();
        expect(screen.queryByText('⚠️')).not.toBeInTheDocument();
    });

    it('renders the error message and warning icon when an error is passed', () => {
        render(<LoadingPage error="Failed to load hotel details (502)" />);

        expect(screen.getByText('Failed to load hotel details (502)')).toBeInTheDocument();
        expect(screen.getByText('⚠️')).toBeInTheDocument();
        expect(screen.queryByText('🏨')).not.toBeInTheDocument();
    });

    it('keeps the message visible alongside an error', () => {
        render(<LoadingPage message="Finding your perfect stay..." error="Network unavailable" />);

        expect(screen.getByText(/finding your perfect stay/i)).toBeInTheDocument();
        expect(screen.getByText('Network unavailable')).toBeInTheDocument();
    });
});
