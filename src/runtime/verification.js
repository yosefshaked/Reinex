function ensureDataClient(client) {
  if (!client || typeof client.rpc !== 'function') {
    throw new Error('נדרש לקוח Supabase תקף כדי להריץ בדיקות חיבור.');
  }
  return client;
}

async function defaultRunDiagnostics({ dataClient, signal }) {
  const client = ensureDataClient(dataClient);
  const options = signal ? { signal } : undefined;
  const { data, error } = await client.rpc('tuttiud.setup_assistant_diagnostics', {}, options);
  if (error) {
    throw error;
  }
  return Array.isArray(data) ? data : [];
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
