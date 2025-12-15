// Legacy client retired: WorkSessions are not part of the current system.
// Keep the module to avoid breaking imports in any stale code paths, but throw immediately.

export function createWorkSessions() {
  throw new Error('WorkSessions API is retired. Use SessionRecords flows instead.');
}
