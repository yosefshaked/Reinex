import re
import os

files_to_fix = [
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
]

for filepath in files_to_fix:
    if not os.path.exists(filepath):
        print(f'❌ {filepath} NOT FOUND')
        continue
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    before_count = len(re.findall(r'\bresolveTenantClient\b', content))
    
    if before_count == 0:
        print(f'⏭️  {filepath}: already clean')
        continue
    
    # 1. Update import
    content = content.replace(
        'resolveTenantClient,',
        'withOrgScope,'
    )
    
    # 2. Remove the resolve block + if error check
    resolve_pattern = r'const\s+\{\s*client:\s*tenantClient,\s*error:\s*tenantError\s*\}\s*=\s*await\s+resolveTenantClient\s*\(\s*context,\s*supabase,\s*env,\s*orgId\s*\);\s*if\s*\(\s*tenantError\s*\)\s*\{\s*return\s+respond\s*\(\s*context,\s*tenantError\.status,\s*tenantError\.body\s*\);\s*\}\s*'
    content = re.sub(resolve_pattern, '', content, flags=re.DOTALL)
    
    # 3. BillingLedgerService if present
    content = content.replace(
        '{ tenantClient }',
        '{ tenantClient: supabase }'
    )
    
    after_count = len(re.findall(r'\bresolveTenantClient\b', content))
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print(f'✅ {filepath}: {before_count} → {after_count} resolveTenantClient refs')

print('\nPhase 1 complete!')
