/* eslint-env node */
/**
 * import-relations.js — Connected-components grouping for import candidates.
 *
 * Replaces the old fixed-hop `buildRelatedCandidates` with a proper union-find
 * over canonical link keys, so transitive family members (sibling students,
 * multiple guardians, etc.) are always found — regardless of which candidate is
 * the "anchor".
 *
 * Exported pure functions (no DB calls):
 *   candidateLinkKeys(candidate)  → string[]
 *   buildRelationGroups(candidates) → { groupIdByCandidateId, groups }
 */

import { validateIsraeliPhone, coerceIdentityNumber, coerceEmail } from './student-validation.js';

// ── Sentinel / placeholder values that must not form connections ────────────
const SENTINEL_VALUES = new Set([
  '', 'missing_identity', 'missing_guardian', 'manual', '0', '-',
]);

function isSentinel(value) {
  return !value || SENTINEL_VALUES.has(String(value).trim());
}

// ── Canonical key builders ──────────────────────────────────────────────────

function canonicalIdentityKey(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str || isSentinel(str)) return null;
  const result = coerceIdentityNumber(str);
  if (result.valid && result.value) return `id:${result.value}`;
  // Fallback: digits only (must be at least 5 digits to avoid trivial collisions)
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 5) return `id:${digits}`;
  return null;
}

function canonicalPhoneKey(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str || isSentinel(str)) return null;
  // Always canonicalize to digits-only so "054-1234567" and "0541234567" are the same key.
  // validateIsraeliPhone confirms the number is a valid Israeli phone before we accept it.
  const result = validateIsraeliPhone(str);
  if (result.valid && result.value) {
    const digits = result.value.replace(/\D/g, '');
    if (digits.length >= 7) return `phone:${digits}`;
  }
  // Fallback for unrecognized formats: digits only (must be at least 7 digits)
  const fallbackDigits = str.replace(/\D/g, '');
  if (fallbackDigits.length >= 7) return `phone:${fallbackDigits}`;
  return null;
}

function canonicalEmailKey(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str || isSentinel(str) || !str.includes('@')) return null;
  const result = coerceEmail(str);
  if (result.valid && result.value) return `email:${result.value.toLowerCase()}`;
  return null;
}

function joinKeys(candidate) {
  const values = candidate?.candidate_data?.__import?.join?.values;
  if (!values || typeof values !== 'object') return [];
  return Object.values(values)
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter((v) => v && !isSentinel(v))
    .map((v) => `join:${v}`);
}

/**
 * Row-provenance keys — the most reliable family signal we have.
 *
 * Every candidate carries the source row it was minted from (`source_row_id`),
 * and `merged_from_row_ids` records the rows analyze actually merged when it
 * resolved the cross-file join. So:
 *   - a guardian and the guardian_link(s) from the same parents row share that row
 *   - a guardian_link that pulled the student's identity from the students file
 *     carries that student row, which is the customer's own source row
 * That reconstructs the exact linkage analyze computed, with no dependence on
 * which optional fields (phone/email) the user happened to map, or on the join
 * value being re-persisted. A source row belongs to exactly one record, so this
 * can never over-merge unrelated families.
 */
function rowKeys(candidate) {
  const ids = [
    candidate?.source_row_id,
    ...(Array.isArray(candidate?.merged_from_row_ids) ? candidate.merged_from_row_ids : []),
  ]
    .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
    .filter((v) => v && !isSentinel(v));
  return [...new Set(ids)].map((v) => `row:${v}`);
}

/**
 * Return all namespaced canonical keys for a candidate.
 * Keys are namespaced to prevent cross-type collisions.
 */
export function candidateLinkKeys(candidate) {
  const data = candidate?.candidate_data || {};
  const type = candidate?.entity_type;
  const keys = new Set();

  if (type === 'customer') {
    const identity = canonicalIdentityKey(data.identity_number ?? data.student_identity_number);
    if (identity) keys.add(identity);
    for (const k of joinKeys(candidate)) keys.add(k);
    for (const k of rowKeys(candidate)) keys.add(k);
  } else if (type === 'guardian') {
    const phone = canonicalPhoneKey(data.guardian_phone);
    if (phone) keys.add(phone);
    const email = canonicalEmailKey(data.guardian_email);
    if (email) keys.add(email);
    for (const k of joinKeys(candidate)) keys.add(k);
    for (const k of rowKeys(candidate)) keys.add(k);
  } else if (type === 'guardian_link') {
    const identity = canonicalIdentityKey(data.identity_number ?? data.student_identity_number);
    if (identity) keys.add(identity);
    const phone = canonicalPhoneKey(data.guardian_phone);
    if (phone) keys.add(phone);
    const email = canonicalEmailKey(data.guardian_email);
    if (email) keys.add(email);
    for (const k of joinKeys(candidate)) keys.add(k);
    for (const k of rowKeys(candidate)) keys.add(k);
  }
  // 'service' entities don't participate in family grouping

  return [...keys];
}

