export function getParticipantPerson(participant) {
  if (!participant || typeof participant !== 'object') {
    return null;
  }

  return participant.student || participant.client_profile || null;
}

export function getParticipantDisplayName(participant, fallback = 'ללא לקוח/ה') {
  const person = getParticipantPerson(participant);
  if (!person) {
    return fallback;
  }

  const fullName = typeof person.full_name === 'string' ? person.full_name.trim() : '';
  if (fullName) {
    return fullName;
  }

  const composedName = [person.first_name, person.middle_name, person.last_name]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .join(' ');

  return composedName || fallback;
}

export function getParticipantDisplayNames(participants, fallback = 'ללא לקוח/ה') {
  const names = Array.isArray(participants)
    ? participants
      .map((participant) => getParticipantDisplayName(participant, ''))
      .filter(Boolean)
    : [];

  return names.length ? names : [fallback];
}

export function resolveParticipantReminderContact(participant) {
  const person = getParticipantPerson(participant);
  const guardian = participant?.student?.primary_guardian || participant?.client_profile?.primary_guardian || null;

  if (guardian) {
    return {
      source: 'guardian',
      name: [guardian.first_name, guardian.middle_name, guardian.last_name].filter(Boolean).join(' ') || 'הורה/אפוטרופוס',
      phone: guardian.phone || null,
      email: guardian.email || null,
    };
  }

  return {
    source: person === participant?.student ? 'student' : 'client_profile',
    name: getParticipantDisplayName(participant, 'לקוח/ה'),
    phone: person?.phone || null,
    email: person?.email || null,
  };
}
