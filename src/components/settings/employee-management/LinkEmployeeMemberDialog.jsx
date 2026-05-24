import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link2 } from 'lucide-react';
import { toast } from '@/lib/toast.jsx';
import { authenticatedFetch } from '@/lib/api-client';

function getMemberLabel(member) {
  return member?.profile?.full_name || member?.profile?.email || member?.user_id || 'חבר ארגון';
}

export default function LinkEmployeeMemberDialog({
  open,
  onOpenChange,
  employee,
  members = [],
  orgId,
  session,
  onLinked,
}) {
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableMembers = useMemo(
    () => members.filter((member) => member?.user_id),
    [members],
  );

  const handleClose = (nextOpen) => {
    if (!nextOpen) {
      setSelectedMemberId('');
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!employee?.id || !selectedMemberId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await authenticatedFetch('instructors-link-user', {
        session,
        method: 'PUT',
        body: {
          org_id: orgId,
          employee_id: employee.id,
          member_user_id: selectedMemberId,
        },
      });
      toast.success('חבר הארגון שויך לעובד בהצלחה.');
      handleClose(false);
      await onLinked?.();
    } catch (error) {
      console.error('Failed to link org member to employee', error);
      toast.error(error?.message || 'שיוך חבר הארגון נכשל.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-end">שיוך חבר ארגון קיים</DialogTitle>
          <DialogDescription className="text-end">
            בחר חבר ארגון קיים שעדיין לא מחובר לכרטיס עובד, כדי לשייך אותו ל-{employee?.first_name || 'העובד'}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-600">חבר ארגון</div>
            <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
              <SelectTrigger>
                <SelectValue placeholder="בחר חבר ארגון קיים" />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {getMemberLabel(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableMembers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                אין כרגע חברי ארגון פנויים לשיוך. אפשר להשתמש בהזמנת משתמש.
              </div>
            ) : null}
          </div>

          <div className="flex flex-row-reverse gap-2 border-t pt-4">
            <Button type="submit" disabled={isSubmitting || !selectedMemberId}>
              <Link2 className="me-2 h-4 w-4" />
              {isSubmitting ? 'משייך...' : 'שייך לחבר הארגון'}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={isSubmitting}>
              ביטול
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
