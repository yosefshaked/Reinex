import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { SelectField, TextField } from '@/components/ui/forms-ui';
import { Loader2, Plus } from 'lucide-react';
import { useMedicalProviders } from '@/features/students/hooks/useMedicalProviders.js';

const NONE_VALUE = '__none__';

export default function MedicalProviderField({ value, onChange, disabled = false, description }) {
  const { providers, loadingProviders, providersError, loadProviders, createProvider, canManageProviders } = useMedicalProviders();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [isSavingProvider, setIsSavingProvider] = useState(false);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const handleSelectChange = useCallback((nextValue) => {
    onChange(nextValue === NONE_VALUE ? '' : nextValue);
  }, [onChange]);

  const handleDialogToggle = useCallback((open) => {
    setIsDialogOpen(open);
    if (!open) {
      setNewProviderName('');
      setDialogError('');
    }
  }, []);

  const handleProviderNameChange = useCallback((event) => {
    setNewProviderName(event.target.value);
    if (dialogError) {
      setDialogError('');
    }
  }, [dialogError]);

  const handleCreateProvider = useCallback(async (event) => {
    event.preventDefault();
    const trimmed = newProviderName.trim();
    if (!trimmed) {
      setDialogError('יש להזין שם קופת חולים.');
      return;
    }

    setIsSavingProvider(true);
    setDialogError('');

    try {
      const payload = await createProvider(trimmed);
      const createdId = payload?.created?.id || null;
      const updated = await loadProviders();
      const resolvedId = createdId || updated.find((provider) => provider.name === trimmed)?.id || '';
      if (resolvedId) {
        onChange(resolvedId);
      }
      setIsDialogOpen(false);
      setNewProviderName('');
    } catch (error) {
      console.error('Failed to create medical provider', error);
      let message = error?.message || 'יצירת קופת החולים נכשלה.';
      if (message === 'provider_already_exists') {
        message = 'קופת חולים בשם זה כבר קיימת.';
      }
      setDialogError(message);
    } finally {
      setIsSavingProvider(false);
    }
  }, [createProvider, loadProviders, newProviderName, onChange]);

  const options = useMemo(() => {
    const base = providers.map((provider) => ({ value: provider.id, label: provider.name }));
    return [{ value: NONE_VALUE, label: 'ללא קופת חולים' }, ...base];
  }, [providers]);

  const placeholder = loadingProviders ? 'טוען קופות חולים...' : 'בחר קופת חולים';
  const fieldDescription = useMemo(() => {
    if (providersError) {
      return description || '';
    }
    if (!loadingProviders && providers.length === 0) {
      return 'לא קיימות קופות חולים זמינות. ניתן להוסיף חדשה.';
    }
    return description || 'בחירת קופת חולים לתלמיד.';
  }, [providersError, loadingProviders, providers.length, description]);

  const footer = (
    <DialogFooter>
      <Button
        type="button"
        onClick={handleCreateProvider}
        disabled={isSavingProvider}
        className="gap-2"
      >
        {isSavingProvider && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        שמירת קופת חולים
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => handleDialogToggle(false)}
        disabled={isSavingProvider}
      >
        ביטול
      </Button>
    </DialogFooter>
  );

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <SelectField
          id="medical-provider"
          label="קופת חולים"
          value={value || NONE_VALUE}
          onChange={handleSelectChange}
          options={options}
          placeholder={placeholder}
          disabled={disabled || loadingProviders}
          description={fieldDescription}
          error={providersError}
        />
      </div>
      {canManageProviders && (
        <Dialog open={isDialogOpen} onOpenChange={handleDialogToggle}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="mb-6"
              disabled={disabled}
              aria-label="הוספת קופת חולים חדשה"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md" footer={footer}>
            <DialogHeader>
              <DialogTitle>הוספת קופת חולים</DialogTitle>
              <DialogDescription>
                צרו קופת חולים חדשה לשימוש חוזר עבור תלמידים בארגון.
              </DialogDescription>
            </DialogHeader>
            <form id="medical-provider-create-form" onSubmit={handleCreateProvider} className="space-y-4" dir="rtl">
              <TextField
                id="new-medical-provider-name"
                name="newProviderName"
                label="שם קופת חולים"
                value={newProviderName}
                onChange={handleProviderNameChange}
                required
                disabled={isSavingProvider}
                placeholder="לדוגמה: כללית"
                error={dialogError}
              />
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
