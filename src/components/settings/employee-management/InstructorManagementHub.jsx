import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import UnifiedEmployeeList from './UnifiedEmployeeList.jsx';

export default function InstructorManagementHub({ session, orgId, activeOrgHasConnection, tenantClientReady }) {
  const canLoad = Boolean(session && orgId && activeOrgHasConnection && tenantClientReady);
  const [viewMode, setViewMode] = React.useState('employees');

  if (!activeOrgHasConnection || !tenantClientReady) {
    return (
      <Card className="w-full border-0 shadow-lg bg-white/80">
        <CardHeader>
          <CardTitle>ניהול עובדים</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">נדרש חיבור Supabase פעיל כדי לנהל עובדים.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-0 shadow-lg bg-white/80">
      <CardHeader>
        <CardTitle className="text-base sm:text-lg">ניהול עובדים</CardTitle>
      </CardHeader>
      <CardContent dir="rtl">
        <UnifiedEmployeeList
          session={session}
          orgId={orgId}
          canLoad={canLoad}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </CardContent>
    </Card>
  );
}
