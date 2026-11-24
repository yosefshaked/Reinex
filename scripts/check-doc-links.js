#!/usr/bin/env node
/**
 * check-doc-links.js
 *
 * Checks the relative Markdown links in the agent instructions: AGENTS.md and every .md file
 * under docs/project-rules/. Each link is resolved from the folder of the file that contains it
 * and must point to an existing file or folder inside the repository.
 *
 * - Checked: `[text](target)` links whose target is a relative path (an optional `#anchor` or
 *   `?query` is ignored; anchors themselves are not checked).
 * - Skipped: links with a scheme (`https:`, `mailto:`), anchor-only links (`#…`), absolute
 *   paths (`/…`), and anything inside a fenced code block.
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

const LINK = /\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
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
    for (const match of lineText.matchAll(LINK)) {
      const raw = match[1];
      if (SKIP.test(raw)) continue;
      let target = raw.split('#')[0].split('?')[0];
      try {
        target = decodeURI(target);
      } catch {
        // Keep the raw text; a malformed escape is reported as a missing target.
      }
      if (target) links.push({ line: index + 1, raw, target });
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
