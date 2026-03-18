import React from 'react';
import { Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Financial tab: Coming soon placeholder.
 */
export default function StudentFinancialTab() {
  return (
    <Card className="border-dashed">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto rounded-full bg-amber-100 p-4 mb-3">
          <Wallet className="h-8 w-8 text-amber-600" />
        </div>
        <CardTitle className="text-xl">ניהול כספים</CardTitle>
        <CardDescription>מעקב חיובים, תשלומים, ויתרות</CardDescription>
      </CardHeader>
      <CardContent className="text-center">
        <p className="text-lg font-semibold text-amber-600">בקרוב...</p>
        <p className="text-sm text-neutral-500 mt-1">
          מודול הכספים בפיתוח ויהיה זמין בגרסה הבאה.
        </p>
      </CardContent>
    </Card>
  );
}
