/* eslint-env node */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeLocalExport, buildImportRows, LOCAL_EXPORT_FORMAT, LOCAL_EXPORT_VERSION } from './local-export-import.js';

const SOURCE_ORG = '11111111-1111-4111-8111-111111111111';
const TARGET_ORG = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function makeExport(tables) {
  return {
    format: LOCAL_EXPORT_FORMAT,
    version: LOCAL_EXPORT_VERSION,
    exported_at: '2026-05-04T00:00:00.000Z',
    source_org_id: SOURCE_ORG,
    app: 'reinex',
    schema_version: null,
    tables,
    excluded: {
      document_binary_files: 'not included in v1',
    },
  };
}

test('analyzeLocalExport rejects invalid format/version before import', () => {
  assert.deepEqual(analyzeLocalExport({ format: 'other', version: 1, tables: {} }), {
    valid: false,
    message: 'invalid_export_format',
  });

  assert.deepEqual(analyzeLocalExport({ format: LOCAL_EXPORT_FORMAT, version: 999, tables: {} }), {
    valid: false,
    message: 'unsupported_export_version',
  });
});

test('buildImportRows forces target org_id and remaps relationships to new IDs', () => {
  const localExport = makeExport({
    client_profiles: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', org_id: SOURCE_ORG, first_name: 'Source' },
    ],
    students: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        org_id: SOURCE_ORG,
        client_profile_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        name: 'Student',
      },
    ],
  });

  const { rowsByTable } = buildImportRows(localExport, TARGET_ORG, USER_ID);
  const importedProfile = rowsByTable.client_profiles[0];
  const importedStudent = rowsByTable.students[0];

  assert.equal(importedProfile.org_id, TARGET_ORG);
  assert.equal(importedStudent.org_id, TARGET_ORG);
  assert.notEqual(importedProfile.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.notEqual(importedStudent.id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  assert.equal(importedStudent.client_profile_id, importedProfile.id);
});

test('buildImportRows strips employee auth linkage and imports document metadata only', () => {
  const localExport = makeExport({
    Employees: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        org_id: SOURCE_ORG,
        name: 'Instructor',
        user_id: '99999999-9999-4999-8999-999999999999',
      },
    ],
    Documents: [
      {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        org_id: SOURCE_ORG,
        entity_type: 'instructor',
        entity_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'Sensitive file name.pdf',
        original_name: 'Sensitive file name.pdf',
        path: 'old-provider/path.pdf',
        url: 'https://example.invalid/file.pdf',
        uploaded_by: '99999999-9999-4999-8999-999999999999',
        metadata: { source: 'test' },
      },
    ],
  });

  const { rowsByTable } = buildImportRows(localExport, TARGET_ORG, USER_ID);
  const importedEmployee = rowsByTable.Employees[0];
  const importedDocument = rowsByTable.Documents[0];

  assert.equal(importedEmployee.user_id, null);
  assert.equal(importedDocument.org_id, TARGET_ORG);
  assert.equal(importedDocument.entity_id, importedEmployee.id);
  assert.equal(importedDocument.url, null);
  assert.equal(importedDocument.uploaded_by, null);
  assert.match(importedDocument.path, /^local-export-v1\//);
  assert.equal(importedDocument.metadata.local_export_note, 'binary file excluded from local export v1');
});
