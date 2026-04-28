import React from 'react';
import { Mail, Phone, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';

function renderDisplayName(profile) {
  return profile?.full_name || [profile?.first_name, profile?.middle_name, profile?.last_name].filter(Boolean).join(' ').trim() || 'ללא שם';
}

export default function OneTimeCustomerOverviewTab({ clientProfile }) {
  if (!clientProfile) return null;

  const tags = Array.isArray(clientProfile?.tags) ? clientProfile.tags : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden xl:col-span-2">
        <div className="h-1.5 bg-violet-500" />
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center text-lg">👤</div>
            <h3 className="font-semibold text-zinc-800">פרטי לקוח/ה</h3>
          </div>
          <dl className="text-sm space-y-3">
            <DetailRow label="שם מלא" value={renderDisplayName(clientProfile)} />
            <DetailRow label="תעודת זהות" value={clientProfile.identity_number} />
            <DetailRow label="טלפון" value={clientProfile.phone} dir="ltr" />
            <DetailRow label="אימייל" value={clientProfile.email} dir="ltr" small />
            <DetailRow label="שיטת התראה" value={clientProfile.default_notification_method} />
            <DetailRow label="סטטוס תהליך" value={clientProfile.onboarding_status || 'not_started'} />
          </dl>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="h-1.5 bg-blue-500" />
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center text-lg">📇</div>
            <h3 className="font-semibold text-zinc-800">פרטי קשר</h3>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{clientProfile.phone || 'ללא טלפון'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{clientProfile.email || 'ללא אימייל'}</span>
            </div>
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <span>{clientProfile.guardian ? renderDisplayName(clientProfile.guardian) : 'ללא איש קשר משויך'}</span>
            </div>
          </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden md:col-span-2 xl:col-span-3">
          <div className="h-1.5 bg-teal-500" />
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-600 flex items-center justify-center text-lg">🏷</div>
              <h3 className="font-semibold text-zinc-800">תגיות</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Badge key={`${clientProfile.id}-${tag}`} variant="outline">{tag}</Badge>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, dir, small }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <dt className="text-muted-foreground text-xs">{label}</dt>
        <dd className={`font-medium ${small ? 'text-xs' : ''}`} dir={dir}>
          {value || '—'}
        </dd>
      </div>
      <hr className="border-border/50" />
    </>
  );
}
