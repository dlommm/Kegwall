import { describe, it, expect } from 'vitest';
import { diffFraction, startCameraMotion } from '../../src/web/lib/cameraMotion.js';

describe('diffFraction', () => {
  it('is 0 for identical frames', () => {
    const a = new Uint8ClampedArray([10, 10, 10, 255, 200, 200, 200, 255]);
    expect(diffFraction(a, a)).toBe(0);
  });
  it('is 1 when every pixel moved past the luma delta', () => {
    const prev = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const curr = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    expect(diffFraction(prev, curr)).toBe(1);
  });
  it('is 0.5 when half the pixels moved', () => {
    const prev = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const curr = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(diffFraction(prev, curr)).toBe(0.5);
  });
});

describe('startCameraMotion', () => {
  it('resolves null when the camera is unavailable', async () => {
    const stop = await startCameraMotion({
      onMotion: () => {}, getUserMedia: () => Promise.reject(new Error('denied')),
    });
    expect(stop).toBeNull();
  });
});
