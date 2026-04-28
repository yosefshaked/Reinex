import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SendFormDialog from '@/features/students/components/SendFormDialog.jsx';

function getInitials(profile) {
  const first = profile?.first_name?.[0] || '';
  const last = profile?.last_name?.[0] || '';
  return (first + last) || '?';
}

function getFullName(profile) {
  return profile?.full_name || [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

export default function OneTimeCustomerHeader({ clientProfile, canManage = false }) {
  const [sendFormDialogOpen, setSendFormDialogOpen] = useState(false);

  if (!clientProfile) return null;

  const subtitleParts = [];
  if (clientProfile?.identity_number) subtitleParts.push(`ת.ז. ${clientProfile.identity_number}`);
  if (clientProfile?.phone) subtitleParts.push(clientProfile.phone);

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white flex items-center justify-center text-2xl font-bold shrink-0 shadow-lg shadow-violet-200/40">
              {getInitials(clientProfile)}
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-tight">{getFullName(clientProfile)}</h1>
                <Badge variant="secondary" className="bg-violet-50 text-violet-700 border-violet-200">לקוח/ה חד-פעמי/ת</Badge>
                <Badge variant="outline">ללא כרטיס תלמיד/ה</Badge>
              </div>
              {subtitleParts.length > 0 && (
                <p className="text-sm text-muted-foreground mt-1">{subtitleParts.join(' · ')}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-5 shrink-0 bg-white rounded-xl border border-border px-6 py-4 shadow-sm">
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-zinc-900">{clientProfile?.onboarding_status === 'approved' ? 'כן' : 'לא'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">מוכן/ה להמשך</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-emerald-600">{clientProfile?.guardian ? 'כן' : 'לא'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">איש קשר</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="text-center px-3">
              <p className="text-2xl font-bold text-amber-500">{Array.isArray(clientProfile?.tags) ? clientProfile.tags.length : 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">תגיות</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">
          <Button asChild variant="ghost" size="sm" className="gap-2 me-auto">
            <Link to="/one-time-customers">
              <ArrowRight className="h-4 w-4" />
              <span className="text-sm">חזרה</span>
            </Link>
          </Button>

          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSendFormDialogOpen(true)}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              שלח טופס
            </Button>
          )}
        </div>
      </div>

      <SendFormDialog
        open={sendFormDialogOpen}
        onOpenChange={setSendFormDialogOpen}
        clientProfile={clientProfile}
      />
    </>
  );
}
