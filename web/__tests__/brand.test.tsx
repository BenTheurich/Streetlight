import { render, screen } from '@testing-library/react';
import Brand from '@/components/Brand';

describe('Brand', () => {
  it('renders the brand text', () => {
    render(<Brand />);
    expect(screen.getByText('Streetlight')).toBeInTheDocument();
  });
});
