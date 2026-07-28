import { describe, it, expect } from 'vitest';
import { qrCodeSvg } from '../../src/web/lib/qr';

describe('qrCodeSvg', () => {
  it('synchronously renders an SVG document (no await needed)', () => {
    const svg = qrCodeSvg('https://example.com/menu');
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
  });

  it('encodes the given text into the QR (round-trips through a decoder-free structural check)', () => {
    // We don't pull in a QR decoder just to prove the encoder path is exercised; instead
    // confirm two different inputs produce different SVGs (the encoder is actually
    // reading `text`, not returning a static fixture).
    const a = qrCodeSvg('https://example.com/menu');
    const b = qrCodeSvg('https://example.com/menu?wall=patio');
    expect(a).not.toBe(b);
  });

  it('is deterministic for the same input', () => {
    expect(qrCodeSvg('https://example.com/menu')).toBe(qrCodeSvg('https://example.com/menu'));
  });
});
