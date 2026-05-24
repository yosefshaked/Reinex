/* eslint-env node */
import { resolveBearerAuthorization } from '../_shared/http.js';
import { createSupabaseAdminClient, readSupabaseAdminConfig } from '../_shared/supabase-admin.js';
import {
  ensureMembership,
  isAdminOrOffice,
  isAdminRole,
  normalizeString,
  readEnv,
  respond,
  resolveOrgId,
  withOrgScope,
} from '../_shared/org-bff.js';
import { parseJsonBodyWithLimit } from '../_shared/validation.js';
import BillingLedgerService from '../_shared/BillingLedgerService.js';
import {
  fetchBillingSnapshot,
} from '../_shared/student-billing.js';
import { resolveDashboardTask } from '../_shared/dashboard-tasks.js';
import { attachErrorTracking, respondTracked } from '../_shared/error-events.js';


const MAX_BODY_BYTES = 96 * 1024;

/**
 * Pure helper: should the payment handler auto-resolve open claim tasks?
 * Exported for unit testing — mirrors the inline check inside record_hmo_claim_payment.
 */
export function resolveOpenClaimTasksEnabled(body) {
  return body?.resolve_open_claim_tasks !== false && body?.resolveOpenClaimTasks !== false;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUuidLike(value) {
  const normalized = normalizeString(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized);
}

function normalizeDateKey(value) {
  const normalized = normalizeString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return '';
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return normalized;
}

function isDateWithinAuthorizationWindow({ validFrom = '', expiresAt = '', referenceDateKey = '' } = {}) {
  const normalizedReferenceDate = normalizeDateKey(referenceDateKey);
  if (!normalizedReferenceDate) return false;
  const normalizedValidFrom = normalizeDateKey(validFrom);
  const normalizedExpiresAt = normalizeDateKey(expiresAt);
  if (normalizedValidFrom && normalizedReferenceDate < normalizedValidFrom) {
    return false;
  }
  if (normalizedExpiresAt && normalizedReferenceDate > normalizedExpiresAt) {
    return false;
  }
  return true;
}

function buildPersonName(profile) {
  if (!profile || !isPlainObject(profile)) return 'לקוח/ה';
  return [profile.first_name, profile.middle_name, profile.last_name].filter(Boolean).join(' ').trim() || 'לקוח/ה';
}

function dedupeHmoClaimTasks(tasks = []) {
  const latestByFlow = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const resourceType = normalizeString(task?.resource_type) || 'lesson_participant';
    const resourceId = normalizeString(task?.resource_id);
    const authorizationId = normalizeString(task?.metadata?.hmo_authorization_id);
    const fallbackTaskId = normalizeString(task?.id);
    const key = resourceId
      ? `${resourceType}:${resourceId}:${authorizationId || '_'}`
      : `task:${fallbackTaskId || Math.random().toString(36).slice(2)}`;

    if (!latestByFlow.has(key)) {
      latestByFlow.set(key, task);
    }
  }
  return Array.from(latestByFlow.values());
}

function buildHmoClaimKey({ lessonParticipantId, hmoAuthorizationId } = {}) {
  const participantId = normalizeString(lessonParticipantId);
  const authorizationId = normalizeString(hmoAuthorizationId);
  if (!participantId) {
    return '';
  }
  return `${participantId}:${authorizationId || '_'}`;
}

