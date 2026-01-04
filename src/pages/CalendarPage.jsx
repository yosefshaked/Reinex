import React from 'react'
import PageLayout from '@/components/ui/PageLayout.jsx'
import Card from '@/components/ui/CustomCard.jsx'
import { ComplianceHeatmap } from '@/features/dashboard/components/ComplianceHeatmap.jsx'
import { useOrg } from '@/org/OrgContext.jsx'

export default function CalendarPage() {
  const { activeOrgHasConnection, tenantClientReady } = useOrg()

  return (
    <PageLayout title="יומן" description="תצוגת שבוע ומעקב תיעודים">
      {tenantClientReady && activeOrgHasConnection ? (
        <ComplianceHeatmap />
      ) : (
        <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
          <p className="text-sm text-muted-foreground">
            היומן יהיה זמין לאחר יצירת חיבור למסד הנתונים של הארגון.
          </p>
        </Card>
      )}
    </PageLayout>
  )
}
