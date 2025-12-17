/* eslint-env node */
import assert from 'node:assert/strict';
import { diffSchema } from '../api/_shared/schema-migrations/diff-engine.js';

function getChange(changes, changeId) {
  const found = changes.find((c) => c.change_id === changeId);
  assert.ok(found, `Expected change_id not found: ${changeId}`);
  return found;
}

function run() {
  // 1) Missing nullable column => SAFE
  {
    const ssot = {
      tables: [
        {
          name: 'Students',
          columns: [{ name: 'notes', type: 'text', nullable: true }],
        },
      ],
    };

    const db = {
      tables: [{ name: 'Students', columns: [{ name: 'id', type: 'uuid', nullable: false }] }],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'column:add:Students:notes');
    assert.equal(change.risk_level, 'SAFE');
  }

  // 2) Missing NOT NULL column without default => CAUTION
  {
    const ssot = {
      tables: [
        {
          name: 'Students',
          columns: [{ name: 'national_id', type: 'text', nullable: false }],
        },
      ],
    };

    const db = {
      tables: [{ name: 'Students', columns: [{ name: 'id', type: 'uuid', nullable: false }] }],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'column:add:Students:national_id');
    assert.equal(change.risk_level, 'CAUTION');
  }

  // 3) Type mismatch => DESTRUCTIVE
  {
    const ssot = {
      tables: [
        {
          name: 'Students',
          columns: [{ name: 'age', type: 'integer', nullable: true }],
        },
      ],
    };

    const db = {
      tables: [
        {
          name: 'Students',
          columns: [{ name: 'age', type: 'text', nullable: true }],
        },
      ],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'column:type:Students:age');
    assert.equal(change.risk_level, 'DESTRUCTIVE');
  }

  // 4) SSOT NOT NULL but DB nullable => CAUTION + preflight null query
  {
    const ssot = {
      tables: [
        {
          name: 'Students',
          columns: [{ name: 'name', type: 'text', nullable: false }],
        },
      ],
    };

    const db = {
      tables: [
        {
          name: 'Students',
          columns: [{ name: 'name', type: 'text', nullable: true }],
        },
      ],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'column:not_null:Students:name');
    assert.equal(change.risk_level, 'CAUTION');
    assert.ok(
      res.preflightQueries.some((q) => q.id === 'preflight:nulls:Students:name'),
      'Expected preflight null-count query'
    );
  }

  // 5) Missing constraint => CAUTION
  {
    const ssot = {
      tables: [{ name: 'Students', columns: [] }],
      constraints: [
        {
          table: 'Students',
          name: 'students_name_not_empty',
          definition: 'CHECK (char_length(name) > 0)',
          sql: 'ALTER TABLE public."Students" ADD CONSTRAINT "students_name_not_empty" CHECK (char_length(name) > 0);',
        },
      ],
    };

    const db = {
      tables: [{ name: 'Students', columns: [] }],
      constraints: [],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'constraint:add:Students:students_name_not_empty');
    assert.equal(change.risk_level, 'CAUTION');
  }

  // 6) Missing policy => SAFE
  {
    const ssot = {
      tables: [
        {
          name: 'Students',
          columns: [],
          expectedPolicies: ['students_select_policy'],
        },
      ],
    };

    const db = {
      tables: [{ name: 'Students', columns: [] }],
      policies: [],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'policy:create:Students:students_select_policy');
    assert.equal(change.risk_level, 'SAFE');
  }

  // 7) Locked table upgrades should never be reported as SAFE (conservative)
  {
    const ssot = {
      tables: [
        {
          name: 'lesson_template_overrides',
          columns: [{ name: 'metadata', type: 'jsonb', nullable: true }],
        },
      ],
    };

    const db = {
      tables: [{ name: 'lesson_template_overrides', columns: [{ name: 'id', type: 'uuid', nullable: false }] }],
    };

    const res = diffSchema(ssot, db);
    const change = getChange(res.changes, 'column:add:lesson_template_overrides:metadata');
    assert.equal(change.risk_level, 'CAUTION');
  }
}

try {
  run();
  // eslint-disable-next-line no-console
  console.log('schema-migrations diff-engine tests: OK');
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('schema-migrations diff-engine tests: FAILED');
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
}
