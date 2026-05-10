export function normalizeDirection(value) {
  const normalized = String(value || '').toUpperCase();
  return normalized === 'CREDIT' || normalized === 'DEBIT' ? normalized : '';
}

export function groupLedgerEntries(entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map(list.map((entry) => [entry?.id, entry]));
  const reversalByOriginalId = new Map();

  for (const entry of list) {
    const originalId = entry?.reverses_transaction_id;
    if (!originalId || reversalByOriginalId.has(originalId)) {
      continue;
    }
    reversalByOriginalId.set(originalId, entry);
  }

  const groups = [];
  const consumedIds = new Set();

  for (const entry of list) {
    const entryId = entry?.id;
    if (!entryId || consumedIds.has(entryId)) {
      continue;
    }

    if (entry?.reverses_transaction_id) {
      const original = byId.get(entry.reverses_transaction_id);
      if (original && !consumedIds.has(original.id)) {
        continue;
      }
    }

    const reversal = reversalByOriginalId.get(entryId);
    if (reversal?.id && !consumedIds.has(reversal.id)) {
      groups.push({
        key: `pair:${entryId}:${reversal.id}`,
        kind: 'reversal_pair',
        originalEntry: entry,
        reversalEntry: reversal,
      });
      consumedIds.add(entryId);
      consumedIds.add(reversal.id);
      continue;
    }

    groups.push({
      key: `single:${entryId}`,
      kind: 'single',
      entry,
    });
    consumedIds.add(entryId);
  }

  for (const entry of list) {
    if (!entry?.id || consumedIds.has(entry.id)) {
      continue;
    }
    groups.push({
      key: `single:${entry.id}`,
      kind: 'single',
      entry,
    });
  }

  return groups;
}

export function sumByDirection(entries = [], direction = '') {
  const normalizedDirection = normalizeDirection(direction);
  if (!normalizedDirection) return 0;
  return (Array.isArray(entries) ? entries : []).reduce((sum, entry) => (
    normalizeDirection(entry?.direction) === normalizedDirection
      ? sum + Number(entry?.amount || 0)
      : sum
  ), 0);
}
