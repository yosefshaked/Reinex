import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Briefcase, CalendarClock, Plus, Trash2, Users, DollarSign, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';
import { DAY_OPTIONS } from '@/lib/day-of-week.js';
import { getAvailabilitySummary, normalizeAvailabilityWindows } from '@/lib/instructor-availability.js';
import { toShekel, toAgorot } from '@/lib/currency.js';

function createEmptyWindow() {
  return { day: '', start: '', end: '' };
}

function createEmptyCapability(serviceId = '') {
  return {
    service_id: serviceId,
    max_students: 1,
    base_rate: 0,
    availability_windows: serviceId ? [createEmptyWindow()] : [],
    metadata: {},
  };
}

function getServiceName(services, serviceId) {
  return services.find((service) => service.id === serviceId)?.name || serviceId || 'שירות חדש';
}

function getSelectableServices(services, capabilities, index) {
  const currentServiceId = capabilities[index]?.service_id || '';
  return services.filter((service) => {
    if (!service?.id) return false;
    const isCurrent = service.id === currentServiceId;
    const assignedElsewhere = capabilities.some(
      (capability, capabilityIndex) => capabilityIndex !== index && capability.service_id === service.id,
    );
    if (assignedElsewhere) return false;
    if (service?.is_active === false && !isCurrent) return false;
    return true;
  });
}

