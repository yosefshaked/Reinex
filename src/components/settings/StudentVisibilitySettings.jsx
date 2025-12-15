import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { fetchSettingsValue, upsertSetting } from '@/features/settings/api/settings.js';

const SETTING_KEY = 'instructors_can_view_inactive_students';

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

export default function StudentVisibilitySettings({ session, orgId, activeOrgHasConnection }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [initialEnabled, setInitialEnabled] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadSetting = async () => {
      if (!session || !orgId || !activeOrgHasConnection) {
        setIsEnabled(false);
        setInitialEnabled(false);
        setIsLoading(false);
        setError('');
        return;
      }

      setIsLoading(true);
      setError('');

      try {
        const response = await fetchSettingsValue({ session, orgId, key: SETTING_KEY });
        if (cancelled) {
          return;
        }
        const enabled = normalizeBoolean(response?.value);
        setIsEnabled(enabled);
        setInitialEnabled(enabled);
      } catch (loadError) {
        console.error('Failed to load student visibility setting', loadError);
        if (!cancelled) {
          setIsEnabled(false);
          setInitialEnabled(false);
          setError('שגיאה בטעינת ההעדפה. נסו שוב לאחר בדיקת החיבור.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadSetting();

    return () => {
      cancelled = true;
    };
  }, [session, orgId, activeOrgHasConnection]);

  const hasChanges = useMemo(() => {
    return isEnabled !== initialEnabled;
  }, [isEnabled, initialEnabled]);

  const handleToggle = (value) => {
    setIsEnabled(Boolean(value));
  };

  const handleSave = async () => {
    if (!session || !orgId) {
      toast.error('נדרשת התחברות פעילה כדי לשמור את ההעדפה.');
      return;
    }
    if (!activeOrgHasConnection) {
      toast.error('השלימו את חיבור ה-Supabase לפני שמירה.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await upsertSetting({
        session,
        orgId,
        key: SETTING_KEY,
        value: isEnabled,
      });
      setInitialEnabled(isEnabled);
      toast.success('ההעדפה נשמרה בהצלחה.');
    } catch (saveError) {
      console.error('Failed to save student visibility setting', saveError);
      setError('שמירת ההעדפה נכשלה. נסו שוב בעוד מספר רגעים.');
      toast.error('שמירת ההעדפה נכשלה.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-0 bg-white/80 shadow-lg">
      <CardHeader className="border-b border-slate-200">
        <CardTitle className="text-lg font-semibold text-slate-900">תצוגת תלמידים לא פעילים</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4" dir="rtl">
        <p className="text-sm text-slate-600">
          שליטה האם מדריכים יוכלו להציג תלמידים שסומנו כלא פעילים בממשק. תלמידים לא פעילים נשארים בהיסטוריית המפגשים ובייצואי PDF.
        </p>

        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">אפשר למדריכים להציג תלמידים לא פעילים</p>
            <p className="text-xs text-slate-600 sm:text-sm">
              כאשר האפשרות פעילה, מדריכים יראו מסנן חדש בממשק "התלמידים שלי" שיאפשר הצגת תלמידים שאינם פעילים כברירת מחדל.
            </p>
          </div>
          <Switch
            id="toggle-inactive-visibility"
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={isLoading || isSaving}
            aria-label="החלפת אפשרות הצגת תלמידים לא פעילים"
          />
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
            className="min-w-[120px]"
          >
            {isSaving ? 'שומר...' : 'שמור הגדרה'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
