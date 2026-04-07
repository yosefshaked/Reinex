export const STUDENT_SEARCH_SELECT = 'id, first_name, middle_name, last_name, identity_number, phone, email, is_active';

function normalizeStudentSearchQuery(value) {
  return String(value || '').trim();
}

function escapeStudentSearchValue(value) {
  return String(value || '').replace(/[%_,]/g, '');
}

export function buildStudentSearchText(student) {
  const profile = student?.client_profile || {};
  return [
    student?.first_name ?? profile.first_name,
    student?.middle_name ?? profile.middle_name,
    student?.last_name ?? profile.last_name,
    student?.identity_number ?? profile.identity_number,
    student?.phone ?? profile.phone,
    student?.email ?? profile.email,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function parseStudentSearchQuery(rawQuery) {
  const normalizedQuery = normalizeStudentSearchQuery(rawQuery);
  const searchTerms = normalizedQuery
    .split(/\s+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    normalizedQuery,
    searchTerms,
    hasQuery: normalizedQuery.length > 0,
    primaryTerm: escapeStudentSearchValue(searchTerms[0] || normalizedQuery),
    requiresRefinement: searchTerms.length > 1,
  };
}

export function buildStudentSearchFilter(searchQuery) {
  const searchSpec = typeof searchQuery === 'string'
    ? parseStudentSearchQuery(searchQuery)
    : searchQuery;

  if (!searchSpec?.primaryTerm) {
    return '';
  }

  return [
    `first_name.ilike.%${searchSpec.primaryTerm}%`,
    `middle_name.ilike.%${searchSpec.primaryTerm}%`,
    `last_name.ilike.%${searchSpec.primaryTerm}%`,
    `identity_number.ilike.%${searchSpec.primaryTerm}%`,
    `phone.ilike.%${searchSpec.primaryTerm}%`,
    `email.ilike.%${searchSpec.primaryTerm}%`,
  ].join(',');
}

export function applyStudentSearchFilter(builder, searchQuery) {
  const filter = buildStudentSearchFilter(searchQuery);
  return filter ? builder.or(filter) : builder;
}

export function filterStudentsBySearchTerms(students, searchQuery) {
  const searchSpec = typeof searchQuery === 'string'
    ? parseStudentSearchQuery(searchQuery)
    : searchQuery;

  const rows = Array.isArray(students) ? students : [];
  if (!searchSpec?.requiresRefinement) {
    return rows;
  }

  return rows.filter((student) => {
    const searchableText = buildStudentSearchText(student);
    return searchSpec.searchTerms.every((term) => searchableText.includes(term));
  });
}

export async function fetchMatchingStudentClientProfileIds(tenantClient, searchQuery, { limit = 1000 } = {}) {
  const searchSpec = typeof searchQuery === 'string'
    ? parseStudentSearchQuery(searchQuery)
    : searchQuery;

  if (!searchSpec?.hasQuery || !searchSpec?.primaryTerm) {
    return { ids: [], error: null };
  }

  const { data, error } = await applyStudentSearchFilter(
    tenantClient
      .from('client_profiles')
      .select('id, first_name, middle_name, last_name, identity_number, phone, email')
      .limit(limit),
    searchSpec,
  );

  if (error) {
    return { ids: [], error };
  }

  const filteredRows = filterStudentsBySearchTerms(Array.isArray(data) ? data : [], searchSpec);
  return {
    ids: filteredRows.map((row) => row.id).filter(Boolean),
    error: null,
  };
}
