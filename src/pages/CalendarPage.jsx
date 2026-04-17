import React from 'react'
import PageLayout from '@/components/ui/PageLayout.jsx'
import Card from '@/components/ui/CustomCard.jsx'
import { useOrg } from '@/org/OrgContext.jsx'
import DayScheduleView from '@/features/scheduling/components/DayScheduleView.jsx'

export default function CalendarPage() {
  const { activeOrgId } = useOrg()

  return (
    <PageLayout title="יומן" description="תצוגת יום">
      {activeOrgId ? (
        <DayScheduleView orgId={activeOrgId} />
      ) : (
        <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
          <p className="text-sm text-muted-foreground">
            היומן יהיה זמין לאחר בחירת ארגון.
          </p>
        </Card>
      )}
    </PageLayout>
  )
}
