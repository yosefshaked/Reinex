// Usage: node test/verify-backup.js <backup-file-path> <password>
// Example: node test/verify-backup.js ./backup-2025-10-28.tuttiud.enc ABCD-EF12-3456-7890-ABCD

const fs = require('fs');
const path = require('path');
const { decryptBackup } = require('../api/_shared/backup-utils');

async function main() {
  const [,, filePath, password] = process.argv;
  if (!filePath || !password) {
    console.error('Usage: node test/verify-backup.js <backup-file-path> <password>');
    process.exit(1);
  }

  try {
    const absPath = path.resolve(filePath);
    const encryptedData = fs.readFileSync(absPath);
    console.log('Loaded backup file:', absPath);

    const manifest = await decryptBackup(encryptedData, password);
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Decryption succeeded but manifest is invalid');
    }

    console.log('Backup file is valid and decrypted successfully!');
    console.log('Manifest summary:');
    console.log(JSON.stringify({
      version: manifest.version,
      org_id: manifest.org_id,
      created_at: manifest.created_at,
      schema_version: manifest.schema_version,
      tables: manifest.tables?.map(t => ({ name: t.name, records: Array.isArray(t.records) ? t.records.length : 0 }))
    }, null, 2));
  } catch (err) {
    console.error('Backup file is invalid or password is incorrect:', err.message);
    process.exit(2);
  }
}

main();
