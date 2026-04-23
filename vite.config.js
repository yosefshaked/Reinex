/* eslint-disable import/namespace, import/default */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      server.middlewares.use('/api/config', (_req, res, next) => {
        try {
          const settingsPath = path.resolve(__dirname, 'api', 'local.settings.json');
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
  // Use relative paths in production so dist can be opened from file:// or served from any subpath
  base: './',
  plugins: [react(), localApiConfigPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // Proxy all other /api/* to Azure Functions local runtime (7071).
    // Use 127.0.0.1 (IPv4) — Vite on Windows often binds to [::1] only.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7071',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
