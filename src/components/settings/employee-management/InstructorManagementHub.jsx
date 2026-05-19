import React from 'react';
import UnifiedEmployeeList from './UnifiedEmployeeList.jsx';

export default function InstructorManagementHub({ session, orgId }) {
  const canLoad = Boolean(session && orgId);

  if (!orgId) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        בחרו ארגון כדי לנהל עובדים.
      </div>
    );
  }

  return (
    <UnifiedEmployeeList
      session={session}
      orgId={orgId}
      canLoad={canLoad}
    />
  );
}