async function buildHmoClaimsReadModel({
  client,
  orgId,
  billingService,
  startDate = '',
  endDate = '',
} = {}) {
  const notices = [];
  const normalizedStartDate = normalizeDateKey(startDate);
  const normalizedEndDate = normalizeDateKey(endDate);

  let ledgerQuery = withOrgScope(client, 'ledger_transactions', orgId)
    .select(`
      id,
      amount,
      direction,
      effective_at,
      posted_at,
      source_type,
      metadata,
      lesson_participant_id,
      hmo_provider_id,
      hmo_authorization_id,
      reverses_transaction_id
    `)
    .not('lesson_participant_id', 'is', null)
    .not('hmo_provider_id', 'is', null)
    .in('source_type', ['lesson_charge', 'reversal'])
    .order('effective_at', { ascending: false })
    .order('posted_at', { ascending: false });

  if (normalizedStartDate) {
    ledgerQuery = ledgerQuery.gte('effective_at', `${normalizedStartDate}T00:00:00.000Z`);
  }
  if (normalizedEndDate) {
    ledgerQuery = ledgerQuery.lte('effective_at', `${normalizedEndDate}T23:59:59.999Z`);
  }

  const { data: ledgerRows, error: ledgerError } = await ledgerQuery;
  if (ledgerError) {
    throw ledgerError;
  }

  const ledgerEntries = Array.isArray(ledgerRows) ? ledgerRows : [];
  const reversedTransactionIds = new Set(ledgerEntries
    .filter((row) => normalizeString(row?.source_type) === 'reversal' && row?.reverses_transaction_id)
    .map((row) => row.reverses_transaction_id));
  const activeClaimRows = ledgerEntries.filter((row) => (
    normalizeString(row?.source_type) === 'lesson_charge'
    && !reversedTransactionIds.has(row.id)
    && normalizeString(row?.direction) === 'DEBIT'
    && normalizeString(row?.lesson_participant_id)
    && normalizeString(row?.hmo_provider_id)
  ));

  const latestLedgerByClaim = new Map();
  for (const row of activeClaimRows) {
    const claimKey = buildHmoClaimKey({
      lessonParticipantId: row.lesson_participant_id,
      hmoAuthorizationId: row.hmo_authorization_id,
    });
    if (!claimKey || latestLedgerByClaim.has(claimKey)) {
      continue;
    }
    latestLedgerByClaim.set(claimKey, row);
  }

  const claimSeedRows = Array.from(latestLedgerByClaim.values());
  const participantIds = Array.from(new Set(claimSeedRows
    .map((row) => normalizeString(row?.lesson_participant_id))
    .filter((value) => isUuidLike(value))));
  const authorizationIds = Array.from(new Set(claimSeedRows
    .map((row) => normalizeString(row?.hmo_authorization_id))
    .filter((value) => isUuidLike(value))));
  const receivableProviderIds = Array.from(new Set(claimSeedRows
    .map((row) => normalizeString(row?.hmo_provider_id))
    .filter(Boolean)));

  let taskRows = [];
  if (participantIds.length > 0) {
    let taskQuery = withOrgScope(client, 'dashboard_tasks', orgId)
      .select('id, task_type, title, description, status, priority, resource_type, resource_id, metadata, created_at, resolved_at')
      .eq('task_type', 'hmo_claim_submission')
      .in('resource_id', participantIds)
      .order('created_at', { ascending: false });

    const { data: tasks, error: tasksError } = await taskQuery;
    if (tasksError) {
      if (tasksError.code === '42P01') {
        notices.push('dashboard_tasks_schema_missing');
      } else {
        throw tasksError;
      }
    } else {
      taskRows = dedupeHmoClaimTasks(tasks || []);
    }
  }

  const taskMap = new Map(taskRows.map((task) => [
    buildHmoClaimKey({
      lessonParticipantId: task?.resource_id,
      hmoAuthorizationId: task?.metadata?.hmo_authorization_id,
    }),
    task,
  ]).filter(([key]) => Boolean(key)));

  const claimLedgerIds = claimSeedRows.map((row) => normalizeString(row?.id)).filter(Boolean);
  const { data: batchItems, error: batchItemsError } = claimLedgerIds.length > 0
    ? await withOrgScope(client, 'hmo_invoice_batch_items', orgId)
      .select('id, batch_id, ledger_transaction_id, amount, expected_amount, paid_amount, status')
      .in('ledger_transaction_id', claimLedgerIds)
    : { data: [], error: null };
  if (batchItemsError && batchItemsError.code !== '42P01') {
    throw batchItemsError;
  }

  const batchIds = Array.from(new Set((batchItems || []).map((item) => normalizeString(item?.batch_id)).filter(Boolean)));
  const { data: batches, error: batchesError } = batchIds.length > 0
    ? await withOrgScope(client, 'hmo_invoice_batches', orgId)
      .select('id, hmo_provider_id, status, total_amount, paid_amount, external_reference, external_link, notes, period_start, period_end, issued_at, submitted_at, paid_at')
      .in('id', batchIds)
    : { data: [], error: null };
  if (batchesError && batchesError.code !== '42P01') {
    throw batchesError;
  }

  const batchMap = new Map((batches || []).map((batch) => [batch.id, batch]));
  const batchItemByLedgerId = new Map((batchItems || [])
    .filter((item) => normalizeString(batchMap.get(item.batch_id)?.status).toLowerCase() !== 'cancelled')
    .map((item) => [item.ledger_transaction_id, item]));

  const [{ data: participants, error: participantsError }, { data: authorizations, error: authorizationsError }] = await Promise.all([
    participantIds.length > 0
      ? withOrgScope(client, 'lesson_participants', orgId)
        .select(`
          id,
          student_id,
          participant_status,
          lesson_instance_id,
          lesson_instance:lesson_instances(
            id,
            datetime_start,
            duration_minutes,
            service_id
          ),
          student:students(
            id,
            client_profile:client_profiles(
              first_name,
              middle_name,
              last_name
            )
          )
        `)
        .in('id', participantIds)
      : Promise.resolve({ data: [], error: null }),
    authorizationIds.length > 0
      ? withOrgScope(client, 'hmo_authorizations', orgId)
        .select('id, provider_id, authorization_reference, status, covered_insurer_claim_amount')
        .in('id', authorizationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (participantsError && participantsError.code !== '42P01') {
    throw participantsError;
  }
  if (authorizationsError && authorizationsError.code !== '42P01') {
    throw authorizationsError;
  }

  const participantRows = Array.isArray(participants) ? participants : [];
  const participantMap = new Map(participantRows.map((row) => [row.id, row]));
  const authorizationRows = Array.isArray(authorizations) ? authorizations : [];
  const authorizationMap = new Map(authorizationRows.map((row) => [row.id, row]));

  const serviceIds = Array.from(new Set(participantRows
    .map((row) => normalizeString(row?.lesson_instance?.service_id))
    .filter(Boolean)));
  const providerIds = Array.from(new Set([
    ...receivableProviderIds,
    ...authorizationRows.map((row) => normalizeString(row?.provider_id)).filter(Boolean),
  ]));

  const [{ data: services, error: servicesError }, { data: providers, error: providersError }] = await Promise.all([
    serviceIds.length > 0
      ? withOrgScope(client, 'Services', orgId)
        .select('id, name')
        .in('id', serviceIds)
      : Promise.resolve({ data: [], error: null }),
    providerIds.length > 0
      ? withOrgScope(client, 'hmo_providers', orgId)
        .select('id, name, is_active, claim_submission_mode, claim_payment_timing, claim_reference_required, claim_period_granularity, claim_payment_matching_mode')
        .in('id', providerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (servicesError && servicesError.code !== '42P01') {
    throw servicesError;
  }
  if (providersError && providersError.code !== '42P01') {
    throw providersError;
  }

  const serviceMap = new Map((services || []).map((row) => [row.id, row]));
  const providerMap = new Map((providers || []).map((row) => [row.id, row]));
  const todayKey = normalizeDateKey(new Date().toISOString().slice(0, 10));

  const { data: activeAuthorizationStudents, error: activeAuthorizationStudentsError } = await withOrgScope(client, 'hmo_authorizations', orgId)
    .select(`
      student_id,
      valid_from,
      expires_at
    `)
    .eq('status', 'active');

  if (activeAuthorizationStudentsError && activeAuthorizationStudentsError.code !== '42P01') {
    throw activeAuthorizationStudentsError;
  }

  const studentsWithActiveHmoEligibility = new Set((activeAuthorizationStudents || [])
    .filter((row) => normalizeString(row?.student_id))
    .filter((row) => isDateWithinAuthorizationWindow({
      validFrom: row?.valid_from,
      expiresAt: row?.expires_at,
      referenceDateKey: todayKey,
    }))
    .map((row) => normalizeString(row?.student_id)));

  const claims = claimSeedRows.map((ledgerRow) => {
    const participantId = normalizeString(ledgerRow?.lesson_participant_id);
    const participant = participantMap.get(participantId) || null;
    const authorizationId = normalizeString(ledgerRow?.hmo_authorization_id);
    const authorization = authorizationMap.get(authorizationId) || null;
    const ledgerProviderId = normalizeString(ledgerRow?.hmo_provider_id);
    const authorizationProviderId = normalizeString(authorization?.provider_id);
    const providerId = ledgerProviderId;
    const provider = providerMap.get(providerId) || null;
    const batchItem = batchItemByLedgerId.get(ledgerRow.id) || null;
    const batch = batchItem ? (batchMap.get(batchItem.batch_id) || null) : null;
    const service = serviceMap.get(participant?.lesson_instance?.service_id || '') || null;
    const task = taskMap.get(buildHmoClaimKey({
      lessonParticipantId: participantId,
      hmoAuthorizationId: authorizationId,
    })) || null;
    const studentName = buildPersonName(participant?.student?.client_profile);

    return {
      id: task?.id || ledgerRow.id,
      ledger_transaction_id: ledgerRow.id,
      status: normalizeString(task?.status) || 'open',
      priority: normalizeString(task?.priority) || 'medium',
      title: normalizeString(task?.title) || 'תביעת גורם מממן',
      description: normalizeString(task?.description) || '',
      created_at: task?.created_at || ledgerRow?.posted_at || ledgerRow?.effective_at || null,
      resolved_at: task?.resolved_at || null,
      lesson_participant_id: participantId || null,
      lesson_instance_id: participant?.lesson_instance_id || null,
      lesson_date: participant?.lesson_instance?.datetime_start || ledgerRow?.effective_at || null,
      lesson_duration_minutes: Number(participant?.lesson_instance?.duration_minutes) || 0,
      student_id: participant?.student_id || null,
      student_name: studentName,
      participant_status: participant?.participant_status || null,
      service_id: participant?.lesson_instance?.service_id || null,
      service_name: normalizeString(service?.name) || 'שירות',
      hmo_authorization_id: authorizationId || null,
      hmo_authorization_status: normalizeString(authorization?.status) || null,
      hmo_authorization_reference: normalizeString(authorization?.authorization_reference) || null,
      hmo_authorization_provider_id: authorizationProviderId || null,
      hmo_contracted_rate_amount: authorization?.covered_insurer_claim_amount ?? ledgerRow?.amount ?? null,
      hmo_provider_id: providerId || null,
      hmo_provider_name: normalizeString(provider?.name) || null,
      claim_workflow_status: normalizeString(batch?.status) || (batchItem ? 'batched' : 'claimable'),
      hmo_invoice_batch_id: batch?.id || null,
      hmo_invoice_batch_item_id: batchItem?.id || null,
      hmo_invoice_batch_status: normalizeString(batch?.status) || null,
      hmo_invoice_batch_external_reference: normalizeString(batch?.external_reference) || null,
      hmo_invoice_batch_paid_amount: batch?.paid_amount ?? null,
      provider_claim_policy: provider ? {
        submission_mode: normalizeString(provider.claim_submission_mode) || 'amount',
        payment_timing: normalizeString(provider.claim_payment_timing) || 'after_submission',
        reference_required: provider.claim_reference_required === true,
        period_granularity: normalizeString(provider.claim_period_granularity) || 'monthly',
        payment_matching_mode: normalizeString(provider.claim_payment_matching_mode) || 'batch_amount',
      } : null,
      metadata: {
        ...(isPlainObject(ledgerRow?.metadata) ? ledgerRow.metadata : {}),
        ...(isPlainObject(task?.metadata) ? { task: task.metadata } : {}),
      },
    };
  });

  const providerReceivables = await Promise.all(receivableProviderIds.map(async (hmoProviderId) => {
    try {
      const snapshot = await billingService.getHmoProviderReceivablesSnapshot({
        hmoProviderId,
        periodStart: normalizedStartDate || null,
        periodEnd: normalizedEndDate || null,
      });
      const provider = providerMap.get(hmoProviderId) || null;
      return {
        hmo_provider_id: hmoProviderId,
        hmo_provider_name: normalizeString(provider?.name) || null,
        is_active: provider?.is_active !== false,
        summary: snapshot?.summary || { balance: 0, receivable_total: 0, payment_total: 0 },
        claim_policy: provider ? {
          submission_mode: normalizeString(provider.claim_submission_mode) || 'amount',
          payment_timing: normalizeString(provider.claim_payment_timing) || 'after_submission',
          reference_required: provider.claim_reference_required === true,
          period_granularity: normalizeString(provider.claim_period_granularity) || 'monthly',
          payment_matching_mode: normalizeString(provider.claim_payment_matching_mode) || 'batch_amount',
        } : null,
        invoice_batch_count: Array.isArray(snapshot?.invoice_batches) ? snapshot.invoice_batches.length : 0,
        open_invoice_batch_count: Array.isArray(snapshot?.invoice_batches)
          ? snapshot.invoice_batches.filter((batch) => ['draft', 'issued', 'submitted', 'acknowledged', 'partially_paid', 'disputed'].includes(normalizeString(batch?.status).toLowerCase())).length
          : 0,
      };
    } catch {
      notices.push(`provider_receivables_failed:${hmoProviderId}`);
      return {
        hmo_provider_id: hmoProviderId,
        hmo_provider_name: normalizeString((providerMap.get(hmoProviderId) || null)?.name) || null,
        is_active: (providerMap.get(hmoProviderId) || null)?.is_active !== false,
        summary: { balance: 0, receivable_total: 0, payment_total: 0 },
        claim_policy: null,
        invoice_batch_count: 0,
        open_invoice_batch_count: 0,
      };
    }
  }));

  const uniqueStudents = new Set(claims.map((row) => normalizeString(row?.student_id)).filter(Boolean));
  const cancelledClaimTasks = claims.filter((row) => normalizeString(row?.participant_status) === 'scheduled').length;
  const openClaimTasks = claims.filter((row) => (
    normalizeString(row?.status) === 'open'
    && normalizeString(row?.participant_status) !== 'scheduled'
    && !normalizeString(row?.hmo_invoice_batch_status)
  )).length;
  const resolvedClaimTasks = claims.filter((row) => (
    normalizeString(row?.status) === 'resolved'
    || normalizeString(row?.participant_status) === 'scheduled'
  )).length;
  const pendingPaymentFollowupBatches = Array.from(batchMap.values()).filter((batch) => (
    ['submitted', 'issued', 'acknowledged', 'partially_paid', 'disputed'].includes(normalizeString(batch?.status).toLowerCase())
    && Number(batch?.paid_amount || 0) < Number(batch?.total_amount || 0)
  )).length;
  const expectedPaymentFromSubmittedBatches = Array.from(batchMap.values()).reduce((sum, batch) => {
    const status = normalizeString(batch?.status).toLowerCase();
    if (!['submitted', 'issued', 'acknowledged', 'partially_paid', 'disputed'].includes(status)) {
      return sum;
    }
    const remainingAmount = Math.max(0, Number(batch?.total_amount || 0) - Number(batch?.paid_amount || 0));
    return sum + remainingAmount;
  }, 0);
  const paymentReceivedTotal = Array.from(batchMap.values()).reduce(
    (sum, batch) => sum + Number(batch?.paid_amount || 0),
    0,
  );

  return {
    summary: {
      total_claim_tasks: claims.length,
      open_claim_tasks: openClaimTasks,
      resolved_claim_tasks: resolvedClaimTasks,
      cancelled_claim_tasks: cancelledClaimTasks,
      pending_payment_followup_batches: pendingPaymentFollowupBatches,
      expected_payment_from_submitted_batches: expectedPaymentFromSubmittedBatches,
      payment_received_total: paymentReceivedTotal,
      active_students_with_hmo_eligibility: studentsWithActiveHmoEligibility.size,
      unique_students: uniqueStudents.size,
      provider_count: providerReceivables.length,
    },
    claims,
    provider_receivables: providerReceivables,
    invoice_batches: Array.from(batchMap.values()).map((batch) => ({
      id: batch.id,
      hmo_provider_id: batch.hmo_provider_id,
      hmo_provider_name: normalizeString((providerMap.get(batch.hmo_provider_id) || null)?.name) || null,
      status: normalizeString(batch.status) || 'draft',
      total_amount: batch.total_amount ?? 0,
      paid_amount: batch.paid_amount ?? 0,
      external_reference: normalizeString(batch.external_reference) || null,
      external_link: normalizeString(batch.external_link) || null,
      notes: normalizeString(batch.notes) || null,
      period_start: batch.period_start || null,
      period_end: batch.period_end || null,
      submitted_at: batch.submitted_at || batch.issued_at || null,
      paid_at: batch.paid_at || null,
      item_count: (batchItems || []).filter((item) => item.batch_id === batch.id).length,
    })),
    notices,
    generated_at: new Date().toISOString(),
  };
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const toKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    startDate: toKey(start),
    endDate: toKey(end),
  };
}

function mapBillingActionError(errorCode, error = null) {
  const withDetails = (status) => ({
    status,
    body: {
      message: errorCode,
      ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {}),
    },
  });
  switch (errorCode) {
    case 'invoice_batch_not_found':
      return { status: 404, body: { message: errorCode } };
    case 'hmo_provider_not_found':
      return { status: 404, body: { message: errorCode } };
    case 'missing_hmo_provider_id':
    case 'missing_invoice_batch_id':
    case 'hmo_provider_inactive':
    case 'hmo_claim_line_not_claimable':
    case 'hmo_claim_provider_mismatch':
    case 'hmo_claim_line_already_batched_or_reversed':
    case 'hmo_authorization_claim_limit_exceeded':
    case 'hmo_claim_batch_empty':
    case 'invoice_batch_not_draft':
    case 'invoice_batch_empty':
    case 'invoice_batch_not_submitted':
    case 'paid_invoice_batch_cannot_be_cancelled':
    case 'hmo_payment_reference_required':
    case 'hmo_payment_exceeds_batch_balance':
    case 'amount_must_be_positive_integer':
    case 'invalid_task_ids':
      return withDetails(400);
    case 'missing_student_id':
    case 'invalid_manual_credit_source_type':
    case 'invalid_manual_debit_source_type':
      return { status: 400, body: { message: errorCode } };
    default:
      return { status: 400, body: { message: errorCode || 'invalid_billing_action' } };
  }
}

async function resolveProviderClaimTaskIds(client, orgId, {
  hmoProviderId,
  taskIds = [],
} = {}) {
  const normalizedProviderId = normalizeString(hmoProviderId);
  if (!normalizedProviderId) {
    throw new Error('missing_hmo_provider_id');
  }

  let taskQuery = withOrgScope(client, 'dashboard_tasks', orgId)
    .select('id, metadata')
    .eq('task_type', 'hmo_claim_submission')
    .eq('status', 'open');

  const normalizedTaskIds = Array.from(new Set((taskIds || []).map((value) => normalizeString(value)).filter(Boolean)));
  if (normalizedTaskIds.length > 0) {
    taskQuery = taskQuery.in('id', normalizedTaskIds);
  }

  const { data: openTasks, error: taskError } = await taskQuery;
  if (taskError) {
    if (taskError.code === '42P01') {
      return [];
    }
    throw taskError;
  }

  const taskRows = Array.isArray(openTasks) ? openTasks : [];
  const authorizationIds = Array.from(new Set(taskRows
    .map((task) => normalizeString(task?.metadata?.hmo_authorization_id))
    .filter(Boolean)));

  if (authorizationIds.length === 0) {
    return [];
  }

  const { data: authorizationRows, error: authorizationError } = await withOrgScope(client, 'hmo_authorizations', orgId)
    .select('id, provider_id')
    .in('id', authorizationIds);

  if (authorizationError) {
    if (authorizationError.code === '42P01') {
      return [];
    }
    throw authorizationError;
  }

  const authorizationMap = new Map((authorizationRows || []).map((row) => [row.id, row]));
  return taskRows
    .filter((task) => {
      const authorizationId = normalizeString(task?.metadata?.hmo_authorization_id);
      const authorization = authorizationMap.get(authorizationId);
      return normalizeString(authorization?.provider_id) === normalizedProviderId;
    })
    .map((task) => task.id)
    .filter(Boolean);
}

export default async function (context, req) {
  const method = String(req.method || 'GET').toUpperCase();
  const env = readEnv(context);
  const adminConfig = readSupabaseAdminConfig(env);
  if (!adminConfig.supabaseUrl || !adminConfig.serviceRoleKey) {
    return respond(context, 500, { message: 'server_misconfigured' });
  }

  const authorization = resolveBearerAuthorization(req);
  if (!authorization?.token) {
    return respond(context, 401, { message: 'missing_bearer' });
  }

  const supabase = createSupabaseAdminClient(adminConfig);
  let authResult;
  try {
    authResult = await supabase.auth.getUser(authorization.token);
  } catch (authError) {
    context.log?.error?.('billing failed to validate token', { message: authError?.message });
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }
  if (authResult.error || !authResult.data?.user?.id) {
    return respond(context, 401, { message: 'invalid_or_expired_token' });
  }

  const userId = authResult.data.user.id;
  const body = method === 'GET'
    ? {}
    : parseJsonBodyWithLimit(req, MAX_BODY_BYTES, { mode: 'observe', context, endpoint: 'billing' });
  const orgId = resolveOrgId(req, body);
  if (!orgId) {
    return respond(context, 400, { message: 'invalid_org_id' });
  }
  attachErrorTracking(context, req, supabase, { orgId, userId, metadata: { endpoint: 'billing' } });

  let role = null;
  try {
    role = await ensureMembership(supabase, orgId, userId);
  } catch (membershipError) {
    context.log?.error?.('billing failed to verify membership', { message: membershipError?.message });
    return respondTracked(context, 500, { message: 'failed_to_verify_membership' }, undefined, { error: membershipError });
  }
  if (!role) {
    return respond(context, 403, { message: 'forbidden' });
  }

  if (!isAdminOrOffice(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const billingService = new BillingLedgerService({
    tenantClient: supabase,
    orgId,
    logger: {
      info: (message, details) => context.log?.info?.(message, details),
      warn: (message, details) => context.log?.warn?.(message, details),
      error: (message, details) => context.log?.error?.(message, details),
    },
  });

  if (method === 'GET') {
    const view = normalizeString(req?.query?.view).toLowerCase();
    const studentId = normalizeString(req?.query?.student_id);
    const clientProfileId = normalizeString(req?.query?.client_profile_id || req?.query?.clientProfileId);
    const hmoProviderId = normalizeString(req?.query?.hmo_provider_id || req?.query?.hmoProviderId);
    let startDate = normalizeDateKey(req?.query?.start_date);
    let endDate = normalizeDateKey(req?.query?.end_date);

    if (view === 'hmo_claims') {
      try {
        const readModel = await buildHmoClaimsReadModel({
          client: supabase,
          orgId,
          billingService,
          startDate,
          endDate,
        });
        return respond(context, 200, readModel);
      } catch (claimsError) {
        context.log?.error?.('billing/hmo_claims failed to build read model', {
          message: claimsError?.message,
          code: claimsError?.code,
        });
        return respond(context, 200, {
          summary: {
            total_claim_tasks: 0,
            open_claim_tasks: 0,
            resolved_claim_tasks: 0,
            pending_payment_followup_batches: 0,
            expected_payment_from_submitted_batches: 0,
            payment_received_total: 0,
            active_students_with_hmo_eligibility: 0,
            unique_students: 0,
            provider_count: 0,
          },
          claims: [],
          provider_receivables: [],
          notices: ['hmo_claims_read_model_failed'],
          generated_at: new Date().toISOString(),
        });
      }
    }

    if (!studentId && !clientProfileId && !hmoProviderId && !startDate && !endDate) {
      const currentRange = currentMonthRange();
      startDate = currentRange.startDate;
      endDate = currentRange.endDate;
    }

    const snapshot = hmoProviderId
      ? await billingService.getHmoProviderReceivablesSnapshot({
        hmoProviderId,
        periodStart: startDate || null,
        periodEnd: endDate || null,
      })
      : await fetchBillingSnapshot(supabase, {
        orgId,
        studentId,
        clientProfileId,
        startDate,
        endDate,
      });

    return respond(context, 200, snapshot);
  }

  if (!isAdminRole(role)) {
    return respond(context, 403, { message: 'forbidden' });
  }

  const action = normalizeString(body?.action).toLowerCase();

  try {
    if (method === 'POST' && action === 'append_manual_credit') {
      const result = await billingService.appendManualCredit({
        accountType: normalizeString(body?.account_type),
        accountRefId: normalizeString(body?.account_ref_id),
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at),
        actorUserId: userId,
        sourceType: normalizeString(body?.source_type),
        sourceId: normalizeString(body?.source_id) || null,
        externalReference: normalizeString(body?.external_reference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'append_manual_debit') {
      const result = await billingService.appendManualDebit({
        accountType: normalizeString(body?.account_type),
        accountRefId: normalizeString(body?.account_ref_id),
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at),
        actorUserId: userId,
        sourceType: normalizeString(body?.source_type),
        sourceId: normalizeString(body?.source_id) || null,
        externalReference: normalizeString(body?.external_reference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'reverse_transaction') {
      const result = await billingService.reverseTransaction({
        transactionId: normalizeString(body?.transaction_id),
        actorUserId: userId,
        reasonCode: normalizeString(body?.reason_code) || 'manual_reversal',
        effectiveAt: normalizeString(body?.effective_at) || null,
        notes: normalizeString(body?.notes) || null,
        sourceId: normalizeString(body?.source_id) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'resync_billing_policy_participants') {
      const result = await billingService.resyncBillingPolicyParticipants({
        actorUserId: userId,
        reasonCode: 'billing_policy_updated',
      });
      return respond(context, 200, result);
    }

    if (method === 'POST' && (action === 'create_hmo_invoice_batch' || action === 'create_hmo_claim_batch')) {
      // Temporary Debugging: trace the raw billing action payload at the API boundary.
      context.log?.info?.('Temporary Debugging:billing:create_hmo_claim_batch:request', {
        orgId,
        userId,
        action,
        hmoProviderId: normalizeString(body?.hmo_provider_id),
        ledgerTransactionIds: Array.isArray(body?.ledger_transaction_ids)
          ? body.ledger_transaction_ids
          : (Array.isArray(body?.ledgerTransactionIds) ? body.ledgerTransactionIds : []),
        periodStart: normalizeString(body?.period_start) || null,
        periodEnd: normalizeString(body?.period_end) || null,
      });

      const result = await billingService.createHmoInvoiceBatch({
        hmoProviderId: normalizeString(body?.hmo_provider_id),
        periodStart: normalizeString(body?.period_start) || null,
        periodEnd: normalizeString(body?.period_end) || null,
        actorUserId: userId,
        ledgerTransactionIds: Array.isArray(body?.ledger_transaction_ids)
          ? body.ledger_transaction_ids
          : (Array.isArray(body?.ledgerTransactionIds) ? body.ledgerTransactionIds : []),
        externalReference: normalizeString(body?.external_reference) || null,
        externalLink: normalizeString(body?.external_link) || null,
        notes: normalizeString(body?.notes) || null,
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'submit_hmo_claim_batch') {
      const result = await billingService.submitHmoInvoiceBatch({
        batchId: normalizeString(body?.batch_id || body?.batchId),
        actorUserId: userId,
        externalReference: normalizeString(body?.external_reference || body?.externalReference) || null,
        externalLink: normalizeString(body?.external_link || body?.externalLink) || null,
        notes: normalizeString(body?.notes) || null,
      });
      return respond(context, 200, result);
    }

    if (method === 'POST' && action === 'cancel_hmo_claim_batch') {
      const result = await billingService.cancelHmoInvoiceBatch({
        batchId: normalizeString(body?.batch_id || body?.batchId),
        actorUserId: userId,
        reason: normalizeString(body?.reason) || null,
      });
      return respond(context, 200, result);
    }

    if (method === 'POST' && (action === 'record_hmo_invoice_batch_payment' || action === 'record_hmo_batch_payment')) {
      const result = await billingService.recordHmoInvoiceBatchPayment({
        batchId: normalizeString(body?.batch_id || body?.batchId),
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at) || null,
        actorUserId: userId,
        externalReference: normalizeString(body?.external_reference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
      return respond(context, 201, result);
    }

    if (method === 'POST' && action === 'update_hmo_provider_claim_policy') {
      const hmoProviderId = normalizeString(body?.hmo_provider_id || body?.hmoProviderId);
      if (!hmoProviderId) {
        throw new Error('missing_hmo_provider_id');
      }

      const submissionMode = normalizeString(body?.claim_submission_mode).toLowerCase();
      const paymentTiming = normalizeString(body?.claim_payment_timing).toLowerCase();
      const periodGranularity = normalizeString(body?.claim_period_granularity).toLowerCase();
      const matchingMode = normalizeString(body?.claim_payment_matching_mode).toLowerCase();
      const allowedSubmissionModes = new Set(['amount', 'unit_count', 'hybrid']);
      const allowedPaymentTimings = new Set(['after_submission', 'monthly', 'quarterly', 'custom']);
      const allowedPeriodGranularities = new Set(['monthly', 'quarterly', 'custom']);
      const allowedMatchingModes = new Set(['batch_amount', 'line_amount', 'unit_count', 'manual_reconciliation']);

      const payload = {
        claim_submission_mode: allowedSubmissionModes.has(submissionMode) ? submissionMode : 'amount',
        claim_payment_timing: allowedPaymentTimings.has(paymentTiming) ? paymentTiming : 'after_submission',
        claim_reference_required: body?.claim_reference_required === true,
        claim_period_granularity: allowedPeriodGranularities.has(periodGranularity) ? periodGranularity : 'monthly',
        claim_payment_matching_mode: allowedMatchingModes.has(matchingMode) ? matchingMode : 'batch_amount',
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await withOrgScope(supabase, 'hmo_providers', orgId)
        .update(payload)
        .eq('id', hmoProviderId)
        .select('id, name, is_active, claim_submission_mode, claim_payment_timing, claim_reference_required, claim_period_granularity, claim_payment_matching_mode')
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data?.id) {
        throw new Error('hmo_provider_not_found');
      }
      return respond(context, 200, { provider: data });
    }

    if (method === 'POST' && action === 'record_hmo_claim_payment') {
      const hmoProviderId = normalizeString(body?.hmo_provider_id || body?.hmoProviderId);
      if (!hmoProviderId) {
        throw new Error('missing_hmo_provider_id');
      }

      const transaction = await billingService.appendManualCredit({
        accountType: 'hmo_provider',
        accountRefId: hmoProviderId,
        amount: body?.amount,
        effectiveAt: normalizeString(body?.effective_at || body?.effectiveAt) || null,
        actorUserId: userId,
        sourceType: 'hmo_invoice_payment',
        sourceId: normalizeString(body?.source_id || body?.sourceId) || null,
        externalReference: normalizeString(body?.external_reference || body?.externalReference) || null,
        notes: normalizeString(body?.notes) || null,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });

      const shouldResolveOpenClaims = resolveOpenClaimTasksEnabled(body);
      let resolvedTaskCount = 0;
      let resolvedTaskIds = [];

      if (shouldResolveOpenClaims) {
        const requestedTaskIds = Array.isArray(body?.task_ids)
          ? body.task_ids
          : (Array.isArray(body?.taskIds) ? body.taskIds : []);
        const taskIds = await resolveProviderClaimTaskIds(supabase, orgId, {
          hmoProviderId,
          taskIds: requestedTaskIds,
        });

        for (const taskId of taskIds) {
          const resolved = await resolveDashboardTask(supabase, {
            orgId,
            taskId,
            resolvedBy: userId,
            metadata: {
              resolved_by_hmo_claim_payment: true,
              hmo_provider_id: hmoProviderId,
              ledger_transaction_id: transaction.transactionId,
            },
          });
          if (resolved?.id) {
            resolvedTaskIds.push(resolved.id);
          }
        }
        resolvedTaskCount = resolvedTaskIds.length;
      }

      return respond(context, 201, {
        transaction_id: transaction.transactionId,
        hmo_provider_id: hmoProviderId,
        resolved_task_count: resolvedTaskCount,
        resolved_task_ids: resolvedTaskIds,
      });
    }
  } catch (error) {
    context.log?.warn?.('billing action failed', {
      action,
      message: error?.message,
      code: error?.code,
      details: error?.details || null,
    });
    const mapped = mapBillingActionError(error?.message || error?.code, error);
    return respond(context, mapped.status, mapped.body);
  }

  return respond(context, 405, { message: 'method_not_allowed' });
}
