import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Badge from './Badge';

afterEach(cleanup);

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>HOT</Badge>);
    expect(screen.getByText('HOT')).toBeTruthy();
  });

  it('applies the variant colour classes', () => {
    render(<Badge variant="red">At risk</Badge>);
    expect(screen.getByText('At risk').className).toContain('bg-red-100');
  });

  it('falls back to gray for the default variant', () => {
    render(<Badge>Default</Badge>);
    expect(screen.getByText('Default').className).toContain('bg-gray-100');
  });
});
