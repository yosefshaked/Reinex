import React from 'react';

/**
 * Financial tab: Coming soon placeholder.
 */
export default function StudentFinancialTab() {
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="h-1.5 bg-amber-500" />
      <div className="p-8 text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center text-2xl">💰</div>
        <h3 className="text-xl font-semibold text-zinc-800">ניהול כספים</h3>
        <p className="text-sm text-muted-foreground">מעקב חיובים, תשלומים, ויתרות</p>
        <p className="text-lg font-semibold text-amber-600">בקרוב...</p>
        <p className="text-sm text-muted-foreground">
          מודול הכספים בפיתוח ויהיה זמין בגרסה הבאה.
        </p>
      </div>
    </div>
  );
}
