// @ts-check
/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import {
  coerceBooleanFlag,
  coerceEmail,
  coerceOptionalText,
  coerceTags,
  validateIsraeliPhone,
  coerceIdentityNumber,
} from '../_shared/student-validation.js';
import { parseCsv } from '../_shared/csv.js';
import { logAuditEvent, AUDIT_ACTIONS, AUDIT_CATEGORIES } from '../_shared/audit-log.js';
import { createOrReuseClientProfile, createOrReuseGuardianByParts, upsertClientGuardianLink } from '../_shared/client-profiles.js';

const MAX_ROWS = 500;

// Lines starting with # are treated as comments and stripped before parsing.
// This allows template files to include example rows prefixed with # that
// are safely ignored on import.
function removeCommentLines(text) {
  return (text || '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

// Recognized column names → canonical field name
const COLUMN_MAP = {
  // First name
  'שם פרטי': 'first_name',
  'first_name': 'first_name',
  'firstname': 'first_name',
  // Last name
  'שם משפחה': 'last_name',
  'last_name': 'last_name',
  'lastname': 'last_name',
  // Middle name
  'שם אמצעי': 'middle_name',
  'שם אמצעי (רשות)': 'middle_name',
  'middle_name': 'middle_name',
  'middlename': 'middle_name',
  // National ID
  'מספר זהות': 'identity_number',
  'national_id': 'identity_number',
  'nationalid': 'identity_number',
  'identity_number': 'identity_number',
  'identitynumber': 'identity_number',
  // Student phone
  'טלפון': 'phone',
  'phone': 'phone',
  // Email
  'אימייל': 'email',
  'אימייל (רשות)': 'email',
  'email': 'email',
  // Notes
  'הערות': 'notes_internal',
  'הערות (רשות)': 'notes_internal',
  'notes': 'notes_internal',
  'notes_internal': 'notes_internal',
  // Tags
  'תגיות': 'tags',
  'תגיות (רשות)': 'tags',
  'tags': 'tags',
  // Active status
  'פעיל': 'is_active',
  'פעיל (רשות)': 'is_active',
  'is_active': 'is_active',
  'active': 'is_active',
  // Guardian first name
  'שם פרטי אפוטרופוס': 'guardian_first_name',
  'guardian_first_name': 'guardian_first_name',
  'guardianfirstname': 'guardian_first_name',
  // Guardian last name
  'שם משפחה אפוטרופוס': 'guardian_last_name',
  'שם משפחה אפוטרופוס (רשות)': 'guardian_last_name',
  'guardian_last_name': 'guardian_last_name',
  'guardianlastname': 'guardian_last_name',
  // Guardian phone
  'טלפון אפוטרופוס': 'guardian_phone',
  'guardian_phone': 'guardian_phone',
  'guardianphone': 'guardian_phone',
  // Guardian relationship
  'קשר לתלמיד': 'guardian_relationship',
  'guardian_relationship': 'guardian_relationship',
  'guardianrelationship': 'guardian_relationship',
};

// Hebrew → English relationship values
const RELATIONSHIP_MAP = {
  'אב': 'father',
  'אבא': 'father',
  'father': 'father',
  'dad': 'father',
  'אם': 'mother',
  'אמא': 'mother',
  'mother': 'mother',
  'mom': 'mother',
  'עצמי': 'self',
  'עצמית': 'self',
  'self': 'self',
  'מטפל': 'caretaker',
  'מטפלת': 'caretaker',
  'caretaker': 'caretaker',
  'אחר': 'other',
  'אחרת': 'other',
  'other': 'other',
};

function normalizeRelationship(raw) {
  const normalized = normalizeString(raw).toLowerCase();
  return RELATIONSHIP_MAP[normalized] || null;
}

function normalizeTagsInput(raw) {
  if (typeof raw !== 'string') return raw;
  return raw.replace(/[;|]/g, ',');
}

function isEmptyCell(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function formatFailure({ lineNumber, name, code, message }) {
  return { line_number: lineNumber, name, code, message };
}

function buildGuardianFullName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(' ');
}

function namesMatch(a, b) {
  return normalizeString(a).toLowerCase() === normalizeString(b).toLowerCase();
}

export default async function handler(context, req) {
  const env = readEnv(context);
  const supabaseAdminConfig = readSupabaseAdminConfig(env);

  if (!supabaseAdminConfig.supabaseUrl || !supabaseAdminConfig.serviceRoleKey) {
    context.log?.error?.('students-bulk-create missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const supabase = createSupabaseAdminClient(supabaseAdminConfig);

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const authResult = await supabase.auth.getUser(authorization.token).catch((authError) => {
    context.log?.error?.('students-bulk-create failed to validate token', { message: authError?.message });
    return { error: authError, data: null };
  });
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = parseRequestBody(req);
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-bulk-create failed to verify membership', { message: membershipError?.message, orgId, userId });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const rawCsvText = normalizeString(body?.csv_text);
  if (!rawCsvText) {
    return respond(context, 400, { message: 'missing_csv' });
  }

  // Strip comment lines (lines beginning with #) before parsing
  const csvText = removeCommentLines(rawCsvText);

  const dryRun = body?.dry_run === true;

  // guardian_name_resolutions: [{ line_number, choice: 'use_existing' | 'use_csv' }]
  const guardianResolutionsRaw = Array.isArray(body?.guardian_name_resolutions) ? body.guardian_name_resolutions : [];
  const guardianResolutionMap = new Map();
  for (const r of guardianResolutionsRaw) {
    if (r.line_number && (r.choice === 'use_existing' || r.choice === 'use_csv')) {
      guardianResolutionMap.set(Number(r.line_number), r.choice);
    }
  }

  const parsed = parseCsv(csvText);
  if (!parsed.columns.length || !parsed.rows.length) {
    return respond(context, 400, { message: 'empty_csv' });
  }

  if (parsed.rows.length > MAX_ROWS) {
    return respond(context, 400, { message: 'too_many_rows', limit: MAX_ROWS });
  }

  // Validate column names
  const columnToField = new Map();
  const unrecognizedColumns = [];
  for (const col of parsed.columns) {
    const field = COLUMN_MAP[col] ?? COLUMN_MAP[col.toLowerCase()];
    if (field) {
      columnToField.set(col, field);
    } else {
      unrecognizedColumns.push(col);
    }
  }

  if (unrecognizedColumns.length > 0) {
    const hebrewCols = Object.keys(COLUMN_MAP).filter((k) => /[\u0590-\u05FF]/.test(k));
    return respond(context, 400, {
      code: 'unrecognized_columns',
      message: `עמודות לא מוכרות: ${unrecognizedColumns.join(', ')}`,
      columns: unrecognizedColumns,
      hint: `עמודות חוקיות: ${hebrewCols.join(', ')}`,
    });
  }

  const coveredFields = new Set(columnToField.values());
  const hasStudentPhone = coveredFields.has('phone');
  const hasGuardianColumns = coveredFields.has('guardian_first_name') || coveredFields.has('guardian_phone') || coveredFields.has('guardian_relationship');

  if (!hasStudentPhone && !hasGuardianColumns) {
    return respond(context, 400, {
      code: 'missing_required_columns',
      message: 'חסרה עמודת טלפון (לתלמיד) או עמודות אפוטרופוס (שם פרטי אפוטרופוס, טלפון אפוטרופוס, קשר לתלמיד)',
      missing_fields: ['phone'],
    });
  }

  const ALWAYS_REQUIRED = ['first_name', 'last_name', 'identity_number'];
  const missingBase = ALWAYS_REQUIRED.filter((f) => !coveredFields.has(f));
  if (missingBase.length > 0) {
    const LABELS = { first_name: 'שם פרטי', last_name: 'שם משפחה', identity_number: 'מספר זהות' };
    return respond(context, 400, {
      code: 'missing_required_columns',
      message: `חסרות עמודות חובה: ${missingBase.map((f) => LABELS[f] || f).join(', ')}`,
      missing_fields: missingBase,
    });
  }

  // Load tags catalog
  const { data: tagsSettings } = await withOrgScope(supabase, 'Settings', orgId)
    .select('settings_value')
    .eq('key', 'student_tags')
    .maybeSingle();

  const tagByName = new Map();
  const tagById = new Map();
  if (tagsSettings?.settings_value) {
    const tagList = Array.isArray(tagsSettings.settings_value) ? tagsSettings.settings_value : [];
    for (const tag of tagList) {
      if (tag?.id && tag?.name) {
        tagById.set(tag.id, tag);
        tagByName.set(normalizeString(tag.name).toLowerCase(), tag.id);
      }
    }
  }

  // --- First pass: parse and validate each row ---
  const failures = [];
  const candidates = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    const lineNumber = i + 2; // header is line 1

    const fields = {};
    for (const [col, field] of columnToField.entries()) {
      if (!isEmptyCell(row[col])) {
        fields[field] = String(row[col]).trim();
      }
    }

    const displayName = [fields.first_name, fields.last_name].filter(Boolean).join(' ') || `שורה ${lineNumber}`;
    let fail = false;

    for (const required of ALWAYS_REQUIRED) {
      if (!fields[required]) {
        const LABELS = { first_name: 'שם פרטי', last_name: 'שם משפחה', identity_number: 'מספר זהות' };
        failures.push(formatFailure({ lineNumber, name: displayName, code: `missing_${required}`, message: `חסר שדה חובה: ${LABELS[required]}` }));
        fail = true;
        break;
      }
    }
    if (fail) continue;

    const idResult = coerceIdentityNumber(fields.identity_number);
    if (!idResult.valid || !idResult.value) {
      failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_identity_number', message: `מספר זהות "${fields.identity_number}" אינו חוקי. נדרשות 5–12 ספרות.` }));
      continue;
    }

    // Contact path: student phone vs guardian
    const hasRowPhone = Boolean(fields.phone);
    const hasRowGuardian = Boolean(fields.guardian_first_name || fields.guardian_phone || fields.guardian_relationship);

    let phoneValue = null;
    if (hasRowPhone) {
      const phoneResult = validateIsraeliPhone(fields.phone);
      if (!phoneResult.valid || !phoneResult.value) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_phone', message: `מספר טלפון "${fields.phone}" אינו חוקי.` }));
        continue;
      }
      phoneValue = phoneResult.value;
    } else if (!hasRowGuardian) {
      failures.push(formatFailure({ lineNumber, name: displayName, code: 'phone_required_without_guardian', message: 'חסר טלפון תלמיד. טלפון הוא חובה כאשר לא מוגדר אפוטרופוס.' }));
      continue;
    }

    // Validate guardian fields (if any guardian field present, first_name + phone + relationship are required)
    let guardianFirstName = null;
    let guardianLastName = null;
    let guardianPhone = null;
    let guardianRelationship = null;

    if (hasRowGuardian) {
      if (!fields.guardian_first_name) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'missing_guardian_first_name', message: 'חסר שם פרטי אפוטרופוס.' }));
        continue;
      }
      if (!fields.guardian_phone) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'missing_guardian_phone', message: 'חסר טלפון אפוטרופוס.' }));
        continue;
      }
      if (!fields.guardian_relationship) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'missing_guardian_relationship', message: 'חסר קשר לתלמיד. ערכים חוקיים: אבא, אמא, מטפל, מטפלת, עצמי, אחר' }));
        continue;
      }

      const guardianPhoneResult = validateIsraeliPhone(fields.guardian_phone);
      if (!guardianPhoneResult.valid || !guardianPhoneResult.value) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_guardian_phone', message: `טלפון אפוטרופוס "${fields.guardian_phone}" אינו חוקי.` }));
        continue;
      }

      guardianRelationship = normalizeRelationship(fields.guardian_relationship);
      if (!guardianRelationship) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_guardian_relationship', message: `קשר לתלמיד "${fields.guardian_relationship}" אינו חוקי. ערכים חוקיים: אבא, אמא, מטפל, מטפלת, עצמי, אחר` }));
        continue;
      }

      guardianFirstName = normalizeString(fields.guardian_first_name);
      guardianLastName = normalizeString(fields.guardian_last_name) || null;
      guardianPhone = guardianPhoneResult.value;
    }

    // Validate optional fields
    let emailValue = null;
    if (fields.email) {
      const emailResult = coerceEmail(fields.email);
      if (!emailResult.valid) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_email', message: `כתובת אימייל "${fields.email}" אינה חוקית.` }));
        continue;
      }
      emailValue = emailResult.value;
    }

    let notesValue = null;
    if (fields.notes_internal) {
      const notesResult = coerceOptionalText(fields.notes_internal);
      if (!notesResult.valid) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_notes', message: 'הערות אינן חוקיות.' }));
        continue;
      }
      notesValue = notesResult.value;
    }

    let tagIds = null;
    if (fields.tags) {
      const tagsResult = coerceTags(normalizeTagsInput(fields.tags));
      if (!tagsResult.valid) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_tags', message: 'תגיות אינן חוקיות.' }));
        continue;
      }
      if (Array.isArray(tagsResult.value) && tagsResult.value.length > 0) {
        const resolved = [];
        const unmatched = [];
        for (const tagName of tagsResult.value) {
          const id = tagByName.get(normalizeString(tagName).toLowerCase());
          if (id) resolved.push(id);
          else unmatched.push(tagName);
        }
        if (unmatched.length > 0) {
          const available = Array.from(tagById.values()).map((t) => t.name).join(', ');
          failures.push(formatFailure({ lineNumber, name: displayName, code: 'unmatched_tags', message: `תגיות לא נמצאו: ${unmatched.join(', ')}. תגיות זמינות: ${available || 'אין תגיות מוגדרות'}` }));
          continue;
        }
        tagIds = resolved;
      }
    }

    let isActiveValue = true;
    if (fields.is_active) {
      const isActiveResult = coerceBooleanFlag(fields.is_active, { defaultValue: true, allowUndefined: true });
      if (!isActiveResult.valid) {
        failures.push(formatFailure({ lineNumber, name: displayName, code: 'invalid_is_active', message: `ערך "${fields.is_active}" אינו חוקי לסטטוס. השתמש ב: כן, לא, true, false, 1, 0` }));
        continue;
      }
      isActiveValue = isActiveResult.value !== false;
    }

    candidates.push({
      lineNumber,
      displayName,
      guardianFirstName,
      guardianLastName,
      guardianPhone,
      guardianRelationship,
      payload: {
        first_name: normalizeString(fields.first_name),
        middle_name: normalizeString(fields.middle_name) || null,
        last_name: normalizeString(fields.last_name),
        identity_number: idResult.value,
        phone: phoneValue,
        email: emailValue,
        notes_internal: notesValue,
        tags: tagIds,
        is_active: isActiveValue,
      },
    });
  }

  // --- Duplicate national ID check within file ---
  const idCountInFile = new Map();
  for (const candidate of candidates) {
    const id = candidate.payload.identity_number;
    idCountInFile.set(id, (idCountInFile.get(id) || 0) + 1);
  }

  const validCandidates = [];
  for (const candidate of candidates) {
    if ((idCountInFile.get(candidate.payload.identity_number) || 0) > 1) {
      failures.push(formatFailure({
        lineNumber: candidate.lineNumber,
        name: candidate.displayName,
        code: 'duplicate_identity_number_in_file',
        message: `מספר הזהות ${candidate.payload.identity_number} מופיע יותר מפעם אחת בקובץ.`,
      }));
    } else {
      validCandidates.push(candidate);
    }
  }

  // --- Duplicate national ID check against DB ---
  const idsToCheck = validCandidates.map((c) => c.payload.identity_number);
  const existingIdSet = new Set();

  if (idsToCheck.length > 0) {
    const { data: existingProfiles, error: profileLookupError } = await supabase
      .from('client_profiles')
      .select('identity_number')
      .eq('org_id', orgId)
      .in('identity_number', idsToCheck);

    if (profileLookupError) {
      context.log?.error?.('students-bulk-create failed to check existing identity numbers', { message: profileLookupError.message, orgId });
      return respond(context, 500, { message: 'failed_to_validate_identity_numbers' });
    }

    for (const row of existingProfiles || []) {
      if (row.identity_number) existingIdSet.add(row.identity_number);
    }
  }

  const actionableCandidates = [];
  for (const candidate of validCandidates) {
    if (existingIdSet.has(candidate.payload.identity_number)) {
      failures.push(formatFailure({
        lineNumber: candidate.lineNumber,
        name: candidate.displayName,
        code: 'duplicate_identity_number',
        message: `מספר זהות ${candidate.payload.identity_number} כבר קיים במערכת.`,
      }));
    } else {
      actionableCandidates.push(candidate);
    }
  }

  // --- Batch guardian phone lookup ---
  const guardianPhonesNeeded = new Set(
    actionableCandidates.map((c) => c.guardianPhone).filter(Boolean),
  );

  const existingGuardiansByPhone = new Map();
  if (guardianPhonesNeeded.size > 0) {
    const { data: guardians, error: guardianLookupError } = await withOrgScope(supabase, 'guardians', orgId)
      .select('id, first_name, last_name, phone')
      .in('phone', Array.from(guardianPhonesNeeded));

    if (guardianLookupError) {
      context.log?.error?.('students-bulk-create failed to look up guardians', { message: guardianLookupError.message, orgId });
      return respond(context, 500, { message: 'failed_to_lookup_guardians' });
    }

    for (const g of guardians || []) {
      if (g.phone) {
        existingGuardiansByPhone.set(g.phone, {
          id: g.id,
          fullName: buildGuardianFullName(g.first_name, g.last_name),
          first_name: g.first_name,
          last_name: g.last_name,
        });
      }
    }
  }

  // Annotate candidates with guardian conflict status
  const guardianNameConflicts = [];
  for (const candidate of actionableCandidates) {
    if (!candidate.guardianPhone) continue;
    const existing = existingGuardiansByPhone.get(candidate.guardianPhone);
    if (!existing) {
      candidate.guardianAction = 'create';
      continue;
    }
    const csvFullName = buildGuardianFullName(candidate.guardianFirstName, candidate.guardianLastName);
    candidate.existingGuardianId = existing.id;
    candidate.existingGuardianName = existing.fullName;
    candidate.csvGuardianFullName = csvFullName;
    if (namesMatch(existing.fullName, csvFullName)) {
      candidate.guardianAction = 'link_existing';
    } else {
      candidate.guardianAction = 'conflict';
      guardianNameConflicts.push({
        line_number: candidate.lineNumber,
        student_name: candidate.displayName,
        guardian_phone: candidate.guardianPhone,
        csv_guardian_name: csvFullName,
        existing_guardian_name: existing.fullName,
      });
    }
  }

  // --- Dry-run: return preview without writing ---
  if (dryRun) {
    return respond(context, 200, {
      dry_run: true,
      total_rows: parsed.rows.length,
      will_create_count: actionableCandidates.length,
      failed_count: failures.length,
      previews: actionableCandidates.map((c) => ({
        line_number: c.lineNumber,
        name: c.displayName,
        identity_number: c.payload.identity_number,
        phone: c.payload.phone,
        email: c.payload.email || null,
        tags: c.payload.tags || [],
        is_active: c.payload.is_active,
        guardian_first_name: c.guardianFirstName || null,
        guardian_last_name: c.guardianLastName || null,
        guardian_phone: c.guardianPhone || null,
        guardian_relationship: c.guardianRelationship || null,
        guardian_action: c.guardianAction || null,
        existing_guardian_name: c.existingGuardianName || null,
      })),
      failed: failures,
      guardian_name_conflicts: guardianNameConflicts,
    });
  }

  // --- Live run: block if unresolved guardian conflicts ---
  const unresolvedConflicts = guardianNameConflicts.filter(
    (c) => !guardianResolutionMap.has(c.line_number),
  );
  if (unresolvedConflicts.length > 0) {
    return respond(context, 409, {
      code: 'unresolved_guardian_name_conflicts',
      message: 'יש התנגשויות שמות אפוטרופוס שלא נפתרו.',
      guardian_name_conflicts: unresolvedConflicts,
    });
  }

  // --- Live run: create students ---
  const successes = [];
  const createdAt = new Date().toISOString();

  for (const candidate of actionableCandidates) {
    const { payload, lineNumber, displayName } = candidate;

    let clientProfileResult;
    try {
      clientProfileResult = await createOrReuseClientProfile(supabase, {
        org_id: orgId,
        ...payload,
        metadata: {
          created_by: userId,
          created_at: createdAt,
          created_role: role,
          source: 'students_bulk_create',
        },
      });
    } catch (profileError) {
      context.log?.error?.('students-bulk-create failed to create client profile', { message: profileError?.message, orgId });
      failures.push(formatFailure({ lineNumber, name: displayName, code: 'profile_create_failed', message: 'יצירת פרופיל לקוח נכשלה.' }));
      continue;
    }

    const { error: insertError } = await withOrgScope(supabase, 'students', orgId)
      .insert([{
        client_profile_id: clientProfileResult.clientProfileId,
        notes_internal: payload.notes_internal,
        metadata: { created_by: userId, created_at: createdAt, created_role: role },
      }]);

    if (insertError) {
      context.log?.error?.('students-bulk-create failed to insert student', { message: insertError.message, orgId });
      failures.push(formatFailure({ lineNumber, name: displayName, code: 'student_create_failed', message: 'יצירת תלמיד נכשלה.' }));
      continue;
    }

    // Handle guardian linking
    if (candidate.guardianPhone) {
      let guardianId = null;

      if (candidate.guardianAction === 'create') {
        // createOrReuseGuardianByParts does a phone lookup before inserting, so
        // if a previous row in this batch already created this guardian it is
        // reused automatically — no duplicate inserts possible.
        try {
          const result = await createOrReuseGuardianByParts(supabase, {
            orgId,
            firstName: candidate.guardianFirstName,
            lastName: candidate.guardianLastName,
            phone: candidate.guardianPhone,
          });
          guardianId = result.guardianId;
        } catch (guardianCreateError) {
          context.log?.error?.('students-bulk-create failed to create guardian', { message: guardianCreateError?.message, orgId });
          failures.push(formatFailure({ lineNumber, name: displayName, code: 'guardian_create_failed', message: 'יצירת אפוטרופוס נכשלה.' }));
          continue;
        }

      } else if (candidate.guardianAction === 'link_existing') {
        guardianId = candidate.existingGuardianId;

      } else if (candidate.guardianAction === 'conflict') {
        guardianId = candidate.existingGuardianId;
        const resolution = guardianResolutionMap.get(lineNumber);
        if (resolution === 'use_csv') {
          await withOrgScope(supabase, 'guardians', orgId)
            .update({ first_name: candidate.guardianFirstName, last_name: candidate.guardianLastName })
            .eq('id', guardianId);
        }
      }

      if (guardianId) {
        try {
          await upsertClientGuardianLink(supabase, {
            orgId,
            clientProfileId: clientProfileResult.clientProfileId,
            guardianId,
            relationship: candidate.guardianRelationship,
          });
        } catch (linkError) {
          context.log?.error?.('students-bulk-create failed to link guardian', { message: linkError?.message, orgId });
        }
      }
    }

    successes.push({ line_number: lineNumber, name: displayName, identity_number: payload.identity_number });
  }

  if (successes.length > 0) {
    await logAuditEvent(supabase, {
      orgId,
      userId,
      userEmail: authResult.data.user.email,
      userRole: role,
      actionType: AUDIT_ACTIONS.STUDENTS_BULK_UPDATE,
      actionCategory: AUDIT_CATEGORIES.STUDENTS,
      resourceType: 'students_bulk',
      resourceId: orgId,
      details: {
        operation: 'bulk_create',
        total_rows: parsed.rows.length,
        created_count: successes.length,
        failed_count: failures.length,
      },
    });
  }

  return respond(context, 200, {
    total_rows: parsed.rows.length,
    created_count: successes.length,
    failed_count: failures.length,
    created: successes,
    failed: failures,
  });
}
