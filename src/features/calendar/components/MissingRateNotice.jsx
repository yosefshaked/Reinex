import { useState } from 'react';
import { AlertCircle, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useOrg } from '@/org/OrgContext';
import { useAuth } from '@/auth/AuthContext.jsx';
import { isAdminOrOffice } from '@/features/students/utils/endpoints.js';
import { AddLessonRateDialog } from '@/components/settings/employee-management/EmployeeRatesPanel.jsx';

/**
 * Shown in a lesson or template form when the save was refused because the instructor has no rate
 * for the service on the lesson's date (`readMissingLessonRate`).
 *
 * Whoever may manage pay (admin / owner / office, the same roles `api/employee-rates` accepts) gets
 * "הוספת תעריף", which opens the rates dialog prefilled with the instructor, service and date. The
 * form underneath stays as it was, so after saving the rate the user saves the form again.
 * Anyone else is told to ask a manager.
 */
export function MissingRateNotice({ missingRate, onRateAdded }) {
  const { currentOrg, activeOrg, activeOrgId } = useOrg();
  const { session } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const org = currentOrg ?? activeOrg;
  const orgId = org?.id || activeOrgId;
  const canManagePay = isAdminOrOffice(org?.membership?.role);

  if (!missingRate) {
    return null;
  }

  return (
    <>
      <Alert variant="destructive" data-missing-rate-notice="">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <p>{missingRate.message}</p>
          {canManagePay ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 gap-1"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              הוספת תעריף
            </Button>
          ) : (
            <p className="mt-1 font-medium">רק מנהל/ת או משרד יכולים להוסיף תעריף. פנו אליהם, ואחרי שהתעריף נוסף שמרו שוב.</p>
          )}
        </AlertDescription>
      </Alert>
      {canManagePay ? (
        <AddLessonRateDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          orgId={orgId}
          session={session}
          employeeId={missingRate.instructorEmployeeId}
          serviceId={missingRate.serviceId}
          rateDate={missingRate.rateDate}
          onSaved={() => {
            setDialogOpen(false);
            onRateAdded?.();
          }}
        />
      ) : null}
    </>
  );
}

export default MissingRateNotice;
