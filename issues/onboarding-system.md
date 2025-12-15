# Onboarding System Implementation Plan

## Overview
Implement a comprehensive onboarding system to guide new users through the TutTiud platform with progressive, role-aware tutorials and contextual help.

## Phases

### Phase 1: Welcome Tour ✅ (Complete)
**Goal**: Interactive step-by-step tour on first login

**Library**: `driver.js` - framework-agnostic, works with React 19

**Features**:
✅ Role-aware tours (Admin/Owner vs Instructor/Member)
✅ Skip/dismiss functionality
✅ "Show me again" option in settings
✅ Persistent state (user metadata or localStorage)
✅ RTL support for Hebrew interface

**Admin/Owner Tour Steps** (5-6 steps):
✅ 1. Welcome to TutTiud Dashboard
✅ 2. Add sessions via FAB button
✅ 3. Manage students (admin panel)
✅ 4. View reports and analytics
✅ 5. Organization settings
✅ 6. Help resources location

**Instructor/Member Tour Steps** (4-5 steps):
✅ 1. Welcome to TutTiud Dashboard
✅ 2. Add sessions via FAB button
✅ 3. View your students
✅ 4. Track session history
✅ 5. Help resources location

**Implementation Structure**:
src/
  features/
    onboarding/
      hooks/
        useOnboardingStatus.js     # Track completion state
        useUserRole.js             # Determine user role for tour variants
      components/
        WelcomeTour.jsx            # Main tour orchestrator
        TourSteps.jsx              # Role-based step definitions
      utils/
        tourConfig.js              # Joyride configuration
```
src/
  features/
    onboarding/
      hooks/
        useOnboardingStatus.js     # Track completion state
        useUserRole.js             # Determine user role for tour variants
      components/
        WelcomeTour.jsx            # Main tour orchestrator
        TourSteps.jsx              # Role-based step definitions
      styles/
        tour.css                   # Custom tour styling
```

**Tracking**:
✅ Store completion in Supabase user metadata: `{ onboarding_completed: true, onboarding_completed_at: timestamp }`
✅ Fallback to localStorage for offline scenarios
✅ Reset option in settings for re-watching

**UI Considerations**:
✅ Use brand colors (#2563EB primary)
✅ RTL-aware positioning
✅ Mobile-responsive tooltips
✅ Skip button always visible
✅ Progress indicator (Step X of Y)

---

### Phase 2: Empty State Components
**Goal**: Replace blank screens with actionable guidance
*Planned*

**Components to Create**:
1. `EmptySessionsState.jsx` - Dashboard when no sessions
2. `EmptyStudentsState.jsx` - Student list when empty
3. `EmptyReportsState.jsx` - Reports page when no data
4. `EmptyInstructorsState.jsx` - Instructors page (admin only)

**Design Pattern**:
```jsx
<EmptyState
  icon={IconComponent}
  title="אין מפגשים עדיין"
  description="התחל לתעד מפגשים על ידי לחיצה על כפתור +"
  actionLabel="הוסף מפגש ראשון"
  onAction={handleAddSession}
/>
```

**Features**:
- Icon/illustration
- Hebrew title
- Brief explanation
- Primary action button
- Optional secondary "Learn more" link

---

### Phase 3: Contextual Help System
**Goal**: In-app help resources and documentation
*Planned*

**Components**:
1. Help icon in AppShell header
2. Help panel/drawer with:
   - Quick start guide
   - Common tasks
   - FAQ accordion
   - Contact support link
   - Video tutorials (if available)

**Structure**:
```
src/
  features/
    help/
      components/
        HelpButton.jsx           # Trigger in header
        HelpPanel.jsx            # Slide-out panel
        QuickStartGuide.jsx      # Step-by-step basics
        FAQ.jsx                  # Accordion of common questions
      data/
        helpContent.js           # Centralized help text
```

**Content Categories**:
- Getting Started
- Recording Sessions
- Managing Students
- Reports & Analytics
- Organization Settings
- Troubleshooting

---

### Phase 4: Enhanced Tooltips
**Goal**: Contextual inline help for complex features
*Planned*

**Enhancements to Existing `InfoTooltip`**:
- Add "Learn more" links
- Support rich content (not just text)
- Dismissible tips that don't show again
- Tour integration (clicking tooltip can start relevant tour)

**New Tooltip Locations**:
- Session form fields
- Report filters
- Settings options
- Permission levels
- Backup/restore features

---

## Technical Decisions

### State Management
- User onboarding status: Supabase user metadata
- Tour visibility: React state + localStorage backup
- Help panel: Local component state

### Role Detection
- Use existing `OrgContext` role information
- Admin/Owner: Full tour + admin features
- Instructor/Member: Limited tour + basic features
- Handle role changes gracefully

### Localization
- All text in Hebrew (RTL)
- English fallbacks where needed
- Use existing i18n patterns if present

### Accessibility
- Keyboard navigation (Esc to close, Tab to navigate)
- Screen reader announcements
- Focus management
- High contrast mode support

---

## Dependencies to Install

```bash
npm install driver.js
```

Alternative options if needed:
- `intro.js` - Classic option, larger bundle
- `shepherd.js` - Modern, accessible, medium size

---

## Testing Strategy

1. **Manual Testing**:
   - Test with fresh user accounts
   - Verify role-based tour variants
   - Mobile responsive checks
   - RTL layout verification

2. **Edge Cases**:
   - User switches orgs mid-tour
   - User logs out during tour
   - Tour on pages with no content
   - Multiple tabs open

3. **Reset Mechanism**:
   - Settings page "Reset onboarding" button
   - Clear local storage option
   - Admin can reset for specific users

---

## Success Metrics

- % of users who complete the tour
- % of users who dismiss/skip
- Time to first session creation
- Support ticket reduction for "how to" questions
- User feedback surveys

---

## Future Enhancements

- [ ] Interactive product tours (click-through demos)
- [ ] Video walkthrough embeds
- [ ] Onboarding checklist (gamification)
- [ ] Role-specific feature announcements
- [ ] Multi-language support (English/Hebrew)
- [ ] Analytics integration (track tour completion)

---

## Implementation Timeline

**Phase 1**: 2-3 days (Complete)
  - Setup, basic tour structure, role detection
  - Tour steps, content, styling
  - Testing, refinement, state persistence

**Phase 2**: 1-2 days
- Empty state components and integration

**Phase 3**: 2-3 days
- Help system infrastructure and content

**Phase 4**: 1 day
- Tooltip enhancements

**Total Estimated**: 6-9 days
