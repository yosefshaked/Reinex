import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * A lesson start that falls in a clock change, from `describeLessonStartClockChange`:
 * 'skipped' (the hour does not exist — saving is blocked) or 'repeated' (saved at the first
 * occurrence — a notice only). Renders nothing for a normal time.
 */
export function ClockChangeNotice({ notice }) {
  if (!notice) return null;
  if (notice.blocking) {
    return (
      <Alert variant="destructive" data-clock-change="skipped">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{notice.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950" data-clock-change="repeated">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );
}
