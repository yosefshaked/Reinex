// Usage: node test/verify-backup.cjs <orgId> <YYYY-MM-DD>
// Example: node test/verify-backup.cjs 550e8400-e29b-41d4-a716-446655440000 2026-05-13

async function main() {
  const [,, orgId, backupDate] = process.argv;
  if (!orgId || !backupDate) {
    console.error('Usage: node test/verify-backup.cjs <orgId> <YYYY-MM-DD>');
    process.exit(1);
  }

  try {
    const [storageModule, backupModule] = await Promise.all([
      import('../api/cross-platform/storage-drivers/index.js'),
      import('../api/_shared/backup-utils.js'),
    ]);

    const { getStorageDriver } = storageModule;
    const { decryptBackup, validateBackupManifest } = backupModule;

    const storageDriver = getStorageDriver('managed', null, process.env);
    const filename = `backups/${orgId}/${backupDate}.enc`;
    const encryptedData = await storageDriver.getFile(filename);
    console.log('Loaded backup file:', filename);

    const manifest = await decryptBackup(encryptedData, process.env);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Decryption succeeded but manifest is invalid');
    }

    const validation = validateBackupManifest(manifest);
    if (!validation.valid) {
      throw new Error(validation.error || 'invalid_manifest');
    }

    console.log('Backup file is valid and decrypted successfully.');
    console.log(JSON.stringify({
      version: manifest.version,
      org_id: manifest.org_id,
      exported_at: manifest.exported_at,
      schema_version: manifest.schema_version,
      total_records: manifest.metadata?.total_records ?? 0,
      table_count: manifest.tables ? Object.keys(manifest.tables).length : 0,
      tables: Object.fromEntries(
        Object.entries(manifest.tables || {}).map(([name, rows]) => [name, Array.isArray(rows) ? rows.length : 0])
      ),
    }, null, 2));
  } catch (err) {
    console.error('Backup verification failed:', err.message);
    process.exit(2);
  }
}

main();
