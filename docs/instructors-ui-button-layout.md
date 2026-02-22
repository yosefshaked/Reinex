# Instructors UI Button Layout Guide

## DirectoryView Active Instructors Tab

### Desktop Layout
```
┌──────────────────────────────────────────────────────────────────────┐
│  [Avatar] Name                   [Type Dropdown ▼]                    │
│           email@example.com                                           │
│                                                                       │
│  [פרופיל 🔧] [שירותים 💼] [השבת ❌]                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Mobile Layout
```
┌──────────────────────────────┐
│  [Avatar] Name               │
│           email@example.com  │
│                              │
│  [Type Dropdown ▼]           │
│                              │
│  [פרופיל 🔧]                 │
│  [שירותים 💼]                │
│  [השבת ❌]                   │
└──────────────────────────────┘
```

## Button Details

### Profile Button (פרופיל)
- **Icon**: Settings (gear)
- **Label**: "פרופיל"
- **Action**: Opens EditInstructorProfileDialog
- **Purpose**: Edit working days and break time

### Capabilities Button (שירותים)
- **Icon**: Briefcase
- **Label**: "שירותים"
- **Action**: Opens EditServiceCapabilitiesDialog
- **Purpose**: Manage service capabilities (which services, capacity, rate)

### Deactivate Button (השבת)
- **Icon**: UserX
- **Label**: "השבת"
- **Action**: Soft-delete instructor (set is_active=false)
- **Purpose**: Deactivate instructor

## Dialog Flows

### Profile Dialog Flow
```
Click "פרופיל" Button
    ↓
Dialog Opens
    ↓
Select Working Days (Visual 7-day selector)
    ↓
Enter Break Time (Minutes)
    ↓
Click "שמור שינויים"
    ↓
API: PUT /api/instructors { working_days, break_time_minutes }
    ↓
Toast Success: "הפרופיל עודכן בהצלחה"
    ↓
Dialog Closes, List Refreshes
```

### Capabilities Dialog Flow
```
Click "שירותים" Button
    ↓
Dialog Opens, Loads Services
    ↓
Click "הוסף שירות" (Add Service)
    ↓
New Row Appears
    ↓
Select Service from Dropdown
    ↓
Enter Max Students (e.g., 5)
    ↓
Enter Base Rate (e.g., 150.00)
    ↓
(Optional) Add More Services or Remove Existing
    ↓
Click "שמור שינויים"
    ↓
API: PUT /api/instructors { service_capabilities: [...] }
    ↓
Toast Success: "היכולות עודכנו בהצלחה"
    ↓
Dialog Closes, List Refreshes
```

## Visual States

### Profile Dialog
```
┌────────────────────────────────────────────┐
│  עריכת פרופיל מדריך                    [X] │
├────────────────────────────────────────────┤
│                                            │
│  ימי עבודה                                 │
│  ┌────────────────────────────────────┐    │
│  │ [א׳] [ב׳] [ג׳] [ד׳] [ה׳] [ו׳] [ש׳]│    │
│  │  ✓    ✓    ✓    ✓    ✓              │    │
│  └────────────────────────────────────┘    │
│  נבחרו 5 ימים: א׳, ב׳, ג׳, ד׳, ה׳          │
│                                            │
│  זמן הפסקה (דקות)                          │
│  ┌────────────────────────────────────┐    │
│  │ 30                            🕐   │    │
│  └────────────────────────────────────┘    │
│                                            │
│              [שמור שינויים]                │
└────────────────────────────────────────────┘
```

### Capabilities Dialog
```
┌────────────────────────────────────────────┐
│  ניהול יכולות שירות                    [X] │
├────────────────────────────────────────────┤
│                                            │
│  שירות: [טיפול רגשי     ▼]                │
│  תלמידים מקסימלי: [5           ]          │
│  תעריף לשעה: [150.00        ]             │
│  [הסר] ────────────────────────────────     │
│                                            │
│  שירות: [ייעוץ חינוכי    ▼]               │
│  תלמידים מקסימלי: [3           ]          │
│  תעריף לשעה: [200.00        ]             │
│  [הסר] ────────────────────────────────     │
│                                            │
│  [+ הוסף שירות]                            │
│                                            │
│              [שמור שינויים]                │
└────────────────────────────────────────────┘
```

## Responsive Behavior

### Breakpoints
- **Mobile**: < 640px (sm)
  - Buttons stack vertically
  - Full-width buttons
  - Larger touch targets (h-10)
  
- **Desktop**: >= 640px
  - Buttons in horizontal row
  - Auto-width buttons
  - Compact spacing

### Dialog Sizing
- **Mobile**: Full-screen with safe margins
- **Desktop**: Max-width container (lg:max-w-2xl)
- **Content**: Scrollable if exceeds viewport height

## Color Scheme

### Buttons
- **Variant**: "outline"
- **Default**: White background, gray border
- **Hover**: Light gray background
- **Disabled**: Gray background, reduced opacity

### Icons
- **Size**: 16px (h-4 w-4)
- **Color**: Inherits from button text color
- **Spacing**: 8px gap (gap-2)

### Dialogs
- **Background**: White
- **Border**: Light gray
- **Shadow**: Medium elevation
- **Overlay**: Semi-transparent black

## Accessibility

### Keyboard Navigation
- Tab through buttons in order
- Enter/Space to activate
- ESC to close dialogs
- Arrow keys in day selector

### Screen Readers
- Buttons have descriptive labels
- Dialog titles announced
- Form fields properly labeled
- Error messages announced

### ARIA Attributes
- `role="combobox"` for service dropdown
- `aria-label` for icon buttons
- `aria-describedby` for form hints
- `aria-invalid` for validation errors

## RTL Support

### Text Direction
- All text flows right-to-left
- Buttons aligned right in containers
- Icons positioned on right side of text

### Flex Direction
- Mobile: `flex-col` (top to bottom)
- Desktop: `flex-row-reverse` (right to left)

### Spacing
- Gap between buttons: 8px (gap-2)
- Padding inside buttons: 8px horizontal, 8px vertical

## Error States

### Profile Dialog
- Empty working days: Allowed (saves as empty array)
- Invalid break time: Shows red border, error message
- API failure: Toast error message

### Capabilities Dialog
- No service selected: Disabled save button
- max_students < 1: Shows red border, error message
- Duplicate service: Prevented by UI (service removed from dropdown)
- API failure: Toast error message

## Loading States

### Dialog Open
- Shows loading spinner while fetching services
- Buttons disabled during load

### Save Operation
- "שמור שינויים" button shows spinner
- All inputs disabled
- Dialog cannot be closed

### List Refresh
- Brief loading indicator on instructor list
- Smooth transition after update

## Summary

Clean, intuitive UI for managing instructor profiles and service capabilities. Three buttons per active instructor: Profile (working days + break time), Services (capabilities), and Deactivate. Both editing dialogs follow established patterns with Hebrew RTL support, toast notifications, and proper validation.

Ready for testing once database schema is deployed.
