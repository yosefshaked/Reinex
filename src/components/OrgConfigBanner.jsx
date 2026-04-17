import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useOrg } from '@/org/OrgContext.jsx';

export default function OrgConfigBanner() {
  const { activeOrg } = useOrg();

  if (!activeOrg) {
    return null;
  }

  const pendingSetup = !activeOrg.setup_completed;

  if (!pendingSetup) {
    return null;
  }

  const message = 'נדרש להשלים את אשף ההגדרות ולוודא שהארגון הנוכחי מוכן לעבודה.';

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2 flex items-center gap-3 text-amber-800 text-sm mt-4 me-6 ms-6" role="status">
      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
      <p className="font-medium">{message}</p>
    </div>
  );
}