// ── Disjoint-Set (union-find) ───────────────────────────────────────────────

function makeUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const rank = new Map(ids.map((id) => [id, 0]));

  function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    // Path compression
    let current = id;
    while (current !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) || 0;
    const rankB = rank.get(rb) || 0;
    if (rankA < rankB) {
      parent.set(ra, rb);
    } else if (rankA > rankB) {
      parent.set(rb, ra);
    } else {
      parent.set(rb, ra);
      rank.set(ra, rankA + 1);
    }
  }

  return { find, union };
}

// ── group_key helpers ───────────────────────────────────────────────────────

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (s && !isSentinel(s)) return s;
  }
  return null;
}

/**
 * Compute a display group_key from the members of a component.
 * Prefers customer identity, then guardian_link identity, then guardian phone,
 * then join value.
 */
function computeGroupKey(members) {
  let identityNumber = null;
  let guardianPhone = null;
  let joinValue = null;

  for (const m of members) {
    const data = m?.candidate_data || {};
    const type = m?.entity_type;
    if (!identityNumber) {
      if (type === 'customer') {
        identityNumber = firstNonEmpty(data.identity_number, data.student_identity_number);
      } else if (type === 'guardian_link') {
        identityNumber = firstNonEmpty(data.identity_number, data.student_identity_number);
      }
    }
    if (!guardianPhone) {
      if (type === 'guardian') {
        guardianPhone = firstNonEmpty(data.guardian_phone);
      } else if (type === 'guardian_link') {
        guardianPhone = guardianPhone || firstNonEmpty(data.guardian_phone);
      }
    }
    if (!joinValue) {
      const values = data?.__import?.join?.values;
      if (values && typeof values === 'object') {
        for (const v of Object.values(values)) {
          const s = v === null || v === undefined ? '' : String(v).trim();
          if (s && !isSentinel(s)) { joinValue = s; break; }
        }
      }
    }
  }
  return { identity_number: identityNumber, guardian_phone: guardianPhone, join_value: joinValue };
}

/**
 * Build connected-component groups from a flat array of candidates.
 *
 * Returns:
 *   groupIdByCandidateId — Map<candidateId, groupId>
 *   groups               — Map<groupId, { memberIds, group_key }>
 *
 * The stable group_id is the lexicographically smallest candidate id in the component.
 * Service entities are excluded from grouping (they have no family links).
 */
export function buildRelationGroups(candidates) {
  const eligible = (candidates || []).filter((c) => c?.id && c.entity_type !== 'service');
  const ids = eligible.map((c) => c.id);
  const { find, union } = makeUnionFind(ids);

  // Map each link key → first candidate id that had it
  const keyToFirstId = new Map();

  for (const candidate of eligible) {
    const keys = candidateLinkKeys(candidate);
    for (const key of keys) {
      if (keyToFirstId.has(key)) {
        union(candidate.id, keyToFirstId.get(key));
      } else {
        keyToFirstId.set(key, candidate.id);
      }
    }
  }

  // Collect components
  const componentMembers = new Map(); // rootId → candidate[]
  for (const candidate of eligible) {
    const root = find(candidate.id);
    if (!componentMembers.has(root)) componentMembers.set(root, []);
    componentMembers.get(root).push(candidate);
  }

  // Stable group id = lexicographically smallest candidate id in the component
  const groupIdByCandidateId = new Map();
  const groups = new Map();

  for (const [, members] of componentMembers) {
    const groupId = members.map((m) => m.id).sort()[0];
    const memberIds = members.map((m) => m.id);
    for (const id of memberIds) groupIdByCandidateId.set(id, groupId);
    groups.set(groupId, {
      memberIds,
      group_key: computeGroupKey(members),
    });
  }

  return { groupIdByCandidateId, groups };
}
