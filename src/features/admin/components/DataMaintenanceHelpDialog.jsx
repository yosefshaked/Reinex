import { Info, X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { DataMaintenanceHelpContent } from './DataMaintenanceHelpContent.jsx';

export function DataMaintenanceHelpDialog({ open, onOpenChange, onClose }) {
  const handleOpenChange = onOpenChange ?? onClose;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl" dir="rtl" hideDefaultClose>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Info className="h-6 w-6 text-primary" />
            מדריך תחזוקת נתונים
          </DialogTitle>
          <DialogDescription className="text-right">
            עדכנו מספר תלמידים במקביל באמצעות אקסל
          </DialogDescription>
          <DialogPrimitive.Close
            className="absolute left-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">סגור</span>
          </DialogPrimitive.Close>
        </DialogHeader>

        <DataMaintenanceHelpContent />
      </DialogContent>
    </Dialog>
  );
}
