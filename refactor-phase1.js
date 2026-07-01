import fs from 'fs';

const files = [
    'api/calendar-corrections/index.js',
    'api/documents-check/index.js',
    'api/documents-download/index.js',
    'api/documents/index.js',
    'api/form-submissions/index.js',
    'api/instructor-files-check/index.js',
    'api/org-documents-check/index.js',
    'api/storage-bulk-download/index.js',
    'api/student-files-check/index.js',
    'api/waiting-list-intake/index.js',
];

files.forEach(filepath => {
    if (!fs.existsSync(filepath)) {
        console.log(`❌ ${filepath} NOT FOUND`);
        return;
    }
    
    let content = fs.readFileSync(filepath, 'utf-8');
    const beforeCount = (content.match(/\bresolveTenantClient\b/g) || []).length;
    
    if (beforeCount === 0) {
        console.log(`⏭️  ${filepath}: already clean`);
        return;
    }
    
    // 1. Update import
    content = content.replace('resolveTenantClient,', 'withOrgScope,');
    
    // 2. Remove resolve block
    const pattern = /const\s+\{\s*client:\s*tenantClient,\s*error:\s*tenantError\s*\}\s*=\s*await\s+resolveTenantClient\s*\([^)]*\);?\s*if\s*\(\s*tenantError\s*\)\s*\{\s*return\s+respond\s*\([^}]*\);\s*\}/s;
    content = content.replace(pattern, '');
    
    // 3. BillingLedgerService
    content = content.replace('{ tenantClient }', '{ tenantClient: supabase }');
    
    const afterCount = (content.match(/\bresolveTenantClient\b/g) || []).length;
    
    fs.writeFileSync(filepath, content, 'utf-8');
    
    console.log(`✅ ${filepath}: ${beforeCount} → ${afterCount} resolveTenantClient refs`);
});

console.log('\nPhase 1 complete!');
