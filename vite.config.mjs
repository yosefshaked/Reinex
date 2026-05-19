import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Dev-only plugin: serves /api/config directly from api/local.settings.json.
 *
 * Problem: Vite resolves /api/config as the source file api/config/index.js
 * before its proxy middleware can run, returning raw JS instead of JSON.
 * configureServer() middleware is inserted earlier in the stack and wins.
 *
 * All other /api/* requests fall through to the proxy → Azure Functions (7071).
 */
function localApiConfigPlugin() {
  return {
    name: 'local-api-config',
    configureServer(server) {
      server.middlewares.use('/api/config', (req, res, next) => {
        try {
          const settingsPath = path.resolve(process.cwd(), 'api', 'local.settings.json');
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          const env = settings.Values || {};
          const supabaseUrl = env.SUPABASE_URL || env.APP_SUPABASE_URL || '';
          const anonKey = env.SUPABASE_ANON_KEY || env.APP_SUPABASE_ANON_KEY || '';
          if (!supabaseUrl || !anonKey) return next();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ source: 'local-dev', supabaseUrl, supabaseAnonKey: anonKey }));
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), localApiConfigPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
  server: {
    // Proxy all other /api/* to Azure Functions local runtime.
    // Use 127.0.0.1 (IPv4) — Vite on Windows often binds to [::1] only
    // and 'localhost' can resolve to ::1 which won't reach IPv4-only listeners.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7071',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    minify: false,
  },
});
