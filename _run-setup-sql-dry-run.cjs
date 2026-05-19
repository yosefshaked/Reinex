#!/usr/bin/env node
/**
 * Dry-run execution of consolidated setup-sql.js against local Supabase
 * Uses psql to execute SQL directly against the PostgreSQL database
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Local Supabase uses default postgres credentials on port 54322
// Extract port from SUPABASE_URL in local.settings.json
const localSettings = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'api', 'local.settings.json'), 'utf-8')
);

const SUPABASE_URL = localSettings.Values.SUPABASE_URL;
// http://127.0.0.1:54331 is the HTTP API endpoint
// PostgreSQL is typically at port 54322 for local Supabase
// We need to get the actual database connection info

console.log(`🔗 Local Supabase URL: ${SUPABASE_URL}`);

// Read the setup-sql.js file and extract the SQL script
const setupSqlPath = path.join(__dirname, 'src', 'lib', 'setup-sql.js');
let setupSqlContent = fs.readFileSync(setupSqlPath, 'utf-8');

// Extract the SQL script from the template literal
// Pattern: export const SETUP_SQL_SCRIPT = String.raw`...`
const match = setupSqlContent.match(/String\.raw`([\s\S]*?)`/);
if (!match) {
  console.error('❌ Could not extract SQL script from setup-sql.js');
  process.exit(1);
}

const sqlScript = match[1];
console.log(`✓ Extracted SQL script (${sqlScript.length} characters)\n`);

// Save the SQL script to a temporary file
const tmpSqlFile = path.join(__dirname, '_setup-sql-tmp.sql');
fs.writeFileSync(tmpSqlFile, sqlScript);
console.log(`✓ Saved SQL to temporary file: ${tmpSqlFile}\n`);

async function runDryRun() {
  const containerName = 'supabase_db_reinex-tenant';

  try {
    console.log(`⏳ Running SQL against container: ${containerName}...\n`);

    // Copy the SQL file into the container
    const copyCmd = `docker cp "${tmpSqlFile}" ${containerName}:/tmp/setup-sql.sql`;
    console.log(`Step 1: Copying SQL into container...`);
    await execAsync(copyCmd, { shell: 'powershell.exe' });
    console.log(`✓ File copied\n`);

    // Execute psql inside the container with ON_ERROR_STOP=1 to halt on first error
    const execCmd = `docker exec ${containerName} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/setup-sql.sql`;
    console.log(`Step 2: Executing SQL via psql inside container...`);
    console.log(`Command: ${execCmd}\n`);

    const { stdout, stderr } = await execAsync(execCmd, { shell: 'powershell.exe' });

    if (stderr) {
      console.log('📋 stderr:\n', stderr);
    }
    if (stdout) {
      console.log('📋 stdout:\n', stdout);
    }
    
    // Parse output for errors
    if (stderr) {
      console.log('📋 stderr output:\n', stderr);
    }
    
    if (stdout) {
      console.log('📋 stdout output:\n', stdout);
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ SQL execution completed successfully!');
    console.log(`${'='.repeat(70)}\n`);

    // Clean up temp file and container file
    fs.unlinkSync(tmpSqlFile);
    await execAsync(`docker exec ${containerName} rm /tmp/setup-sql.sql`, { shell: 'powershell.exe' }).catch(() => {});
    process.exit(0);

  } catch (err) {
    console.error(`\n❌ SQL execution failed:\n`);
    console.error(err.message);

    if (err.stderr) {
      console.error('\nstderr:\n', err.stderr);
    }

    if (err.stdout) {
      console.error('\nstdout:\n', err.stdout);
    }

    // Clean up temp file
    if (fs.existsSync(tmpSqlFile)) {
      fs.unlinkSync(tmpSqlFile);
    }

    process.exit(1);
  }
}

runDryRun().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
