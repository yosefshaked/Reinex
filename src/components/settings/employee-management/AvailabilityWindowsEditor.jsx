import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DAY_OPTIONS } from '@/lib/day-of-week.js';

function createEmptyWindow() {
  return { day: '', start: '', end: '' };
}

/**
 * The hours an instructor is available for one service: day, from, until.
 *
 * Shared by the service sheet in the finance tab and the services dialog, so the two cannot drift
 * apart. It owns no state — the caller keeps the windows and decides when they are saved.
 */
export default function AvailabilityWindowsEditor({ windows = [], onChange, disabled = false, idPrefix = 'availability' }) {
  const rows = Array.isArray(windows) ? windows : [];

  function updateWindow(index, field, value) {
    onChange(rows.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
          לא הוגדרו שעות עבודה לשירות הזה. עד שיוגדרו, המדריך/ה לא יוצע/תוצע לשיבוץ בשירות.
        </div>
      ) : (
        rows.map((window, index) => (
          <div key={`${idPrefix}-window-${index}`} className="grid items-end gap-3 md:grid-cols-[1.1fr_1fr_1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-day-${index}`} className="text-xs text-slate-600">יום</Label>
              <Select
                value={window.day || undefined}
                onValueChange={(value) => updateWindow(index, 'day', value)}
                disabled={disabled}
              >
                <SelectTrigger id={`${idPrefix}-day-${index}`}>
                  <SelectValue placeholder="בחר יום" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((day) => (
                    <SelectItem key={day.value} value={day.value}>{day.fullLabel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-start-${index}`} className="text-xs text-slate-600">משעה</Label>
              <Input
                id={`${idPrefix}-start-${index}`}
                type="time"
                value={window.start || ''}
                onChange={(event) => updateWindow(index, 'start', event.target.value)}
                disabled={disabled}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-end-${index}`} className="text-xs text-slate-600">עד שעה</Label>
              <Input
                id={`${idPrefix}-end-${index}`}
                type="time"
                value={window.end || ''}
                onChange={(event) => updateWindow(index, 'end', event.target.value)}
                disabled={disabled}
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => onChange(rows.filter((_, position) => position !== index))}
              disabled={disabled}
              aria-label="הסרת שעות עבודה"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, createEmptyWindow()])}
        disabled={disabled}
      >
        <Plus className="me-2 h-4 w-4" />
        הוסף שעות עבודה
      </Button>
    </div>
  );
}
