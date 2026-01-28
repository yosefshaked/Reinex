import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { User, FileText, Activity, DollarSign } from 'lucide-react';

export default function EmployeeDiagnosticsDialog({ open, onOpenChange, employee }) {
  if (!employee) return null;

  const fullName = `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
  const hasUser = Boolean(employee.user_id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <User className="h-5 w-5" />
            {fullName || employee.email || 'עובד'}
          </DialogTitle>
          <DialogDescription className="text-right">
            <div className="flex gap-2 mt-2">
              <Badge variant={employee.is_active ? "default" : "secondary"}>
                {employee.is_active ? 'פעיל' : 'מושבת'}
              </Badge>
              {!hasUser && (
                <Badge variant="outline">עובד ידני</Badge>
              )}
              {employee.metadata?.invitation_pending && (
                <Badge variant="outline" className="text-amber-600">הזמנה תלויה</Badge>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="details" className="w-full" dir="rtl">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">
              <User className="h-4 w-4 ml-2" />
              פרטים
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity className="h-4 w-4 ml-2" />
              פעילות
            </TabsTrigger>
            <TabsTrigger value="salary">
              <DollarSign className="h-4 w-4 ml-2" />
              שכר
            </TabsTrigger>
            <TabsTrigger value="documents">
              <FileText className="h-4 w-4 ml-2" />
              מסמכים
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">שם פרטי</div>
                <div className="font-medium">{employee.first_name || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">שם משפחה</div>
                <div className="font-medium">{employee.last_name || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground" dir="ltr">דוא"ל</div>
                <div className="font-medium" dir="ltr">{employee.email || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">טלפון</div>
                <div className="font-medium" dir="ltr">{employee.phone || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">מזהה מערכת</div>
                <div className="font-mono text-xs">{employee.id}</div>
              </div>
              {hasUser && (
                <div>
                  <div className="text-xs text-muted-foreground">מזהה משתמש</div>
                  <div className="font-mono text-xs">{employee.user_id}</div>
                </div>
              )}
            </div>

            {employee.notes && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">הערות</div>
                <div className="text-sm bg-slate-50 p-3 rounded-md">{employee.notes}</div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="py-4">
            <div className="text-center text-sm text-muted-foreground py-8">
              <Activity className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p>נתוני פעילות יתווספו בקרוב</p>
              <p className="text-xs mt-2">היסטוריית שיבוצים, נוכחות, חופשות</p>
            </div>
          </TabsContent>

          <TabsContent value="salary" className="py-4">
            <div className="text-center text-sm text-muted-foreground py-8">
              <DollarSign className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p>נתוני שכר יתווספו בקרוב</p>
              <p className="text-xs mt-2">שעות עבודה, תשלומים, דוחות</p>
            </div>
          </TabsContent>

          <TabsContent value="documents" className="py-4">
            <div className="text-center text-sm text-muted-foreground py-8">
              <FileText className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p>ניהול מסמכים יתווסף בקרוב</p>
              <p className="text-xs mt-2">חוזה עבודה, אישורים, מסמכים אישיים</p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
