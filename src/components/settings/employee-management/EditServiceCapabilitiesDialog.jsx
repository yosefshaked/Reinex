import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Briefcase, Users, DollarSign, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { authenticatedFetch } from '@/lib/api-client';

export default function EditServiceCapabilitiesDialog({ open, onOpenChange, instructor, orgId, session, onSaved }) {
  const [services, setServices] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && instructor) {
      // Initialize capabilities from instructor data
      setCapabilities(instructor.service_capabilities || []);
      loadServices();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, instructor]);

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

  const addCapability = () => {
    const selectedServiceIds = new Set(capabilities.map((capability) => capability.service_id).filter(Boolean));
    const hasUnselectedRow = capabilities.some((capability) => !capability.service_id);
    const remainingServices = services.filter((service) => service?.is_active !== false && !selectedServiceIds.has(service.id));

    if (hasUnselectedRow) {
      toast.error('בחר שירות בשורה הפתוחה לפני הוספת שורה נוספת.');
      return;
    }

    if (remainingServices.length === 0) {
      toast.error('כל השירותים כבר מוגדרים לעובד זה.');
      return;
    }

    setCapabilities([
      ...capabilities,
      {
        service_id: '',
        max_students: 1,
        base_rate: 0,
        metadata: {},
      },
    ]);
  };

  const updateCapability = (index, field, value) => {
    const updated = [...capabilities];
    updated[index] = { ...updated[index], [field]: value };
    setCapabilities(updated);
  };

  const removeCapability = (index) => {
    setCapabilities(capabilities.filter((_, i) => i !== index));
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!instructor?.id) return;

    // Validate
    for (const cap of capabilities) {
      if (!cap.service_id) {
        toast.error('כל היכולות חייבות להיות משויכות לשירות.');
        return;
      }
      if (cap.max_students < 1) {
        toast.error('מספר התלמידים המקסימלי חייב להיות לפחות 1.');
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
          service_capabilities: capabilities,
        },
      });
      toast.success('יכולות השירות עודכנו בהצלחה.');
      onOpenChange(false);
      if (onSaved) {
        onSaved();
      }
    } catch (error) {
      console.error('Failed to update service capabilities', error);
      toast.error(error?.message || 'עדכון היכולות נכשל.');
    } finally {
      setIsSaving(false);
    }
  };

  const getServiceName = (serviceId) => {
    return services.find((s) => s.id === serviceId)?.name || serviceId;
  };

  const availableServices = services.filter(
    (service) => service?.is_active !== false && !capabilities.some((capability) => capability.service_id === service.id)
  );

  const getSelectableServices = (index) => {
    const currentServiceId = capabilities[index]?.service_id || '';
    return services.filter((service) => {
      if (!service?.id) {
        return false;
      }
      const isCurrentSelection = service.id === currentServiceId;
      const assignedElsewhere = capabilities.some(
        (capability, capabilityIndex) => capabilityIndex !== index && capability.service_id === service.id
      );
      if (assignedElsewhere) {
        return false;
      }
      if (service?.is_active === false && !isCurrentSelection) {
        return false;
      }
      return true;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-end">ניהול יכולות שירות</DialogTitle>
          <DialogDescription className="text-end">
            הגדר את השירותים שהעובד יכול לספק, מספר תלמידים מקסימלי ותעריף בסיס
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave}>
          <div className="space-y-4 py-4">
            {/* Capabilities List */}
            {capabilities.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                לא הוגדרו יכולות שירות. לחץ על "הוסף שירות" כדי להתחיל.
              </div>
            ) : (
              <div className="space-y-3">
                {capabilities.map((capability, index) => (
                  <div key={index} className="border rounded-lg p-4 space-y-3 bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <Briefcase className="h-4 w-4 text-slate-600" />
                        <span className="font-medium text-sm">
                          {capability.service_id ? getServiceName(capability.service_id) : 'שירות חדש'}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCapability(index)}
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
                          onValueChange={(value) => updateCapability(index, 'service_id', value)}
                          disabled={isSaving || loadingServices}
                        >
                          <SelectTrigger className="text-end">
                            <SelectValue placeholder="בחר שירות" />
                          </SelectTrigger>
                          <SelectContent>
                            {getSelectableServices(index).map((service) => (
                              <SelectItem key={service.id} value={service.id}>
                                {service.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-slate-500">
                          השירות נבחר מתוך קטלוג `Services`. כאן מגדירים את ההחרגה לעובד: קיבולת ותעריף בפועל.
                        </p>
                      </div>

                      {/* Max Students */}
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
                          onChange={(e) => updateCapability(index, 'max_students', parseInt(e.target.value, 10) || 1)}
                          disabled={isSaving}
                          className="text-end"
                          dir="ltr"
                        />
                      </div>

                      {/* Base Rate */}
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
                          onChange={(e) => updateCapability(index, 'base_rate', parseFloat(e.target.value) || 0)}
                          disabled={isSaving}
                          className="text-end"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Button */}
            {availableServices.length > 0 && (
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

            {services.length > 0 && availableServices.length === 0 && capabilities.length > 0 && (
              <p className="text-xs text-slate-500 text-center">כל השירותים הזמינים כבר מוגדרים לעובד זה.</p>
            )}
          </div>

          <div className="flex flex-row-reverse gap-2 pt-4 border-t">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <>
                  <span className="animate-spin me-2">⏳</span>
                  שומר...
                </>
              ) : (
                'שמור שינויים'
              )}
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
