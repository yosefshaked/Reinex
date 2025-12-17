/* eslint-env node */
import { randomUUID } from 'node:crypto';
import { readSsotSqlText } from './ssot-reader.js';
import { parseSsotExpectations } from './ssot-parser.js';
import { introspectTenantDb } from './introspection.js';
import { diffSchema } from './diff-engine.js';
import { generatePatchArtifacts } from './patch-generator.js';
import { hashSnapshot, hashSsot } from './audit-store.js';

export async function buildSchemaPlan({ tenantClient, ssotTextOverride }) {
  const ssotText = typeof ssotTextOverride === 'string' && ssotTextOverride.trim()
    ? ssotTextOverride
    : await readSsotSqlText();

  const ssotHash = hashSsot(ssotText);
  const ssot = parseSsotExpectations(ssotText);

  const introspectionResult = await introspectTenantDb(tenantClient);
  if (introspectionResult.error) {
    return {
      error: introspectionResult.error,
      ssotHash,
      ssot,
      dbSnapshot: null,
      diff: null,
      artifacts: null,
      planId: null,
    };
  }

  const dbSnapshot = introspectionResult.data;
  const dbSnapshotHash = hashSnapshot(dbSnapshot);

  const diff = diffSchema(ssot, dbSnapshot);
  const artifacts = generatePatchArtifacts(diff);
  const planId = randomUUID();

  return {
    error: null,
    planId,
    ssotHash,
    ssot,
    dbSnapshot,
    dbSnapshotHash,
    diff,
    artifacts,
  };
}
