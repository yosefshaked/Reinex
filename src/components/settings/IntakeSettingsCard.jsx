import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { fetchSettings, upsertSettings } from '@/features/settings/api/settings.js';

const DEFAULT_MAPPING = {
  student_name: '',
  national_id: '',
  phone: '',
  parent_name: '',
  parent_phone: '',
  health_provider_tag: '',
};

const FIELD_LABELS = {
  student_name: 'שם תלמיד (Source Key)',
  national_id: 'מספר זהות (Source Key)',
  phone: 'טלפון תלמיד (Source Key)',
  parent_name: 'שם הורה/איש קשר (Source Key)',
  parent_phone: 'טלפון הורה/איש קשר (Source Key)',
  health_provider_tag: 'תג ספק שירות/קופת חולים (Source Key)',
};

function normalizeMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_MAPPING };
  }
  return {
    student_name: typeof value.student_name === 'string' ? value.student_name : '',
    national_id: typeof value.national_id === 'string' ? value.national_id : '',
    phone: typeof value.phone === 'string' ? value.phone : '',
    parent_name: typeof value.parent_name === 'string' ? value.parent_name : '',
    parent_phone: typeof value.parent_phone === 'string' ? value.parent_phone : '',
    health_provider_tag: typeof value.health_provider_tag === 'string' ? value.health_provider_tag : '',
  };
}

