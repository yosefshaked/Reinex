import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import handler from './index.js';

function createContext(env = {}) {
  return {
    env,
    log: {
      info() {},
      error() {},
      warn() {},
    },
    res: null,
  };
}

describe('/api/config', () => {
  it('returns base runtime config from fallback VITE env names', async () => {
    const context = createContext({
      VITE_APP_SUPABASE_URL: 'https://example-control.supabase.co',
      VITE_APP_SUPABASE_ANON_KEY: 'anon-key-123',
    });

    await handler(context);

    assert.equal(context.res?.status, 200);
    const payload = JSON.parse(context.res.body);
    assert.equal(payload.source, 'api');
    assert.equal(payload.supabase_url, 'https://example-control.supabase.co');
    assert.equal(payload.anon_key, 'anon-key-123');
    assert.equal(context.res.headers['X-Config-Scope'], 'app');
  });

  it('returns server_misconfigured when no public config is available', async () => {
    const context = createContext({});

    await handler(context);

    assert.equal(context.res?.status, 500);
    assert.deepEqual(JSON.parse(context.res.body), { error: 'server_misconfigured' });
  });
});
