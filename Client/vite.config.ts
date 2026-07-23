import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Public new-hire/candidate portals are external-facing and must stay reachable at clean ROOT URLs
// (e.g. /onboarding/<token>, /careers, /kiosk/<token>, /schedule/<token>) even when the main app is
// served under a sub-path like /xhrm. Without this, Vite's base handling 404s those bare paths, so
// links already shared with new hires break and land on the login screen. This dev-server plugin
// serves the SPA (index.html) for those paths at root; the app's client router then shows the portal.
const PUBLIC_PORTAL_RE = /^\/(onboarding|careers|kiosk|schedule)(\/|$)/;
function publicPortalsAtRoot(): Plugin {
  return {
    name: 'public-portals-at-root',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!PUBLIC_PORTAL_RE.test(url.split('?')[0])) return next();
        try {
          const html = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          res.end(await server.transformIndexHtml(url, html));
        } catch (e) { next(e as Error); }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // Sub-path the app is served under, configured via VITE_BASE_PATH (e.g. "/xhrm/" → the app lives
  // at http://host:3002/xhrm/). Normalised to always start and end with "/". Defaults to root "/".
  // The API proxy below uses absolute paths, so it is unaffected by the base.
  const base = `/${(env.VITE_BASE_PATH || '/').replace(/^\/+|\/+$/g, '')}/`.replace(/\/{2,}/g, '/');
  return {
    base,
    server: {
        port: 3099,
        host: '0.0.0.0',

        proxy: {
          // Requests to the HR API are proxied to the backend (PORT in Server/.env).
          "/v1/api/hr": {
            target: "http://localhost:3088",
            changeOrigin: true,
            secure: false,
          },
          '/uploads': {
              target: 'http://localhost:3088',
              changeOrigin: true,
          },
        },
      },
    plugins: [publicPortalsAtRoot(), react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    }
  };
});
