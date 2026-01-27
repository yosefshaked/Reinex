import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import UnifiedEmployeeList from './UnifiedEmployeeList.jsx';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base sm:text-lg">ניהול עובדים</CardTitle>
          <Tabs value={viewMode} onValueChange={setViewMode} className="w-full sm:w-auto">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="employees">עובדים</TabsTrigger>
              <TabsTrigger value="unlinked">חברי ארגון ללא עובד</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
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
