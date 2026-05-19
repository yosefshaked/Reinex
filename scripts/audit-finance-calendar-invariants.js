/* eslint-env node */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const RESOLVED_STATUSES = new Set(['attended', 'no_show', 'cancelled_student', 'cancelled_clinic']);
const NON_ATTENDANCE_STATUSES = new Set(['no_show', 'cancelled_student', 'cancelled_clinic']);

function normalize(value) {
  return String(value || '').trim();
}

function activeLessonCharges(rows = []) {
  const reversedIds = new Set((Array.isArray(rows) ? rows : [])
    .filter((row) => normalize(row?.source_type) === 'reversal' && normalize(row?.reverses_transaction_id))
    .map((row) => normalize(row.reverses_transaction_id)));

  return (Array.isArray(rows) ? rows : []).filter((row) => (
    normalize(row?.source_type) === 'lesson_charge'
    && !normalize(row?.reverses_transaction_id)
    && !reversedIds.has(normalize(row?.id))
  ));
}

function signature(row) {
  return [
    normalize(row.lesson_participant_id),
    normalize(row.ledger_account_id),
    normalize(row.student_id),
    normalize(row.client_profile_id),
    normalize(row.hmo_provider_id),
    normalize(row.hmo_authorization_id),
    normalize(row.direction),
    Number(row.amount || 0),
    normalize(row.rate_source),
  ].join(':');
}

export function auditFinanceCalendarInvariants({
  participants = [],
  ledgerTransactions = [],
  hmoNonAttendanceBillingPolicy = 'student_private_rate',
} = {}) {
  const findings = [];
  const activeRows = activeLessonCharges(ledgerTransactions);
  const participantsById = new Map((participants || []).map((participant) => [normalize(participant.id), participant]));
  const activeBySignature = new Map();

  for (const row of activeRows) {
    const rowSignature = signature(row);
    if (activeBySignature.has(rowSignature)) {
      findings.push({
        code: 'duplicate_active_lesson_charge',
        severity: 'error',
        lesson_participant_id: normalize(row.lesson_participant_id),
        ledger_transaction_ids: [activeBySignature.get(rowSignature), normalize(row.id)],
      });
    } else {
      activeBySignature.set(rowSignature, normalize(row.id));
    }

    const participant = participantsById.get(normalize(row.lesson_participant_id)) || null;
    const participantStatus = normalize(participant?.participant_status);
    if (participant && !RESOLVED_STATUSES.has(participantStatus)) {
      findings.push({
        code: 'active_charge_for_unresolved_participant',
        severity: 'error',
        lesson_participant_id: normalize(row.lesson_participant_id),
        participant_status: participantStatus,
        ledger_transaction_id: normalize(row.id),
      });
    }

    if (
      hmoNonAttendanceBillingPolicy === 'student_private_rate'
      && NON_ATTENDANCE_STATUSES.has(participantStatus)
      && normalize(row.hmo_provider_id)
    ) {
      findings.push({
        code: 'hmo_receivable_for_private_non_attendance_policy',
        severity: 'error',
        lesson_participant_id: normalize(row.lesson_participant_id),
        participant_status: participantStatus,
        ledger_transaction_id: normalize(row.id),
        hmo_provider_id: normalize(row.hmo_provider_id),
      });
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === 'error'),
    active_lesson_charge_count: activeRows.length,
    finding_count: findings.length,
    findings,
  };
}

function builtInFixture() {
  return {
    good: {
      hmoNonAttendanceBillingPolicy: 'student_private_rate',
      participants: [
        { id: 'part-private-no-show', participant_status: 'no_show' },
        { id: 'part-hmo-attended', participant_status: 'attended' },
        { id: 'part-restored', participant_status: 'scheduled' },
      ],
      ledgerTransactions: [
        {
          id: 'tx-private-no-show',
          source_type: 'lesson_charge',
          lesson_participant_id: 'part-private-no-show',
          ledger_account_id: 'acct-student',
          student_id: 'student-1',
          direction: 'DEBIT',
          amount: 18000,
          rate_source: 'service_rate',
        },
        {
          id: 'tx-hmo-attended',
          source_type: 'lesson_charge',
          lesson_participant_id: 'part-hmo-attended',
          ledger_account_id: 'acct-hmo',
          hmo_provider_id: 'hmo-1',
          hmo_authorization_id: 'auth-1',
          direction: 'DEBIT',
          amount: 4500,
          rate_source: 'hmo_authorization',
        },
        {
          id: 'tx-restored-original',
          source_type: 'lesson_charge',
          lesson_participant_id: 'part-restored',
          ledger_account_id: 'acct-student',
          student_id: 'student-2',
          direction: 'DEBIT',
          amount: 18000,
          rate_source: 'service_rate',
        },
        {
          id: 'tx-restored-reversal',
          source_type: 'reversal',
          lesson_participant_id: 'part-restored',
          ledger_account_id: 'acct-student',
          student_id: 'student-2',
          direction: 'CREDIT',
          amount: 18000,
          rate_source: 'service_rate',
          reverses_transaction_id: 'tx-restored-original',
        },
      ],
    },
    bad: {
      hmoNonAttendanceBillingPolicy: 'student_private_rate',
      participants: [
        { id: 'part-bad-hmo-no-show', participant_status: 'no_show' },
        { id: 'part-duplicate', participant_status: 'attended' },
      ],
      ledgerTransactions: [
        {
          id: 'tx-bad-hmo-no-show',
          source_type: 'lesson_charge',
          lesson_participant_id: 'part-bad-hmo-no-show',
          ledger_account_id: 'acct-hmo',
          hmo_provider_id: 'hmo-1',
          hmo_authorization_id: 'auth-1',
          direction: 'DEBIT',
          amount: 4500,
          rate_source: 'hmo_authorization',
        },
        {
          id: 'tx-duplicate-1',
          source_type: 'lesson_charge',
          lesson_participant_id: 'part-duplicate',
          ledger_account_id: 'acct-student',
          student_id: 'student-3',
          direction: 'DEBIT',
          amount: 18000,
          rate_source: 'service_rate',
        },
        {
          id: 'tx-duplicate-2',
          source_type: 'lesson_charge',
          lesson_participant_id: 'part-duplicate',
          ledger_account_id: 'acct-student',
          student_id: 'student-3',
          direction: 'DEBIT',
          amount: 18000,
          rate_source: 'service_rate',
        },
      ],
    },
  };
}

async function loadInputFixture(filePath) {
  const raw = await readFile(resolve(process.cwd(), filePath), 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const fixturePath = process.argv[2] || '';
  if (fixturePath) {
    const input = await loadInputFixture(fixturePath);
    const result = auditFinanceCalendarInvariants(input);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const fixture = builtInFixture();
  const goodResult = auditFinanceCalendarInvariants(fixture.good);
  const badResult = auditFinanceCalendarInvariants(fixture.bad);

  console.log('Finance/calendar invariant fixture audit');
  console.log(`  good fixture: ${goodResult.ok ? 'passed' : 'failed'}`);
  console.log(`  bad fixture findings: ${badResult.finding_count}`);

  if (!goodResult.ok) {
    console.error(JSON.stringify(goodResult.findings, null, 2));
    throw new Error('good_fixture_failed_finance_calendar_invariants');
  }
  if (badResult.ok || badResult.findings.length < 2) {
    console.error(JSON.stringify(badResult, null, 2));
    throw new Error('bad_fixture_did_not_trigger_finance_calendar_invariants');
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});

