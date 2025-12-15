/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  UUID_PATTERN,
  ensureMembership,
  isAdminRole,
  normalizeString,
  parseRequestBody,
  readEnv,
  respond,
  resolveOrgId,
  resolveTenantClient,
} from '../_shared/org-bff.js';
import { ensureOrgPermissions } from '../_shared/permissions-utils.js';
import { extractQuestionsForVersion } from '../_shared/version-lookup.js';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';

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
 * Parse session form config
 * Currently unused but kept for potential future use
 */
function _parseSessionFormConfig(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return [];
    }
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

// getQuestionsForVersion is now imported from shared utility (extractQuestionsForVersion)
// No need for duplicate implementation here

/**
 * Generate HTML content for PDF
 */
function generatePdfHtml(student, sessions, formConfig, logoUrl, customLogoUrl) {
  const sessionsHtml = sessions.map(session => {
    // Extract form version from session metadata
    const formVersion = session.metadata?.form_version ?? null;
    
    // Get questions for this specific session's form version (using shared utility)
    const questions = extractQuestionsForVersion(formConfig, formVersion);
    
  const answers = buildAnswerList(session.content, questions, { isLegacy: Boolean(session?.is_legacy) });
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
          <h3>${formatSessionDate(session.date)}</h3>
          <p class="session-service">${session.service_context ? escapeHtml(session.service_context) : 'ללא שירות מוגדר'}</p>
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
        <img src="${escapeHtml(logoUrl)}" alt="Reinex" class="logo" />
        <img src="${escapeHtml(customLogoUrl)}" alt="Organization Logo" class="logo" />
      </div>
    `
    : `<img src="${escapeHtml(logoUrl)}" alt="Reinex" class="logo-single" />`;

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
    <h2>היסטוריית מפגשים (${sessions.length})</h2>
    ${sessionsHtml}
  </div>
  
  <div class="footer">
    <p>מסמך זה נוצר באמצעות מערכת Reinex לניהול רישומי מפגשים</p>
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
    return respond(context, 401, { message: 'missing bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);

  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (error) {
    context.log?.error?.('students-export failed to validate token', { message: error?.message });
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid or expired token' });
  }

  const userId = authResult.data.user.id;
  const orgId = resolveOrgId(req, body);

  if (!orgId) {
    return respond(context, 400, { message: 'invalid org id' });
  }

  let role;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('students-export failed to verify membership', {
      message: membershipError?.message,
      orgId,
      userId,
    });
    return respond(context, 500, { message: 'failed_to_verify_membership' });
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
    return respond(context, 500, { message: 'failed_to_load_permissions' });
  }

  if (!permissions?.can_export_pdf_reports) {
    return respond(context, 403, {
      message: 'pdf_export_not_enabled',
      description: 'PDF export is a premium feature. Contact support to enable this feature.',
    });
  }

  // Extract student_id from body
  const studentId = normalizeString(body?.student_id);
  if (!studentId || !UUID_PATTERN.test(studentId)) {
    return respond(context, 400, { message: 'invalid_student_id' });
  }

  const { client: tenantClient, error: tenantError } = await resolveTenantClient(context, supabase, env, orgId);
  if (tenantError) {
    return respond(context, tenantError.status, tenantError.body);
  }

  // Fetch student data
  let student;
  try {
    const { data, error } = await tenantClient
      .from('Students')
      .select('*')
      .eq('id', studentId)
      .maybeSingle();

    if (error) {
      context.log?.error?.('students-export failed to fetch student', { message: error.message, studentId });
      return respond(context, 500, { message: 'failed_to_load_student' });
    }

    if (!data) {
      return respond(context, 404, { message: 'student_not_found' });
    }

  student = data;
  } catch (error) {
    context.log?.error?.('students-export failed to fetch student', { message: error?.message, studentId });
    return respond(context, 500, { message: 'failed_to_load_student' });
  }

  // Fetch session records
  let sessions;
  try {
    const { data, error } = await tenantClient
      .from('SessionRecords')
      .select('*')
      .eq('student_id', studentId)
      .order('date', { ascending: false });

    if (error) {
      context.log?.error?.('students-export failed to fetch sessions', { message: error.message, studentId });
      return respond(context, 500, { message: 'failed_to_load_sessions' });
    }

  sessions = Array.isArray(data) ? data : [];
  } catch (error) {
    context.log?.error?.('students-export failed to fetch sessions', { message: error?.message, studentId });
    return respond(context, 500, { message: 'failed_to_load_sessions' });
  }

  // Fetch session form config (complete with version history)
  let formConfig = null;
  try {
    const { data, error } = await tenantClient
      .from('Settings')
      .select('settings_value')
      .eq('key', 'session_form_config')
      .maybeSingle();

    if (!error && data?.settings_value) {
      formConfig = data.settings_value;
    }
  } catch (error) {
    context.log?.warn?.('students-export failed to fetch form config', { message: error?.message });
    // Continue without form config
  }

  // Fetch organization logo URL
  let customLogoUrl = null;
  if (permissions?.can_use_custom_logo_on_exports) {
    try {
      const { data, error } = await supabase
        .from('org_settings')
        .select('logo_url')
        .eq('org_id', orgId)
        .maybeSingle();

      if (!error && data?.logo_url) {
        customLogoUrl = data.logo_url;
      }
    } catch (error) {
      context.log?.warn?.('students-export failed to fetch custom logo', { message: error?.message });
      // Continue without custom logo
    }
  }

  // Use Reinex logo URL from environment or default (keep legacy TutTiud env var fallbacks)
  const appLogoUrl =
    env.VITE_REINEX_LOGO_URL ||
    env.REINEX_LOGO_URL ||
    env.VITE_TUTTIUD_LOGO_URL ||
    env.TUTTIUD_LOGO_URL ||
    env.VITE_PUBLIC_APP_LOGO_URL ||
    env.PUBLIC_APP_LOGO_URL ||
    'https://reinex.thepcrunners.com/icon.png';

  // Generate PDF
  let browser;
  try {
    context.log?.info?.('students-export launching browser');
    
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

  const page = await browser.newPage();
  const html = generatePdfHtml(student, sessions, formConfig, appLogoUrl, customLogoUrl);
    
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
      sessionCount: sessions.length,
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
    return respond(context, 500, { message: 'failed_to_generate_pdf' });
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
