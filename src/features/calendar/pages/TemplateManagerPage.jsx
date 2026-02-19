import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageLayout from '@/components/ui/PageLayout';
import { Button } from '@/components/ui/button';
import { Plus, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';
import { TemplateGrid } from '../components/TemplateManager/TemplateGrid';
import { AddTemplateDialog } from '../components/TemplateManager/AddTemplateDialog';
import { TemplateEditDialog } from '../components/TemplateManager/TemplateEditDialog';
import { useTemplates } from '../hooks/useTemplates';
import { useCalendarInstructors } from '../hooks/useCalendar';

export default function TemplateManagerPage() {
  const navigate = useNavigate();

  const [showInactive, setShowInactive] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDefaults, setAddDefaults] = useState({ instructorId: null, dayOfWeek: null });
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  const { templates, isLoading: templatesLoading, error: templatesError, refetch: refetchTemplates } = useTemplates({ showInactive });
  const { instructors, isLoading: instructorsLoading, error: instructorsError } = useCalendarInstructors();

  const isLoading = templatesLoading || instructorsLoading;
  const errorMsg = templatesError || instructorsError;

  function handleCellClick(instructor, dayOfWeek) {
    setAddDefaults({ instructorId: instructor.id, dayOfWeek });
    setShowAddDialog(true);
  }

  function handleTemplateClick(template) {
    setSelectedTemplate(template);
  }

  function handleAddSuccess() {
    refetchTemplates();
  }

  function handleUpdateSuccess() {
    refetchTemplates();
    setSelectedTemplate(null);
  }

  return (
    <PageLayout
      title="ניהול תבניות"
      description="תבניות שיעורים שבועיות קבועות — לחצו על תא ריק להוספה או על תבנית לעריכה"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInactive(!showInactive)}
            className="gap-1"
          >
            {showInactive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showInactive ? 'הסתר לא פעילים' : 'הצג לא פעילים'}
          </Button>
          <Button
            onClick={() => {
              setAddDefaults({ instructorId: null, dayOfWeek: null });
              setShowAddDialog(true);
            }}
            className="gap-1"
          >
            <Plus className="h-4 w-4" />
            תבנית חדשה
          </Button>
          <Button variant="outline" onClick={() => navigate('/calendar')} className="gap-1">
            <ArrowRight className="h-4 w-4" />
            חזרה ללוח
          </Button>
        </div>
      }
    >
      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      )}

      {/* Error */}
      {errorMsg && !isLoading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          שגיאה בטעינת הנתונים: {errorMsg}
        </div>
      )}

      {/* Grid */}
      {!isLoading && !errorMsg && (
        <TemplateGrid
          templates={templates}
          instructors={instructors}
          onTemplateClick={handleTemplateClick}
          onCellClick={handleCellClick}
          showInactive={showInactive}
        />
      )}

      {/* Empty state */}
      {!isLoading && !errorMsg && templates.length === 0 && instructors.length > 0 && (
        <div className="text-center text-gray-500 py-8">
          <p className="text-lg mb-2">אין תבניות עדיין</p>
          <p className="text-sm">לחצו על &quot;תבנית חדשה&quot; או על תא ריק בטבלה כדי להתחיל</p>
        </div>
      )}

      {/* Dialogs */}
      <AddTemplateDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onSuccess={handleAddSuccess}
        defaultInstructorId={addDefaults.instructorId}
        defaultDayOfWeek={addDefaults.dayOfWeek}
      />

      <TemplateEditDialog
        template={selectedTemplate}
        open={!!selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        onUpdate={handleUpdateSuccess}
      />
    </PageLayout>
  );
}