export default function EditServiceCapabilitiesDialog({
  open,
  onOpenChange,
  instructor,
  orgId,
  session,
  onSaved,
  focusServiceId = '',
  introMessage = '',
}) {
  const [services, setServices] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && instructor) {
      const baseCapabilities = Array.isArray(instructor.service_capabilities)
        ? instructor.service_capabilities.map((capability) => ({
            ...capability,
            base_rate: capability.base_rate != null ? toShekel(capability.base_rate) : '',
            availability_windows: Array.isArray(capability.availability_windows) ? capability.availability_windows : [],
            metadata: capability.metadata || {},
          }))
        : [];

      if (focusServiceId && !baseCapabilities.some((capability) => capability.service_id === focusServiceId)) {
        baseCapabilities.unshift(createEmptyCapability(focusServiceId));
      }

      setCapabilities(baseCapabilities);
      loadServices();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instructor, focusServiceId]);

  const loadServices = async () => {
    setLoadingServices(true);
    try {
      const payload = await authenticatedFetch('services', {
        session,
        params: { org_id: orgId },
      });
      setServices(Array.isArray(payload) ? payload : []);
    } catch (error) {
      console.error('Failed to load services', error);
      toast.error('טעינת השירותים נכשלה.');
      setServices([]);
    } finally {
      setLoadingServices(false);
    }
  };

  const availableServices = useMemo(
    () => services.filter((service) => service?.is_active !== false),
    [services],
  );

  const addCapability = () => {
    const selectedServiceIds = new Set(capabilities.map((capability) => capability.service_id).filter(Boolean));
    const hasUnselectedRow = capabilities.some((capability) => !capability.service_id);
    const remainingServices = availableServices.filter((service) => !selectedServiceIds.has(service.id));

    if (hasUnselectedRow) {
      toast.error('בחר שירות בשורה הפתוחה לפני הוספת שורה נוספת.');
      return;
    }

    if (remainingServices.length === 0) {
      toast.error('כל השירותים כבר מוגדרים לעובד זה.');
      return;
    }

    setCapabilities((prev) => [...prev, createEmptyCapability('')]);
  };

  const updateCapability = (index, field, value) => {
    setCapabilities((prev) => prev.map((capability, capabilityIndex) => (
      capabilityIndex === index ? { ...capability, [field]: value } : capability
    )));
  };

  const removeCapability = (index) => {
    setCapabilities((prev) => prev.filter((_, capabilityIndex) => capabilityIndex !== index));
  };

  const addWindow = (capabilityIndex) => {
    setCapabilities((prev) => prev.map((capability, index) => (
      index === capabilityIndex
        ? { ...capability, availability_windows: [...(capability.availability_windows || []), createEmptyWindow()] }
        : capability
    )));
  };

  const updateWindow = (capabilityIndex, windowIndex, field, value) => {
    setCapabilities((prev) => prev.map((capability, index) => (
      index === capabilityIndex
        ? {
            ...capability,
            availability_windows: (capability.availability_windows || []).map((window, currentIndex) => (
              currentIndex === windowIndex ? { ...window, [field]: value } : window
            )),
          }
        : capability
    )));
  };

  const removeWindow = (capabilityIndex, windowIndex) => {
    setCapabilities((prev) => prev.map((capability, index) => (
      index === capabilityIndex
        ? {
            ...capability,
            availability_windows: (capability.availability_windows || []).filter((_, currentIndex) => currentIndex !== windowIndex),
          }
        : capability
    )));
  };

  const validationByCapability = useMemo(
    () => capabilities.map((capability) => normalizeAvailabilityWindows(capability.availability_windows || [])),
    [capabilities],
  );

  const handleSave = async (event) => {
    event.preventDefault();
    if (!instructor?.id) return;

    for (let index = 0; index < capabilities.length; index += 1) {
      const capability = capabilities[index];
      if (!capability.service_id) {
        toast.error('כל היכולות חייבות להיות משויכות לשירות.');
        return;
      }
      if (capability.max_students < 1) {
        toast.error('מספר התלמידים המקסימלי חייב להיות לפחות 1.');
        return;
      }

      const availabilityResult = validationByCapability[index];
      if (!availabilityResult.valid) {
        toast.error(`חלונות הזמינות עבור ${getServiceName(services, capability.service_id)} אינם תקינים או חופפים.`);
        return;
      }
    }

    if (new Set(capabilities.map((capability) => capability.service_id)).size !== capabilities.length) {
      toast.error('אין לבחור את אותו שירות יותר מפעם אחת.');
      return;
    }

    setIsSaving(true);
    try {
      await authenticatedFetch('instructors', {
        session,
        method: 'PUT',
        body: {
          org_id: orgId,
          instructor_id: instructor.id,
          service_capabilities: capabilities.map((capability, index) => ({
            service_id: capability.service_id,
            max_students: capability.max_students || 1,
            base_rate: capability.base_rate === '' ? 0 : toAgorot(capability.base_rate),
            availability_windows: validationByCapability[index].value,
            metadata: capability.metadata || {},
          })),
        },
      });
      toast.success('שירותים וזמינות עודכנו בהצלחה.');
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      console.error('Failed to update service capabilities', error);
      toast.error(error?.message || 'עדכון השירותים והזמינות נכשל.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>שירותים וזמינות לפי שירות</DialogTitle>
          <DialogDescription>
            לכל שירות מגדירים קיבולת, תעריף בסיס וחלונות זמינות. אלו הם נתוני התזמון הקובעים של המדריך/ה.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave}>
          <div className="space-y-4 py-4">
            {introMessage ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{introMessage}</AlertDescription>
              </Alert>
            ) : null}

            {capabilities.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                לא הוגדרו יכולות שירות. לחץ על "הוסף שירות" כדי להתחיל.
              </div>
            ) : (
              <div className="space-y-4">
                {capabilities.map((capability, capabilityIndex) => {
                  const availabilityResult = validationByCapability[capabilityIndex];
                  const isFocusedService = focusServiceId && capability.service_id === focusServiceId;
                  const windows = Array.isArray(capability.availability_windows) ? capability.availability_windows : [];

                  return (
                    <div
                      key={`${capability.service_id || 'new'}-${capabilityIndex}`}
                      className={`rounded-2xl border p-4 space-y-4 ${isFocusedService ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4 text-slate-600" />
                            <span className="font-medium text-sm">
                              {capability.service_id ? getServiceName(services, capability.service_id) : 'שירות חדש'}
                            </span>
                            {!availabilityResult.valid ? <Badge variant="destructive">זמינות לא תקינה</Badge> : null}
                            {availabilityResult.valid && availabilityResult.value.length === 0 ? <Badge variant="outline">חסר חלון זמינות</Badge> : null}
                          </div>
                          <div className="text-xs text-slate-500">
                            {availabilityResult.valid ? getAvailabilitySummary(availabilityResult.value) : 'חלונות הזמינות דורשים תיקון'}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCapability(capabilityIndex)}
                          disabled={isSaving}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-end flex items-center gap-1">
                            <Briefcase className="h-3 w-3" />
                            שירות
                          </Label>
                          <Select
                            value={capability.service_id || undefined}
                            onValueChange={(value) => updateCapability(capabilityIndex, 'service_id', value)}
                            disabled={isSaving || loadingServices || Boolean(focusServiceId && capability.service_id === focusServiceId)}
                          >
                            <SelectTrigger className="text-end">
                              <SelectValue placeholder="בחר שירות" />
                            </SelectTrigger>
                            <SelectContent>
                              {getSelectableServices(availableServices, capabilities, capabilityIndex).map((service) => (
                                <SelectItem key={service.id} value={service.id}>
                                  {service.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-end flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            תלמידים מקסימלי
                          </Label>
                          <Input
                            type="number"
                            min="1"
                            max="50"
                            value={capability.max_students}
                            onChange={(e) => updateCapability(capabilityIndex, 'max_students', parseInt(e.target.value, 10) || 1)}
                            disabled={isSaving}
                            className="text-end"
                            dir="ltr"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-end flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            תעריף בסיס (₪)
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={capability.base_rate}
                            onChange={(e) => updateCapability(capabilityIndex, 'base_rate', parseFloat(e.target.value) || 0)}
                            disabled={isSaving}
                            className="text-end"
                            dir="ltr"
                          />
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <CalendarClock className="h-4 w-4 text-slate-600" />
                            חלונות זמינות
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => addWindow(capabilityIndex)} disabled={isSaving}>
                            <Plus className="me-2 h-4 w-4" />
                            הוסף חלון
                          </Button>
                        </div>

                        {windows.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
                            לא הוגדרו חלונות זמינות לשירות הזה. עד שלא יוגדרו חלונות, המדריך/ה לא יוצע/תוצע לשיבוץ עבור השירות.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {windows.map((window, windowIndex) => (
                              <div key={`${capability.service_id || 'new'}-window-${windowIndex}`} className="grid gap-3 md:grid-cols-[1.1fr_1fr_1fr_auto] items-end">
                                <div className="space-y-1">
                                  <Label className="text-xs text-slate-600">יום</Label>
                                  <Select
                                    value={window.day || undefined}
                                    onValueChange={(value) => updateWindow(capabilityIndex, windowIndex, 'day', value)}
                                    disabled={isSaving}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="בחר יום" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {DAY_OPTIONS.map((day) => (
                                        <SelectItem key={day.value} value={day.value}>
                                          {day.fullLabel}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-1">
                                  <Label className="text-xs text-slate-600">משעה</Label>
                                  <Input
                                    type="time"
                                    value={window.start || ''}
                                    onChange={(e) => updateWindow(capabilityIndex, windowIndex, 'start', e.target.value)}
                                    disabled={isSaving}
                                  />
                                </div>

                                <div className="space-y-1">
                                  <Label className="text-xs text-slate-600">עד שעה</Label>
                                  <Input
                                    type="time"
                                    value={window.end || ''}
                                    onChange={(e) => updateWindow(capabilityIndex, windowIndex, 'end', e.target.value)}
                                    disabled={isSaving}
                                  />
                                </div>

                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => removeWindow(capabilityIndex, windowIndex)}
                                  disabled={isSaving}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {availableServices.length > capabilities.length && (
              <Button
                type="button"
                variant="outline"
                onClick={addCapability}
                disabled={isSaving || loadingServices}
                className="w-full"
              >
                <Plus className="me-2 h-4 w-4" />
                הוסף שירות
              </Button>
            )}
          </div>

          <div className="flex flex-row-reverse gap-2 pt-4 border-t">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'שומר...' : 'שמור שינויים'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              ביטול
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
