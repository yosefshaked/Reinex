import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Pencil, Send } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import ProfileMasterStrip from '@/components/ui/ProfileMasterStrip.jsx';
import { authenticatedFetch } from '@/lib/api-client.js';
import { useOrg } from '@/org/OrgContext.jsx';
import { useSupabase } from '@/context/SupabaseContext.jsx';
import { coerceAgorot, formatCurrency } from '@/lib/currency.js';
import SendFormDialog from '@/features/students/components/SendFormDialog.jsx';
import CreateClientProfileDialog from '@/features/clients/components/CreateClientProfileDialog.jsx';

function getInitials(profile) {
  const first = profile?.first_name?.[0] || '';
  const last = profile?.last_name?.[0] || '';
  return (first + last) || '?';
}

function getFullName(profile) {
  return profile?.full_name || [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

export default function OneTimeCustomerHeader({
  clientProfile,
  canEdit = false,
  onUpdated,
}) {
  const { activeOrgId } = useOrg();
  const { session } = useSupabase();
  const [sendFormDialogOpen, setSendFormDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [summary, setSummary] = useState({ formsCount: null, balance: 0, debt: 0 });

  const loadSummary = useCallback(async () => {
    if (!clientProfile?.id || !session || !activeOrgId) return;

    try {
      const [billingPayload, formsPayload] = await Promise.all([
        authenticatedFetch('billing', {
          session,
          params: {
            org_id: activeOrgId,
            client_profile_id: clientProfile.id,
          },
        }),
        authenticatedFetch('form-submissions', {
          session,
          params: {
            org_id: activeOrgId,
            client_profile_id: clientProfile.id,
            limit: 100,
          },
        }),
      ]);

      const balanceAgorot = coerceAgorot(billingPayload?.summary?.balance);
      setSummary({
        formsCount: Array.isArray(formsPayload) ? formsPayload.length : 0,
        balance: balanceAgorot > 0 ? balanceAgorot : 0,
        debt: balanceAgorot < 0 ? Math.abs(balanceAgorot) : 0,
      });
    } catch (error) {
      console.error('Failed to load one-time customer header summary', error);
      setSummary({ formsCount: null, balance: 0, debt: 0 });
    }
  }, [activeOrgId, clientProfile?.id, session]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  if (!clientProfile) return null;

  const subtitleParts = [];
  if (clientProfile?.identity_number) subtitleParts.push(`ת.ז. ${clientProfile.identity_number}`);
  if (clientProfile?.phone) subtitleParts.push(clientProfile.phone);

  const kpis = [
    {
      label: 'טפסים',
      value: summary.formsCount ?? '—',
      className: 'text-slate-900',
    },
    {
      label: 'יתרה',
      value: formatCurrency(summary.balance),
      className: summary.balance > 0 ? 'text-emerald-700' : 'text-slate-900',
    },
    {
      label: 'חוב',
      value: formatCurrency(summary.debt),
      className: summary.debt > 0 ? 'text-red-600' : 'text-slate-900',
    },
  ];

  const primaryActions = canEdit ? [
    {
      label: 'עריכה',
      icon: <Pencil className="h-4 w-4" />,
      onClick: () => setEditDialogOpen(true),
    },
    {
      label: 'שלח טופס',
      icon: <Send className="h-4 w-4" />,
      onClick: () => setSendFormDialogOpen(true),
    },
  ] : [
    {
      label: 'שלח טופס',
      icon: <Send className="h-4 w-4" />,
      onClick: () => setSendFormDialogOpen(true),
    },
  ];

  const moreActions = [
    {
      label: 'העתק מזהה',
      icon: <Copy className="h-4 w-4" />,
      onClick: () => {
        navigator.clipboard.writeText(clientProfile.id);
        toast.success('מזהה הועתק');
      },
    },
  ];

  return (
    <>
      <ProfileMasterStrip
        backHref="/one-time-customers"
        backLabel="חזרה ללקוחות חד-פעמיים"
        avatarFallback={getInitials(clientProfile)}
        name={getFullName(clientProfile)}
        status={{ label: 'לקוח/ה חד-פעמי/ת', className: 'border-sky-200 bg-sky-50 text-sky-700' }}
        subtitle={subtitleParts.join(' · ')}
        kpis={kpis}
        primaryActions={primaryActions}
        moreActions={moreActions}
      />

      <SendFormDialog
        open={sendFormDialogOpen}
        onOpenChange={setSendFormDialogOpen}
        clientProfile={clientProfile}
      />

      <CreateClientProfileDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        session={session}
        orgId={activeOrgId}
        mode="edit"
        clientProfileId={clientProfile.id}
        initialValues={clientProfile}
        title="עריכת לקוח/ה חד-פעמי/ת"
        description="עדכנו את פרטי הקשר והזיהוי של הלקוח/ה מתוך אותו כרטיס."
        onSuccess={async () => {
          await onUpdated?.();
          await loadSummary();
        }}
      />
    </>
  );
}
