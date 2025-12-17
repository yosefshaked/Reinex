/* eslint-env node */

function isMissingFunctionError(error, functionName) {
  if (!error) {
    return false;
  }
  const message = String(error.message || '').toLowerCase();
  if (message.includes('could not find the function') && message.includes(functionName.toLowerCase())) {
    return true;
  }
  if (message.includes('function') && message.includes(functionName.toLowerCase()) && message.includes('does not exist')) {
    return true;
  }
  return false;
}

export async function introspectTenantDb(tenantClient, { rpcName = 'schema_introspection_v1' } = {}) {
  const { data, error } = await tenantClient
    .schema('public')
    .rpc(rpcName);

  if (error) {
    if (isMissingFunctionError(error, rpcName)) {
      const missing = new Error('schema_introspection_not_available');
      missing.code = 'schema_introspection_not_available';
      missing.status = 424;
      return { data: null, error: missing };
    }

    return { data: null, error };
  }

  return { data, error: null };
}

export async function runPreflightQueries(tenantClient, queries, { rpcName = 'schema_run_selects_v1' } = {}) {
  const payload = { queries };
  const { data, error } = await tenantClient
    .schema('public')
    .rpc(rpcName, payload);

  if (error) {
    if (isMissingFunctionError(error, rpcName)) {
      const missing = new Error('schema_preflight_not_available');
      missing.code = 'schema_preflight_not_available';
      missing.status = 424;
      return { data: null, error: missing };
    }

    return { data: null, error };
  }

  return { data, error: null };
}

export async function executeSchemaStatements(
  tenantClient,
  statements,
  {
    allowDestructive = false,
    confirmationPhrase = null,
    rpcName = 'schema_execute_statements_v1',
  } = {},
) {
  const payload = {
    statements,
    allow_destructive: allowDestructive,
    confirmation_phrase: confirmationPhrase,
  };

  const { data, error } = await tenantClient
    .schema('public')
    .rpc(rpcName, payload);

  if (error) {
    if (isMissingFunctionError(error, rpcName)) {
      const missing = new Error('schema_executor_not_available');
      missing.code = 'schema_executor_not_available';
      missing.status = 424;
      return { data: null, error: missing };
    }

    return { data: null, error };
  }

  return { data, error: null };
}
