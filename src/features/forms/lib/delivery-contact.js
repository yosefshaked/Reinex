function compactName(parts) {
  return parts
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' ');
}

function firstText(...values) {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized) return normalized;
  }
  return '';
}

export function normalizeFormDeliveryPhone(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('5')) return `972${digits}`;
  return digits;
}

export function resolveSubjectFormDeliveryContact({ student = null, clientProfile = null, participant = null } = {}) {
  const participantStudent = participant?.student || null;
  const participantClientProfile = participant?.client_profile || null;
  const resolvedStudent = student || participantStudent || null;
  const resolvedClientProfile = clientProfile || participantClientProfile || null;
  const guardian = resolvedClientProfile?.primary_guardian
    || resolvedStudent?.primary_guardian
    || participantClientProfile?.primary_guardian
    || participantStudent?.primary_guardian
    || null;

  const profileName = compactName([
    resolvedClientProfile?.first_name,
    resolvedClientProfile?.middle_name,
    resolvedClientProfile?.last_name,
  ]);
  const studentName = compactName([
    resolvedStudent?.first_name,
    resolvedStudent?.middle_name,
    resolvedStudent?.last_name,
  ]);
  const guardianName = compactName([
    guardian?.first_name,
    guardian?.middle_name,
    guardian?.last_name,
  ]);

  return {
    name: resolvedClientProfile?.full_name || resolvedStudent?.full_name || profileName || studentName || guardianName || 'הלקוח/ה',
    phone: firstText(resolvedClientProfile?.phone, resolvedStudent?.phone, guardian?.phone),
    email: firstText(resolvedClientProfile?.email, resolvedStudent?.email, guardian?.email),
    phoneSource: firstText(resolvedClientProfile?.phone) ? 'client_profile' : firstText(resolvedStudent?.phone) ? 'student' : firstText(guardian?.phone) ? 'primary_guardian' : '',
    emailSource: firstText(resolvedClientProfile?.email) ? 'client_profile' : firstText(resolvedStudent?.email) ? 'student' : firstText(guardian?.email) ? 'primary_guardian' : '',
    primaryGuardian: guardian,
  };
}
