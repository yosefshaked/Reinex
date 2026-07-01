/**
 * useImportRelations.js — Cache and expose connected-component relation groups
 * for an import workspace.
 *
 * Fetches once per workspaceId (or on explicit invalidate/refetch), then gives
 * callers `getGroupForCandidate(candidateId)` to look up the family group for
 * any candidate without triggering a new network call.
 *
 * Usage:
 *   const { loading, error, getGroupForCandidate, refetch } = useImportRelations(workspaceId);
 *   const group = getGroupForCandidate(candidate.id);
 *   // group: { id, group_key, customer, guardian, guardian_link } | null
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCandidateRelations } from '../api/importWorkspacesApi.js';

/**
 * @param {string|null|undefined} workspaceId
 */
export function useImportRelations(workspaceId) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // groups: object[] — the raw array from the server
  const [groups, setGroups] = useState([]);

  // candidateId → group index into `groups`; rebuilt whenever `groups` changes
  const indexRef = useRef(new Map());

  // Rebuild the lookup index whenever groups change
  useEffect(() => {
    const index = new Map();
    for (const group of groups) {
      for (const type of ['customer', 'guardian', 'guardian_link']) {
        for (const member of (group[type] || [])) {
          if (member?.id) index.set(member.id, group);
        }
      }
    }
    indexRef.current = index;
  }, [groups]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCandidateRelations(workspaceId);
      setGroups(result?.groups || []);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינת קשרי מועמדים');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  // Fetch once on mount / workspace change
  useEffect(() => {
    load();
  }, [load]);

  /**
   * Look up the relation group for a given candidate id.
   * Returns null if not found (e.g. service entities or loading).
   * @param {string} candidateId
   * @returns {object|null}
   */
  const getGroupForCandidate = useCallback((candidateId) => {
    if (!candidateId) return null;
    return indexRef.current.get(candidateId) ?? null;
  }, []);

  /**
   * Patch already-cached group members in place from server-returned rows, with no
   * network call (Approach A). Used after an edit whose response carries the edited
   * candidate + the siblings the server also corrected. Membership is unchanged, so
   * we only replace matching members by id; add/remove still needs refetch().
   * @param {object[]} rows
   */
  const applyCandidateUpdates = useCallback((rows) => {
    const byId = new Map((rows || []).filter((r) => r?.id).map((r) => [r.id, r]));
    if (byId.size === 0) return;
    setGroups((prev) => prev.map((group) => {
      let changed = false;
      const patch = (arr) => (arr || []).map((member) => {
        const update = byId.get(member.id);
        if (!update) return member;
        changed = true;
        return { ...member, ...update };
      });
      const next = {
        ...group,
        customer: patch(group.customer),
        guardian: patch(group.guardian),
        guardian_link: patch(group.guardian_link),
      };
      return changed ? next : group;
    }));
  }, []);

  /**
   * Refetch the relations (call after any mutation that changes the family structure,
   * e.g. creating a new guardian_link — a pure field edit uses applyCandidateUpdates).
   */
  const refetch = useCallback(() => load(), [load]);

  return { loading, error, groups, getGroupForCandidate, applyCandidateUpdates, refetch };
}
