import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App.tsx';
import { initAuth } from '../lib/auth';
import api from '../lib/api';
import { moduleStore } from '../lib/moduleState';
import { initControlSettings } from '../lib/settings';
import { applyTheme } from '../lib/theme';
import './index.css';

// Apply the saved per-user theme before first render to avoid a flash of the wrong mode.
applyTheme();
import '@fontsource/poppins/300.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';

initAuth()
  .then(user => {
    // User is authenticated — fetch module settings NOW, before the first render,
    // so the sidebar and Modules page never flash incorrect state.
    if (user) {
      return Promise.all([
        api.get('/settings/modules')
          .then(r => moduleStore.init(r.data?.data?.disabled ?? []))
          .catch(() => {/* keep default (all enabled) on network failure */}),
        initControlSettings(),
      ]);
    }
  })
  .finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Toast styling lives in index.css under `.app-toast` so it uses the same theme tokens
        (--surface, --border, --text-primary, --font-sans) as the rest of the app and follows dark
        mode. Hardcoding colours here made every toast render white-on-white in dark mode, and the
        font stack was duplicated rather than taken from --font-sans. */}
    <Toaster
      position="top-right"
      offset={16}
      gap={8}
      toastOptions={{
        duration: 3500,
        className: 'app-toast',
      }}
    />
    <App />
  </StrictMode>,
));
