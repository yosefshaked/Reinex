function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function appendOrganizationSignature(linesOrMessage, organizationName) {
  const messageLines = Array.isArray(linesOrMessage)
    ? linesOrMessage
    : String(linesOrMessage || '').split('\n');
  const lines = messageLines.map((line) => String(line || '')).filter((line, index, allLines) => {
    if (line.trim()) return true;
    const previousHasText = index > 0 && allLines[index - 1]?.trim();
    const nextHasText = index < allLines.length - 1 && allLines[index + 1]?.trim();
    return previousHasText && nextHasText;
  });

  const orgName = normalizeText(organizationName);
  if (!orgName) {
    return lines.join('\n').trim();
  }

  return [
    ...lines,
    '',
    `בברכה, ${orgName}`,
  ].join('\n').trim();
}

export function buildFormAccessWhatsAppMessage({
  formName,
  submitLink,
  accessIdentifier,
  otp,
  expiresText,
  organizationName,
}) {
  return appendOrganizationSignature([
    'שלום,',
    '',
    `שם הטופס למילוי: ${formName || 'טופס'}`,
    '',
    'מצורף קישור למילוי טופס:',
    submitLink,
    '',
    `מזהה גישה: ${accessIdentifier}`,
    `קוד אימות: ${otp}`,
    `תוקף הקישור עד: ${expiresText || '—'}`,
    '',
    'אפשר לפתוח את הקישור ולשלוח את הטופס.',
  ], organizationName);
}

export function buildRequiredFormInviteWhatsAppMessage({
  inviteUrl,
  formLabel,
  organizationName,
}) {
  return appendOrganizationSignature([
    'שלום,',
    '',
    `נשלח אליך קישור למילוי ${formLabel || 'טופס חובה'}:`,
    inviteUrl,
    '',
    'אפשר לפתוח את הקישור ולמלא את הטופס.',
  ], organizationName);
}

export function buildWaitingListInviteWhatsAppMessage({
  inviteUrl,
  expiresText,
  formName,
  serviceName,
  studentName,
  organizationName,
}) {
  return appendOrganizationSignature([
    `שלום${studentName ? ` ${studentName}` : ''},`,
    '',
    'שמחים שיצרתם קשר איתנו.',
    serviceName
      ? `כדי שנוכל לקדם את הבקשה להצטרפות לשירות ${serviceName}, נשמח שתמלאו את טופס ההצטרפות לרשימת ההמתנה בקישור הבא:`
      : `כדי שנוכל לקדם את הבקשה להצטרפות לרשימת ההמתנה, נשמח שתמלאו את ${formName || 'הטופס'} בקישור הבא:`,
    inviteUrl,
    '',
    expiresText ? `הקישור זמין עד ${expiresText}.` : '',
    'אם יש שאלות, אפשר לחזור אלינו בהודעה חוזרת.',
  ].filter(Boolean), organizationName);
}

export function buildLessonReminderWhatsAppMessage({
  studentName,
  serviceName,
  dayDate,
  time,
  organizationName,
}) {
  return appendOrganizationSignature([
    'שלום,',
    `רצינו להזכיר שיש ל${studentName || 'לקוח/ה'} מפגש ${serviceName || 'אצלנו'}.`,
    `ניפגש ב${dayDate || ''} בשעה ${time || ''}.`,
    'נשמח לאישור הגעתך.',
    'תודה רבה!',
  ], organizationName);
}
