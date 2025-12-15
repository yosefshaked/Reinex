import { useState } from 'react';
import { Download, FileText, AlertTriangle, Filter, Upload, Info } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetchBlob } from '@/lib/api-client.js';
import { toast } from 'sonner';
import { FilteredExportDialog } from './FilteredExportDialog';
import { DataMaintenanceHelpDialog } from './DataMaintenanceHelpDialog';

export function DataMaintenanceMenu({ onImportClick, instructors = [], tags = [] }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [showFilteredDialog, setShowFilteredDialog] = useState(false);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const { activeOrgId } = useOrg();

  const handleExportAll = async () => {
    if (!activeOrgId) return;
    setIsDownloading(true);
    try {
      const blob = await authenticatedFetchBlob(`students-maintenance-export?org_id=${activeOrgId}`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'student-data-maintenance.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('הקובץ ירד בהצלחה.');
    } catch (error) {
      console.error('Failed to download maintenance CSV', error);
      toast.error('הורדת הקובץ נכשלה.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleExportProblematic = async () => {
    if (!activeOrgId) return;
    setIsDownloading(true);
    try {
      const blob = await authenticatedFetchBlob(`students-maintenance-export?org_id=${activeOrgId}&filter=problematic`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'students-problematic.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('הקובץ ירד בהצלחה.');
    } catch (error) {
      console.error('Failed to download problematic students CSV', error);
      toast.error('הורדת הקובץ נכשלה.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleExportFiltered = () => {
    setShowFilteredDialog(true);
  };

  return (
    <>
      <FilteredExportDialog
        open={showFilteredDialog}
        onClose={() => setShowFilteredDialog(false)}
        instructors={instructors}
        tags={tags}
      />
      <DataMaintenanceHelpDialog
        open={showHelpDialog}
        onOpenChange={setShowHelpDialog}
      />
      <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isDownloading}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">
            {isDownloading ? 'מוריד...' : 'תחזוקת נתונים'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => setShowHelpDialog(true)} className="gap-2 cursor-pointer bg-blue-50 hover:bg-blue-100">
          <Info className="h-4 w-4 text-blue-600" />
          <div className="flex flex-col items-start">
            <span className="font-medium text-blue-900">מדריך לתחזוקת נתונים</span>
            <span className="text-xs text-blue-700">הסבר מפורט על התכונה</span>
          </div>
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel>ייצוא נתונים</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={handleExportAll} className="gap-2 cursor-pointer">
          <FileText className="h-4 w-4 text-primary" />
          <div className="flex flex-col items-start">
            <span className="font-medium">ייצוא כל התלמידים</span>
            <span className="text-xs text-muted-foreground">לעדכון המוני</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handleExportProblematic} className="gap-2 cursor-pointer">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <div className="flex flex-col items-start">
            <span className="font-medium">תלמידים עם בעיות</span>
            <span className="text-xs text-muted-foreground">חסר מזהה, מדריך לא פעיל</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handleExportFiltered} className="gap-2 cursor-pointer">
          <Filter className="h-4 w-4 text-blue-500" />
          <div className="flex flex-col items-start">
            <span className="font-medium">ייצוא מסונן</span>
            <span className="text-xs text-muted-foreground">לפי יום/מדריך/תגית</span>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>ייבוא נתונים</DropdownMenuLabel>
        
        <DropdownMenuItem onClick={onImportClick} className="gap-2 cursor-pointer">
          <Upload className="h-4 w-4 text-green-600" />
          <div className="flex flex-col items-start">
            <span className="font-medium">ייבוא עדכונים</span>
            <span className="text-xs text-muted-foreground">העלאת קובץ CSV מעודכן</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
