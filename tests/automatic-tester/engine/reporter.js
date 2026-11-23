/**
 * reporter.js
 *
 * Generates a self-contained HTML report from a test run.
 * Screenshots are referenced via relative paths (they live next to the HTML).
 *
 * Output: <reportDir>/report.html
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// ─── Utilities ────────────────────────────────────────────────────────────

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadge(status) {
  const map = {
    pass: `<span class="badge pass">PASS</span>`,
    fail: `<span class="badge fail">FAIL</span>`,
    skip: `<span class="badge skip">SKIP</span>`,
  };
  return map[status] || `<span class="badge">${escHtml(status)}</span>`;
}

// ─── HTML sections ────────────────────────────────────────────────────────

function renderValidationSection(validationResults) {
  if (!validationResults?.length) return '';

  const rows = validationResults.map(({ script, valid, issues, warnings }) => {
    const issueRows = issues.map(i =>
      `<li class="issue">✗ ${escHtml(i)}</li>`
    ).join('');
    const warnRows = warnings.map(w =>
      `<li class="warn">⚠ ${escHtml(w)}</li>`
    ).join('');
    const detail = (issueRows || warnRows)
      ? `<ul class="validation-detail">${issueRows}${warnRows}</ul>`
      : '';

    return `
      <tr>
        <td>${statusBadge(valid ? 'pass' : 'fail')}</td>
        <td>${escHtml(script.name)}</td>
        <td><code>${escHtml(script.id)}</code></td>
        <td>${detail}</td>
      </tr>`;
  }).join('');

  return `
    <section>
      <h2>Script Validation</h2>
      <table>
        <thead><tr><th>Status</th><th>Script</th><th>ID</th><th>Details</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderStepRow(step) {
  const errHtml = step.error
    ? `<pre class="error-detail">${escHtml(step.error)}</pre>`
    : '';

  const screenshotHtml = step.screenshot
    ? `<img src="${escHtml(step.screenshot)}" alt="Screenshot" class="thumb" onclick="openLightbox(this.src)" />`
    : '';

  return `
    <tr class="step-row step-${step.status}">
      <td>${statusBadge(step.status)}</td>
      <td class="step-desc">
        <code class="action-tag">${escHtml(step.action)}</code>
        ${escHtml(step.description !== step.action ? step.description : '')}
        ${errHtml}
      </td>
      <td class="duration">${fmtMs(step.duration)}</td>
      <td>${screenshotHtml}</td>
    </tr>`;
}

function renderWorkflow(wf) {
  const stepRows = wf.steps.map(renderStepRow).join('');
  const passCount = wf.steps.filter(s => s.status === 'pass').length;
  const failCount = wf.steps.filter(s => s.status === 'fail').length;
  const skipCount = wf.steps.filter(s => s.status === 'skip').length;

  return `
    <div class="workflow workflow-${wf.status}">
      <details ${wf.status === 'fail' ? 'open' : ''}>
        <summary class="workflow-summary">
          ${statusBadge(wf.status)}
          <span class="workflow-name">${escHtml(wf.name)}</span>
          <span class="workflow-meta">
            ${fmtMs(wf.duration)} &nbsp;·&nbsp;
            <span class="pass-c">${passCount} passed</span>,
            <span class="fail-c">${failCount} failed</span>,
            <span class="skip-c">${skipCount} skipped</span>
          </span>
        </summary>
        ${wf.description ? `<p class="workflow-desc">${escHtml(wf.description)}</p>` : ''}
        <table class="steps-table">
          <thead>
            <tr><th>Status</th><th>Step</th><th>Time</th><th>Screenshot</th></tr>
          </thead>
          <tbody>${stepRows}</tbody>
        </table>
      </details>
    </div>`;
}

function renderScript(sr) {
  const workflowsHtml = sr.workflows
    .map((wf, i) => renderWorkflow(wf, sr.script.id, i))
    .join('');

  const passWf = sr.workflows.filter(w => w.status === 'pass').length;

  return `
    <section class="script-section">
      <h3 class="script-title">
        ${escHtml(sr.script.name)}
        <small>${escHtml(sr.script.id)}</small>
        <span class="script-meta">${fmtMs(sr.duration)} &nbsp;·&nbsp; ${passWf}/${sr.workflows.length} workflows passed</span>
      </h3>
      ${workflowsHtml}
    </section>`;
}

// ─── Summary bar ─────────────────────────────────────────────────────────

function renderSummary(runResults, timestamp) {
  let passWf = 0, failWf = 0;
  let totalSteps = 0, passSteps = 0;

  for (const sr of runResults) {
    for (const wf of sr.workflows) {
      if (wf.status === 'pass') passWf++; else failWf++;
      for (const s of wf.steps) {
        totalSteps++;
        if (s.status === 'pass') passSteps++;
      }
    }
  }

  const overallStatus = failWf === 0 ? 'pass' : 'fail';

  return `
    <section class="summary summary-${overallStatus}">
      <div class="summary-title">
        ${statusBadge(overallStatus)}
        <span>Run at ${escHtml(new Date(timestamp).toLocaleString())}</span>
      </div>
      <div class="summary-stats">
        <div class="stat">
          <strong>${passWf}</strong><span>workflows passed</span>
        </div>
        <div class="stat fail-stat">
          <strong>${failWf}</strong><span>workflows failed</span>
        </div>
        <div class="stat">
          <strong>${passSteps}/${totalSteps}</strong><span>steps passed</span>
        </div>
      </div>
    </section>`;
}

// ─── CSS ──────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #1e293b;
    background: #f8fafc;
    margin: 0;
    padding: 0;
  }
  header {
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: white;
    padding: 20px 32px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  header h1 { margin: 0; font-size: 20px; font-weight: 700; }
  header p  { margin: 0; font-size: 13px; opacity: 0.8; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 20px; }
  section { margin-bottom: 28px; }
  h2 { font-size: 16px; font-weight: 600; color: #475569; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .05em; }

  /* Summary */
  .summary {
    border-radius: 12px;
    padding: 20px 24px;
    border: 1px solid;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .summary-pass { background: #f0fdf4; border-color: #bbf7d0; }
  .summary-fail { background: #fff1f2; border-color: #fecdd3; }
  .summary-title { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }
  .summary-stats { display: flex; gap: 24px; }
  .stat { display: flex; flex-direction: column; align-items: center; }
  .stat strong { font-size: 22px; font-weight: 700; }
  .stat span   { font-size: 12px; color: #64748b; }
  .fail-stat strong { color: #e11d48; }

  /* Badge */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .04em;
  }
  .badge.pass { background: #dcfce7; color: #16a34a; }
  .badge.fail { background: #fee2e2; color: #dc2626; }
  .badge.skip { background: #f1f5f9; color: #94a3b8; }

  /* Validation table */
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
  th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-size: 12px; color: #475569; font-weight: 600; text-transform: uppercase; }
  td { padding: 8px 12px; border-top: 1px solid #f1f5f9; vertical-align: top; }
  .validation-detail { margin: 4px 0 0; padding: 0; list-style: none; }
  .validation-detail li { font-size: 12px; padding: 2px 0; }
  .issue { color: #dc2626; }
  .warn  { color: #d97706; }

  /* Script sections */
  .script-section { background: white; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.06); margin-bottom: 20px; }
  .script-title {
    font-size: 15px;
    font-weight: 600;
    padding: 14px 18px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }
  .script-title small { font-size: 12px; font-weight: 400; color: #94a3b8; font-family: monospace; }
  .script-meta { font-size: 12px; font-weight: 400; color: #94a3b8; margin-left: auto; }

  /* Workflow */
  .workflow { border-bottom: 1px solid #f1f5f9; }
  .workflow:last-child { border-bottom: none; }
  .workflow-summary {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    user-select: none;
    list-style: none;
  }
  .workflow-summary::-webkit-details-marker { display: none; }
  .workflow-summary::before { content: '▶'; font-size: 10px; color: #94a3b8; transition: transform .15s; }
  details[open] .workflow-summary::before { transform: rotate(90deg); }
  .workflow-name { font-weight: 500; }
  .workflow-meta { font-size: 12px; color: #94a3b8; margin-left: auto; }
  .pass-c { color: #16a34a; }
  .fail-c { color: #dc2626; }
  .skip-c { color: #94a3b8; }
  .workflow-desc { font-size: 12px; color: #64748b; margin: 0 0 8px 18px; }

  /* Steps table */
  .steps-table { width: 100%; border-collapse: collapse; }
  .steps-table th { font-size: 11px; background: #f8fafc; padding: 6px 12px; }
  .step-row td { padding: 6px 12px; border-top: 1px solid #f8fafc; vertical-align: top; font-size: 13px; }
  .step-fail td { background: #fff8f8; }
  .step-skip td { opacity: 0.5; }
  .step-desc { max-width: 550px; }
  .action-tag {
    display: inline-block;
    background: #f1f5f9;
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 11px;
    color: #3b82f6;
    margin-right: 4px;
    font-family: monospace;
  }
  .error-detail {
    background: #fff1f2;
    border: 1px solid #fecdd3;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    color: #be123c;
    margin: 4px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 500px;
  }
  .duration { color: #94a3b8; font-size: 12px; white-space: nowrap; }
  .thumb { max-width: 80px; max-height: 60px; border-radius: 4px; border: 1px solid #e2e8f0; cursor: zoom-in; }
  .lightbox {
    display: none;
    position: fixed; inset: 0;
    background: rgba(0,0,0,.85);
    z-index: 1000;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 100%; max-height: 100%; border-radius: 6px; box-shadow: 0 8px 40px rgba(0,0,0,.6); }
  .lightbox-close {
    position: absolute; top: 16px; right: 20px;
    color: white; font-size: 28px; font-weight: 300; cursor: pointer; line-height: 1;
    background: none; border: none; padding: 4px 8px;
  }
  .lightbox-close:hover { opacity: .7; }

  code { font-family: 'SFMono-Regular', Consolas, monospace; }
`;

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Generate an HTML report and write it to <reportDir>/report.html.
 *
 * @param {Array}  runResults        - Array of script run results
 * @param {Array}  validationResults - Array of validation results
 * @param {string} reportDir         - Directory to write the report into
 * @param {string} timestamp         - ISO timestamp string for the run
 * @returns {string} Absolute path to the generated HTML file
 */
export function generateReport(runResults, validationResults, reportDir, timestamp) {
  const summaryHtml    = renderSummary(runResults, timestamp);
  const validationHtml = renderValidationSection(validationResults);
  const scriptsHtml    = runResults.map(renderScript).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reinex Automatic Test Report — ${escHtml(timestamp)}</title>
  <style>${CSS}</style>
</head>
<body>
  <header>
    <div>
      <h1>Reinex Automatic Test Report</h1>
      <p>Generated ${new Date(timestamp).toUTCString()}</p>
    </div>
  </header>
  <main>
    ${summaryHtml}
    ${validationHtml}
    <section>
      <h2>Results</h2>
      ${scriptsHtml || '<p>No scripts were run.</p>'}
    </section>
  </main>
  <div class="lightbox" id="lightbox" onclick="closeLightbox(event)">
    <button class="lightbox-close" onclick="closeLightbox()">&#x2715;</button>
    <img id="lightbox-img" src="" alt="Screenshot" />
  </div>
  <script>
    function openLightbox(src) {
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox').classList.add('open');
    }
    function closeLightbox(e) {
      if (!e || e.target !== document.getElementById('lightbox-img')) {
        document.getElementById('lightbox').classList.remove('open');
      }
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeLightbox();
    });
  </script>
</body>
</html>`;

  const reportPath = join(reportDir, 'report.html');
  writeFileSync(reportPath, html, 'utf8');
  return reportPath;
}
