import React from 'react';
import { ClipboardList } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Forms tab: Coming soon placeholder.
 */
export default function StudentFormsTab() {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto rounded-full bg-blue-100 p-4 mb-3">
          <ClipboardList className="h-8 w-8 text-blue-600" />
        </div>
        <CardTitle className="text-xl">טפסים</CardTitle>
        <CardDescription>ניהול טפסי הרשמה, הסכמות, ושאלונים</CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <p className="text-lg font-semibold text-blue-600">בקרוב...</p>
        <p className="text-sm text-neutral-500 mt-1">
          מודול הטפסים בפיתוח ויהיה זמין בגרסה הבאה.
        </p>
      </CardContent>
    </Card>
  );
}
