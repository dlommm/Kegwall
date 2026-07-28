import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QrOverlay } from '../../src/web/components/QrOverlay';

describe('QrOverlay', () => {
  it('renders an SVG QR code encoding the given url', () => {
    render(<QrOverlay url="https://taproom.example/menu" />);
    const overlay = screen.getByTestId('qr-overlay');
    expect(overlay.querySelector('svg')).toBeTruthy();
  });

  it('surfaces the encoded link as a visually-hidden accessible link too', () => {
    render(<QrOverlay url="https://taproom.example/menu" />);
    const link = screen.getByRole('link', { name: /menu/i });
    expect(link).toHaveAttribute('href', 'https://taproom.example/menu');
  });

  it('re-renders a different QR when the url changes', () => {
    const { rerender, container } = render(<QrOverlay url="https://taproom.example/menu" />);
    const first = container.querySelector('svg')?.outerHTML;

    rerender(<QrOverlay url="https://taproom.example/menu?wall=patio" />);
    const second = container.querySelector('svg')?.outerHTML;

    expect(second).not.toBe(first);
  });
});
