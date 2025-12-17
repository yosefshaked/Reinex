import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Copy, RefreshCcw, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';

import PageLayout from '@/components/ui/PageLayout.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { cn } from '@/lib/utils';
import { useOrg } from '@/org/OrgContext.jsx';
import { useUserRole } from '@/features/onboarding/hooks/useUserRole.js';
import { toast } from 'sonner';

import {
  applySchemaDestructive,
  applySchemaSafe,
  createSchemaPlan,
  fetchSchemaHistory,
  runSchemaPreflight,
} from '@/features/admin/api/schema-migrations.js';

const REQUIRED_PHRASE = 'ALLOW DESTRUCTIVE CHANGES';

function riskUi(riskLevel) {
  if (riskLevel === 'SAFE') {
    return {
      label: 'בטוח',
      icon: ShieldCheck,
      className: 'bg-emerald-100 text-emerald-900',
    };
  }
  if (riskLevel === 'CAUTION') {
    return {
      label: 'זהיר',
      icon: AlertTriangle,
      className: 'bg-amber-100 text-amber-900',
    };
  }
  return {
    label: 'מסוכן',
    icon: ShieldAlert,
    className: 'bg-red-100 text-red-900',
  };
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('הועתק ללוח');
  } catch {
    toast.error('לא ניתן להעתיק ללוח');
  }
}

function summarizePlainBullets(change) {
  const bullets = [];
  if (change?.reason) {
    bullets.push(change.reason);
  }
  if (change?.category && change?.action) {
    bullets.push(`סוג שינוי: ${change.category} / ${change.action}`);
  }
  if (change?.object?.table) {
    bullets.push(`טבלה: ${change.object.table}`);
  }
  if (change?.object?.name) {
    bullets.push(`פריט: ${change.object.name}`);
  }
  return bullets;
}

