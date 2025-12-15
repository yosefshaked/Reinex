import React, { useCallback, useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Lock, HardDrive, Cloud, Loader2, CheckCircle2, Trash2, AlertTriangle, RefreshCw, Zap } from 'lucide-react';
import { saveStorageConfiguration, deleteStorageConfiguration, reconnectStorageConfiguration, testStorageConnection } from '@/features/settings/api/storage.js';
import { useOrg } from '@/org/OrgContext.jsx';

const STORAGE_MODES = {
  BYOS: 'byos',
  MANAGED: 'managed',
};

const PROVIDERS = [
  { value: 's3', label: 'Amazon S3' },
  { value: 'r2', label: 'Cloudflare R2' },
  { value: 'azure', label: 'Azure Blob Storage' },
  { value: 'supabase', label: 'Supabase Storage' },
  { value: 'gcs', label: 'Google Cloud Storage' },
  { value: 'generic', label: 'S3-Compatible (Generic)' },
];

const REQUEST = {
  idle: 'idle',
  loading: 'loading',
  error: 'error',
};

/**
 * Generate a unique namespace for managed storage
 * Uses org ID prefix and suffix for better distribution
 */
function createStorageNamespace(orgId) {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid organization ID required for namespace generation');
  }
  
  // For short IDs, use the full ID
  if (orgId.length <= 12) {
    return `org-${orgId}`;
  }
  
  // For longer IDs, use prefix + suffix for better distribution
  const prefix = orgId.substring(0, 8);
  const suffix = orgId.substring(orgId.length - 4);
  return `org-${prefix}-${suffix}`;
}

