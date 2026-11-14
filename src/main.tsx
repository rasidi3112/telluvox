import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// Fonts are bundled locally (no network requests): IBM Plex, latin subset.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './styles/global.css';

const el = document.getElementById('root');
if (!el) throw new Error('Root element #root not found');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
