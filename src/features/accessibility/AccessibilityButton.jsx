import React from 'react'
import { Accessibility as AccessibilityIcon, Minus, Plus, RefreshCw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.jsx'
import { Switch } from '@/components/ui/switch.jsx'
import { Button } from '@/components/ui/button.jsx'
import { useAccessibility } from './AccessibilityProvider.jsx'

export default function AccessibilityButton() {
  const {
    fontScale, increaseFont, decreaseFont,
    highContrast, toggleHighContrast,
    textSpacing, toggleTextSpacing,
    underlineLinks, toggleUnderlineLinks,
    dyslexiaFont, toggleDyslexiaFont,
    highlightInteractives, toggleHighlightInteractives,
    noAnimations, toggleNoAnimations,
    structureOverlay, toggleStructureOverlay,
    grayscale, toggleGrayscale,
    reset,
  } = useAccessibility()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-primary text-primary-foreground p-2 transition hover:bg-primary/90"
          aria-label="אפשרויות נגישות"
          title="נגישות"
        >
          <AccessibilityIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 text-right" sideOffset={8}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">גודל טקסט</span>
            <div className="flex items-center gap-2">
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={decreaseFont} aria-label="הקטן טקסט">
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center text-sm tabular-nums">{Math.round((fontScale || 1) * 100)}%</span>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={increaseFont} aria-label="הגדל טקסט">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">ניגודיות גבוהה</span>
            <Switch checked={highContrast} onCheckedChange={toggleHighContrast} aria-label="הפעל ניגודיות גבוהה" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">מרווחי טקסט מוגדלים</span>
            <Switch checked={textSpacing} onCheckedChange={toggleTextSpacing} aria-label="הפעל מרווחי טקסט מוגדלים" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">קו תחתון בקישורים</span>
            <Switch checked={underlineLinks} onCheckedChange={toggleUnderlineLinks} aria-label="הדגש קישורים בקו תחתון" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">גופן מותאם לדיסלקסיה</span>
            <Switch checked={dyslexiaFont} onCheckedChange={toggleDyslexiaFont} aria-label="הפעל גופן מותאם לדיסלקסיה" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">הדגש לחצנים וקישורים</span>
            <Switch checked={highlightInteractives} onCheckedChange={toggleHighlightInteractives} aria-label="הדגש רכיבים אינטראקטיביים" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">עצור אנימציות</span>
            <Switch checked={noAnimations} onCheckedChange={toggleNoAnimations} aria-label="עצור אנימציות ומעברים" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">סימון מבנה העמוד</span>
            <Switch checked={structureOverlay} onCheckedChange={toggleStructureOverlay} aria-label="הצג קווי מתאר לאזורים וכותרות" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">מצב גווני אפור</span>
            <Switch checked={grayscale} onCheckedChange={toggleGrayscale} aria-label="הפעל מצב גווני אפור" />
          </div>

          <div className="pt-1">
            <Button type="button" variant="ghost" className="w-full justify-center gap-2" onClick={reset}>
              <RefreshCw className="h-4 w-4" /> אתחל הגדרות נגישות
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
