/* eslint-env node */
import { normalizeString } from './org-bff.js';

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = i + 1 < line.length ? line[i + 1] : '';

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());

  return result.map((part) => part.replace(/^"|"$/g, ''));
}

function parseCsv(text) {
  const normalized = typeof text === 'string' ? text : '';
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line);

  if (!lines.length) {
    return { columns: [], rows: [] };
  }

  const columns = splitCsvLine(lines[0]).filter((column) => column);
  const rows = lines.slice(1).map((line) => splitCsvLine(line));

  const mappedRows = rows
    .map((values) => {
      const entry = {};
      columns.forEach((column, index) => {
        entry[column] = values[index] ?? '';
      });
      const hasContent = Object.values(entry).some((value) => normalizeString(value));
      return hasContent ? entry : null;
    })
    .filter((entry) => entry !== null);

  return { columns, rows: mappedRows };
}

export { splitCsvLine, parseCsv };
