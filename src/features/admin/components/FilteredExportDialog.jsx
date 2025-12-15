import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DayOfWeekSelect from '@/components/ui/DayOfWeekSelect';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { useOrg } from '@/org/OrgContext.jsx';
import { authenticatedFetchBlob } from '@/lib/api-client.js';
import { toast } from 'sonner';

export function FilteredExportDialog({ open, onClose, instructors = [], tags = [] }) {
  const { activeOrgId } = useOrg();
  const [isExporting, setIsExporting] = useState(false);
  const [selectedInstructors, setSelectedInstructors] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedDay, setSelectedDay] = useState('');

  useEffect(() => {
    if (!open) {
      // Reset filters when dialog closes
      setSelectedInstructors([]);
      setSelectedTags([]);
      setSelectedDay('');
    }
  }, [open]);

  const handleInstructorToggle = (instructorId) => {
    setSelectedInstructors(prev =>
      prev.includes(instructorId)
        ? prev.filter(id => id !== instructorId)
        : [...prev, instructorId]
    );
  };

  const handleTagToggle = (tagId) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleExport = async () => {
    if (!activeOrgId) return;

    const params = new URLSearchParams({ org_id: activeOrgId, filter: 'custom' });
    
    if (selectedInstructors.length > 0) {
      params.append('instructors', selectedInstructors.join(','));
    }
    
    if (selectedTags.length > 0) {
      params.append('tags', selectedTags.join(','));
    }
    
    if (selectedDay) {
      params.append('day', selectedDay);
    }

    setIsExporting(true);
    try {
      const blob = await authenticatedFetchBlob(`students-maintenance-export?${params.toString()}`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'students-filtered.csv';
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('הקובץ ירד בהצלחה.');
      onClose();
    } catch (error) {
      console.error('Failed to download filtered CSV', error);
      toast.error('הורדת הקובץ נכשלה.');
    } finally {
      setIsExporting(false);
    }
  };

  const hasFilters = selectedInstructors.length > 0 || selectedTags.length > 0 || selectedDay;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>ייצוא תלמידים מסונן</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Day Filter */}
          <div className="space-y-2">
            <Label className="block text-right">סינון לפי יום</Label>
            <DayOfWeekSelect
              value={selectedDay}
              onChange={setSelectedDay}
              allowEmpty
              emptyLabel="כל הימים"
            />
          </div>

          {/* Instructor Filter */}
          {instructors.length > 0 && (
            <div className="space-y-2">
              <Label className="block text-right">סינון לפי מדריך</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-2">
                {instructors.map(instructor => (
                  <div key={instructor.id} className="flex items-center gap-2 justify-end">
                    <Label htmlFor={`instructor-${instructor.id}`} className="text-sm cursor-pointer">
                      {instructor.name}
                    </Label>
                    <Checkbox
                      id={`instructor-${instructor.id}`}
                      checked={selectedInstructors.includes(instructor.id)}
                      onCheckedChange={() => handleInstructorToggle(instructor.id)}
                    />
                  </div>
                ))}
              </div>
              {selectedInstructors.length > 0 && (
                <p className="text-xs text-muted-foreground text-right">
                  נבחרו {selectedInstructors.length} מדריכים
                </p>
              )}
            </div>
          )}

          {/* Tag Filter */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <Label className="block text-right">סינון לפי תגיות</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-2">
                {tags.map(tag => (
                  <div key={tag.id} className="flex items-center gap-2 justify-end">
                    <Label htmlFor={`tag-${tag.id}`} className="text-sm cursor-pointer">
                      {tag.name}
                    </Label>
                    <Checkbox
                      id={`tag-${tag.id}`}
                      checked={selectedTags.includes(tag.id)}
                      onCheckedChange={() => handleTagToggle(tag.id)}
                    />
                  </div>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <p className="text-xs text-muted-foreground text-right">
                  נבחרו {selectedTags.length} תגיות
                </p>
              )}
            </div>
          )}

          {!hasFilters && (
            <p className="text-sm text-muted-foreground text-right bg-muted/50 p-3 rounded-md">
              בחר לפחות מסנן אחד כדי לייצא תלמידים מסוימים
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isExporting}
          >
            ביטול
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !hasFilters}
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
                מייצא...
              </>
            ) : (
              'ייצא CSV'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
