import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// We don't enable vitest's `globals: true`, so @testing-library/react's automatic
// afterEach cleanup never registers itself — do it explicitly instead.
afterEach(() => {
  cleanup();
});

// Recharts' <ResponsiveContainer> (Task 9's stats charts) sizes itself from its DOM
// parent via ResizeObserver + getBoundingClientRect — see
// node_modules/recharts/es6/component/ResponsiveContainer.js's SizeDetectorContainer.
// jsdom has no layout engine: it has no ResizeObserver at all, and every element's
// getBoundingClientRect() returns all zeros, which ResponsiveContainer treats as "not
// measured yet" and renders nothing. A trivial ResizeObserver stub (it never needs to
// actually fire — nothing resizes the jsdom window mid-test) plus a fixed nonzero
// getBoundingClientRect are enough for every chart to size itself once, synchronously,
// on mount, so chart component tests can assert on real rendered output.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

Element.prototype.getBoundingClientRect = () => ({
  width: 600, height: 300, top: 0, left: 0, right: 600, bottom: 300, x: 0, y: 0,
  toJSON() {},
});