function generateSecretValue() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`;
}

export default function IntakeSettingsCard({ session, orgId, activeOrgHasConnection }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [mapping, setMapping] = useState({ ...DEFAULT_MAPPING });
  const [secret, setSecret] = useState('');
  const [importantFields, setImportantFields] = useState([]);
  const [newImportantField, setNewImportantField] = useState('');
  const [initialMapping, setInitialMapping] = useState({ ...DEFAULT_MAPPING });
  const [initialSecret, setInitialSecret] = useState('');
  const [initialImportantFields, setInitialImportantFields] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      if (!session || !orgId || !activeOrgHasConnection) {
        if (!cancelled) {
          setIsLoading(false);
          setMapping({ ...DEFAULT_MAPPING });
          setSecret('');
          setInitialMapping({ ...DEFAULT_MAPPING });
          setInitialSecret('');
          setError('');
        }
        return;
      }

      setIsLoading(true);
      setError('');

      try {
        const settings = await fetchSettings({ session, orgId });
        if (cancelled) {
          return;
        }
        const nextMapping = normalizeMapping(settings?.intake_field_mapping);
        const nextSecret = typeof settings?.external_intake_secret === 'string'
          ? settings.external_intake_secret
          : '';
        const importantFields = Array.isArray(settings?.intake_important_fields)
          ? settings.intake_important_fields
          : [];
        setMapping(nextMapping);
        setSecret(nextSecret);
        setImportantFields(importantFields);
        setInitialMapping(nextMapping);
        setInitialSecret(nextSecret);
        setInitialImportantFields(importantFields);
      } catch (loadError) {
        console.error('Failed to load intake settings', loadError);
        if (!cancelled) {
          setError('טעינת הגדרות קליטת תלמידים נכשלה. נסו שוב.');
          setMapping({ ...DEFAULT_MAPPING });
          setSecret('');
          setImportantFields([]);
          setInitialMapping({ ...DEFAULT_MAPPING });
          setInitialSecret('');
          setInitialImportantFields([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [session, orgId, activeOrgHasConnection]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(mapping) !== JSON.stringify(initialMapping)
      || secret !== initialSecret
      || JSON.stringify(importantFields) !== JSON.stringify(initialImportantFields);
  }, [mapping, initialMapping, secret, initialSecret, importantFields, initialImportantFields]);

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;
    setMapping((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegenerateSecret = () => {
    const nextSecret = generateSecretValue();
    setSecret(nextSecret);
  };

  const saveImportantFields = async (nextFields, { successMessage } = {}) => {
    if (!session || !orgId) {
      toast.error('נדרשת התחברות פעילה כדי לשמור את ההגדרות.');
      return false;
    }
    if (!activeOrgHasConnection) {
      toast.error('יש להשלים חיבור למסד הנתונים לפני שמירה.');
      return false;
    }

    setIsSaving(true);
    setError('');
    try {
      await upsertSettings({
        session,
        orgId,
        settings: {
          intake_important_fields: nextFields,
        },
      });
      setImportantFields(nextFields);
      setInitialImportantFields(nextFields);
      if (successMessage) {
        toast.success(successMessage);
      }
      return true;
    } catch (saveError) {
      console.error('Failed to save important fields', saveError);
      toast.error('שמירת השדות החשובים נכשלה.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddImportantField = async () => {
    const trimmed = newImportantField.trim();
    if (!trimmed) {
      return;
    }
    const nextFields = importantFields.includes(trimmed)
      ? importantFields
      : [...importantFields, trimmed];
    const saved = await saveImportantFields(nextFields, {
      successMessage: 'השדה נשמר בהצלחה.',
    });
    if (saved) {
      setNewImportantField('');
    }
  };

  const handleRemoveImportantField = async (field) => {
    const nextFields = importantFields.filter((entry) => entry !== field);
    await saveImportantFields(nextFields, {
      successMessage: 'השדה הוסר בהצלחה.',
    });
  };

  const handleMoveImportantField = async (fieldIndex, direction) => {
    const nextIndex = fieldIndex + direction;
    if (nextIndex < 0 || nextIndex >= importantFields.length) {
      return;
    }
    const nextFields = [...importantFields];
    const [moved] = nextFields.splice(fieldIndex, 1);
    nextFields.splice(nextIndex, 0, moved);
    await saveImportantFields(nextFields, {
      successMessage: 'סדר השדות עודכן בהצלחה.',
    });
  };

  const handleSave = async () => {
    if (!session || !orgId) {
      toast.error('נדרשת התחברות פעילה כדי לשמור את ההגדרות.');
      return;
    }
    if (!activeOrgHasConnection) {
      toast.error('יש להשלים חיבור למסד הנתונים לפני שמירה.');
      return;
    }
    if (!secret.trim()) {
      setError('יש להזין סוד חיצוני לפני שמירה.');
      toast.error('חסר סוד חיצוני לשמירה.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await upsertSettings({
        session,
        orgId,
        settings: {
          intake_field_mapping: mapping,
          intake_important_fields: importantFields,
          external_intake_secret: secret.trim(),
        },
      });
      setInitialMapping(mapping);
      setInitialSecret(secret.trim());
      setInitialImportantFields(importantFields);
      toast.success('הגדרות הקליטה נשמרו בהצלחה.');
    } catch (saveError) {
      console.error('Failed to save intake settings', saveError);
      setError('שמירת ההגדרות נכשלה. נסו שוב.');
      toast.error('שמירת ההגדרות נכשלה.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-0 bg-white/80 shadow-lg">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="text-lg font-semibold text-slate-900">הגדרות קליטת תלמידים</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6" dir="rtl">
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            מיפוי שדות טופס Microsoft Forms לשדות המערכת כדי לקלוט בקשות באמצעות Power Automate.
          </p>
          <p>
            הגדירו את הכותרות <span className="font-medium">x-org-id</span> ו-
            <span className="font-medium"> x-intake-secret</span> בזרימת Power Automate.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">מיפוי שדות מערכת</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.keys(DEFAULT_MAPPING).map((fieldKey) => (
              <div key={fieldKey} className="space-y-2">
                <Label htmlFor={`intake-${fieldKey}`}>{FIELD_LABELS[fieldKey]}</Label>
                <Input
                  id={`intake-${fieldKey}`}
                  value={mapping[fieldKey]}
                  onChange={handleFieldChange(fieldKey)}
                  placeholder='הקלידו את נוסח השאלה בעברית (למשל: "תעודת זהות")'
                  disabled={isLoading || isSaving}
                />
              </div>
            ))}
          </div>
        </div>

        <details className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            שדות חשובים לתצוגה מהירה
          </summary>
          <p className="text-sm text-slate-600">
            הוסיפו שמות שדות בעברית להצגה בלוח הבקרה ובפרופיל התלמיד.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="intake-important-field">שדה חשוב</Label>
              <Input
                id="intake-important-field"
                value={newImportantField}
                onChange={(event) => setNewImportantField(event.target.value)}
                placeholder='לדוגמה: "שם פרטי"'
                disabled={isLoading || isSaving}
              />
            </div>
            <Button
              type="button"
              onClick={handleAddImportantField}
              disabled={isLoading || isSaving || !newImportantField.trim()}
            >
              הוסף
            </Button>
          </div>
          {importantFields.length ? (
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {importantFields.map((field, index) => (
                <li key={`${field}-${index}`} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <span>{field}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMoveImportantField(index, -1)}
                      disabled={isLoading || isSaving || index === 0}
                      aria-label="העבר למעלה"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleMoveImportantField(index, 1)}
                      disabled={isLoading || isSaving || index === importantFields.length - 1}
                      aria-label="העבר למטה"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveImportantField(field)}
                      disabled={isLoading || isSaving}
                    >
                      הסר
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">לא הוגדרו שדות חשובים עדיין.</p>
          )}
        </details>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="intake-secret">סוד חיצוני (External Intake Secret)</Label>
            <Input
              id="intake-secret"
              type={showSecret ? 'text' : 'password'}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="יצירת סוד חיצוני"
              disabled={isLoading || isSaving}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowSecret((prev) => !prev)}
              disabled={isLoading || isSaving}
            >
              {showSecret ? 'הסתרת סוד' : 'הצגת סוד'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleRegenerateSecret}
              disabled={isLoading || isSaving}
            >
              יצירת סוד חדש
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={isLoading || isSaving || !hasChanges}
            className="min-w-[140px]"
          >
            {isSaving ? 'שומר...' : 'שמירת הגדרות'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