export default function TenantSchemaPage() {
  const { tenantId } = useParams();
  const { activeOrgId, organizations, activeOrg } = useOrg();
  const role = useUserRole();

  const controlPlaneOrg = React.useMemo(() => {
    if (!tenantId) {
      return null;
    }
    if (activeOrg?.id === tenantId) {
      return activeOrg;
    }
    return Array.isArray(organizations)
      ? organizations.find((org) => org?.id === tenantId) || null
      : null;
  }, [activeOrg, organizations, tenantId]);

  const membershipRole = controlPlaneOrg?.membership?.role ?? null;
  const isAdminMembership = membershipRole === 'admin' || membershipRole === 'owner';
  const isAdmin = isAdminMembership || role === 'admin' || role === 'owner';

  const [simpleMode, setSimpleMode] = React.useState(true);
  const [expandedIds, setExpandedIds] = React.useState(() => new Set());

  const [plan, setPlan] = React.useState(null);
  const [planLoading, setPlanLoading] = React.useState(false);

  const [preflightLoading, setPreflightLoading] = React.useState(false);
  const [applySafeLoading, setApplySafeLoading] = React.useState(false);
  const [applyDangerLoading, setApplyDangerLoading] = React.useState(false);

  const [dangerChecked, setDangerChecked] = React.useState(false);
  const [dangerPhrase, setDangerPhrase] = React.useState('');

  const [history, setHistory] = React.useState([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  const tenantMismatch = activeOrgId && tenantId && activeOrgId !== tenantId;

  const refreshHistory = React.useCallback(async () => {
    if (!tenantId || !isAdmin) {
      return;
    }

    setHistoryLoading(true);
    try {
      const res = await fetchSchemaHistory(tenantId);
      setHistory(Array.isArray(res?.history) ? res.history : []);
    } catch (error) {
      toast.error(error?.message || 'שגיאה בטעינת היסטוריה');
    } finally {
      setHistoryLoading(false);
    }
  }, [tenantId, isAdmin]);

  React.useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const toggleExpanded = React.useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleGeneratePlan = React.useCallback(async () => {
    if (!tenantId) {
      return;
    }
    setPlanLoading(true);
    try {
      const res = await createSchemaPlan(tenantId);
      setPlan(res);
      toast.success('נוצרה תכנית שינויים');
      await refreshHistory();
    } catch (error) {
      const message = error?.data?.message || error?.message || 'שגיאה ביצירת תכנית';
      const bootstrap = error?.data?.bootstrap_sql;
      if (bootstrap) {
        setPlan({
          error: message,
          bootstrap_sql: bootstrap,
          hint: error?.data?.hint,
        });
      }
      toast.error(message);
    } finally {
      setPlanLoading(false);
    }
  }, [tenantId, refreshHistory]);

  const handleRunPreflight = React.useCallback(async () => {
    if (!tenantId || !plan?.plan_id) {
      return;
    }

    setPreflightLoading(true);
    try {
      const res = await runSchemaPreflight(tenantId, plan.plan_id);
      setPlan((prev) => ({
        ...prev,
        preflight_results: res.preflight_results,
      }));
      toast.success('בדיקות מקדימות הושלמו');
    } catch (error) {
      const bootstrap = error?.data?.bootstrap_sql;
      if (bootstrap) {
        setPlan((prev) => ({
          ...prev,
          bootstrap_sql: bootstrap,
          hint: error?.data?.hint,
        }));
      }
      toast.error(error?.message || 'בדיקות מקדימות נכשלו');
    } finally {
      setPreflightLoading(false);
    }
  }, [tenantId, plan?.plan_id]);

  const handleApplySafe = React.useCallback(async () => {
    if (!tenantId || !plan?.plan_id) {
      return;
    }

    setApplySafeLoading(true);
    try {
      const res = await applySchemaSafe(tenantId, plan.plan_id);
      toast.success('שינויים בטוחים הוחלו');
      setPlan((prev) => ({ ...prev, apply_result: res }));
      await refreshHistory();
    } catch (error) {
      const bootstrap = error?.data?.bootstrap_sql;
      if (bootstrap) {
        setPlan((prev) => ({
          ...prev,
          bootstrap_sql: bootstrap,
          hint: error?.data?.hint,
        }));
      }
      toast.error(error?.message || 'החלת שינויים בטוחים נכשלה');
    } finally {
      setApplySafeLoading(false);
    }
  }, [tenantId, plan?.plan_id, refreshHistory]);

  const handleApplyDestructive = React.useCallback(async () => {
    if (!tenantId || !plan?.plan_id) {
      return;
    }

    setApplyDangerLoading(true);
    try {
      const res = await applySchemaDestructive(tenantId, plan.plan_id, dangerPhrase);
      toast.success('שינויים מסוכנים הוחלו');
      setPlan((prev) => ({ ...prev, apply_result: res }));
      await refreshHistory();
    } catch (error) {
      toast.error(error?.message || 'החלת שינויים מסוכנים נכשלה');
    } finally {
      setApplyDangerLoading(false);
    }
  }, [tenantId, plan?.plan_id, dangerPhrase, refreshHistory]);

  const safeCount = plan?.summary_counts?.SAFE ?? 0;
  const cautionCount = plan?.summary_counts?.CAUTION ?? 0;
  const destructiveCount = plan?.summary_counts?.DESTRUCTIVE ?? 0;

  const driftDetected = Boolean(safeCount || cautionCount || destructiveCount);

  return (
    <PageLayout title="סנכרון סכימה" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-lg" dir="rtl">
        {!isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-right">אין הרשאה</CardTitle>
            </CardHeader>
            <CardContent className="text-right text-sm text-neutral-600">
              עמוד זה זמין למנהלים בלבד.
            </CardContent>
          </Card>
        ) : null}

        {tenantMismatch ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-right">ארגון לא תואם</CardTitle>
            </CardHeader>
            <CardContent className="space-y-sm text-right text-sm text-neutral-600">
              <p>הארגון שנבחר באפליקציה שונה מהקישור.</p>
              <Link className="text-primary underline" to="/select-org">בחר ארגון מחדש</Link>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row-reverse items-start justify-between gap-md">
            <div className="space-y-1">
              <CardTitle className="text-right">מצב סכימה</CardTitle>
              <p className="text-right text-sm text-neutral-600">
                בדיקה והשוואה בין בסיס הנתונים לבין ה-SSOT.
              </p>
            </div>
            <div className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1 text-sm font-medium',
              driftDetected ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
            )}>
              {driftDetected ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>{driftDetected ? 'זוהתה סטייה' : 'מסונכרן'}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-md">
            <div className="flex flex-row-reverse items-center justify-between gap-md">
              <Button
                type="button"
                onClick={handleGeneratePlan}
                disabled={!isAdmin || tenantMismatch || planLoading}
              >
                <RefreshCcw className="ml-2 h-4 w-4" aria-hidden="true" />
                {planLoading ? 'בודק…' : 'צור תכנית שינויים'}
              </Button>

              <div className="flex flex-row-reverse items-center gap-sm">
                <span className="text-sm text-neutral-700">הסבר פשוט</span>
                <Switch
                  checked={simpleMode}
                  onCheckedChange={setSimpleMode}
                  aria-label="הסבר פשוט"
                />
              </div>
            </div>

            {plan?.bootstrap_sql ? (
              <div className="rounded-md border border-border bg-surface p-md text-right">
                <p className="text-sm font-medium">נדרש Bootstrap</p>
                <p className="mt-1 text-sm text-neutral-600">{plan?.hint || 'יש להריץ את ה-SQL הבא פעם אחת ב-Supabase SQL Editor ואז לנסות שוב.'}</p>
                <div className="mt-2 flex flex-row-reverse gap-sm">
                  <Button type="button" variant="outline" onClick={() => copyToClipboard(plan.bootstrap_sql)}>
                    <Copy className="ml-2 h-4 w-4" aria-hidden="true" />
                    העתק SQL
                  </Button>
                </div>
                <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-3 text-xs" dir="ltr">
                  {plan.bootstrap_sql}
                </pre>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {plan?.summary_counts ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-right">סיכום תכנית</CardTitle>
            </CardHeader>
            <CardContent className="space-y-md">
              {(cautionCount > 0 || destructiveCount > 0) ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-md text-right text-sm text-amber-900">
                  קיימים שינויים זהירים/מסוכנים. שינוי בטוח לא מוחק נתונים.
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-md" dir="rtl">
                <div className="rounded-md bg-emerald-50 p-md text-right">
                  <div className="text-sm text-emerald-900">בטוח</div>
                  <div className="text-2xl font-semibold text-emerald-950">{safeCount}</div>
                </div>
                <div className="rounded-md bg-amber-50 p-md text-right">
                  <div className="text-sm text-amber-900">זהיר</div>
                  <div className="text-2xl font-semibold text-amber-950">{cautionCount}</div>
                </div>
                <div className="rounded-md bg-red-50 p-md text-right">
                  <div className="text-sm text-red-900">מסוכן</div>
                  <div className="text-2xl font-semibold text-red-950">{destructiveCount}</div>
                </div>
              </div>

              <div className="flex flex-row-reverse flex-wrap gap-sm">
                <Button type="button" variant="outline" onClick={handleRunPreflight} disabled={preflightLoading}>
                  {preflightLoading ? 'בודק…' : 'הרץ בדיקות מקדימות'}
                </Button>

                <Button type="button" onClick={handleApplySafe} disabled={applySafeLoading || safeCount === 0}>
                  <Wrench className="ml-2 h-4 w-4" aria-hidden="true" />
                  {applySafeLoading ? 'מחיל…' : 'החל שינויים בטוחים'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {Array.isArray(plan?.changes) && plan.changes.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-right">רשימת שינויים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-sm">
              {plan.changes.map((change) => {
                const meta = riskUi(change.risk_level);
                const Icon = meta.icon;
                const isOpen = expandedIds.has(change.change_id);

                return (
                  <div key={change.change_id} className="rounded-md border border-border">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(change.change_id)}
                      className="flex w-full flex-row-reverse items-center justify-between gap-md p-md text-right"
                    >
                      <div className="flex flex-row-reverse items-center gap-sm">
                        <span className={cn('inline-flex items-center gap-2 rounded px-2 py-1 text-xs font-medium', meta.className)}>
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {meta.label}
                        </span>
                        <span className="text-sm font-medium text-foreground">{change.title}</span>
                      </div>
                      <span className="text-xs text-neutral-500">{isOpen ? 'הסתר' : 'הצג'}</span>
                    </button>

                    {isOpen ? (
                      <div className="border-t border-border p-md text-right">
                        {simpleMode ? (
                          <ul className="list-disc space-y-1 pr-5 text-sm text-neutral-700">
                            {summarizePlainBullets(change).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : null}

                        {!simpleMode ? (
                          <p className="text-sm text-neutral-700">{change.reason}</p>
                        ) : null}

                        {!simpleMode ? (
                          <div className="mt-3">
                            <div className="flex flex-row-reverse items-center justify-between gap-sm">
                              <p className="text-sm font-medium">SQL</p>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => copyToClipboard(change.sql_preview || '')}
                                disabled={!change.sql_preview}
                              >
                                <Copy className="ml-2 h-4 w-4" aria-hidden="true" />
                                העתק
                              </Button>
                            </div>
                            <pre className="mt-2 max-h-60 overflow-auto rounded bg-muted p-3 text-xs" dir="ltr">
                              {change.sql_preview}
                            </pre>
                          </div>
                        ) : (
                          <div className="mt-3">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => copyToClipboard(change.sql_preview || '')}
                              disabled={!change.sql_preview}
                            >
                              <Copy className="ml-2 h-4 w-4" aria-hidden="true" />
                              העתק SQL
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {plan?.manual_steps ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-right">שלבים ידניים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-sm">
              <p className="text-right text-sm text-neutral-600">
                שינויים זהירים/מסוכנים לא מוחלים אוטומטית במסלול הבטוח.
              </p>
              <div className="flex flex-row-reverse gap-sm">
                <Button type="button" variant="outline" onClick={() => copyToClipboard(plan.manual_sql || '')} disabled={!plan.manual_sql}>
                  <Copy className="ml-2 h-4 w-4" aria-hidden="true" />
                  העתק SQL מרוכז
                </Button>
              </div>
              <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs" dir="ltr">
                {plan.manual_steps}
              </pre>
            </CardContent>
          </Card>
        ) : null}

        {(cautionCount > 0 || destructiveCount > 0) ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-right">שינויים מסוכנים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-md">
              <div className="rounded-md border border-red-200 bg-red-50 p-md text-right text-sm text-red-900">
                שינויים מסוכנים עלולים להיכשל או להשפיע על נתונים. חובה אישור מפורש.
              </div>

              <div className="flex flex-row-reverse items-center gap-sm">
                <input
                  id="danger-check"
                  type="checkbox"
                  checked={dangerChecked}
                  onChange={(e) => setDangerChecked(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="danger-check" className="text-sm text-neutral-700">
                  אני מבין/ה שזה יכול לשבור נתונים
                </label>
              </div>

              <div className="space-y-2">
                <label className="block text-right text-sm font-medium">הקלד/י בדיוק:</label>
                <Input
                  dir="ltr"
                  value={dangerPhrase}
                  onChange={(e) => setDangerPhrase(e.target.value)}
                  placeholder={REQUIRED_PHRASE}
                />
              </div>

              <Button
                type="button"
                variant="destructive"
                disabled={applyDangerLoading || !dangerChecked || dangerPhrase !== REQUIRED_PHRASE}
                onClick={handleApplyDestructive}
              >
                {applyDangerLoading ? 'מחיל…' : 'החל שינויים מסוכנים'}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row-reverse items-center justify-between gap-md">
            <CardTitle className="text-right">היסטוריה</CardTitle>
            <Button type="button" variant="outline" onClick={refreshHistory} disabled={historyLoading}>
              {historyLoading ? 'טוען…' : 'רענן'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-sm">
            {history.length === 0 ? (
              <p className="text-right text-sm text-neutral-600">אין רשומות עדיין.</p>
            ) : (
              <div className="space-y-sm">
                {history.map((row) => (
                  <div key={row.id} className="rounded-md border border-border p-md text-right text-sm">
                    <div className="flex flex-row-reverse items-center justify-between gap-md">
                      <span className="font-medium">{row.status}</span>
                      <span className="text-xs text-neutral-500">{new Date(row.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-xs text-neutral-600" dir="ltr">
                      {row.ssot_version_hash}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
