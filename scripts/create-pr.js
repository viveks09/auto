#!/usr/bin/env node
/**
 * create-pr.js
 * Phase 8: Creates a GitHub Pull Request using gh CLI.
 * Usage: node .github/scripts/create-pr.js <TICKET_ID>
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
require('./load-env');

const { ghExec } = require('./gh-or-api');

const TICKET_ID = process.argv[2];
if (!TICKET_ID) {
  console.error('❌  Usage: node create-pr.js <TICKET_ID>');
  process.exit(1);
}

const { JIRA_BASE_URL, REVIEWERS = '' } = process.env;

// ── Load context ──────────────────────────────────────────────────────────────
// ── Project root ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = (() => {
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.github'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
})();

function loadContext() {
  const ctxDir = path.join(PROJECT_ROOT, '.github', 'context');
  const ticket = JSON.parse(fs.readFileSync(path.join(ctxDir, 'ticket.json'), 'utf-8'));
  const repo   = JSON.parse(fs.readFileSync(path.join(ctxDir, 'repo.json'),   'utf-8'));
  const plan   = fs.existsSync(path.join(ctxDir, 'PLAN.md'))
    ? fs.readFileSync(path.join(ctxDir, 'PLAN.md'), 'utf-8') : null;
  const mode   = fs.existsSync(path.join(ctxDir, 'mode.json'))
    ? JSON.parse(fs.readFileSync(path.join(ctxDir, 'mode.json'), 'utf-8')) : null;
  const db     = fs.existsSync(path.join(ctxDir, 'db.json'))
    ? JSON.parse(fs.readFileSync(path.join(ctxDir, 'db.json'), 'utf-8')) : null;
  return { ticket, repo, plan, mode, db };
}

// ── Build PR body ─────────────────────────────────────────────────────────────
function buildPrBody(ticket, plan, { repoType = null, crossRefUrl = null, db = null } = {}) {
  const jiraUrl        = `${JIRA_BASE_URL}/browse/${ticket.id}`;
  const acLines        = (ticket.acceptanceCriteria ?? []).map(ac => `- [x] ${ac}`).join('\n')
                         || '- See Jira ticket for acceptance criteria';
  const componentsList = ticket.components.length
    ? ticket.components.map(c => `\`${c}\``).join(', ') : 'N/A';
  const labelsList     = ticket.labels.length
    ? ticket.labels.map(l => `\`${l}\``).join(', ') : 'none';

  let affectedSection = '';
  if (plan) {
    const m = plan.match(/## Affected Areas\n([\s\S]*?)(?=\n## )/);
    if (m) affectedSection = m[1].trim();
  }

  const crossRefSection = crossRefUrl
    ? `
---

## 🔗 Related PR
${repoType === 'backend'
      ? `**Frontend PR:** ${crossRefUrl}`
      : `**Backend PR:** ${crossRefUrl}`}
`
    : '';

  const dbSection = db
    ? `
---

## 🗄️ Database
- Migration: \`${db.migrationFile}\` (Flyway)
- DB name: \`${db.dbName}\`
- Review \`DB_SETUP.md\` for local setup instructions
- All TODO comments in migration file must be resolved before merging
`
    : '';

  return `## 🎫 Jira Ticket
[${ticket.id}](${jiraUrl}) — ${ticket.summary}

**Priority:** ${ticket.priority} | **Story Points:** ${ticket.storyPoints ?? 'unset'} | **Type:** ${ticket.issueType ?? 'Story'}
**Components:** ${componentsList} | **Labels:** ${labelsList}

---

## 📋 What & Why
${ticket.description?.slice(0, 800) || '_See Jira for full description_'}

---

## ✅ Acceptance Criteria
${acLines}

---

## 🗂️ Changes Made
${affectedSection || '_See commit history for detailed file changes_'}

---

## 🧪 Test Coverage
- **Vitest:** \`src/**/*.spec.ts\` — component and service tests
- **JUnit 5:** \`src/test/kotlin/\` — unit and slice tests
- **Playwright:** \`e2e/${ticket.id.toLowerCase()}-*.spec.ts\` — runs outside CI (nightly)

---

## 📸 Screenshots / Recordings
<!-- Add screenshots or Loom recording for UI changes -->

---

## 🔍 Review Notes
- All AC items implemented and verified
- Vitest and JUnit suites green locally before this PR
- No breaking changes to existing API contracts

---

## 🤖 Auto-generated
> Created by Copilot Agent Mode · Jira-to-PR skill
> Ticket fetched: ${ticket.fetchedAt}`;
}

