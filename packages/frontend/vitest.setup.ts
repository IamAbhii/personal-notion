// Vitest setup: jest-dom matchers for every test file, plus a crypto.randomUUID shim for DOM
// environments that omit it, since the op builder mints client-side UUIDs.
import '@testing-library/jest-dom/vitest';

if (typeof crypto.randomUUID !== 'function') {
  let counter = 0;
  Object.defineProperty(crypto, 'randomUUID', {
    value: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  });
}
