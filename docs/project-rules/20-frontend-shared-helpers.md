# 20 Frontend Shared Helpers

## When to read
- New page, dialog, hook, or frontend API call.
- Any task that needs shared fetch, formatting, date, currency, name, availability, or error helpers.

## Start here
These files are an entry point, not a boundary: follow imports, callers (grep the symbol), dependencies, cross-domain effects and tests as far as the change needs.
- [`../../src/lib/api-client.js`](../../src/lib/api-client.js)
- [`../../src/hooks/useOrgData.js`](../../src/hooks/useOrgData.js)
- [`../../src/api/`](../../src/api/)
- [`../../src/api/me.js`](../../src/api/me.js)
- [`../../src/features/settings/api/settings.js`](../../src/features/settings/api/settings.js)
- [`../../src/features/settings/api/storage.js`](../../src/features/settings/api/storage.js)
- [`../../src/lib/currency.js`](../../src/lib/currency.js)
- [`../../src/lib/date.js`](../../src/lib/date.js)
- [`../../src/lib/local-time.js`](../../src/lib/local-time.js)
- [`../../src/lib/day-of-week.js`](../../src/lib/day-of-week.js)
- [`../../src/lib/format-name.js`](../../src/lib/format-name.js)
- [`../../src/lib/instructor-availability.js`](../../src/lib/instructor-availability.js)
- [`../../src/lib/time-grid.js`](../../src/lib/time-grid.js)
- [`../../src/lib/utils.js`](../../src/lib/utils.js)
- [`../../src/lib/error-utils.js`](../../src/lib/error-utils.js)
- [`../../src/lib/invite-tokens.js`](../../src/lib/invite-tokens.js)
- [`../../src/lib/external-links.js`](../../src/lib/external-links.js)

## Shared helpers to reuse
- `cn` (classname merger via `clsx` + `tailwind-merge`) in [`../../src/lib/utils.js`](../../src/lib/utils.js) — use this for all conditional className composition
- `asError`, `SupabaseHttpError`, `MissingRuntimeConfigError` in [`../../src/lib/error-utils.js`](../../src/lib/error-utils.js)
- `authenticatedFetch`, `authenticatedFetchBlob`, `authenticatedFetchText`
- `useStudents`, `useInstructors`, `useServices`, `useClientProfiles`
- API wrappers in [`../../src/api/`](../../src/api/) and [`../../src/features/settings/api/`](../../src/features/settings/api/)
- `fetchMyAccount`, `updateMyAccount`, `deactivateMyAccount`, `reactivateMyAccount` in [`../../src/api/me.js`](../../src/api/me.js)
- `useAccount` in [`../../src/account/AccountContext.jsx`](../../src/account/AccountContext.jsx) — use this as the canonical frontend source for signed-in user profile/setup/disabled state
- Password reset requests should use [`../../src/api/password-reset.js`](../../src/api/password-reset.js) instead of calling `supabase.auth.resetPasswordForEmail(...)` directly from UI/auth context
- `toAgorot`, `toShekel`, `coerceAgorot`, `formatCurrency`
- `parseDateStrict`, `toISODateString`, `isValidRange`, `isFullMonthRange`
- Dates and time zones: `todayKey`, `localDateKey`, `localTime`, `dateKeyFromCalendarDate`, `addDays`, `firstDayOfMonth`, `formatInstant` and the rest of [`../../src/lib/local-time.js`](../../src/lib/local-time.js) (re-export of the API module; rules in `00-core-rules.md` "Dates and time zones")
- `normalizeDayToken`, `dayLabel`, `daySortValue`
- `formatStudentName`, `formatInstructorName`, `formatName`
- `formatUserAccountName`
- `normalizeAvailabilityWindows`, `getAvailabilitySummary`, `buildAvailabilityTimeSlots`
- `ceilClockTimeToGrid`, `normalizePreferredTimeRangeToGrid` for 15-minute calendar/waiting-list time normalization
- `extractRegistrationTokens`, `extractInvitationToken`, `buildInvitationSearch`
- `normalizeExternalHttpUrl`
- WhatsApp message text helpers in [`../../src/lib/whatsapp-message-templates.js`](../../src/lib/whatsapp-message-templates.js) for organization signatures and shared form / waiting-list / reminder wording.

## Known patterns / do not reinvent
- **The product speaks Hebrew.** Every text the product writes and shows or reads out to a user is in Hebrew. This covers admin screens, public forms, error and confirmation messages, loading and empty states, placeholders, tooltips, and accessibility labels such as `aria-label`. **Why:** the users work in Hebrew, and a mixed or English message is a message they cannot act on.
  - **Kept as they are:** what the user typed, trade names, and technical identifiers meant to be passed on by the user, such as a support code.
  - **English is allowed** only for technical diagnostics meant explicitly for developers. The rest of the UI stays in Hebrew in developer mode too.
  - **API codes stay stable English** (`snake_case`). How a failed call is shown is the next rule.
  - This is a product rule. It does not set the language of conversations with agents or of development documentation.
