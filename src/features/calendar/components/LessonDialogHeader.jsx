import { Flag, ShieldCheck, X } from 'lucide-react';
import { DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';

function HeaderFlag({ label, className, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={`inline-grid h-[26px] w-[26px] cursor-help place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-line text-start text-xs leading-relaxed">{label}</TooltipContent>
    </Tooltip>
  );
}

const STATUS_PILL_CLASSES = {
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

/**
 * Lesson dialog header (owner's layout): service · date + time range · instructor, the close button
 * centered on the top edge and the tabs centered on the bottom edge.
 */
export function LessonDialogHeader({
  serviceName,
  serviceColor,
  status,
  statusLabel,
  exceptionReason,
  corrected,
  dateLabel,
  timeRange,
  instructorName,
  notice,
  tabs,
  activeTab,
  onTabChange,
  modeLabel,
  ModeIcon,
  onClose,
}) {
  const hasEdgeControl = Boolean(tabs?.length) || Boolean(modeLabel);

  return (
    <div className={`relative rounded-t-[22px] border-b border-slate-200 bg-white px-5 pt-7 sm:px-7 ${hasEdgeControl ? '' : 'pb-6'}`}>
      <button
        type="button"
        onClick={onClose}
        aria-label="סגירה"
        className="absolute -top-[19px] left-1/2 z-20 grid h-[38px] w-[38px] -translate-x-1/2 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <X className="h-[18px] w-[18px]" />
      </button>

      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-bold text-slate-500">שירות</span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {serviceColor ? <span className="h-[11px] w-[11px] shrink-0 rounded" style={{ backgroundColor: serviceColor }} aria-hidden="true" /> : null}
            <DialogTitle className="text-[17px] font-bold leading-snug text-slate-900">{serviceName}</DialogTitle>
            {statusLabel ? (
              <span className={`inline-flex h-[22px] items-center rounded-full px-2.5 text-xs font-bold ${STATUS_PILL_CLASSES[status] || 'bg-slate-100 text-slate-600'}`}>
                {statusLabel}
              </span>
            ) : null}
            {exceptionReason ? (
              <HeaderFlag label={`שיבוץ חריג מחוץ לזמינות\nסיבה: ${exceptionReason}`} className="bg-amber-50 text-amber-700">
                <Flag className="h-3.5 w-3.5" />
              </HeaderFlag>
            ) : null}
            {corrected ? (
              <HeaderFlag label="השיעור תוקן — הערכים המוצגים כוללים את התיקון" className="bg-sky-50 text-sky-700">
                <ShieldCheck className="h-3.5 w-3.5" />
              </HeaderFlag>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-1 sm:items-center sm:text-center">
          <span className="text-xs font-bold text-slate-500">{dateLabel}</span>
          <span className="text-2xl font-bold leading-tight tracking-tight text-slate-900 tabular-nums" dir="ltr">{timeRange}</span>
        </div>

        <div className="flex min-w-0 flex-col gap-1 sm:items-end sm:text-end">
          <span className="text-xs font-bold text-slate-500">מדריך/ה</span>
          <span className="text-[17px] font-bold text-slate-900">{instructorName}</span>
        </div>
      </div>

      <DialogDescription className="sr-only">פרטי השיעור, המשתתפים והפעולות הזמינות.</DialogDescription>

      {notice ? <div className="mt-4">{notice}</div> : null}

      {hasEdgeControl ? (
        <div className="relative z-10 -mb-5 mt-4 flex justify-center">
          {tabs?.length ? (
            <div role="tablist" aria-label="אזורי השיעור" className="inline-flex gap-0.5 rounded-xl border border-slate-200 bg-white p-1 shadow-md">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.value}
                  onClick={() => onTabChange(tab.value)}
                  className={`inline-flex h-[30px] items-center gap-1.5 rounded-lg px-4 text-[13.5px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                    activeTab === tab.value ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="inline-flex h-[38px] items-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-[13.5px] font-bold text-primary shadow-md">
              {ModeIcon ? <ModeIcon className="h-4 w-4" /> : null}
              {modeLabel}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
