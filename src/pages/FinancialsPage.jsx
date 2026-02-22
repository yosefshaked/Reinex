import React from 'react'
import PageLayout from '@/components/ui/PageLayout.jsx'
import Card from '@/components/ui/CustomCard.jsx'

export default function FinancialsPage() {
  return (
    <PageLayout title="כספים" description="כלי כספים ודוחות (בקרוב)">
      <Card className="rounded-2xl border border-border bg-surface p-lg shadow-sm">
        <p className="text-sm text-muted-foreground">עמוד הכספים יתווסף בהמשך.</p>
      </Card>
    </PageLayout>
  )
}
