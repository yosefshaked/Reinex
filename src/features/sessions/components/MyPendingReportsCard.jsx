import { useCallback, useEffect, useState, useMemo } from 'react';
import { Calendar, Clock, CheckCircle2, AlertCircle, Loader2, XCircle, RotateCcw, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useOrg } from '@/org/OrgContext.jsx';
import { fetchLooseSessions } from '@/features/sessions/api/loose-sessions.js';
import ResubmitRejectedReportDialog from './ResubmitRejectedReportDialog.jsx';

const REQUEST_STATE = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  error: 'error',
});

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5); // HH:MM from HH:MM:SS
}

function getReasonLabel(reason, reasonOther) {
  const labels = {
    substitute: 'מחליף זמני',
    new_student: 'תלמיד חדש',
    other: reasonOther || 'אחר',
  };
  return labels[reason] || reason || 'לא צוין';
}

const DATE_RANGE_OPTIONS = [
  { value: 'all', label: 'הכל', days: null },
  { value: '1day', label: 'יום אחרון', days: 1 },
  { value: '7days', label: '7 ימים אחרונים', days: 7 },
  { value: '14days', label: '14 ימים אחרונים', days: 14 },
  { value: '1month', label: 'חודש אחרון', days: 30 },
  { value: '2months', label: 'חודשיים אחרונים', days: 60 },
  { value: '3months', label: '3 חודשים אחרונים', days: 90 },
  { value: '6months', label: '6 חודשים אחרונים', days: 180 },
  { value: '1year', label: 'שנה אחרונה', days: 365 },
];

function filterReportsByDateRange(reports, dateRangeDays) {
  if (!dateRangeDays) return reports; // 'all' selected
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - dateRangeDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD
  
  return reports.filter(report => report.date >= cutoffStr);
}

