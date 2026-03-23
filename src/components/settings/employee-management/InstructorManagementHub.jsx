import React from 'react';
import UnifiedEmployeeList from './UnifiedEmployeeList.jsx';

export default function InstructorManagementHub({ session, orgId, activeOrgHasConnection, tenantClientReady }) {
  const canLoad = Boolean(session && orgId && activeOrgHasConnection && tenantClientReady);

  if (!activeOrgHasConnection || !tenantClientReady) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
        נדרש חיבור Supabase פעיל כדי לנהל עובדים.
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
