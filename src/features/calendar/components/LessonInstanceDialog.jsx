import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { formatTimeDisplay, formatDateDisplay, getInstanceStatusIcon } from '../utils/timeGrid';
import { Badge } from '../../../components/ui/badge';

/**
 * LessonInstanceDialog component - displays detailed information about a lesson instance (readonly mode)
 */
export function LessonInstanceDialog({ instance, open, onClose }) {
  if (!instance) return null;

  const statusInfo = getInstanceStatusIcon(instance.status, instance.documentation_status);
  const startTime = formatTimeDisplay(instance.datetime_start);
  const endDate = new Date(new Date(instance.datetime_start).getTime() + instance.duration_minutes * 60000);
  const endTime = formatTimeDisplay(endDate.toISOString());
  const dateDisplay = formatDateDisplay(instance.datetime_start);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>פרטי שיעור</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <span className={`text-2xl ${statusInfo.color}`}>{statusInfo.icon}</span>
            <Badge variant={instance.status === 'completed' ? 'default' : 'secondary'}>
              {statusInfo.label}
            </Badge>
          </div>

          {/* Service Info */}
          <div>
            <label className="text-sm font-medium text-gray-700">שירות</label>
            <div className="mt-1 flex items-center gap-2">
              {instance.service?.color && (
                <div
                  className="w-4 h-4 rounded"
                  style={{ backgroundColor: instance.service.color }}
                />
              )}
              <span className="text-lg">{instance.service?.service_name || 'לא ידוע'}</span>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">תאריך</label>
              <p className="mt-1 text-lg">{dateDisplay}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">שעה</label>
              <p className="mt-1 text-lg">
                {startTime} - {endTime} ({instance.duration_minutes} דקות)
              </p>
            </div>
          </div>

          {/* Instructor */}
          <div>
            <label className="text-sm font-medium text-gray-700">מדריך</label>
            <p className="mt-1 text-lg">{instance.instructor?.full_name || 'לא ידוע'}</p>
          </div>

          {/* Participants */}
          <div>
            <label className="text-sm font-medium text-gray-700">
              משתתפים ({instance.participants?.length || 0})
            </label>
            <div className="mt-2 space-y-2">
              {(instance.participants || []).map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium">{participant.student?.full_name || 'לא ידוע'}</p>
                    <p className="text-sm text-gray-600">
                      סטטוס: {participant.participant_status || 'pending'}
                    </p>
                  </div>
                  {participant.price_charged && (
                    <Badge variant="outline">₪{participant.price_charged}</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Documentation Status */}
          {instance.documentation_status && (
            <div>
              <label className="text-sm font-medium text-gray-700">סטטוס תיעוד</label>
              <p className="mt-1">
                <Badge
                  variant={instance.documentation_status === 'documented' ? 'default' : 'secondary'}
                >
                  {instance.documentation_status === 'documented' ? 'תועד' : 'ממתין לתיעוד'}
                </Badge>
              </p>
            </div>
          )}

          {/* Created Source */}
          {instance.created_source && (
            <div className="text-sm text-gray-600">
              מקור: {instance.created_source}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
