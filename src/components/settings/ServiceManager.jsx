import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { upsertSetting } from '@/features/settings/api/settings.js';
import { useServices } from '@/hooks/useOrgData.js';

const SAVE_STATE = {
  idle: 'idle',
  saving: 'saving',
  error: 'error',
};

export default function ServiceManager({ session, orgId, activeOrgHasConnection, tenantClientReady }) {
  const { services: hookServices, loadingServices, servicesError, refetchServices } = useServices({
    orgId,
    session,
    enabled: Boolean(session && orgId && activeOrgHasConnection && tenantClientReady),
  });
  const [services, setServices] = useState([]);
  const [newService, setNewService] = useState('');
  const [saveState, setSaveState] = useState(SAVE_STATE.idle);
  const [saveError, setSaveError] = useState('');

  const canLoad = Boolean(session && orgId && activeOrgHasConnection && tenantClientReady);

  useEffect(() => {
    if (canLoad && Array.isArray(hookServices)) {
      setServices(hookServices);
    } else if (!canLoad) {
      setServices([]);
    }
  }, [canLoad, hookServices]);

  const handleAddService = () => {
    const trimmed = newService.trim();
    if (!trimmed) {
      toast.error('יש להזין שם שירות.');
      return;
    }

    if (services.includes(trimmed)) {
      toast.error('שירות זה כבר קיים ברשימה.');
      return;
    }

    setServices([...services, trimmed]);
    setNewService('');
  };

  const handleRemoveService = (index) => {
    setServices(services.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!canLoad) {
      return;
    }

    setSaveState(SAVE_STATE.saving);
    setSaveError('');

    try {
      await upsertSetting({
        session,
        orgId,
        key: 'available_services',
        value: services,
      });
      setSaveState(SAVE_STATE.idle);
      toast.success('השירותים נשמרו בהצלחה.');
      await refetchServices();
    } catch (error) {
      console.error('Failed to save services', error);
      setSaveError(error?.message || 'שמירת השירותים נכשלה.');
      setSaveState(SAVE_STATE.error);
      toast.error('שמירת השירותים נכשלה.');
    }
  };

  if (!activeOrgHasConnection || !tenantClientReady) {
    return (
      <Card className="w-full border-0 shadow-lg bg-white/80">
        <CardHeader>
          <CardTitle>ניהול שירותים</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600">
            נדרש חיבור Supabase פעיל כדי לנהל שירותים.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isLoading = loadingServices;
  const isSaving = saveState === SAVE_STATE.saving;
  const loadError = servicesError;

  return (
    <Card className="w-full border-0 shadow-lg bg-white/80">
      <CardHeader>
        <CardTitle className="text-base sm:text-lg">ניהול שירותים</CardTitle>
        <p className="text-xs text-slate-600 mt-xs sm:mt-sm sm:text-sm">
          הגדר את רשימת השירותים הזמינים בארגון. השירותים יופיעו בטופס הוספת תלמיד.
        </p>
      </CardHeader>
      <CardContent className="space-y-sm sm:space-y-md">
        {isLoading ? (
          <div className="flex items-center justify-center py-md sm:py-lg">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="mr-2 text-xs text-slate-600 sm:text-sm">טוען שירותים...</span>
          </div>
        ) : loadError ? (
          <div className="rounded-md bg-red-50 p-sm text-xs text-red-700 sm:p-md sm:text-sm">
            {loadError}
          </div>
        ) : (
          <>
            <div className="space-y-xs sm:space-y-sm">
              <Label htmlFor="new-service" className="text-xs sm:text-sm">הוסף שירות חדש</Label>
              <div className="flex gap-sm">
                <Input
                  id="new-service"
                  value={newService}
                  onChange={(e) => setNewService(e.target.value)}
                  placeholder="לדוגמה: פיזיותרפיה"
                  className="text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddService();
                    }
                  }}
                  disabled={isSaving}
                />
                <Button
                  type="button"
                  onClick={handleAddService}
                  disabled={isSaving}
                  size="sm"
                  className="gap-xs text-sm"
                >
                  <Plus className="h-4 w-4" />
                  הוסף
                </Button>
              </div>
            </div>

            {services.length > 0 ? (
              <div className="space-y-xs sm:space-y-sm">
                <Label className="text-xs sm:text-sm">שירותים זמינים ({services.length})</Label>
                <div className="space-y-xs max-h-64 overflow-y-auto border rounded-md p-sm sm:space-y-sm sm:p-md">
                  {services.map((service, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-md"
                    >
                      <span className="text-sm">{service}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveService(index)}
                        disabled={isSaving}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">
                אין שירותים מוגדרים. הוסף שירות ראשון.
              </p>
            )}

            {saveError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {saveError}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <Button
                onClick={handleSave}
                disabled={isSaving || services.length === 0}
                className="gap-2"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                שמור שירותים
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
