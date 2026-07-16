/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeNullableId,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { ensureOrgPermissions } from '../_shared/permissions-utils.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';

function respondStudentsExportError(context, status, message, error, metadata = {}) {
  return respondTracked(context, status, { message }, undefined, {
    error,
    metadata,
  });
}

/**
 * Parse session content from JSON or text
 */
function parseSessionContent(raw) {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      return { notes: trimmed };
    }
    return { notes: trimmed };
  }
  if (typeof raw === 'object') {
    return raw;
  }
  return {};
}

/**
 * Create a stable key from a label/id similar to frontend normalization
 * - lowercases
 * - replaces non [a-z0-9א-ת] with underscores
 * - collapses multiple underscores and trims edges
 */
function toKey(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9א-ת]+/gi, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Build answer list with human-readable labels
 */
function extractQuestionLabelRaw(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (typeof entry.label === 'string' && entry.label.trim()) return entry.label.trim();
  if (typeof entry.title === 'string' && entry.title.trim()) return entry.title.trim();
  if (typeof entry.question === 'string' && entry.question.trim()) return entry.question.trim();
  return '';
}

function buildAnswerList(content, questions, { isLegacy = false } = {}) {
  const answers = parseSessionContent(content);
  const entries = [];
  const seenKeys = new Set();

  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    if (isLegacy) {
      for (const [answerKey, answerValue] of Object.entries(answers)) {
        if (answerValue === undefined || answerValue === null || answerValue === '') {
          continue;
        }
        entries.push({ label: String(answerKey), value: String(answerValue) });
      }
      return entries;
    }

    // Create a lookup map for questions by ID, key, and label (including slugged variants)
    const questionMap = new Map();
    for (const question of questions) {
      const qLabel = extractQuestionLabelRaw(question);
      const qId = typeof question.id === 'string' ? question.id : '';
      const qKey = typeof question.key === 'string' ? question.key : '';

      if (qLabel) {
        questionMap.set(qLabel, qLabel);
        questionMap.set(toKey(qLabel), qLabel);
      }
      if (qId) {
        questionMap.set(qId, qLabel || qId);
        questionMap.set(toKey(qId), qLabel || qId);
      }
      if (qKey) {
        questionMap.set(qKey, qLabel || qKey);
        questionMap.set(toKey(qKey), qLabel || qKey);
      }
    }

    // Process all answers and look up their labels from the question map
    for (const [answerKey, answerValue] of Object.entries(answers)) {
      if (answerValue === undefined || answerValue === null || answerValue === '') {
        continue;
      }
      const rawKey = String(answerKey);
      // Try to find the human-readable label for this answer
      const label = questionMap.get(rawKey) || questionMap.get(toKey(rawKey)) || rawKey;

      if (!seenKeys.has(rawKey)) {
        entries.push({ label, value: String(answerValue) });
        seenKeys.add(rawKey);
      }
    }
  } else if (typeof answers === 'string' && answers.trim()) {
    entries.push({ label: 'תוכן המפגש', value: answers.trim() });
  }

  return entries;
}

/** Format date to dd/MM/yyyy (Hebrew locale) */
function formatSessionDate(value) {
  if (!value) {
    return '';
  }
  try {
    const parsed = parseISO(value);
    if (!Number.isNaN(parsed.getTime())) {
      return format(parsed, 'dd/MM/yyyy', { locale: he });
    }
  } catch {
    // ignore parsing failures
  }
  return value;
}

/**
 * Session Reports Phase 5 — flatten a Reinex Form schema (sections[].questions[])
 * into a flat question list, in the shape buildAnswerList already expects
 * (objects with .label/.id/.key). Each report carries its own rendering
 * contract in metadata.form_schema_snapshot (captured at submit time — see
 * api/session-reports/index.js createReport), so there is no version-history
 * lookup needed anymore (that was the old TutTiud session_form_config model).
 */
function flattenSchemaQuestions(schema) {
  if (!schema || typeof schema !== 'object') return [];
  const sections = Array.isArray(schema.sections) ? schema.sections : [];
  const out = [];
  for (const section of sections) {
    const questions = Array.isArray(section?.questions) ? section.questions : [];
    for (const question of questions) {
      if (question && typeof question === 'object') {
        out.push(question);
      }
    }
  }
  return out;
}

