// Acceptance tests for scripts/check-doc-links.js (relative links in the agent instructions).
// Each case builds its own repository-like folder in a temp directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDocLinks, extractLinks } from '../scripts/check-doc-links.js';

const SCRIPT = fileURLToPath(new URL('../scripts/check-doc-links.js', import.meta.url));
const created = [];

// files: { 'relative/path': 'content' }; a path ending in '/' creates a folder.
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-links-'));
  created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    if (rel.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const BASE = {
  'AGENTS.md': '# A\n[rules](docs/project-rules/00-core-rules.md)\n',
  'docs/project-rules/00-core-rules.md': '# 00\n[org](../../api/_shared/org-bff.js) [sibling](30-backend.md)\n',
  'docs/project-rules/30-backend.md': '# 30\n[api folder](../../api/) [agents](../../AGENTS.md#always-on-rules)\n',
  'api/_shared/org-bff.js': 'export {};\n',
};

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe('doc links: valid instructions pass', () => {
  it('accepts file, folder, sibling and anchored links resolved from each file', () => {
    const result = checkDocLinks(repo(BASE));
    assert.deepEqual(result.errors, []);
    assert.equal(result.files, 3);
    assert.equal(result.links, 5);
  });

  it('skips external, anchor-only, absolute and fenced links', () => {
    const result = checkDocLinks(repo({
      ...BASE,
      'docs/project-rules/40-x.md': [
        '[web](https://example.com/x) [mail](mailto:a@b.c) [here](#top) [abs](/nowhere.md)',
        '```',
        '[in code](missing.md)',
        '```',
      ].join('\n'),
    }));
    assert.deepEqual(result.errors, []);
  });

  it('checks Markdown files in nested folders under docs/project-rules', () => {
    const result = checkDocLinks(repo({ ...BASE, 'docs/project-rules/sub/note.md': '[up](../00-core-rules.md)\n' }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.files, 4);
  });
});

describe('doc links: broken instructions fail', () => {
  it('reports a missing target with the source file, line and resolved target', () => {
    const { errors } = checkDocLinks(repo({
      ...BASE,
      'docs/project-rules/30-backend.md': '# 30\n\n[gone](../../api/backup-status/index.js)\n',
    }));
    assert.deepEqual(errors, [
      'docs/project-rules/30-backend.md:3: link "../../api/backup-status/index.js" -> missing target api/backup-status/index.js',
    ]);
  });

  it('resolves from the containing file, not from the repository root', () => {
    // From docs/project-rules/, "api/_shared/org-bff.js" means docs/project-rules/api/…, which is missing.
    const { errors } = checkDocLinks(repo({ ...BASE, 'docs/project-rules/50-x.md': '[wrong base](api/_shared/org-bff.js)\n' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /missing target docs\/project-rules\/api\/_shared\/org-bff\.js$/);
  });

  it('reports a broken link in AGENTS.md', () => {
    const { errors } = checkDocLinks(repo({ ...BASE, 'AGENTS.md': '[rules](docs/project-rules/99-missing.md)\n' }));
    assert.deepEqual(errors, ['AGENTS.md:1: link "docs/project-rules/99-missing.md" -> missing target docs/project-rules/99-missing.md']);
  });

  it('reports a link that leaves the repository', () => {
    const { errors } = checkDocLinks(repo({ ...BASE, 'AGENTS.md': '[out](../outside.md)\n' }));
    assert.deepEqual(errors, ['AGENTS.md:1: link "../outside.md" points outside the repository']);
  });

  it('reports a missing AGENTS.md', () => {
    const { errors } = checkDocLinks(repo({ 'docs/project-rules/00-core-rules.md': '# 00\n' }));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^AGENTS\.md does not exist/);
  });
});

describe('doc links: angle-bracket targets, reference links and inline code', () => {
  it('accepts an existing target written in angle brackets, with a space in its name', () => {
    const result = checkDocLinks(repo({ ...BASE, 'docs/project-rules/my guide.md': '# g\n', 'AGENTS.md': '[guide](<docs/project-rules/my guide.md>)\n' }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.links, 1 + 2 + 2);
  });

  it('reports a missing target written in angle brackets', () => {
    const { errors } = checkDocLinks(repo({ ...BASE, 'AGENTS.md': '[guide](<missing guide.md>)\n' }));
    assert.deepEqual(errors, ['AGENTS.md:1: link "missing guide.md" -> missing target missing guide.md']);
  });

  it('accepts a reference link whose definition points to an existing file', () => {
    const result = checkDocLinks(repo({
      ...BASE,
      'docs/project-rules/40-x.md': 'See [the core rules][core] and [core].\n\n[core]: 00-core-rules.md "Core"\n',
    }));
    assert.deepEqual(result.errors, []);
  });

  it('reports a reference definition with a missing target, on the definition line', () => {
    const { errors } = checkDocLinks(repo({
      ...BASE,
      'docs/project-rules/40-x.md': 'See [guide][ref].\n\n[ref]: missing.md\n',
    }));
    assert.deepEqual(errors, ['docs/project-rules/40-x.md:3: link "missing.md" -> missing target docs/project-rules/missing.md']);
  });

  it('reports a reference definition in angle brackets with a missing target', () => {
    const { errors } = checkDocLinks(repo({ ...BASE, 'AGENTS.md': '[guide][g]\n\n  [g]: <docs/no such.md>\n' }));
    assert.deepEqual(errors, ['AGENTS.md:3: link "docs/no such.md" -> missing target docs/no such.md']);
  });

  it('ignores a link example inside inline code, including double-backtick spans', () => {
    const result = checkDocLinks(repo({
      ...BASE,
      'docs/project-rules/40-x.md': 'Write `[x](missing.md)` or ``a ` [y](gone.md)`` in prose.\n',
    }));
    assert.deepEqual(result.errors, []);
    assert.equal(result.links, 5);
  });

  it('still checks a link whose text is inline code', () => {
    const { errors } = checkDocLinks(repo({ ...BASE, 'AGENTS.md': '[`99-missing.md`](docs/project-rules/99-missing.md)\n' }));
    assert.equal(errors.length, 1);
  });

  it('skips footnote definitions', () => {
    const result = checkDocLinks(repo({ ...BASE, 'docs/project-rules/40-x.md': 'Text[^1].\n\n[^1]: a note, not a link\n' }));
    assert.deepEqual(result.errors, []);
  });
});

describe('doc links: link extraction', () => {
  it('keeps the line number and drops anchors and queries from the target', () => {
    assert.deepEqual(extractLinks('x\n[a](b.md#c) [d](e/f.md?g=1)'), [
      { line: 2, raw: 'b.md#c', target: 'b.md' },
      { line: 2, raw: 'e/f.md?g=1', target: 'e/f.md' },
    ]);
  });

  it('reads link text that contains code and brackets', () => {
    assert.deepEqual(extractLinks('[`../../api/x.js`](../../api/x.js) [a [b] c](d.md)').map((l) => l.target), ['../../api/x.js', 'd.md']);
  });
});

describe('doc links: command line', () => {
  it('exits 0 with a summary on valid instructions', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--root', repo(BASE)], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^Doc links OK: 5 relative link\(s\) in 3 file\(s\)\./);
  });

  it('exits 1 and names the source and the missing target', () => {
    const run = spawnSync(process.execPath, [SCRIPT, '--root', repo({ ...BASE, 'AGENTS.md': '[x](docs/nope.md)\n' })], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /AGENTS\.md:1: link "docs\/nope\.md" -> missing target docs\/nope\.md/);
  });
});