export default function StorageSettingsCard({ session, orgId }) {
  const { orgSettings, refreshOrganizations } = useOrg();
  const [saveState, setSaveState] = useState(REQUEST.idle);
  const [selectedMode, setSelectedMode] = useState('');
  const [provider, setProvider] = useState('s3');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [disconnectState, setDisconnectState] = useState(REQUEST.idle);
  const [testState, setTestState] = useState(REQUEST.idle);

  const canAct = Boolean(session && orgId);

  // Get storage_access_level permission
  const storageAccessLevel = orgSettings?.permissions?.storage_access_level;
  
  // Check if storage is disconnected
  const isDisconnected = orgSettings?.storageProfile?.disconnected === true;
  
  // Determine access states
  const isLocked = storageAccessLevel === false || !storageAccessLevel;
  const canUseBYOS = storageAccessLevel === 'byos_only' || storageAccessLevel === 'all';
  const canUseManaged = storageAccessLevel === 'managed_only' || storageAccessLevel === 'all';

  // Load existing storage profile
  useEffect(() => {
    const profile = orgSettings?.storageProfile;
    if (profile && profile.mode) {
      setSelectedMode(profile.mode);
      if (profile.mode === STORAGE_MODES.BYOS && profile.byos) {
        setProvider(profile.byos.provider || 's3');
        setEndpoint(profile.byos.endpoint || '');
        setRegion(profile.byos.region || '');
        setBucket(profile.byos.bucket || '');
        setPublicUrl(profile.byos.public_url || '');
        // Don't populate credentials for security (force re-entry)
      }
    }
  }, [orgSettings]);

  const handleSave = useCallback(async () => {
    if (!canAct) return;

    if (!selectedMode) {
      toast.error('יש לבחור מצב אחסון');
      return;
    }

    setSaveState(REQUEST.loading);

    try {
      let payload;

      if (selectedMode === STORAGE_MODES.MANAGED) {
        // For managed mode, generate a namespace from org ID
        const namespace = createStorageNamespace(orgId);
        payload = {
          mode: STORAGE_MODES.MANAGED,
          managed: {
            namespace,
            active: true,
          },
        };
      } else if (selectedMode === STORAGE_MODES.BYOS) {
        // Validate BYOS fields
        const trimmedEndpoint = endpoint.trim();
        
        if (!trimmedEndpoint) {
          toast.error('נדרשת כתובת Endpoint');
          setSaveState(REQUEST.idle);
          return;
        }
        
        // HTTPS validation for security
        if (!trimmedEndpoint.startsWith('https://')) {
          toast.error('Endpoint חייב להשתמש ב-HTTPS למניעת דליפת מפתחות');
          setSaveState(REQUEST.idle);
          return;
        }
        
        if (!bucket.trim()) {
          toast.error('נדרש שם Bucket');
          setSaveState(REQUEST.idle);
          return;
        }
        if (!accessKeyId.trim()) {
          toast.error('נדרש Access Key ID');
          setSaveState(REQUEST.idle);
          return;
        }
        if (!secretAccessKey.trim()) {
          toast.error('נדרש Secret Access Key');
          setSaveState(REQUEST.idle);
          return;
        }

        payload = {
          mode: STORAGE_MODES.BYOS,
          byos: {
            provider,
            endpoint: endpoint.trim(),
            bucket: bucket.trim(),
            access_key_id: accessKeyId.trim(),
            secret_access_key: secretAccessKey.trim(),
          },
        };

        if (region.trim()) {
          payload.byos.region = region.trim();
        }

        // Add public URL if provided
        if (publicUrl.trim()) {
          const trimmedPublicUrl = publicUrl.trim();
          if (!trimmedPublicUrl.startsWith('https://')) {
            toast.error('כתובת URL ציבורית חייבת להשתמש ב-HTTPS');
            setSaveState(REQUEST.idle);
            return;
          }
          payload.byos.public_url = trimmedPublicUrl;
        }
      }

      await saveStorageConfiguration(orgId, payload, { session });

      toast.success('הגדרות האחסון נשמרו בהצלחה!');
      setSaveState(REQUEST.idle);

      // Clear sensitive fields after save
      setAccessKeyId('');
      setSecretAccessKey('');
      
      // Refresh org context to reload storage profile
      if (refreshOrganizations) {
        await refreshOrganizations({ keepSelection: true });
      }
    } catch (error) {
      console.error('Save storage configuration failed', error);
      toast.error(error?.message || 'שמירת הגדרות האחסון נכשלה');
      setSaveState(REQUEST.error);
    }
  }, [canAct, orgId, session, selectedMode, provider, endpoint, region, bucket, accessKeyId, secretAccessKey, publicUrl, refreshOrganizations]);

  const handleDisconnect = useCallback(async () => {
    if (!canAct) return;

    setDisconnectState(REQUEST.loading);

    try {
      await deleteStorageConfiguration(orgId, { session });
      
      // Refresh org context to reload storage profile
      if (refreshOrganizations) {
        await refreshOrganizations({ keepSelection: true });
      }

      toast.success('אחסון נותק בהצלחה');
      setDisconnectState(REQUEST.idle);
      setShowDisconnectDialog(false);
      
      // Reset form state
      setSelectedMode('');
      setProvider('s3');
      setEndpoint('');
      setRegion('');
      setBucket('');
      setAccessKeyId('');
      setSecretAccessKey('');
      setPublicUrl('');
    } catch (error) {
      console.error('Disconnect storage failed', error);
      toast.error(error?.message || 'ניתוק האחסון נכשל');
      setDisconnectState(REQUEST.error);
    }
  }, [canAct, orgId, session, refreshOrganizations]);

  const handleReconnect = useCallback(async () => {
    if (!canAct) return;

    setDisconnectState(REQUEST.loading);

    try {
      await reconnectStorageConfiguration(orgId, { session });
      
      // Refresh org context to reload storage profile
      if (refreshOrganizations) {
        await refreshOrganizations({ keepSelection: true });
      }

      toast.success('האחסון חובר מחדש בהצלחה');
      setDisconnectState(REQUEST.idle);
    } catch (error) {
      console.error('Reconnect storage failed', error);
      toast.error(error?.message || 'חיבור האחסון מחדש נכשל');
      setDisconnectState(REQUEST.error);
    }
  }, [canAct, orgId, session, refreshOrganizations]);

  const handleTestConnection = useCallback(async () => {
    if (!canAct) return;

    if (!selectedMode) {
      toast.error('יש לבחור מצב אחסון');
      return;
    }

    setTestState(REQUEST.loading);

    try {
      let payload;

      if (selectedMode === STORAGE_MODES.MANAGED) {
        const namespace = createStorageNamespace(orgId);
        payload = {
          mode: STORAGE_MODES.MANAGED,
          managed: {
            namespace,
            active: true,
          },
        };
      } else if (selectedMode === STORAGE_MODES.BYOS) {
        // Validate BYOS fields before testing
        const trimmedEndpoint = endpoint.trim();
        
        if (!trimmedEndpoint) {
          toast.error('נדרשת כתובת Endpoint');
          setTestState(REQUEST.idle);
          return;
        }
        
        if (!trimmedEndpoint.startsWith('https://')) {
          toast.error('Endpoint חייב להשתמש ב-HTTPS');
          setTestState(REQUEST.idle);
          return;
        }
        
        if (!bucket.trim()) {
          toast.error('נדרש שם Bucket');
          setTestState(REQUEST.idle);
          return;
        }
        if (!accessKeyId.trim()) {
          toast.error('נדרש Access Key ID');
          setTestState(REQUEST.idle);
          return;
        }
        if (!secretAccessKey.trim()) {
          toast.error('נדרש Secret Access Key');
          setTestState(REQUEST.idle);
          return;
        }

        payload = {
          mode: STORAGE_MODES.BYOS,
          byos: {
            provider,
            endpoint: endpoint.trim(),
            bucket: bucket.trim(),
            access_key_id: accessKeyId.trim(),
            secret_access_key: secretAccessKey.trim(),
          },
        };

        if (region.trim()) {
          payload.byos.region = region.trim();
        }

        if (publicUrl.trim()) {
          payload.byos.public_url = publicUrl.trim();
        }
      }

      const result = await testStorageConnection(payload, { session });

      if (result?.success) {
        toast.success('✅ החיבור נבדק בהצלחה! ההגדרות תקינות.');
      } else {
        toast.error('הבדיקה נכשלה');
      }
      
      setTestState(REQUEST.idle);
    } catch (error) {
      console.error('Test connection failed', error);
      const errorMessage = error?.message || 'בדיקת החיבור נכשלה';
      toast.error(errorMessage);
      setTestState(REQUEST.error);
    }
  }, [canAct, orgId, session, selectedMode, provider, endpoint, region, bucket, accessKeyId, secretAccessKey, publicUrl]);


  // Render locked state
  if (isLocked) {
    return (
      <div className="relative" dir="rtl">
        <div className="absolute inset-0 bg-slate-100/80 backdrop-blur-[2px] z-10 rounded-lg flex items-center justify-center">
          <div className="text-center p-6 bg-white rounded-lg shadow-lg max-w-sm">
            <Lock className="h-12 w-12 text-slate-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">תכונה זו אינה זמינה</h3>
            <p className="text-sm text-slate-600">
              תכונת הגדרות אחסון זמינה בחבילות מתקדמות. צור קשר עם התמיכה לקבלת מידע נוסף.
            </p>
          </div>
        </div>
        <Card className="opacity-50 pointer-events-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              הגדרות אחסון
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">טעינה...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card dir="rtl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          הגדרות אחסון
        </CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          בחר את מצב האחסון המועדף עבור קבצי הארגון
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Mode Selection */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">מצב אחסון</Label>
          <div className="grid gap-3">
            {/* Managed Storage Option */}
            <button
              type="button"
              onClick={() => canUseManaged && setSelectedMode(STORAGE_MODES.MANAGED)}
              disabled={!canUseManaged}
              className={`p-4 border-2 rounded-lg text-right transition-all ${
                selectedMode === STORAGE_MODES.MANAGED
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : canUseManaged
                  ? 'border-slate-200 hover:border-primary/50'
                  : 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start gap-3">
                <Cloud className={`h-5 w-5 mt-0.5 ${canUseManaged ? 'text-primary' : 'text-slate-400'}`} />
                <div className="flex-1">
                  <div className="font-semibold mb-1">אחסון מנוהל</div>
                  <p className="text-sm text-slate-600">
                    נאחסן בצורה מאובטחת על ידי Reinex
                  </p>
                  {!canUseManaged && (
                    <Badge variant="secondary" className="mt-2">לא זמין בחבילה שלך</Badge>
                  )}
                </div>
                {selectedMode === STORAGE_MODES.MANAGED && (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                )}
              </div>
            </button>

            {/* BYOS Option */}
            <button
              type="button"
              onClick={() => canUseBYOS && setSelectedMode(STORAGE_MODES.BYOS)}
              disabled={!canUseBYOS}
              className={`p-4 border-2 rounded-lg text-right transition-all ${
                selectedMode === STORAGE_MODES.BYOS
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : canUseBYOS
                  ? 'border-slate-200 hover:border-primary/50'
                  : 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-start gap-3">
                <HardDrive className={`h-5 w-5 mt-0.5 ${canUseBYOS ? 'text-primary' : 'text-slate-400'}`} />
                <div className="flex-1">
                  <div className="font-semibold mb-1">BYOS - אחסון משלך</div>
                  <p className="text-sm text-slate-600">
                    השתמש באחסון ענן משלך (S3, R2, Azure וכו')
                  </p>
                  {!canUseBYOS && (
                    <Badge variant="secondary" className="mt-2">לא זמין בחבילה שלך</Badge>
                  )}
                </div>
                {selectedMode === STORAGE_MODES.BYOS && (
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                )}
              </div>
            </button>
          </div>
        </div>

        {/* Managed Storage Success Message */}
        {selectedMode === STORAGE_MODES.MANAGED && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-emerald-900 mb-1">נאחסן בצורה מאובטחת</div>
              <p className="text-sm text-emerald-700">
                הקבצים שלך יישמרו באופן מאובטח במערכת Reinex ללא צורך בהגדרות נוספות.
              </p>
            </div>
          </div>
        )}

        {/* BYOS Configuration Form */}
        {selectedMode === STORAGE_MODES.BYOS && (
          <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <Label htmlFor="provider">ספק אחסון</Label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full mt-1 rounded-md border border-slate-300 p-2 text-sm"
                dir="ltr"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="endpoint">
                Endpoint <span className="text-red-500">*</span>
              </Label>
              <Input
                id="endpoint"
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://s3.amazonaws.com"
                className="mt-1"
                dir="ltr"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                חובה להשתמש ב-HTTPS למניעת דליפת מפתחות
              </p>
            </div>

            <div>
              <Label htmlFor="bucket">
                Bucket <span className="text-red-500">*</span>
              </Label>
              <Input
                id="bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                placeholder="my-bucket-name"
                className="mt-1"
                dir="ltr"
                required
              />
            </div>

            <div>
              <Label htmlFor="region">Region (אופציונלי)</Label>
              <Input
                id="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                className="mt-1"
                dir="ltr"
              />
            </div>

            <div>
              <Label htmlFor="accessKeyId">
                Access Key ID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="accessKeyId"
                type="text"
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                className="mt-1"
                dir="ltr"
                required
              />
            </div>

            <div>
              <Label htmlFor="secretAccessKey">
                Secret Access Key <span className="text-red-500">*</span>
              </Label>
              <Input
                id="secretAccessKey"
                type="password"
                value={secretAccessKey}
                onChange={(e) => setSecretAccessKey(e.target.value)}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                className="mt-1"
                dir="ltr"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                המפתחות נשמרים באופן מוצפן
              </p>
            </div>

            <div className="pt-2 border-t border-slate-200">
              <Label htmlFor="publicUrl" className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Public URL (אופציונלי - לשיפור ביצועים)
              </Label>
              <Input
                id="publicUrl"
                type="url"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://files.mycompany.com"
                className="mt-1"
                dir="ltr"
              />
              <p className="text-xs text-slate-500 mt-1">
                אם הגדרת דומיין ציבורי/CDN לאחסון שלך, הזן אותו כאן לביצועים משופרים
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t">
          <div className="flex items-center gap-2">
            {/* Disconnect button - only show if storage is configured and NOT disconnected */}
            {orgSettings?.storageProfile?.mode && !isDisconnected && (
              <Button
                variant="outline"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={saveState === REQUEST.loading || disconnectState === REQUEST.loading || testState === REQUEST.loading}
                className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                ניתוק אחסון
              </Button>
            )}
            
            {/* Reconnect button - only show if storage is disconnected */}
            {isDisconnected && (
              <Button
                variant="outline"
                onClick={handleReconnect}
                disabled={saveState === REQUEST.loading || disconnectState === REQUEST.loading || testState === REQUEST.loading}
                className="gap-2 text-primary hover:bg-primary/10"
              >
                <RefreshCw className="h-4 w-4" />
                חיבור מחדש
              </Button>
            )}

            {/* Test Connection button - only show for BYOS mode (managed uses pre-configured system credentials) */}
            {selectedMode === STORAGE_MODES.BYOS && !isDisconnected && (
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={saveState === REQUEST.loading || disconnectState === REQUEST.loading || testState === REQUEST.loading}
                className="gap-2"
              >
                {testState === REQUEST.loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    בודק...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4" />
                    בדיקת חיבור
                  </>
                )}
              </Button>
            )}
          </div>
          
          {/* Save button - only show if mode is selected and not disconnected */}
          {selectedMode && !isDisconnected && (
            <Button
              onClick={handleSave}
              disabled={saveState === REQUEST.loading || disconnectState === REQUEST.loading || testState === REQUEST.loading || !selectedMode}
              className="gap-2"
            >
              {saveState === REQUEST.loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  שמירת הגדרות
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              ניתוק אחסון
            </DialogTitle>
            <DialogDescription className="text-right">
              פעולה זו תנתק את הגדרות האחסון. קבצים קיימים יישארו זמינים לתקופה מוגבלת.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4" dir="rtl">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-900">
                <strong>שים לב:</strong> לאחר הניתוק, לא תוכל להעלות קבצים חדשים עד שתגדיר אחסון מחדש.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2" dir="rtl">
            <Button
              variant="outline"
              onClick={() => setShowDisconnectDialog(false)}
              disabled={disconnectState === REQUEST.loading}
            >
              ביטול
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnectState === REQUEST.loading}
              className="gap-2"
            >
              {disconnectState === REQUEST.loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מנתק...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  נתק אחסון
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
