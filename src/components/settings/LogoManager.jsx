import React, { useCallback, useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Image, Trash2, Loader2, AlertCircle, Link as LinkIcon } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';

const REQUEST = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

export default function LogoManager({ session, orgId }) {
  const [saveState, setSaveState] = useState(REQUEST.idle);
  const [deleteState, setDeleteState] = useState(REQUEST.idle);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [loading, setLoading] = useState(true);

  const canAct = Boolean(session && orgId);

  // Fetch current logo
  useEffect(() => {
    if (!canAct) return;

    const fetchLogo = async () => {
      setLoading(true);
      try {
        const data = await authenticatedFetch(`org-logo?org_id=${encodeURIComponent(orgId)}`, {
          method: 'GET',
        });
        setLogoUrl(data?.logo_url || null);
      } catch (error) {
        console.error('Error fetching logo:', error);
        setLogoUrl(null);
      } finally {
        setLoading(false);
      }
    };

    fetchLogo();
  }, [canAct, orgId]);

  const handleSave = useCallback(async () => {
    if (!canAct) return;
    
    const trimmedUrl = logoUrlInput.trim();
    if (!trimmedUrl) {
      toast.error('יש להזין כתובת URL של לוגו.');
      return;
    }

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch {
      toast.error('כתובת URL אינה תקינה.');
      return;
    }

    setSaveState(REQUEST.loading);

    try {
      const payload = await authenticatedFetch('org-logo', {
        method: 'POST',
        body: {
          org_id: orgId,
          logo_url: trimmedUrl,
        },
      });

      setLogoUrl(payload?.logo_url || null);
      setLogoUrlInput('');
      toast.success('הלוגו נשמר בהצלחה!');
      setSaveState(REQUEST.idle);
      
      // Notify other components to refresh the logo
      window.dispatchEvent(new CustomEvent('org-logo-updated'));
    } catch (error) {
      console.error('Save logo failed', error);
      
      if (error?.status === 403) {
        toast.error('הלוגו המותאם אישית אינו זמין. נא לפנות לתמיכה.');
      } else {
        toast.error(error?.message || 'שמירת הלוגו נכשלה');
      }
      
      setSaveState(REQUEST.error);
    }
  }, [canAct, orgId, logoUrlInput]);

  const handleDelete = useCallback(async () => {
    if (!canAct || !logoUrl) return;

    setDeleteState(REQUEST.loading);

    try {
      await authenticatedFetch('org-logo', {
        method: 'DELETE',
        body: { org_id: orgId },
      });

      setLogoUrl(null);
      toast.success('הלוגו הוסר בהצלחה.');
      setDeleteState(REQUEST.idle);
      
      // Notify other components to refresh the logo
      window.dispatchEvent(new CustomEvent('org-logo-updated'));
    } catch (error) {
      console.error('Delete logo failed', error);
      toast.error(error?.message || 'הסרת הלוגו נכשלה');
      setDeleteState(REQUEST.error);
    }
  }, [canAct, orgId, logoUrl]);

  return (
    <Card className="w-full border-0 shadow-lg bg-white/80" dir="rtl">
      <CardHeader className="border-b border-slate-200 space-y-xs">
        <CardTitle className="text-base font-semibold text-slate-900 sm:text-lg md:text-xl flex items-center gap-xs">
          <Image className="h-5 w-5 text-slate-700" />
          לוגו מותאם אישית
        </CardTitle>
        <p className="text-xs text-slate-600 sm:text-sm">הזינו כתובת URL של לוגו הארגון (קישור לתמונה).</p>
      </CardHeader>

      <CardContent className="space-y-md">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            טוען לוגו...
          </div>
        ) : logoUrl ? (
          <div className="space-y-sm">
            <Label className="text-slate-700">לוגו נוכחי</Label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-center">
              <img src={logoUrl} alt="Organization Logo" className="max-h-32 max-w-full object-contain" />
            </div>
            <div className="text-xs text-slate-500 break-all">
              <strong>URL:</strong> {logoUrl}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleDelete}
                disabled={deleteState === REQUEST.loading}
                variant="destructive"
                size="sm"
                className="gap-xs"
              >
                {deleteState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                הסר/י לוגו
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 flex flex-col items-center justify-center gap-3 text-center">
            <div className="rounded-full bg-slate-200 p-3">
              <Image className="h-6 w-6 text-slate-500" />
            </div>
            <p className="text-sm text-slate-600">לא הוגדר לוגו</p>
          </div>
        )}

        <div className="h-px w-full bg-slate-200" />

        <div className="space-y-2">
          <Label className="text-slate-700">הגדרת לוגו חדש</Label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                type="url"
                value={logoUrlInput}
                onChange={(e) => setLogoUrlInput(e.target.value)}
                placeholder="https://example.com/logo.png"
                className="w-full"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={saveState === REQUEST.loading || !logoUrlInput.trim()}
              className="gap-xs"
            >
              {saveState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              שמור/י לוגו
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            הזינו כתובת URL ציבורית של תמונת הלוגו (PNG, JPG, SVG, וכו׳)
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            הלוגו המותאם אישית יוצג בכל הדפים של האפליקציה ויחליף את לוגו ברירת המחדל.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