- **Showing an error.** One shared behaviour, in [`../../src/lib/error-support.js`](../../src/lib/error-support.js). **Why:** the user should read a useful Hebrew message, and support needs the same few facts every time, without anything internal.
  - **A known error** shows its dedicated Hebrew explanation.
  - **An unmapped error** shows a general Hebrew message, or the wording of the failed action, followed in parentheses by the public error code when one was received, or `(HTTP <status>)` when there is only a status.
  - **A request with no server response** shows the Hebrew connection message.
  - **Never invent a code or a status.**
  - **A saved support code** (`error_id`) is shown only when the server returned one, which means the event was saved. It is an extra field: the public code stays in the title next to it. A public error code is not a support code.
  - **Which server text may be shown is decided by its source, not by its characters:**
    - a code in `API_ERROR_MESSAGES`;
    - the `message` of a 4xx response, where endpoints write deliberate Hebrew copy;
    - an error the app itself threw.
    - A 5xx text, and any `details`, `description` or `title`, may hold raw DB or provider text. It is never shown, even when it contains Hebrew. Server code must not put raw DB or provider text in a 4xx `message` either.
  - **The public error code** is a `snake_case` value of the response's `message` or `error` (`publicErrorCode`). Free text, `details`, DB or provider messages are never shown or copied.
  - **"פירוט השגיאה" and "העתקה לשליחה לתמיכה"** come with every error the user may report.
    - Both come from the same fields (`describeError`, `errorDetailRows`, `formatErrorDetailsForCopy`): the failed action, the time, the HTTP status, the public error code and the saved support code, each only when available.
    - Copying works without a support code, and confirms in Hebrew.
    - Never copy or show the error object, the request or response body, user data, tokens, stack traces or DB/provider text.
  - **Keep the error object until the display.**
    - Do not turn it into a string early; that loses the status and the codes.
    - Use `ErrorDetails` (`src/components/ui/ErrorDetails.jsx`) under an `Alert`, or `toast.apiError(error, { action, fallback })`. That toast stays open until the user closes it, so it cannot vanish while being read or copied.
    - At the `catch`, attach the screen's wording with `withErrorContext(error, { action, fallback })`, and store the object. `ErrorMessageText error={error} showDetails` then shows it with the details, and the copied "הודעה" equals the text on screen.
    - Where a screen builds its own text, pass that text as `message` to `ErrorDetails`.
    - `resolveUserErrorMessage(error, '<Hebrew fallback>')` gives the same message as one string.
  - **Branch on the code, not on the text.** The original code stays on the error (`error.code`, `error.apiCode`, `error.publicCode`, `resolveApiErrorMessage(error)`) for consumers that branch on it.
    - For compatibility, an unmapped `snake_case` 4xx code still appears as `error.message`, so do not show `error.message` directly.
    - Add new codes to `API_ERROR_MESSAGES`.
- **Quoting UI names in Hebrew text.** When UI text or UI-writing guidance quotes the name of a button, field or status, use straight double quotes, for example: לחצו על "בטל שיעור". Do not use „…” or “…”. **Why:** one consistent quote character keeps names easy to search and avoids mixed marks in RTL text.
- Default to [`../../src/lib/api-client.js`](../../src/lib/api-client.js) for authenticated requests.
- Public auth-email initiation flows (for example password reset) should still use shared frontend API wrappers rather than direct Supabase email-sending methods, so delivery stays centralized on backend Brevo helpers.
- Personal-account screens should use `AccountContext` + `src/api/me.js`; do not read/write `profiles` directly from page components.
- First-join completion is handled as a blocking account flow, not a loose optional profile form. Reuse [`../../src/features/account/components/AccountProfileForm.jsx`](../../src/features/account/components/AccountProfileForm.jsx) for setup/edit screens before inventing another user-details form.
- `authenticatedFetch` automatically adds `x-org-id` from `active_org_id` local storage; do not hand-build this header in feature code.
- Prefer [`../../src/hooks/useOrgData.js`](../../src/hooks/useOrgData.js) for org-scoped lists before writing a new fetch hook.
- The private `authenticatedFetch` inside [`../../src/org/OrgContext.jsx`](../../src/org/OrgContext.jsx) is local to that provider; do not copy it elsewhere.
- [`../../src/hooks/useDocuments.js`](../../src/hooks/useDocuments.js) is a special-case raw-fetch hook for document upload/download flows; use it only for document work.
- Money is carried as agorot integers across API/DB boundaries.
- Keep text weights at `font-bold` (700) or lighter. Hebrew renders in the system font, which has no 800/900. `font-extrabold` / `font-black` make Chrome fake the weight, and the text looks smeared.
- `DialogContent` (in [`../../src/components/ui/dialog.jsx`](../../src/components/ui/dialog.jsx)) wraps children in its own scroll container by default. Pass `bare` only when the dialog owns a fixed header / scrolling body / footer layout (see `LessonInstanceDialog`), and give it `hideDefaultClose` when it renders its own close button.
- Sticky dialog actions go in `DialogContent`'s `footer` prop, not inside the scrolling body.
- A `Select` or `Popover` inside a `Dialog`: the shared `PopoverContent` (`src/components/ui/popover.jsx`) already sets `data-scroll-lock-ignore`; a list you render yourself also needs `overflow-y-auto` to scroll. Never wrap an editable `<Input>` in a `PopoverTrigger`; it breaks typing. Trigger with the chevron or a button.
- **Mobile: closing a `Select` can close its `Dialog`.** On real touch devices the `Select` closes before the dialog's `onInteractOutside` runs. Use the delayed-decrement guard (an open-select counter plus an `isClosingSelectRef` flag cleared after 100 ms, checked in `onInteractOutside`), as in [`../../src/features/admin/components/EditStudentModal.jsx`](../../src/features/admin/components/EditStudentModal.jsx). Desktop emulation does not reproduce it; test on a device.
- Do not hand-build repeated WhatsApp wording in page components. Reuse the shared WhatsApp message helpers so organization signatures and invite wording stay consistent across send/resend flows.
- Treat account names as derived values. Use `formatUserAccountName` or the `displayName` returned by `useAccount()` / `fetchMyAccount()`; do not assume `profiles.full_name` exists on the frontend data model.
- [`../../src/lib/selectors.js`](../../src/lib/selectors.js) is deprecated; do not reuse or extend it.
- `createDataClient` is deprecated/removed in the single-DB model; do not reintroduce tenant client creation on the frontend.
