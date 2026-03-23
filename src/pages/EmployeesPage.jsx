import React from 'react'
import PageLayout from '@/components/ui/PageLayout.jsx'
import InstructorManagementHub from '@/components/settings/employee-management/InstructorManagementHub.jsx'
import { useAuth } from '@/auth/AuthContext.jsx'
import { useOrg } from '@/org/OrgContext.jsx'

export default function EmployeesPage() {
  const { session } = useAuth()
  const { activeOrgId, activeOrgHasConnection, tenantClientReady } = useOrg()

  return (
    <PageLayout
      title="עובדים"
      description="ניהול מצבת כוח אדם, פרטים אישיים ומסמכים"
      style={{ maxWidth: 'min(1680px, 100vw)' }}
    >
      <InstructorManagementHub
        session={session}
        orgId={activeOrgId}
        activeOrgHasConnection={activeOrgHasConnection}
        tenantClientReady={tenantClientReady}
      />
    </PageLayout>
  )
}
