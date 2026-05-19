import { Badge } from '../../../components/ui/badge';

function getListItemTone(resolved, pendingLabel = 'ממתין') {
  if (resolved === true) {
    return {
      badgeVariant: 'default',
      badgeLabel: 'סגור',
      text: 'הושלם',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    };
  }

  if (resolved === false) {
    return {
      badgeVariant: 'outline',
      badgeLabel: pendingLabel,
      text: 'פתוח',
      className: 'border-amber-200 bg-amber-50 text-amber-950',
    };
  }

  return {
    badgeVariant: 'outline',
    badgeLabel: 'לא רלוונטי',
    text: 'לא רלוונטי',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  };
}

export function LessonResolutionStatus({
  metadata,
  isClosed,
  workflowEvaluatedAt,
  closureDoneCount,
  closureTotalCount,
  closureAttendanceResolved,
  closureBillingResolved,
  closureCompensationResolved,
  closureHmoResolved,
  studentBillingRequired,
  instructorCompensationRequired,
  hmoClaimRequired,
  workflowReasonsOpen,
  getWorkflowReasonLabel,
}) {
  const workflowState = metadata?.workflow_state && typeof metadata.workflow_state === 'object'
    ? metadata.workflow_state
    : null;

  const attendanceTone = getListItemTone(closureAttendanceResolved, 'ממתין');
  const billingTone = getListItemTone(
    closureAttendanceResolved !== true ? false : (studentBillingRequired ? closureBillingResolved : null),
    closureAttendanceResolved !== true ? 'ממתין לנוכחות' : 'ממתין',
  );
  const payrollTone = getListItemTone(
    closureAttendanceResolved !== true ? false : (instructorCompensationRequired ? closureCompensationResolved : null),
    closureAttendanceResolved !== true ? 'ממתין לנוכחות' : 'ממתין',
  );
  const hmoTone = getListItemTone(
    closureAttendanceResolved !== true && hmoClaimRequired ? false : (hmoClaimRequired ? closureHmoResolved : null),
    closureAttendanceResolved !== true ? 'ממתין לנוכחות' : 'ממתין',
  );

  const checklistItems = [
    { key: 'attendance', label: 'נוכחות', tone: attendanceTone },
    { key: 'billing', label: 'חיובי תלמידים', tone: billingTone },
    { key: 'payroll', label: 'שכר מדריך', tone: payrollTone },
    { key: 'hmo', label: 'תביעות גורם מממן', tone: hmoTone },
  ];

  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3"
      data-workflow-evaluated={workflowState?.evaluated_at || ''}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-800">מצב סגירה</div>
          <div className="text-xs text-slate-600">
            {isClosed
              ? 'כל החיובים, השכר וההתחייבויות התפעוליות סגורים.'
              : 'השיעור עדיין פתוח עד להשלמת כל ההתחייבויות.'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {workflowEvaluatedAt
              ? `נבדק לאחרונה: ${workflowEvaluatedAt}`
              : 'עדיין אין נתוני סגירה מלאים להצגה.'}
          </div>
        </div>
        <Badge variant={isClosed ? 'default' : 'outline'}>
          {isClosed ? 'סגור' : 'פתוח'}
        </Badge>
      </div>

      <div className="text-xs text-slate-700">
        התקדמות סגירה: {`${closureDoneCount}/${closureTotalCount}`}
      </div>

      <ul className="space-y-2 text-xs">
        {checklistItems.map((item) => (
          <li
            key={item.key}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${item.tone.className}`}
          >
            <span className="font-medium">{item.label}</span>
            <span className="flex items-center gap-2">
              <span>{item.tone.text}</span>
              <Badge variant={item.tone.badgeVariant}>{item.tone.badgeLabel}</Badge>
            </span>
          </li>
        ))}
      </ul>

      {!isClosed && workflowReasonsOpen.length > 0 && (
        <div className="pt-1">
          <div className="text-xs font-medium text-slate-700">מה עדיין מונע סגירה:</div>
          <ul className="mt-1 list-disc pe-5 text-xs text-slate-600 space-y-1">
            {workflowReasonsOpen.map((reason) => (
              <li key={reason}>{getWorkflowReasonLabel(reason)}</li>
            ))}
          </ul>
        </div>
      )}

      {!isClosed && workflowReasonsOpen.length === 0 && closureAttendanceResolved !== true && (
        <div className="pt-1 text-xs text-slate-600">
          לאחר סימון נוכחות או שינוי סטטוס, המערכת תעדכן כאן מה בדיוק חסר לסגירה.
        </div>
      )}
    </div>
  );
}
