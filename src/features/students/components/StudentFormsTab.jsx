import React from 'react';

/**
 * Forms tab: Coming soon placeholder.
 */
export default function StudentFormsTab() {
  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="h-1.5 bg-blue-500" />
      <div className="p-8 text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center text-2xl">📋</div>
        <h3 className="text-xl font-semibold text-zinc-800">טפסים</h3>
        <p className="text-sm text-muted-foreground">ניהול טפסי הרשמה, הסכמות, ושאלונים</p>
        <p className="text-lg font-semibold text-blue-600">בקרוב...</p>
        <p className="text-sm text-muted-foreground">
          מודול הטפסים בפיתוח ויהיה זמין בגרסה הבאה.
        </p>
      </div>
    </div>
  );
}
