import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// We don't enable vitest's `globals: true`, so @testing-library/react's automatic
// afterEach cleanup never registers itself — do it explicitly instead.
afterEach(() => {
  cleanup();
});
