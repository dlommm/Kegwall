import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import './index.css';
// Kegwall V2 design tokens (ADR-0001): spacing, radius, motion and the semantic color roles.
import './design/tokens.css';

// Self-hosted fonts (no CDN) for the design direction's display/body faces —
// Oswald Variable (condensed display, beer names) + Inter Variable (humanist
// body/meta; also backs --font-mono-numeric via tabular-nums). Imported here,
// in the SPA's one unconditional entry chunk, rather than in ThemeProvider.tsx:
// ThemeProvider itself isn't mounted by any route yet (that lands with the
// wall/menu pages in later Phase 3 tasks), so a side-effect import living only
// there would get tree-shaken out of this build. main.tsx is always included,
// so this is the wiring that actually lands the .woff2 files in dist/web —
// verified below by inspecting the build output.
import '@fontsource-variable/oswald';
import '@fontsource-variable/inter';
// Pour Wall overhaul faces: Barlow Condensed 500-700 (display/numbers) +
// Barlow 400-600 (body) — the typographic identity of the redesign themes
// (Midnight Slate et al., see themes.ts). Static weight files (Barlow isn't
// published as a variable font on Fontsource).
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
// IBM Plex Mono — the Console admin look (8i) and the Terminal/Departures wall
// looks (8d/8f).
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
