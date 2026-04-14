import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import HmoSetupWorkspace from '@/features/finance/components/HmoSetupWorkspace.jsx';

const BILLING_POLICY_FIELDS = [
  {
    key: 'attended',
    label: 'נכח',
    description: 'האם לחייב את התלמיד כשהוא הגיע לשיעור.',
  },
  {
    key: 'no_show',
    label: 'לא הגיע',
    description: 'האם לחייב את התלמיד כשהוא לא הגיע.',
  },
  {
    key: 'cancelled_student',
    label: 'בוטל על ידי תלמיד',
    description: 'האם לחייב את התלמיד כשביטל את השיעור.',
  },
  {
    key: 'cancelled_clinic',
    label: 'בוטל על ידי המכון',
    description: 'האם לחייב את התלמיד כשהמכון ביטל את השיעור.',
  },
];

export default function BillingSettingsWorkspace({
  billingPolicy,
  setBillingPolicy,
  instructorPolicy,
  setInstructorPolicy,
  canMutateBillingPolicy,
  savingPolicy = false,
  loadingPolicy = false,
  onSaveBillingPolicy = null,
  onChanged = null,
}) {
  const handleBillingPolicyToggle = (key, checked) => {
    setBillingPolicy?.((current) => ({ ...current, [key]: checked }));
    // Auto-fill instructor policy from billing by default; user can still override before save.
    setInstructorPolicy?.((current) => ({ ...current, [key]: checked }));
  };

  const handleInstructorPolicyToggle = (key, checked) => {
    setInstructorPolicy?.((current) => ({ ...current, [key]: checked }));
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">מדיניות חיוב שיעורים</h3>
            <p className="text-sm text-muted-foreground">
              בוחרים כאן באילו מצבים לחייב את התלמיד ובאילו מצבים לשלם למדריך.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              שינוי בחיוב התלמיד יעדכן אוטומטית גם את שכר המדריך כברירת מחדל, וניתן לשנות ידנית לפני השמירה.
            </p>
          </div>
          {typeof onSaveBillingPolicy === 'function' && canMutateBillingPolicy ? (
            <Button onClick={onSaveBillingPolicy} disabled={savingPolicy || loadingPolicy}>
              {savingPolicy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              שמור מדיניות
            </Button>
          ) : null}
        </div>

        <div className="mt-4 space-y-3">
          {BILLING_POLICY_FIELDS.map((field) => (
            <div key={field.key} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-slate-50 p-4">
              <div>
                <div className="text-sm font-semibold text-zinc-900">{field.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{field.description}</div>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-slate-600">חיוב תלמיד: {billingPolicy?.[field.key] ? 'מחויב' : 'לא מחויב'}</Label>
                  <Switch
                    checked={Boolean(billingPolicy?.[field.key])}
                    onCheckedChange={(checked) => handleBillingPolicyToggle(field.key, checked)}
                    disabled={!canMutateBillingPolicy || savingPolicy || loadingPolicy}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-xs text-slate-600">שכר מדריך: {instructorPolicy?.[field.key] ? 'משולם' : 'לא משולם'}</Label>
                  <Switch
                    checked={Boolean(instructorPolicy?.[field.key])}
                    onCheckedChange={(checked) => handleInstructorPolicyToggle(field.key, checked)}
                    disabled={!canMutateBillingPolicy || savingPolicy || loadingPolicy}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-white p-0 shadow-sm">
        <div className="p-5">
          <HmoSetupWorkspace onChanged={onChanged} />
        </div>
      </section>
    </div>
  );
}