/**
 * Generate HTML content for PDF.
 *
 * `reports` are form_submissions rows (Session Reports Phase 2+), each
 * pre-shaped by loadReportsForExport below into
 * { date, service_name, answers, is_legacy, form_schema_snapshot }.
 */
function generatePdfHtml(student, reports, logoUrl, customLogoUrl) {
  const sessionsHtml = reports.map(report => {
    const questions = flattenSchemaQuestions(report.form_schema_snapshot);
    const answers = buildAnswerList(report.answers, questions, { isLegacy: Boolean(report?.is_legacy) && questions.length === 0 });
    const answersHtml = answers.length ? answers.map(entry => `
      <div class="answer-item">
        <div class="answer-label">${escapeHtml(entry.label)}</div>
        <div class="answer-value">${escapeHtml(entry.value)}</div>
      </div>
    `).join('') : '<p class="no-data">לא תועדו תשובות עבור מפגש זה.</p>';

    // NOTE: Instructor name is displayed in the web UI but intentionally NOT exported to PDF
    return `
      <div class="session-card">
        <div class="session-header">
          <h3>${formatSessionDate(report.date)}</h3>
          <p class="session-service">${report.service_name ? escapeHtml(report.service_name) : 'ללא שירות מוגדר'}</p>
        </div>
        <div class="session-content">
          ${answersHtml}
        </div>
      </div>
    `;
  }).join('');

  const logoSection = customLogoUrl
    ? `
      <div class="header-logos">
        <img src="${escapeHtml(logoUrl)}" alt="TutTiud" class="logo" />
        <img src="${escapeHtml(customLogoUrl)}" alt="Organization Logo" class="logo" />
      </div>
    `
    : `<img src="${escapeHtml(logoUrl)}" alt="TutTiud" class="logo-single" />`;

  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>רישומי מפגשים - ${escapeHtml(student.name)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Arial', 'Tahoma', 'Noto Sans Hebrew', sans-serif;
      direction: rtl;
      background: white;
      color: #1a1a1a;
      padding: 40px;
      line-height: 1.6;
    }
    
    .header {
      border-bottom: 3px solid #4f46e5;
      padding-bottom: 20px;
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header-logos {
      display: flex;
      gap: 20px;
      align-items: center;
    }
    
    .logo {
      height: 50px;
      width: auto;
      object-fit: contain;
    }
    
    .logo-single {
      height: 50px;
      width: auto;
      object-fit: contain;
    }
    
    .header-info {
      text-align: right;
    }
    
    h1 {
      font-size: 24px;
      color: #1a1a1a;
      margin-bottom: 5px;
    }
    
    .subtitle {
      font-size: 14px;
      color: #666;
    }
    
    .student-info {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
    }
    
    .student-info h2 {
      font-size: 18px;
      margin-bottom: 15px;
      color: #4f46e5;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
    }
    
    .info-item {
      display: flex;
      flex-direction: column;
    }
    
    .info-label {
      font-size: 12px;
      color: #666;
      margin-bottom: 4px;
      font-weight: 600;
    }
    
    .info-value {
      font-size: 14px;
      color: #1a1a1a;
    }
    
    .sessions-section h2 {
      font-size: 20px;
      margin-bottom: 20px;
      color: #1a1a1a;
    }
    
    .session-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    
    .session-header {
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    
    .session-header h3 {
      font-size: 16px;
      color: #1a1a1a;
      margin-bottom: 4px;
    }
    
    .session-service {
      font-size: 13px;
      color: #666;
    }
    
    .session-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .answer-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    
    .answer-label {
      font-size: 12px;
      font-weight: 600;
      color: #4f46e5;
    }
    
    .answer-value {
      font-size: 13px;
      color: #1a1a1a;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    
    .no-data {
      font-size: 13px;
      color: #999;
      font-style: italic;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 11px;
      color: #999;
    }
    
    @media print {
      body {
        padding: 20px;
      }
      
      .session-card {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-info">
      <h1>רישומי מפגשים</h1>
      <p class="subtitle">נוצר ב-${format(new Date(), 'dd/MM/yyyy', { locale: he })}</p>
    </div>
    ${logoSection}
  </div>
  
  <div class="student-info">
    <h2>פרטי תלמיד</h2>
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">שם התלמיד</div>
        <div class="info-value">${escapeHtml(student.name)}</div>
      </div>
      ${student.national_id ? `
        <div class="info-item">
          <div class="info-label">מספר זהות</div>
          <div class="info-value">${escapeHtml(student.national_id)}</div>
        </div>
      ` : ''}
      ${student.default_service ? `
        <div class="info-item">
          <div class="info-label">שירות ברירת מחדל</div>
          <div class="info-value">${escapeHtml(student.default_service)}</div>
        </div>
      ` : ''}
      ${student.contact_name ? `
        <div class="info-item">
          <div class="info-label">שם איש קשר</div>
          <div class="info-value">${escapeHtml(student.contact_name)}</div>
        </div>
      ` : ''}
      ${student.contact_phone ? `
        <div class="info-item">
          <div class="info-label">טלפון</div>
          <div class="info-value">${escapeHtml(student.contact_phone)}</div>
        </div>
      ` : ''}
    </div>
  </div>
  
  <div class="sessions-section">
    <h2>היסטוריית מפגשים (${reports.length})</h2>
    ${sessionsHtml}
  </div>
  
  <div class="footer">
    <p>מסמך זה נוצר באמצעות מערכת TutTiud לניהול רישומי מפגשים</p>
  </div>
</body>
</html>
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize student name for use in filename
 */
function sanitizeStudentName(studentName) {
  return studentName
    .replace(/[^א-תa-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

/**
 * Generate safe filename from student name
 */
function generateFilename(studentName) {
  const safeName = sanitizeStudentName(studentName);
  const dateStr = format(new Date(), 'yyyy-MM-dd');
  return `${safeName}_Records_${dateStr}.pdf`;
}

export default async function (context, req) {
  const method = String(req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    return respond(context, 405, { message: 'method_not_allowed' }, { Allow: 'POST' });
  }

  const env = readEnv(context);
  const body = parseRequestBody(req);
  const adminConfig = readSupabaseAdminConfig(env);

  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    context.log?.error?.('students-export missing Supabase admin credentials');
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    context.log?.warn?.('students-export missing bearer token');
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-export failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }

  attachErrorTracking(context, req, supabase, {
    orgId,
    userId,
    metadata: { endpoint: 'students-export' },
  });

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-export failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respondStudentsExportError(context, 500, 'failed_to_verify_membership', membershipError, {
      action: 'verify_membership',
    });
  }

  if (!role || !isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  // Check permissions
  let permissions;
  try {
    permissions = await ensureOrgPermissions(supabase, orgId);
  } catch (permError) {
    context.log?.error?.('students-export failed to load permissions', {
      message: permError?.message,
      orgId,
    });
    return respondStudentsExportError(context, 500, 'failed_to_load_permissions', permError, {
      action: 'load_permissions',
    });
  }

  if (!permissions?.can_export_pdf_reports) {
    return respond(context, 403, {
      message: 'pdf_export_not_enabled',
      description: 'pdf_export_is_a_premium_feature_contact_support_to_enable_this_feature',
    });
  }

  // Extract student_id from body
  const studentId = normalizeNullableId(body?.student_id);
  if (!studentId || !UUID_PATTERN.test(studentId)) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  // Fetch student data
  let student;
  try {
    const { data, error } = await withOrgScope(supabase, 'Students', orgId)
      .select('*')
      .eq('id', studentId)
      .maybeSingle();

    if (error) {
      context.log?.error?.('students-export failed to fetch student', { message: error.message, studentId });
      return respondStudentsExportError(context, 500, 'failed_to_load_student', error, {
        action: 'load_student',
        student_id: studentId,
      });
    }

    if (!data) {
      return respond(context, 404, { message: 'student_not_found' });
    }

  student = data;
  } catch (error) {
    context.log?.error?.('students-export failed to fetch student', { message: error?.message, studentId });
    return respondStudentsExportError(context, 500, 'failed_to_load_student', error, {
      action: 'load_student',
      student_id: studentId,
    });
  }

  // Fetch session reports (Session Reports Phase 2+ — form_submissions rows
  // bound to lesson_participant_id; is_legacy rows are TutTiud/Amir imports).
  // The old SessionRecords table this used to read from was never created
  // (see implementations/session-reports/phase0-delta-audit.md) — this export
  // was dead code until now.
  let reports = [];
  try {
    const { data, error } = await withOrgScope(supabase, 'form_submissions', orgId)
      .select('id, submitted_at, service_id, answers, metadata, is_legacy, lesson_participant_id, lesson_participants(lesson_instance_id, lesson_instances(datetime_start))')
      .eq('student_id', studentId)
      .order('submitted_at', { ascending: false });

    if (error) {
      context.log?.error?.('students-export failed to fetch reports', { message: error.message, studentId });
      return respondStudentsExportError(context, 500, 'failed_to_load_sessions', error, {
        action: 'load_reports',
        student_id: studentId,
      });
    }

    const rawReports = Array.isArray(data) ? data : [];
    const serviceIds = Array.from(new Set(rawReports.map((row) => row.service_id).filter(Boolean)));
    let serviceNameById = new Map();
    if (serviceIds.length) {
      const { data: serviceRows, error: servicesError } = await withOrgScope(supabase, 'Services', orgId)
        .select('id, name')
        .in('id', serviceIds);
      if (!servicesError && serviceRows) {
        serviceNameById = new Map(serviceRows.map((row) => [row.id, row.name]));
      }
    }

    reports = rawReports.map((row) => ({
      date: row?.lesson_participants?.lesson_instances?.datetime_start || row.submitted_at,
      service_name: serviceNameById.get(row.service_id) || null,
      answers: row.answers,
      is_legacy: Boolean(row.is_legacy),
      form_schema_snapshot: row?.metadata?.form_schema_snapshot || null,
    }));
  } catch (error) {
    context.log?.error?.('students-export failed to fetch reports', { message: error?.message, studentId });
    return respondStudentsExportError(context, 500, 'failed_to_load_sessions', error, {
      action: 'load_reports',
      student_id: studentId,
    });
  }

  // Fetch organization logo URL
  let customLogoUrl = null;
  if (permissions?.can_use_custom_logo_on_exports) {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('logo_url')
        .eq('id', orgId)
        .maybeSingle();

      if (!error && data?.logo_url) {
        customLogoUrl = data.logo_url;
      }
    } catch (error) {
      context.log?.warn?.('students-export failed to fetch custom logo', { message: error?.message });
      // Continue without custom logo
    }
  }

  // Use TutTiud logo URL from environment or default
  const tuttiudLogoUrl = env.VITE_TUTTIUD_LOGO_URL || env.TUTTIUD_LOGO_URL || 'https://tuttiud.thepcrunners.com/icon.png';

  // Generate PDF
  let browser;
  try {
    const chromiumPackUrl = String(process.env.CHROMIUM_PACK_URL || '').trim();
    if (!chromiumPackUrl) {
      return respondStudentsExportError(context, 500, 'pdf_renderer_not_configured', new Error('CHROMIUM_PACK_URL is not configured'), {
        action: 'configure_pdf_renderer',
        student_id: studentId,
      });
    }

    context.log?.info?.('students-export launching browser');
    
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(chromiumPackUrl),
      headless: chromium.headless,
    });

  const page = await browser.newPage();
  const html = generatePdfHtml(student, reports, tuttiudLogoUrl, customLogoUrl);

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px',
      },
    });

    const filename = generateFilename(student.name);

    context.log?.info?.('students-export PDF generated successfully', {
      studentId,
      filename,
      sessionCount: reports.length,
    });

    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store',
      },
      body: pdfBuffer,
      isRaw: true,
    };

    return context.res;
  } catch (error) {
    context.log?.error?.('students-export failed to generate PDF', {
      message: error?.message,
      stack: error?.stack,
      studentId,
    });
    return respondStudentsExportError(context, 500, 'failed_to_generate_pdf', error, {
      action: 'generate_pdf',
      student_id: studentId,
      session_count: Array.isArray(reports) ? reports.length : null,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
        context.log?.info?.('students-export browser closed successfully');
      } catch (closeError) {
        context.log?.error?.('students-export failed to close browser', { message: closeError?.message });
      }
    }
  }
}
