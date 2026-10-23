import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import './index.css';
// Kegwall V2 design tokens (ADR-0001): spacing, radius, motion and the semantic color roles.
import './design/tokens.css';

// Self-hosted fonts (no CDN). The Kegwall type every surface uses: Big Shoulders Display and
// Atkinson Hyperlegible (design/fonts.ts).
import './design/fonts';
// IBM Plex Mono — the Terminal and Departures looks, and code in the admin (custom CSS,
// logs, snippets).
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
// Caveat — the Chalkboard wall look's hand-lettering (8a).
import '@fontsource/caveat/500.css';
import '@fontsource/caveat/600.css';
// Playfair Display — the Editorial wall look's serif (8b).
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/500-italic.css';
import '@fontsource/playfair-display/700.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element (#root) not found');
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
