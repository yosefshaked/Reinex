// Acceptance tests for scripts/validate-plans-index.js (docs/plans/index.csv).
// Each case builds its own docs/plans-like folder in a temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseCsv, validatePlansIndex } from '../scripts/validate-plans-index.js';

const SCRIPT = fileURLToPath(new URL('../scripts/validate-plans-index.js', import.meta.url));
const created = [];

function plansDir({ csv, plans = ['repository/directory-restructure.md'], extra = [] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-index-'));
  created.push(dir);
  for (const plan of [...plans, ...extra]) {
    const file = path.join(dir, ...plan.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# plan\n');
  }
  if (csv !== undefined) fs.writeFileSync(path.join(dir, 'index.csv'), csv);
  return dir;
}

function errorsFor(options) {
  return validatePlansIndex(plansDir(options)).errors;
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe('plans index: valid registries pass', () => {
  it('accepts the plain registry', () => {
    const result = validatePlansIndex(plansDir({
      csv: 'path,title,status\nrepository/directory-restructure.md,Repository directory restructure,active\n',
    }));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.rows, [{ path: 'repository/directory-restructure.md', title: 'Repository directory restructure', status: 'active' }]);
  });

  it('accepts a quoted title with a comma', () => {
    const result = validatePlansIndex(plansDir({
      csv: 'path,title,status\nrepository/directory-restructure.md,"Payroll, leave and rates",planned\n',
    }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].title, 'Payroll, leave and rates');
  });

  it('accepts a quoted title with doubled inner quotes', () => {
    const result = validatePlansIndex(plansDir({
      csv: 'path,title,status\nrepository/directory-restructure.md,"The ""no month close"" decision",completed\n',
    }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].title, 'The "no month close" decision');
  });

  it('accepts a quoted title with a line break, CRLF line endings and no final newline', () => {
    const result = validatePlansIndex(plansDir({
      csv: 'path,title,status\r\nrepository/directory-restructure.md,"First line\r\nsecond line",canceled',
    }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0].title, 'First line\r\nsecond line');
  });

  it('accepts every allowed status and ignores supporting files below a plan folder', () => {
    const plans = ['a/one.md', 'a/two.md', 'b/three.md', 'b/four.md'];
    const result = validatePlansIndex(plansDir({
      plans,
      extra: ['a/one/mockup.md', 'README.md', 'a/README.md'],
      csv: 'path,title,status\na/one.md,One,planned\na/two.md,Two,active\nb/three.md,Three,completed\nb/four.md,Four,canceled\n',
    }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 4);
  });
});

describe('plans index: broken registries fail with a reason', () => {
  const valid = 'repository/directory-restructure.md,Repository directory restructure,active';

  it('rejects an unterminated quote', () => {
    const errors = errorsFor({ csv: 'path,title,status\nrepository/directory-restructure.md,"Never closed,active\n' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unterminated quoted field/);
  });

  it('rejects a quote inside an unquoted field', () => {
    const errors = errorsFor({ csv: 'path,title,status\nrepository/directory-restructure.md,Say "hi",active\n' });
    assert.match(errors[0], /double quote inside an unquoted field/);
  });

  it('rejects text after a closing quote', () => {
    const errors = errorsFor({ csv: 'path,title,status\nrepository/directory-restructure.md,"Title"x,active\n' });
    assert.match(errors[0], /after a closing quote/);
  });

  it('rejects a wrong field count (an unquoted comma in the title)', () => {
    const errors = errorsFor({ csv: 'path,title,status\nrepository/directory-restructure.md,Payroll, leave,active\n' });
    assert.ok(errors.some((e) => /record 1 .*expected 3 fields, found 4/.test(e)), errors.join('\n'));
  });

  it('rejects a wrong header', () => {
    const errors = errorsFor({ csv: `path,status,title\n${valid}\n` });
    assert.match(errors[0], /header must be exactly the three fields path, title, status/);
  });

  it('rejects a header that is one quoted field "path,title,status" (regression)', () => {
    const errors = errorsFor({ csv: `"path,title,status"\n${valid}\n` });
    assert.deepEqual(errors, ['line 1: header must be exactly the three fields path, title, status']);
  });

  it('rejects a header with an extra field', () => {
    const errors = errorsFor({ csv: `path,title,status,owner\n${valid},x\n` });
    assert.match(errors[0], /header must be exactly the three fields/);
  });

  it('rejects a bad status', () => {
    const errors = errorsFor({ csv: 'path,title,status\nrepository/directory-restructure.md,Repository directory restructure,done\n' });
    assert.ok(errors.some((e) => /status "done" is not one of planned, active, completed, canceled/.test(e)), errors.join('\n'));
  });

  it('rejects a duplicate path', () => {
    const errors = errorsFor({ csv: `path,title,status\n${valid}\n${valid}\n` });
    assert.ok(errors.some((e) => /record 2 .*already listed in record 1/.test(e)), errors.join('\n'));
  });

  it('rejects a row whose file is missing', () => {
    const errors = errorsFor({ csv: `path,title,status\n${valid}\npayroll/missing.md,Missing,planned\n` });
    assert.ok(errors.some((e) => /path "payroll\/missing.md" is not a plan file/.test(e)), errors.join('\n'));
  });

  it('rejects a row that points to a folder named like a plan (regression)', () => {
    const dir = plansDir({ csv: `path,title,status\n${valid}\npayroll/folder.md,Not a plan,planned\n` });
    fs.mkdirSync(path.join(dir, 'payroll', 'folder.md'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'payroll', 'folder.md', 'notes.md'), '# supporting file\n');
    const { errors } = validatePlansIndex(dir);
    assert.deepEqual(errors, ['record 2 (line 3): path "payroll/folder.md" is not a plan file in docs/plans/<topic>/ (missing, or not a regular file)']);
  });

  it('rejects a plan with no row', () => {
    const errors = errorsFor({ plans: ['repository/directory-restructure.md', 'payroll/live-pay.md'], csv: `path,title,status\n${valid}\n` });
    assert.deepEqual(errors, ['payroll/live-pay.md: plan has no row in index.csv']);
  });

  it('rejects a path outside the <topic>/<plan>.md pattern', () => {
    for (const bad of ['./repository/directory-restructure.md', 'repository\\directory-restructure.md', 'a/b/c.md', 'repository/README.md']) {
      const errors = errorsFor({ csv: `path,title,status\n${valid}\n"${bad.replace(/"/g, '""')}",Bad,planned\n` });
      assert.ok(errors.some((e) => /must be "<topic>\/<plan>.md"/.test(e)), `${bad}: ${errors.join('\n')}`);
    }
  });

  it('rejects a plan file directly in docs/plans/', () => {
    const errors = errorsFor({ extra: ['loose-plan.md'], csv: `path,title,status\n${valid}\n` });
    assert.deepEqual(errors, ['loose-plan.md: a plan must be in a topic folder (docs/plans/<topic>/<plan>.md)']);
  });

  it('rejects an empty title and a blank line', () => {
    const errors = errorsFor({ csv: 'path,title,status\nrepository/directory-restructure.md,,active\n\n' });
    assert.ok(errors.some((e) => /title is empty/.test(e)), errors.join('\n'));
    assert.ok(errors.some((e) => /record 2 .*expected 3 fields, found 1/.test(e)), errors.join('\n'));
  });

  it('rejects a missing index.csv', () => {
    const errors = errorsFor({ csv: undefined });
    assert.match(errors[0], /index\.csv does not exist/);
  });
});

describe('plans index: CSV parser', () => {
  it('keeps empty fields and quoted separators', () => {
    const { records, errors } = parseCsv('a,,"b,c"\n"",x,"y\nz"\n');
    assert.deepEqual(errors, []);
    assert.deepEqual(records.map((r) => r.fields), [['a', '', 'b,c'], ['', 'x', 'y\nz']]);
    assert.deepEqual(records.map((r) => r.line), [1, 2]);
  });
});

describe('plans index: command line', () => {
  it('exits 0 with a summary for a valid registry', () => {
    const dir = plansDir({ csv: 'path,title,status\nrepository/directory-restructure.md,"A, B",active\n' });
    const run = spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Plans index OK: 1 plan\(s\) \(planned 0, active 1, completed 0, canceled 0\)\./);
  });

  it('exits 1 and names the record and the reason', () => {
    const dir = plansDir({ csv: 'path,title,status\nrepository/directory-restructure.md,Title,paused\n' });
    const run = spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /record 1 \(line 2\): status "paused"/);
  });
});
