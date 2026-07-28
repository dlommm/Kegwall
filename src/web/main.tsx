import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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
