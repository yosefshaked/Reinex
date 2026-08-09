/* eslint-env node */
// import-link-search — GET /api/import-link-search
// Finds existing client_profiles to link an import candidate to.
//   ?identity_number=...  → exact-identity auto-lookup (the "first look by ת״ז" step)
//   ?query=...            → free-text search by student name (any order), phone,
//                           national id, email, OR linked parent/guardian info
// Returns up to 10 profiles, each with a short guardian summary for disambiguation.
import { resolveBearerAuthorization } from '../_shared/http.js';
import {
  createSingleClient,
  ensureMembership,
  isAdminOrOffice,
  normalizeString,
  readEnv,
  resolveOrgId,
  respond,
  withOrgScope,
} from '../_shared/org-bff.js';
import {
  parseStudentSearchQuery,
  buildStudentSearchFilter,
  filterStudentsBySearchTerms,
} from '../_shared/student-search.js';
import { coerceIdentityNumber } from '../_shared/student-validation.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';

const MAX_RESULTS = 10;
const SCAN_LIMIT = 250;

function respondLinkSearchError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, { error, metadata });
}

const PROFILE_COLUMNS = 'id, first_name, middle_name, last_name, identity_number, phone, email, is_active';

function guardianSearchText(guardian) {
  return [guardian.first_name, guardian.middle_name, guardian.last_name, guardian.phone, guardian.email]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildGuardianFilter(searchSpec) {
  if (!searchSpec?.primaryTerm) return '';
  return [
    `first_name.ilike.%${searchSpec.primaryTerm}%`,
    `middle_name.ilike.%${searchSpec.primaryTerm}%`,
    `last_name.ilike.%${searchSpec.primaryTerm}%`,
    `phone.ilike.%${searchSpec.primaryTerm}%`,
    `email.ilike.%${searchSpec.primaryTerm}%`,
  ].join(',');
}

function shapeProfile(profile, guardiansByProfileId) {
  return {
    client_profile_id: profile.id,
    first_name: profile.first_name || '',
    middle_name: profile.middle_name || null,
    last_name: profile.last_name || '',
    identity_number: profile.identity_number || null,
    phone: profile.phone || null,
    email: profile.email || null,
    is_active: profile.is_active !== false,
    guardians: (guardiansByProfileId.get(profile.id) || []).map((g) => ({
      first_name: g.first_name || '',
      last_name: g.last_name || null,
      phone: g.phone || null,
      relationship: g.relationship || null,
    })),
  };
}

// Load guardian summaries for a set of client_profile ids.
async function loadGuardiansFor(supabase, orgId, profileIds, context) {
  const map = new Map();
  if (profileIds.length === 0) return map;

  const { data: links, error: linksError } = await withOrgScope(supabase, 'client_guardians', orgId)
    .select('client_profile_id, guardian_id, relationship')
    .in('client_profile_id', profileIds);
  if (linksError) {
    context.log?.warn?.('import-link-search: guardian link lookup failed', { message: linksError.message });
    return map;
  }
  const guardianIds = [...new Set((links || []).map((l) => l.guardian_id).filter(Boolean))];
  if (guardianIds.length === 0) return map;

  const { data: guardians, error: guardiansError } = await withOrgScope(supabase, 'guardians', orgId)
    .select('id, first_name, middle_name, last_name, phone, email')
    .in('id', guardianIds);
  if (guardiansError) {
    context.log?.warn?.('import-link-search: guardian lookup failed', { message: guardiansError.message });
    return map;
  }
  const guardianById = new Map((guardians || []).map((g) => [g.id, g]));

  for (const link of links || []) {
    const guardian = guardianById.get(link.guardian_id);
    if (!guardian) continue;
    if (!map.has(link.client_profile_id)) map.set(link.client_profile_id, []);
    map.get(link.client_profile_id).push({ ...guardian, relationship: link.relationship });
  }
  return map;
}

export default async function importLinkSearch(context, req) {
  const env = readEnv(context);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSingleClient(env);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (err) {
    context.log?.error?.('import-link-search: auth failed', { message: err?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  const userId = authResult.data.user.id;

  const orgId = resolveOrgId(req, {});
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'import-link-search' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (err) {
    context.log?.error?.('import-link-search: membership check failed', { message: err?.message });
    return respondLinkSearchError(context, 500, 'failed_to_verify_membership', err, { action: 'verify_membership' });
  }
  if (!role) return respond(context, 403, { message: 'forbidden' });
  if (!isAdminOrOffice(role)) return respond(context, 403, { message: 'forbidden' });

  const rawIdentity = normalizeString(req.query?.identity_number);
  const rawQuery = normalizeString(req.query?.query || req.query?.q);
  const entityType = normalizeString(req.query?.entity_type || 'customer');

  if (entityType === 'instructor') {
    if (!rawQuery || rawQuery.length < 2) {
      return respond(context, 200, { results: [], matched_by: 'query' });
    }
    const normalizedQuery = rawQuery.toLocaleLowerCase('he-IL');
    const { data: employees, error: employeeError } = await withOrgScope(supabase, 'Employees', orgId)
      .select('id, first_name, middle_name, last_name, employee_id, email, phone, is_active')
      .eq('employee_type', 'instructor')
      .limit(SCAN_LIMIT);
    if (employeeError) {
      return respondLinkSearchError(context, 500, 'failed_to_search_instructors', employeeError, {
        action: 'instructor_search',
      });
    }
    const results = (employees || [])
      .filter((employee) => (
        [employee.first_name, employee.middle_name, employee.last_name, employee.employee_id, employee.email, employee.phone]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('he-IL')
          .includes(normalizedQuery)
      ))
      .slice(0, MAX_RESULTS)
      .map((employee) => ({
        employee_id: employee.id,
        external_employee_id: employee.employee_id || null,
        first_name: employee.first_name || '',
        middle_name: employee.middle_name || null,
        last_name: employee.last_name || '',
        email: employee.email || null,
        phone: employee.phone || null,
        is_active: employee.is_active === true,
      }));
    return respond(context, 200, { results, matched_by: 'query' });
  }

  if (entityType !== 'customer') {
    return respond(context, 400, { message: 'unsupported_entity_type' });
  }

  // ── Branch 1: exact-identity auto-lookup ──────────────────────────────────
  if (rawIdentity) {
    const idResult = coerceIdentityNumber(rawIdentity);
    if (!idResult.valid || !idResult.value) {
      return respond(context, 200, { results: [], matched_by: 'identity_number' });
    }
    const { data, error } = await withOrgScope(supabase, 'client_profiles', orgId)
      .select(PROFILE_COLUMNS)
      .eq('identity_number', idResult.value)
      .limit(MAX_RESULTS);
    if (error) {
      context.log?.error?.('import-link-search: identity lookup failed', { message: error.message });
      return respondLinkSearchError(context, 500, 'failed_to_search_profiles', error, { action: 'identity_lookup' });
    }
    const profiles = Array.isArray(data) ? data : [];
    const guardians = await loadGuardiansFor(supabase, orgId, profiles.map((p) => p.id), context);
    return respond(context, 200, {
      results: profiles.map((p) => shapeProfile(p, guardians)),
      matched_by: 'identity_number',
    });
  }

  // ── Branch 2: free-text search (name/phone/id/email + parent info) ────────
  if (!rawQuery || rawQuery.length < 2) {
    return respond(context, 200, { results: [], matched_by: 'query' });
  }
  const searchSpec = parseStudentSearchQuery(rawQuery);

  // Profile-side matches (name any order, phone, identity, email)
  const profileFilter = buildStudentSearchFilter(searchSpec);
  let profileQuery = withOrgScope(supabase, 'client_profiles', orgId)
    .select(PROFILE_COLUMNS)
    .limit(SCAN_LIMIT);
  if (profileFilter) profileQuery = profileQuery.or(profileFilter);
  const { data: profileRows, error: profileError } = await profileQuery;
  if (profileError) {
    context.log?.error?.('import-link-search: profile search failed', { message: profileError.message });
    return respondLinkSearchError(context, 500, 'failed_to_search_profiles', profileError, { action: 'profile_search' });
  }
  const profileMatches = filterStudentsBySearchTerms(Array.isArray(profileRows) ? profileRows : [], searchSpec);

  // Guardian-side matches → resolve back to their client_profile ids
  const guardianFilter = buildGuardianFilter(searchSpec);
  let guardianQuery = withOrgScope(supabase, 'guardians', orgId)
    .select('id, first_name, middle_name, last_name, phone, email')
    .limit(SCAN_LIMIT);
  if (guardianFilter) guardianQuery = guardianQuery.or(guardianFilter);
  const { data: guardianRows, error: guardianError } = await guardianQuery;
  if (guardianError) {
    context.log?.error?.('import-link-search: guardian search failed', { message: guardianError.message });
    return respondLinkSearchError(context, 500, 'failed_to_search_profiles', guardianError, { action: 'guardian_search' });
  }
  const matchingGuardianIds = (Array.isArray(guardianRows) ? guardianRows : [])
    .filter((g) => searchSpec.searchTerms.every((term) => guardianSearchText(g).includes(term)))
    .map((g) => g.id);

  const profileById = new Map(profileMatches.map((p) => [p.id, p]));

  if (matchingGuardianIds.length > 0) {
    const { data: links, error: linksError } = await withOrgScope(supabase, 'client_guardians', orgId)
      .select('client_profile_id, guardian_id')
      .in('guardian_id', matchingGuardianIds);
    if (linksError) {
      context.log?.warn?.('import-link-search: guardian→profile resolution failed', { message: linksError.message });
    } else {
      const extraIds = [...new Set((links || []).map((l) => l.client_profile_id).filter((id) => id && !profileById.has(id)))];
      if (extraIds.length > 0) {
        const { data: extraProfiles, error: extraError } = await withOrgScope(supabase, 'client_profiles', orgId)
          .select(PROFILE_COLUMNS)
          .in('id', extraIds);
        if (extraError) {
          context.log?.warn?.('import-link-search: extra profile load failed', { message: extraError.message });
        } else {
          for (const profile of extraProfiles || []) profileById.set(profile.id, profile);
        }
      }
    }
  }

  const combined = [...profileById.values()].slice(0, MAX_RESULTS);
  const guardians = await loadGuardiansFor(supabase, orgId, combined.map((p) => p.id), context);
  const results = combined
    .map((p) => shapeProfile(p, guardians))
    .sort((a, b) => {
      const an = [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ');
      const bn = [b.first_name, b.middle_name, b.last_name].filter(Boolean).join(' ');
      return an.localeCompare(bn, 'he');
    });

  return respond(context, 200, { results, matched_by: 'query' });
}
