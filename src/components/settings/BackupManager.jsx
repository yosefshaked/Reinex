import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Upload, Loader2, Copy, ShieldCheck, Clock, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client.js';

const REQUEST = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

function base64ToBlob(base64, contentType = 'application/octet-stream') {
  const binStr = atob(base64);
  const len = binStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

export default function BackupManager({ session, orgId }) {
  const [createState, setCreateState] = useState(REQUEST.idle);
  const [restoreState, setRestoreState] = useState(REQUEST.idle);
  const [passwordShown, setPasswordShown] = useState('');
  const [fileNameShown, setFileNameShown] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [clearExisting, setClearExisting] = useState(false);
  const [cooldownInfo, setCooldownInfo] = useState(null);
  const [checkingCooldown, setCheckingCooldown] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [backupEnabled, setBackupEnabled] = useState(true);
  const fileInputRef = useRef(null);

  const canAct = useMemo(() => Boolean(session && orgId), [session, orgId]);

  // Check cooldown status from backup history
  useEffect(() => {
    if (!canAct) return;

    const checkCooldown = async () => {
      setCheckingCooldown(true);
      try {
        // Fetch cooldown status from control DB
        const data = await authenticatedFetch(`backup-status?org_id=${encodeURIComponent(orgId)}` , {
          method: 'GET',
        });
        setBackupEnabled(Boolean(data?.enabled));
        const cooldown = data?.cooldown || { active: false };
        setOverrideEnabled(Boolean(data?.override_enabled));
        if (cooldown && cooldown.active) {
          setCooldownInfo({
            active: true,
            nextAllowedAt: cooldown.next_allowed_at,
            daysRemaining: cooldown.days_remaining,
            lastBackupDate: cooldown.last_backup_at,
          });
        } else {
          setCooldownInfo({ active: false });
        }
      } catch (error) {
        console.error('Error checking cooldown:', error);
        setCooldownInfo({ active: false });
      } finally {
        setCheckingCooldown(false);
      }
    };

    checkCooldown();
  }, [canAct, orgId]);

  const handleCreateBackup = useCallback(async () => {
    if (!canAct) return;
    setCreateState(REQUEST.loading);
    setPasswordShown('');
    setFileNameShown('');

    try {
      const payload = await authenticatedFetch('backup', {
        method: 'POST',
        body: { org_id: orgId },
      });

      const { encrypted_file: encryptedBase64, filename, password, size_bytes } = payload || {};
      if (!encryptedBase64 || !filename || !password) {
        throw new Error('Backup did not return required fields.');
      }

      // Prepare download
      const blob = base64ToBlob(encryptedBase64, 'application/octet-stream');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Show password
      setPasswordShown(password);
      setFileNameShown(filename);

      const sizeKB = Math.round((size_bytes || blob.size) / 1024);
      toast.success(`הגיבוי נוצר בהצלחה (${sizeKB}KB). שמור/י את הסיסמה!`);
      setCreateState(REQUEST.idle);
      setOverrideEnabled(false); // consumed on success by backend
      
      // Refresh cooldown info
      setCooldownInfo({
        active: true,
        nextAllowedAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        daysRemaining: 7,
        lastBackupDate: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Create backup failed', error);
      
      // Handle cooldown error
      if (error?.status === 429) {
        const daysRemaining = error?.data?.days_remaining || 7;
        toast.error(`יש להמתין ${daysRemaining} ימים נוספים לפני יצירת גיבוי נוסף`);
        
        // Update cooldown info from error
        setCooldownInfo({
          active: true,
          nextAllowedAt: error?.data?.next_allowed_at,
          daysRemaining: error?.data?.days_remaining,
        });
      } else {
        toast.error(error?.message || 'יצירת הגיבוי נכשלה');
      }
      
      setCreateState(REQUEST.error);
    }
  }, [canAct, orgId]);

  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result is data URL: data:application/octet-stream;base64,....
      const comma = String(result).indexOf(',');
      if (comma >= 0) {
        resolve(String(result).slice(comma + 1));
      } else {
        // Fallback: try to extract base64 anyway
        resolve(String(result));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const handleRestore = useCallback(async () => {
    if (!canAct) return;
    const input = fileInputRef.current;
    const file = input?.files?.[0] || null;
    if (!file) {
      toast.error('יש לבחור קובץ גיבוי לשחזור.');
      return;
    }
    if (!restorePassword.trim()) {
      toast.error('יש להזין סיסמת גיבוי.');
      return;
    }

    setRestoreState(REQUEST.loading);

    try {
      const base64 = await readFileAsBase64(file);
      const payload = await authenticatedFetch('restore', {
        method: 'POST',
        body: {
          org_id: orgId,
          file: base64,
          password: restorePassword.trim(),
          clear_existing: Boolean(clearExisting),
        },
      });

      const restored = payload?.restored || 0;
      toast.success(`השחזור הושלם. ${restored} רשומות שוחזרו.`);
      setRestoreState(REQUEST.idle);
    } catch (error) {
      console.error('Restore failed', error);
      const incorrect = error?.data?.message === 'incorrect_password';
      toast.error(incorrect ? 'סיסמת הגיבוי שגויה.' : (error?.message || 'השחזור נכשל'));
      setRestoreState(REQUEST.error);
    }
  }, [canAct, orgId, restorePassword, clearExisting]);

  const handleCopyPassword = () => {
    if (!passwordShown) return;
    navigator.clipboard.writeText(passwordShown).then(
      () => toast.success('הסיסמה הועתקה'),
      () => toast.error('ההעתקה נכשלה'),
    );
  };

  return (
    <Card className="w-full border-0 shadow-lg bg-white/80" dir="rtl">
      <CardHeader className="border-b border-slate-200 space-y-xs">
        <CardTitle className="text-base font-semibold text-slate-900 sm:text-lg md:text-xl flex items-center gap-xs">
          <ShieldCheck className="h-5 w-5 text-slate-700" />
          גיבוי ושחזור
        </CardTitle>
        <p className="text-xs text-slate-600 sm:text-sm">צרו קובץ גיבוי מוצפן לשמירה מקומית, או שחזרו מגיבוי קיים.</p>
      </CardHeader>

      <CardContent className="space-y-md">
        {/* Disabled/availability indicator */}
        {checkingCooldown ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            בודק זמינות גיבוי...
          </div>
        ) : !backupEnabled ? (
          <div className="rounded-lg border border-slate-200 bg-slate-100 p-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-slate-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-slate-800 text-sm mb-1">
                גיבוי אינו זמין
              </div>
              <div className="text-xs text-slate-700">
                גיבוי אינו זמין. נא לפנות לתמיכה על מנת לבחון הפעלת הפונקציה.
              </div>
            </div>
          </div>
        ) : cooldownInfo?.active ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-amber-900 text-sm mb-1">
                גיבוי זמין בעוד {cooldownInfo.daysRemaining} ימים
              </div>
              <div className="text-xs text-amber-700">
                הגיבוי הבא יהיה זמין ב-{new Date(cooldownInfo.nextAllowedAt).toLocaleDateString('he-IL', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </div>
              {cooldownInfo.lastBackupDate && (
                <div className="text-xs text-amber-600 mt-1">
                  גיבוי אחרון: {new Date(cooldownInfo.lastBackupDate).toLocaleDateString('he-IL', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              )}
              {overrideEnabled && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-100">עקיפה זמינה</Badge>
                  <span className="text-xs text-amber-700">לחיצה על יצירת גיבוי תצרוך את העקיפה החד-פעמית.</span>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-sm sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="text-slate-700">יצירת גיבוי</Label>
            <p className="text-xs text-slate-500 mb-2">בלחיצה יווצר קובץ גיבוי מוצפן וסיסמה חד-פעמית. חובה לשמור את הסיסמה.</p>
            <Button 
              onClick={handleCreateBackup} 
              disabled={!backupEnabled || createState === REQUEST.loading || (cooldownInfo?.active && !overrideEnabled)} 
              className="gap-xs"
            >
              {createState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {!backupEnabled
                ? 'גיבוי אינו זמין'
                : cooldownInfo?.active 
                ? (overrideEnabled ? 'עקוף ההמתנה וצור/י גיבוי' : 'גיבוי לא זמין (ממתין)') 
                : 'צור/י גיבוי להורדה'}
            </Button>
          </div>

          {passwordShown ? (
            <div className="flex-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <div className="flex items-center justify-between gap-2 mb-1">
                <strong className="text-sm">סיסמת הגיבוי</strong>
                <Button variant="outline" size="xs" className="h-7 gap-1" onClick={handleCopyPassword}>
                  <Copy className="h-3.5 w-3.5" /> העתק
                </Button>
              </div>
              <div className="font-mono text-sm break-all">{passwordShown}</div>
              {fileNameShown ? (
                <div className="mt-1 text-xs text-slate-600">שם הקובץ: {fileNameShown}</div>
              ) : null}
              <div className="mt-2 text-xs text-amber-700">אין אפשרות לשחזר ללא סיסמה. שמור/י אותה במקום מאובטח.</div>
            </div>
          ) : null}
        </div>

        <div className="h-px w-full bg-slate-200" />

        <div className="grid gap-sm sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-700">קובץ לשחזור</Label>
            <Input type="file" ref={fileInputRef} accept=".enc,application/octet-stream" />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-700">סיסמת גיבוי</Label>
            <Input type="text" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} placeholder="ABCD-EF12-3456-7890-ABCD" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="clear-existing" checked={clearExisting} onCheckedChange={setClearExisting} />
            <Label htmlFor="clear-existing" className="text-slate-700">נקה נתונים קיימים לפני השחזור</Label>
          </div>
          <div className="flex items-end">
            <Button onClick={handleRestore} disabled={!backupEnabled || restoreState === REQUEST.loading} className="gap-xs">
              {restoreState === REQUEST.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              שחזר/י מגיבוי
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
