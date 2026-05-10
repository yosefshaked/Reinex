const STORAGE_KEY_PREFIX = 'reinex_calendar_generation_review_v1';

function getStorage() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.sessionStorage;
}

function normalizeIssueMessage(entry) {
  if (typeof entry?.message === 'string' && entry.message.trim()) {
    return entry.message.trim();
  }

  if (Array.isArray(entry?.issues) && entry.issues.length > 0) {
    const issueMessages = entry.issues
      .map((issue) => {
        if (typeof issue?.message === 'string' && issue.message.trim()) {
          return issue.message.trim();
        }
        if (typeof issue?.type === 'string' && issue.type.trim()) {
          return issue.type.trim();
        }
        return '';
      })
      .filter(Boolean);

    if (issueMessages.length > 0) {
      return issueMessages.join(' | ');
    }
  }

  if (typeof entry?.type === 'string' && entry.type.trim()) {
    return entry.type.trim();
  }

  return 'generation_issue';
}

function normalizeRepairTargets(entry) {
  if (Array.isArray(entry?.repair_targets) && entry.repair_targets.length > 0) {
    return entry.repair_targets;
  }

  const targets = [];
  if (entry?.student_id) {
    targets.push({
      type: 'student_profile',
      label: 'student_profile',
      student_id: entry.student_id,
      path: `/students/${entry.student_id}/overview`,
    });
  }
  if (entry?.template_id) {
    targets.push({
      type: 'template_edit',
      label: 'template_edit',
      template_id: entry.template_id,
      path: `/calendar/templates?edit_template_id=${entry.template_id}`,
    });
  }
  return targets;
}

function normalizeIssue(entry, source) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const retryItem = entry?.retry_item?.template_id && entry?.retry_item?.target_date
    ? {
      template_id: entry.retry_item.template_id,
      target_date: entry.retry_item.target_date,
    }
    : null;

  return {
    source,
    issue_type: entry.issue_type || entry.type || entry?.issues?.[0]?.type || 'generation_issue',
    issue_types: Array.isArray(entry.issue_types)
      ? entry.issue_types.filter(Boolean)
      : Array.isArray(entry.issues)
        ? entry.issues.map((issue) => issue?.type).filter(Boolean)
        : [entry.type || entry.issue_type || 'generation_issue'],
    message: normalizeIssueMessage(entry),
    template_id: entry.template_id || null,
    student_id: entry.student_id || null,
    student_name: entry.student_name || '',
    client_profile_id: entry.client_profile_id || null,
    service_name: entry.service_name || '',
    datetime_start: entry.datetime_start || null,
    target_date: entry.target_date || null,
    time_of_day: entry.time_of_day || null,
    retry_item: retryItem,
    repair_targets: normalizeRepairTargets(entry),
  };
}

export function getActionableGenerationIssues(result) {
  if (Array.isArray(result?.actionable_issues)) {
    return result.actionable_issues
      .map((entry) => normalizeIssue(entry, entry?.source || 'generation_issue'))
      .filter(Boolean);
  }

  const conflicts = Array.isArray(result?.conflicts)
    ? result.conflicts.map((entry) => normalizeIssue(entry, 'preview_conflict')).filter(Boolean)
    : [];
  const applyErrors = Array.isArray(result?.applied?.errors)
    ? result.applied.errors.map((entry) => normalizeIssue(entry, 'apply_error')).filter(Boolean)
    : [];

  return [...conflicts, ...applyErrors];
}

export function getRetryableGenerationFailures(result) {
  const issueEntries = Array.isArray(result?.retryable_failures) && result.retryable_failures.length > 0
    ? result.retryable_failures.map((entry) => normalizeIssue(entry, entry?.source || 'apply_error'))
    : getActionableGenerationIssues(result);

  const seen = new Set();
  const retryableEntries = [];

  for (const entry of issueEntries) {
    if (!entry?.retry_item?.template_id || !entry?.retry_item?.target_date) {
      continue;
    }

    const key = `${entry.retry_item.template_id}|${entry.retry_item.target_date}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    retryableEntries.push(entry);
  }

  return retryableEntries;
}

export function buildGenerationReview({
  orgId,
  startDate,
  endDate,
  requestMode,
  result,
  source,
}) {
  const issues = getActionableGenerationIssues(result);
  const retryableFailures = getRetryableGenerationFailures(result);

  return {
    version: 1,
    orgId: orgId || null,
    generationRunId: result?.generation_run_id || null,
    savedAt: new Date().toISOString(),
    source: source || 'preview',
    scope: {
      startDate: startDate || result?.start_date || '',
      endDate: endDate || result?.end_date || '',
      requestMode: requestMode || result?.request_mode || 'full_range',
      retryItems: retryableFailures.map((entry) => entry.retry_item).filter(Boolean),
    },
    summary: result?.summary || {},
    issues,
    retryableFailures,
    result: result || null,
  };
}

export function readGenerationReview(orgId) {
  const storage = getStorage();
  if (!storage || !orgId) {
    return null;
  }

  try {
    const raw = storage.getItem(`${STORAGE_KEY_PREFIX}:${orgId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) {
      storage.removeItem(`${STORAGE_KEY_PREFIX}:${orgId}`);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(`${STORAGE_KEY_PREFIX}:${orgId}`);
    return null;
  }
}

export function writeGenerationReview(orgId, review) {
  const storage = getStorage();
  if (!storage || !orgId || !review) {
    return;
  }

  storage.setItem(`${STORAGE_KEY_PREFIX}:${orgId}`, JSON.stringify(review));
}

export function clearGenerationReview(orgId) {
  const storage = getStorage();
  if (!storage || !orgId) {
    return;
  }

  storage.removeItem(`${STORAGE_KEY_PREFIX}:${orgId}`);
}
