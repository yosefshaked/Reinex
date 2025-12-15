function ensureDataClient(client) {
  if (!client || typeof client.rpc !== 'function') {
    throw new Error('נדרש לקוח Supabase תקף כדי להריץ בדיקות חיבור.');
  }
  return client;
}

async function defaultRunDiagnostics({ dataClient, signal }) {
  const client = ensureDataClient(dataClient);
  const options = signal ? { signal } : undefined;

  const publicResult = await client.schema('public').rpc('setup_assistant_diagnostics', {}, options);
  if (!publicResult.error) {
    return Array.isArray(publicResult.data) ? publicResult.data : [];
  }

  throw publicResult.error;
}

export async function verifyOrgConnection(options, { runDiagnostics = defaultRunDiagnostics } = {}) {
  if (!options || typeof options !== 'object') {
    throw new Error('נדרש אובייקט אפשרויות הכולל dataClient עבור בדיקת החיבור.');
  }

  const dataClient = ensureDataClient(options.dataClient ?? options.client ?? null);
  const signal = options.signal ?? null;

  const diagnostics = await runDiagnostics({ dataClient, signal });
  const allChecksPassed = Array.isArray(diagnostics)
    ? diagnostics.every((item) => item && item.success === true)
    : false;

  return { ok: allChecksPassed, diagnostics };
}

export const verifyConnection = verifyOrgConnection;
