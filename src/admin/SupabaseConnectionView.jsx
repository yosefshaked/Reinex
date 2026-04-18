import React from 'react';
import { Link } from 'react-router-dom';
import SetupAssistant from '@/components/settings/SetupAssistant.jsx';
import { useOrg } from '@/org/OrgContext.jsx';

export default function SupabaseConnectionView() {
  const { activeOrg } = useOrg();

  if (!activeOrg) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Supabase Connection</h2>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p className="text-sm">
            Select an organization first, then return here to run the setup assistant.
          </p>
          <Link
            to="/select-org"
            className="mt-3 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Go to organization selection
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Supabase Connection</h2>
        <p className="mt-1 text-sm text-slate-600">
          Running setup for organization: <span className="font-medium">{activeOrg.name}</span>
        </p>
      </div>
      <SetupAssistant />
    </div>
  );
}
