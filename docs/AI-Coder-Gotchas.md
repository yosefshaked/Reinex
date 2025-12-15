# AI Coder Gotchas

A living checklist of patterns that frequently trip up automated coders in this repo and how to handle them fast and safely.

## RTL and Hebrew text
- Always apply `rtl-embed-text` to Hebrew content to set `direction: rtl; unicode-bidi: embed;`.
- Pair `rtl-embed-text` with `text-right` when the visual alignment needs to be flush-right (labels, titles, inline helper text).
- Buttons with icon + text use a `row-reverse` layout (`legacy-import-row-reverse`). Inside the text column:
  - Use `flex-col items-start text-right` (not `items-end`) so the text aligns correctly in RTL.
- In choice cards or option buttons: put the icon as a sibling; don’t wrap the text in a row with the icon.
- For tags/inline chips that should appear on the right, use a container with `justify-end`.

## Dialogs and sticky footers
- Use `DialogContent`'s `footer` prop for sticky action buttons; don’t place CTA buttons inside the scrollable body if they need to stay visible.
- Mobile dialogs are positioned from the top; keep long content inside `.dialog-scroll-content`.

## Select/Popover and scroll inside dialogs
- When dropdowns are inside a Dialog, the overlay must allow scroll: set `data-scroll-lock-ignore` and ensure the viewport/list has `overflow-y-auto`.
- Do not wrap editable `<Input>` inside `PopoverTrigger` — it breaks typing. Trigger only with the chevron/button.

## Mobile-only: Dialog closes when Select dropdown dismissed ⚠️ CRITICAL
**The Problem:** On real mobile devices (not desktop emulators), tapping outside a nested `<Select>` dropdown to close it also closes the parent `<Dialog>` modal. This does NOT happen on desktop.

**Root Cause:** Mobile touch event timing. The sequence is:
1. User taps outside Select
2. **Select's `onOpenChange(false)` fires FIRST**
3. **Dialog's `onInteractOutside` fires SECOND** (too late to check if Select was open)

**The Solution: Delayed Decrement Pattern**
Always use this pattern when a Dialog contains any Select components:

```javascript
// In the Modal component (e.g., NewSessionModal.jsx):
const openSelectCountRef = useRef(0);
const isClosingSelectRef = useRef(false);

// Handler to track Select open/close (pass to all Select components via props)
const handleSelectOpenChange = useCallback((isOpen) => {
  if (!isOpen && openSelectCountRef.current > 0) {
    // Select is closing - set flag BEFORE decrementing
    isClosingSelectRef.current = true;
    
    // Delay decrement by 100ms to give Dialog's event handler time to check the flag
    setTimeout(() => {
      openSelectCountRef.current -= 1;
      if (openSelectCountRef.current < 0) openSelectCountRef.current = 0;
      isClosingSelectRef.current = false;
    }, 100);
  } else if (isOpen) {
    openSelectCountRef.current += 1;
  }
}, []);

// Dialog outside interaction handler
const handleDialogInteractOutside = useCallback((event) => {
  // Block close if Select is open OR in the process of closing
  if (openSelectCountRef.current > 0 || isClosingSelectRef.current) {
    event.preventDefault();
  }
}, []);

// Apply to DialogContent
<DialogContent onInteractOutside={handleDialogInteractOutside}>

// Pass to all Select components (directly or via form props)
<Select onOpenChange={handleSelectOpenChange}>
// OR for SelectField wrapper:
<SelectField onOpenChange={handleSelectOpenChange}>
```

**Files Already Fixed:**
- `LegacyImportModal.jsx` ✅
- `NewSessionModal.jsx` + `NewSessionForm.jsx` ✅
- `EditStudentModal.jsx` + `EditStudentForm.jsx` ✅
- `StudentManagementPage.jsx` + `AddStudentForm.jsx` ✅
- `SelectField.jsx` (wrapper component) ✅

**Why This Works:**
- The `isClosingSelectRef.current = true` flag is set **immediately** when Select starts closing
- When `onInteractOutside` fires microseconds later, it sees the flag and blocks the Dialog close
- The counter is decremented 100ms later (after all events have settled)
- Supports multiple Selects open simultaneously via counter pattern

**Testing:** Always test on a real mobile device. Desktop Chrome DevTools mobile emulation does NOT reproduce this bug.

## CSV/Forms specifics
- Labels: use `rtl-embed-text text-right`.
- Helper lines: prefer `text-right` for Hebrew.
- Mapping rows: each column block should keep label/input in a `flex` layout that honors RTL; avoid nesting `row-reverse` inside another `row-reverse`.

## Instructor colors (legend and drawers)
- Use `ensureInstructorColors()` before returning rows. Render both solid colors and gradient-* via inline style that converts tokens to CSS gradients.

## Permissions and premium features
- Always check permissions on both frontend and backend. Respect `org_settings.permissions` via the BFF helpers before enabling UI.

## Supabase auth redirects
- For OAuth and password reset flows, always pass a redirect URL (see AGENTS.md for exact routes).

## Backups
- `/api/backup` has a 7-day cooldown and optional override. Reflect state via `/api/backup-status`.

## Lint/build checks (quick)
- Lint only files you touch: `npx eslint <paths>`.
- Build locally before pushing: `npm run build`.

> Keep this doc focused: add short, repeatable patterns that save time during PRs. For larger guides, link to AGENTS.md or ProjectDoc/*.md.
