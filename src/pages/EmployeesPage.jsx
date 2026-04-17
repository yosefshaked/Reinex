import React from 'react'
import InstructorManagementHub from '@/components/settings/employee-management/InstructorManagementHub.jsx'
import { useAuth } from '@/auth/AuthContext.jsx'
import { useOrg } from '@/org/OrgContext.jsx'

/**
 * EmployeesPage — no own PageLayout.
 * AppShell already wraps every page in PageLayout (centred 1680 px container + padding).
 * We render content directly so the master-detail grid fills the available width.
 */
export default function EmployeesPage() {
  const { session } = useAuth()
  const { activeOrgId } = useOrg()

  return (
    <InstructorManagementHub
      session={session}
      orgId={activeOrgId}
    />
  )
}
