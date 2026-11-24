#!/usr/bin/env node
/**
 * check-doc-links.js
 *
 * Checks the relative Markdown links in the agent instructions: AGENTS.md and every .md file
 * under docs/project-rules/. Each link is resolved from the folder of the file that contains it
 * and must point to an existing file or folder inside the repository.
 *
 * - Checked, when the target is a relative path (an optional `#anchor` or `?query` is ignored;
 *   anchors themselves are not checked):
 *   - inline links and images: `[text](target)` or `[text](<target with spaces>)`, with an
 *     optional title;
 *   - reference definitions: `[label]: target` or `[label]: <target>`. A reference link
 *     `[text][label]` or `[label]` goes to its definition, so checking every definition covers it.
 * - Skipped: links with a scheme (`https:`, `mailto:`), anchor-only links (`#…`), absolute
 *   paths (`/…`), footnotes (`[^1]: …`), anything inside a fenced code block, and examples
 *   inside inline code (a code span such as `[x](y)`).
 *
 * Usage: node scripts/check-doc-links.js [--root <repository root>]
 * Exits 1 on any missing target and names the source file, line and target.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ENTRY_FILE = 'AGENTS.md';
export const RULES_DIR = path.join('docs', 'project-rules');

const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;
// [text](target) or [text](<target>). Link text may hold escapes and one level of brackets; a bare
// target may hold balanced parentheses, as in file(1).md.
const INLINE_LINK = new RegExp(
  String.raw`\[(?:[^[\]\\]|\\.|\[[^\]]*\])*\]\(\s*(?:<([^<>\n]*)>|((?:[^\s()<>]|\([^\s()<>]*\))+))`
    + TITLE
    + String.raw`\s*\)`,
  'g',
);
// [label]: target or [label]: <target>, indented by at most three spaces.
const DEFINITION = new RegExp(String.raw`^ {0,3}\[([^\]]+)\]:\s*(?:<([^<>\n]*)>|(\S+))` + TITLE + String.raw`\s*$`);
// A code span: a run of backticks, its content, and a closing run of the same length.
const CODE_SPAN = /(`+)(?:(?!\1)[\s\S])+?\1(?!`)/g;
const FENCE = /^\s*(```|~~~)/;
const SKIP = /^([a-z][a-z0-9+.-]*:|#|\/)/i;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

function toLink(line, raw) {
  if (raw === undefined || raw === '' || SKIP.test(raw)) return null;
  let target = raw.split('#')[0].split('?')[0];
  try {
    target = decodeURI(target);
  } catch {
    // Keep the raw text; a malformed escape is reported as a missing target.
  }
  return target ? { line, raw, target } : null;
}

/** Returns the relative link targets of one Markdown text: [{ line, raw, target }]. */
export function extractLinks(text) {
  const links = [];
  let inFence = false;
  text.split(/\r?\n/).forEach((lineText, index) => {
    if (FENCE.test(lineText)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = index + 1;
    const definition = DEFINITION.exec(lineText);
    if (definition) {
      if (!definition[1].startsWith('^')) {
        const link = toLink(line, definition[2] ?? definition[3]);
        if (link) links.push(link);
      }
      return;
    }
    // Blank out each code span (same length, no brackets left), so an example inside inline code
    // is not a link, while link text that contains code, as in [`a.js`](a.js), still is.
    const scanned = lineText.replace(CODE_SPAN, (span) => 'x'.repeat(span.length));
    for (const match of scanned.matchAll(INLINE_LINK)) {
      const link = toLink(line, match[1] ?? match[2]);
      if (link) links.push(link);
    }
  });
  return links;
}

/** Checks the instruction files under `rootDir`. Returns { errors, files, links }. */
export function checkDocLinks(rootDir) {
  const root = path.resolve(rootDir);
  const errors = [];
  const entry = path.join(root, ENTRY_FILE);
  if (!fs.existsSync(entry)) errors.push(`${ENTRY_FILE} does not exist under ${root}`);
  const sources = [
    ...(fs.existsSync(entry) ? [entry] : []),
    ...listMarkdown(path.join(root, RULES_DIR)).sort(),
  ];

  let links = 0;
  for (const source of sources) {
    const sourceRel = toPosix(path.relative(root, source));
    for (const link of extractLinks(fs.readFileSync(source, 'utf8'))) {
      links += 1;
      const resolved = path.resolve(path.dirname(source), link.target);
      const resolvedRel = toPosix(path.relative(root, resolved));
      if (resolvedRel.startsWith('..') || path.isAbsolute(resolvedRel)) {
        errors.push(`${sourceRel}:${link.line}: link "${link.raw}" points outside the repository`);
      } else if (!fs.existsSync(resolved)) {
        errors.push(`${sourceRel}:${link.line}: link "${link.raw}" -> missing target ${resolvedRel}`);
      }
    }
  }
  return { errors, files: sources.length, links };
}

function main() {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf('--root');
  const root = rootFlag >= 0 ? args[rootFlag + 1] : process.cwd();
  const { errors, files, links } = checkDocLinks(root);
  if (errors.length > 0) {
    console.error(`Doc link check failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Doc links OK: ${links} relative link(s) in ${files} file(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