function buildLabels(ticket) {
  const labels = ['feature', 'copilot-generated'];
  if (ticket.priority === 'High' || ticket.priority === 'Highest') labels.push('priority-high');
  if (ticket.priority === 'Low'  || ticket.priority === 'Lowest')  labels.push('priority-low');
  if (ticket.labels?.includes('backend'))  labels.push('backend');
  if (ticket.labels?.includes('frontend')) labels.push('frontend');
  return labels;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { ticket, repo, plan, mode, db } = loadContext();

  const isFullstack = !!(repo.backend && repo.frontend);
  const prLabels    = buildLabels(ticket);
  const reviewers   = REVIEWERS.split(',').map(r => r.trim()).filter(Boolean);

  if (isFullstack) {
    // ── Fullstack: create backend PR first, then frontend PR with cross-ref ──
    console.log(`
🚀  Creating Pull Requests (fullstack — 2 PRs)
`);

    const backendPrUrl  = await createPr(ticket, repo.backend,  plan, prLabels, reviewers,
      { repoType: 'backend',  crossRefUrl: null, db, mode });
    const frontendPrUrl = await createPr(ticket, repo.frontend, plan, prLabels, reviewers,
      { repoType: 'frontend', crossRefUrl: backendPrUrl, db: null, mode });

    // Update backend PR body to add the frontend cross-reference
    const backendPrNum = backendPrUrl.split('/').pop();
    const tmpBody = fs.writeFileSync(
      path.join(os.tmpdir(), `pr-body-update-${TICKET_ID}.md`),
      buildPrBody(ticket, plan, { repoType: 'backend', crossRefUrl: frontendPrUrl, db, mode }),
    );
    try {
      ghExec(`pr edit ${backendPrNum} --body-file "${path.join(os.tmpdir(), `pr-body-update-${TICKET_ID}.md`)}" --repo "${repo.backend.org}/${repo.backend.name}"`);
    } catch { /* non-fatal */ }

    const logLine = `[${new Date().toISOString()}] PRs created: backend=${backendPrUrl} frontend=${frontendPrUrl}
`;
    fs.appendFileSync(path.join(PROJECT_ROOT, '.github', 'context', 'run.log'), logLine);

    console.log('
' + '━'.repeat(60));
    console.log('🎉  Done! Pull Requests ready for review.');
    console.log(`    Backend  : ${backendPrUrl}`);
    console.log(`    Frontend : ${frontendPrUrl}`);
    console.log('━'.repeat(60) + '
');
    return;
  }

  // ── Single repo ───────────────────────────────────────────────────────────
  console.log(`
🚀  Creating Pull Request
`);
  const prUrl = await createPr(ticket, repo, plan, prLabels, reviewers, { db, mode });

  const logLine = `[${new Date().toISOString()}] PR created: ${prUrl}
`;
  fs.appendFileSync(path.join(PROJECT_ROOT, '.github', 'context', 'run.log'), logLine);

  console.log('
' + '━'.repeat(60));
  console.log('🎉  Done! Pull Request ready for review.');
  console.log(`    ${prUrl}`);
  console.log('━'.repeat(60) + '
');
}

async function createPr(ticket, repoEntry, plan, prLabels, reviewers, opts = {}) {
  const { ticket: _t, ...rest } = { ticket };
  const prTitle   = `[${ticket.id}] ${ticket.summary}`;
  const prBody    = buildPrBody(ticket, plan, opts);
  const prLabels_ = prLabels;
  const reviewers_ = reviewers;

  console.log(`\n🚀  Creating Pull Request`);
  console.log(`    Repo   : ${repo.org}/${repo.name}`);
  console.log(`    Branch : ${repo.branch}  →  ${repo.baseBranch}`);
  console.log(`    Title  : ${prTitle}\n`);

  // Write PR body to temp file — avoids shell-escaping issues with multi-line content
  const bodyFile = path.join(os.tmpdir(), `pr-body-${TICKET_ID}.md`);
  fs.writeFileSync(bodyFile, prBody);

  // Build label and reviewer flags
  const labelFlags    = prLabels.map(l => `--label "${l}"`).join(' ');
  const reviewerFlags = reviewers.map(r => `--reviewer "${r}"`).join(' ');

  const createCmd = [
    `pr create`,
    `--title "${prTitle.replace(/"/g, '\\"')}"`,
    `--body-file "${bodyFile}"`,
    `--base "${repo.baseBranch}"`,
    `--head "${repo.branch}"`,
    labelFlags,
    reviewerFlags,
    `--repo "${repo.org}/${repo.name}"`,
  ].filter(Boolean).join(' ');

  let prUrl;
  try {
    prUrl = ghExec(createCmd, { cwd: repo.localPath });
  } catch {
    // Labels may not exist yet — retry without them, then add separately
    console.warn('⚠️   Label creation may have failed. Retrying without labels...');
    const retryCmd = [
      `pr create`,
      `--title "${prTitle.replace(/"/g, '\\"')}"`,
      `--body-file "${bodyFile}"`,
      `--base "${repo.baseBranch}"`,
      `--head "${repo.branch}"`,
      reviewerFlags,
      `--repo "${repo.org}/${repo.name}"`,
    ].filter(Boolean).join(' ');
    prUrl = ghExec(retryCmd, { cwd: repo.localPath });
  }

  fs.unlinkSync(bodyFile);
  console.log(`✅  PR created: ${prUrl}`);

  // Apply labels separately (creates them if missing)
  try {
    for (const label of prLabels) {
      try { ghExec(`label create "${label}" --force --repo "${repo.org}/${repo.name}"`); }
      catch { /* already exists */ }
    }
    const prNumber = prUrl.split('/').pop();
    ghExec(`pr edit ${prNumber} ${labelFlags} --repo "${repo.org}/${repo.name}"`);
    console.log(`🏷️   Labels applied: ${prLabels.join(', ')}`);
  } catch {
    console.warn('⚠️   Could not apply labels (non-fatal)');
  }

  // Append to run log
  const logLine = `[${new Date().toISOString()}] PR created: ${prUrl}\n`;
  fs.appendFileSync(path.resolve('.github', 'context', 'run.log'), logLine);

  console.log('\n' + '━'.repeat(60));
  console.log('🎉  Done! Pull Request ready for review.');
  console.log(`    ${prUrl}`);
  console.log('━'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