export default function MyPendingReportsCard() {
  const { activeOrg, activeOrgHasConnection, tenantClientReady } = useOrg();
  const [state, setState] = useState(REQUEST_STATE.idle);
  const [error, setError] = useState('');
  const [reports, setReports] = useState([]);
  const [resubmitModalOpen, setResubmitModalOpen] = useState(false);
  const [resubmitReport, setResubmitReport] = useState(null);
  const [dateRange, setDateRange] = useState('3months'); // Default to 3 months

  const activeOrgId = activeOrg?.id || null;
  const canFetch = Boolean(activeOrgId && activeOrgHasConnection && tenantClientReady);

  const loadReports = useCallback(async (options = {}) => {
    if (!canFetch) return;

    setState(REQUEST_STATE.loading);
    setError('');

    try {
      const data = await fetchLooseSessions({ 
        orgId: activeOrgId,
        view: 'mine', // Always fetch user's own reports
        signal: options.signal,
      });
      setReports(Array.isArray(data) ? data : []);
      setState(REQUEST_STATE.idle);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Failed to load pending reports', err);
      setError(err?.message || 'טעינת הדיווחים הממתינים נכשלה.');
      setState(REQUEST_STATE.error);
    }
  }, [canFetch, activeOrgId]);

  useEffect(() => {
    if (!canFetch) {
      setState(REQUEST_STATE.idle);
      setError('');
      setReports([]);
      return;
    }

    const abortController = new AbortController();
    void loadReports({ signal: abortController.signal });

    return () => {
      abortController.abort();
    };
  }, [canFetch, loadReports]);

  const handleResubmit = useCallback((report) => {
    setResubmitReport(report);
    setResubmitModalOpen(true);
  }, []);

  const handleResubmitSuccess = useCallback(() => {
    setResubmitModalOpen(false);
    setResubmitReport(null);
    // Reload reports to update the list
    void loadReports();
  }, [loadReports]);

  const handleResubmitClose = useCallback(() => {
    setResubmitModalOpen(false);
    setResubmitReport(null);
  }, []);

  const isLoading = state === REQUEST_STATE.loading;
  const hasError = state === REQUEST_STATE.error;
  
  // Apply date range filter
  const dateRangeDays = useMemo(() => {
    const option = DATE_RANGE_OPTIONS.find(opt => opt.value === dateRange);
    return option?.days ?? null;
  }, [dateRange]);
  
  const filteredReports = useMemo(() => {
    return filterReportsByDateRange(reports, dateRangeDays);
  }, [reports, dateRangeDays]);
  
  const pendingReports = filteredReports.filter((r) => !r.student_id && !r.deleted && !r.isRejected);
  const rejectedReports = filteredReports.filter((r) => {
    const isRejected = r.isRejected === true || (r.deleted && r.metadata?.rejection);
    if (!isRejected) return false;
    // Once resubmitted, hide the original rejected item from the instructor view.
    if (r.metadata?.rejection?.resubmitted_at) return false;
    return true;
  });
  const resolvedReports = filteredReports.filter((r) => r.student_id);
  
  // Debug logging for resolved reports
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[MyPendingReportsCard Debug]', {
        totalReports: reports.length,
        filteredReports: filteredReports.length,
        pendingCount: pendingReports.length,
        rejectedCount: rejectedReports.length,
        resolvedCount: resolvedReports.length,
      });
    }
  }, [reports, filteredReports, pendingReports, rejectedReports, resolvedReports]);

  if (!canFetch) {
    return null;
  }

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle className="text-right">הדיווחים הממתינים שלי</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Date Range Filter */}
        <div className="flex items-center gap-3 pb-2 border-b">
          <Label htmlFor="dateRange" className="flex items-center gap-2 text-sm font-medium shrink-0">
            <Filter className="h-4 w-4" />
            טווח תאריכים:
          </Label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger id="dateRange" className="w-[200px]" dir="rtl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-neutral-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>טוען דיווחים...</span>
          </div>
        ) : hasError ? (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
            {error || 'טעינת הדיווחים נכשלה.'}
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground text-right">
              דיווחים שהגשת ללא שיוך תלמיד. רק מנהל יכול לשייך דיווחים אלה לתלמידים.
            </div>

            {pendingReports.length === 0 && rejectedReports.length === 0 && resolvedReports.length === 0 && (
              <div className="text-center py-8 text-neutral-500">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 text-neutral-400" />
                <p className="text-lg font-medium">אין דיווחים ממתינים</p>
                <p className="text-sm mt-1">כל הדיווחים שהגשת שוייכו לתלמידים.</p>
              </div>
            )}

            {(pendingReports.length > 0 || rejectedReports.length > 0 || resolvedReports.length > 0) && (
              <Tabs defaultValue="pending" dir="rtl">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="pending" className="flex items-center gap-2">
                    ממתינים
                    {pendingReports.length > 0 && (
                      <Badge variant="secondary" className="bg-amber-500 text-white">
                        {pendingReports.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="rejected" className="flex items-center gap-2">
                    נדחו
                    {rejectedReports.length > 0 && (
                      <Badge variant="secondary" className="bg-red-500 text-white">
                        {rejectedReports.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="accepted" className="flex items-center gap-2">
                    אושרו
                    {resolvedReports.length > 0 && (
                      <Badge variant="secondary" className="bg-green-500 text-white">
                        {resolvedReports.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Pending Tab */}
                <TabsContent value="pending" className="space-y-3 mt-4">
                  {pendingReports.length === 0 ? (
                    <div className="text-center py-8 text-neutral-500">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-neutral-400" />
                      <p className="text-sm">אין דיווחים ממתינים</p>
                    </div>
                  ) : (
                    pendingReports.map((report) => {
                      const name = report?.metadata?.unassigned_details?.name || 'ללא שם';
                      const reason = report?.metadata?.unassigned_details?.reason || '';
                      const reasonOther = report?.metadata?.unassigned_details?.reason_other || '';
                      const time = report?.metadata?.unassigned_details?.time || '';
                      const service = report?.service_context || '';

                      return (
                        <Card key={report.id} className="border-2 border-amber-200 bg-amber-50/30">
                          <CardContent className="p-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-base font-semibold text-foreground">{name}</h4>
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
                                  ממתין לשיוך
                                </Badge>
                              </div>
                              
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                                <div className="flex items-center gap-2 text-neutral-600">
                                  <Calendar className="h-4 w-4 shrink-0" />
                                  <span>תאריך: {formatDate(report.date)}</span>
                                </div>
                                {time && (
                                  <div className="flex items-center gap-2 text-neutral-600">
                                    <Clock className="h-4 w-4 shrink-0" />
                                    <span>שעה: {formatTime(time)}</span>
                                  </div>
                                )}
                                {service && (
                                  <div className="flex items-center gap-2 text-neutral-600">
                                    <span className="font-medium">שירות:</span>
                                    <span>{service}</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-2 text-neutral-600">
                                  <span className="font-medium">סיבה:</span>
                                  <span>{getReasonLabel(reason, reasonOther)}</span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </TabsContent>

                {/* Rejected Tab */}
                <TabsContent value="rejected" className="space-y-3 mt-4">
                  {rejectedReports.length === 0 ? (
                    <div className="text-center py-8 text-neutral-500">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-neutral-400" />
                      <p className="text-sm">אין דיווחים שנדחו</p>
                    </div>
                  ) : (
                    rejectedReports.map((report) => {
                      const name = report?.metadata?.unassigned_details?.name || 'ללא שם';
                      const reason = report?.metadata?.unassigned_details?.reason || '';
                      const reasonOther = report?.metadata?.unassigned_details?.reason_other || '';
                      const time = report?.metadata?.unassigned_details?.time || '';
                      const service = report?.service_context || '';
                      // Handle rejection reason - ensure it's a string
                      const rejectionReasonRaw = report?.metadata?.rejection?.reason;
                      const rejectionReason = typeof rejectionReasonRaw === 'string' 
                        ? rejectionReasonRaw 
                        : rejectionReasonRaw?.label || rejectionReasonRaw?.value || 'לא צוינה סיבה';
                      const rejectedAt = report?.metadata?.rejection?.rejected_at || report?.deleted_at || '';

                      return (
                        <Card key={report.id} className="border-2 border-red-200 bg-red-50/30">
                          <CardContent className="p-4">
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap mb-2">
                                    <h4 className="text-base font-semibold text-foreground">{name}</h4>
                                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
                                      <XCircle className="h-3 w-3 ml-1" />
                                      נדחה
                                    </Badge>
                                  </div>
                                  
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-3">
                                    <div className="flex items-center gap-2 text-neutral-600">
                                      <Calendar className="h-4 w-4 shrink-0" />
                                      <span>תאריך: {formatDate(report.date)}</span>
                                    </div>
                                    {time && (
                                      <div className="flex items-center gap-2 text-neutral-600">
                                        <Clock className="h-4 w-4 shrink-0" />
                                        <span>שעה: {formatTime(time)}</span>
                                      </div>
                                    )}
                                    {service && (
                                      <div className="flex items-center gap-2 text-neutral-600">
                                        <span className="font-medium">שירות:</span>
                                        <span>{service}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 text-neutral-600">
                                      <span className="font-medium">סיבה:</span>
                                      <span>{getReasonLabel(reason, reasonOther)}</span>
                                    </div>
                                  </div>

                                  <div className="rounded-md bg-red-100 p-3 text-sm">
                                    <p className="font-semibold text-red-900 mb-1">סיבת הדחייה:</p>
                                    <p className="text-red-800">{rejectionReason}</p>
                                    {rejectedAt && (
                                      <p className="text-xs text-red-600 mt-1">
                                        נדחה ב-{formatDate(rejectedAt.split('T')[0])}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-2"
                                  onClick={() => handleResubmit(report)}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                  שלח מחדש
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </TabsContent>

                {/* Accepted Tab */}
                <TabsContent value="accepted" className="space-y-3 mt-4">
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-neutral-600">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">טוען דיווחים שאושרו...</span>
                    </div>
                  ) : resolvedReports.length === 0 ? (
                    <div className="text-center py-8 text-neutral-500">
                      <AlertCircle className="h-8 w-8 mx-auto mb-2 text-neutral-400" />
                      <p className="text-sm font-medium">אין דיווחים שאושרו עדיין</p>
                      <p className="text-xs mt-1">כאשר מנהל יאשר דיווח שלך, הוא יופיע כאן</p>
                    </div>
                  ) : (
                    <>
                      {resolvedReports.slice(0, 5).map((report) => {
                        const submittedName = report?.metadata?.unassigned_details?.name || 'ללא שם';
                        const actualStudentName = report?.Students?.name;
                        const displayName = actualStudentName 
                          ? `${actualStudentName} (${submittedName})`
                          : submittedName;
                        const service = report?.service_context || '';

                        return (
                          <Card key={report.id} className="border-2 border-green-200 bg-green-50/30">
                            <CardContent className="p-3">
                              <div className="flex items-center gap-2 text-sm">
                                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                                <span className="font-medium">{displayName}</span>
                                <span className="text-neutral-600">·</span>
                                <span className="text-neutral-600">{formatDate(report.date)}</span>
                                {service && (
                                  <>
                                    <span className="text-neutral-600">·</span>
                                    <span className="text-neutral-600">{service}</span>
                                  </>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      {resolvedReports.length > 5 && (
                        <p className="text-xs text-neutral-500 text-center">
                          ועוד {resolvedReports.length - 5} דיווחים שטופלו
                        </p>
                      )}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </>
        )}
      </CardContent>

      {/* Resubmit Modal */}
      <ResubmitRejectedReportDialog
        isOpen={resubmitModalOpen}
        onClose={handleResubmitClose}
        report={resubmitReport}
        onSuccess={handleResubmitSuccess}
      />
    </Card>
  );
}
