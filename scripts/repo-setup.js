#!/usr/bin/env node
/**
 * repo-setup.js
 * Phase 2: Mode-aware repo setup — new app or existing feature.
 *
 * First calls detect-mode.js (Phase 2a) to ask the user if this is a new
 * application or a new feature on an existing app. Then:
 *
 *   new-app:
 *     • Detects stack (frontend / backend / fullstack)
 *     • Bootstraps frontend from Angular starter (bootstrap-frontend.js)
 *     • Creates a fresh backend repo
 *     • Calls setup-database.js (Phase 2c) to scaffold Flyway migration,
 *       application.yml, and DB_SETUP.md inside the backend repo
 *
 *   new-feature:
 *     • Detects stack
 *     • Clones EXISTING frontend and/or backend repos from GitHub
 *     • No database setup — schema already exists
 *
 * Repo placement: all repos as siblings to .github/ inside the project dir:
 *   <your-project>/
 *     .github/
 *     <backend-repo>/     ← created (new-app) or cloned (new-feature)
 *     <frontend-repo>/    ← bootstrapped (new-app) or cloned (new-feature)
 *
 * Usage: node .github/scripts/repo-setup.js <TICKET_ID> [backend-repo-name]
 */

const fs           = require('fs');
const path         = require('path');
const { execSync, spawnSync } = require('child_process');
require('./load-env');

const { exec, ghExec } = require('./gh-or-api');
const { askUser, askUserSelect, askUserConfirm } = require('./ask-user');

const TICKET_ID     = process.argv[2];
const EXPLICIT_REPO = process.argv[3];

if (!TICKET_ID) {
  console.error('❌  Usage: node repo-setup.js <TICKET_ID> [backend-repo-name]');
  process.exit(1);
}

// ── Project root ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = (() => {
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.github'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
})();

const { GITHUB_ORG, DEFAULT_BASE_BRANCH = 'main' } = process.env;

// ── Load ticket context ───────────────────────────────────────────────────────
const ticketPath = path.join(PROJECT_ROOT, '.github', 'context', 'ticket.json');
if (!fs.existsSync(ticketPath)) {
  console.error('❌  ticket.json not found — run fetch-jira.js first');
  process.exit(1);
}
const ticket = JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));

// ── Helpers ───────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}

function detectGitignoreTemplate() {
  if (fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) return 'Node';
  if (fs.existsSync(path.join(PROJECT_ROOT, 'pom.xml')))      return 'Java';
  return 'Node';
}

function configureGitIdentity(repoDir) {
  try { execSync(`git -C "${repoDir}" config user.email`, { stdio: 'pipe' }); }
  catch { exec(`git -C "${repoDir}" config user.email "copilot-agent@dev.local"`); }
  try { execSync(`git -C "${repoDir}" config user.name`, { stdio: 'pipe' }); }
  catch { exec(`git -C "${repoDir}" config user.name "Copilot Agent"`); }
}

// ── Stack detection ───────────────────────────────────────────────────────────
/**
 * Scores ticket signals to determine which repos are needed.
 *
 * Weights:
 *   Component name match  : 3  (most reliable — explicitly set by team)
 *   Label match           : 3  (explicitly set by team)
 *   Summary keyword match : 2  (written by humans, fairly reliable)
 *   Description keyword   : 1  (noisy, use as tiebreaker only)
 *   Explicit fullstack kw : +3 to both (unambiguous)
 *
 * Threshold: score >= 2 → stack detected
 * Default when nothing detected: backend-only (safer assumption)
 */
function detectStack(ticket) {
  const components  = (ticket.components  ?? []).map(c => c.toLowerCase());
  const labels      = (ticket.labels      ?? []).map(l => l.toLowerCase());
  const summary     = (ticket.summary     ?? '').toLowerCase();
  const description = (ticket.description ?? '').toLowerCase();
  const allText     = `${summary} ${description}`;

  let fe = 0;
  let be = 0;

  // Component signals
  if (components.some(c => /frontend|ui|angular|web|portal|client|app|screen|view|dashboard/.test(c))) fe += 3;
  if (components.some(c => /backend|api|service|server|microservice|data|batch|job|integration/.test(c))) be += 3;

  // Label signals
  if (labels.some(l => /frontend|ui|angular|web|client|spa/.test(l))) fe += 3;
  if (labels.some(l => /backend|api|service|java|kotlin|spring|server/.test(l))) be += 3;

  // Summary keywords
  if (/\b(screen|page|ui|form|modal|component|view|dashboard|widget|layout|button|table|panel|dialog)\b/.test(summary)) fe += 2;
  if (/\b(api|endpoint|service|rest|controller|repository|migration|batch|job|queue|cache|dto|entity)\b/.test(summary)) be += 2;

  // Description keywords (lower weight — noisy)
  if (/\b(angular|typescript|html|css|scss|template|binding|observable|rxjs|router)\b/.test(allText)) fe += 1;
  if (/\b(spring|kotlin|java|maven|jooq|postgres|postgresql|sql|kafka|redis)\b/.test(allText)) be += 1;

  // Explicit fullstack keywords → both get a boost
  if (/\b(fullstack|full.stack|end.to.end|full feature|both frontend and backend)\b/.test(allText)) {
    fe += 3;
    be += 3;
  }

  const needsFrontend = fe >= 2;
  const needsBackend  = be >= 2;

  console.log(`\n🔍  Stack detection for: ${ticket.id}`);
  console.log(`    Frontend score : ${fe}  ${needsFrontend ? '✅ detected' : '— not detected'}`);
  console.log(`    Backend score  : ${be}  ${needsBackend  ? '✅ detected' : '— not detected'}`);

  if (!needsFrontend && !needsBackend) {
    console.log(`    No clear signal — defaulting to backend-only`);
    return { needsFrontend: false, needsBackend: true };
  }

  return { needsFrontend, needsBackend };
}

// ── Resolve backend repo name ─────────────────────────────────────────────────
async function resolveBackendRepoName() {
  if (EXPLICIT_REPO) {
    console.log(`ℹ️   Backend repo from CLI: ${EXPLICIT_REPO}`);
    return EXPLICIT_REPO;
  }

  if (ticket.repoName) {
    const source    = ticket.repoNameSource ?? 'jira';
    const isCertain = !source.includes('uncertain');
    if (isCertain) {
      console.log(`ℹ️   Backend repo from Jira (${source}): ${ticket.repoName}`);
      return ticket.repoName;
    }
    console.log(`\n⚠️   Backend repo inferred from Jira (${source}): "${ticket.repoName}"`);
    const ok = await askUserConfirm(`Use "${ticket.repoName}" as the backend repo name?`, true);
    if (ok) return ticket.repoName;
  }

  console.log('\n📋  Ticket details:');
  console.log(`    ID         : ${ticket.id}`);
  console.log(`    Summary    : ${ticket.summary}`);
  console.log(`    Components : ${ticket.components.join(', ') || 'none'}`);
  console.log(`    Labels     : ${ticket.labels.join(', ') || 'none'}`);
  console.log();

  const backendComponents = ticket.components
    .filter(c => /backend|api|service|server/i.test(c))
    .map(c => c.toLowerCase().replace(/[^a-z0-9-]/g, '-'));

  const allComponents = ticket.components
    .map(c => c.toLowerCase().replace(/[^a-z0-9-]/g, '-'));

  const choices = [
    ...(backendComponents.length ? backendComponents : allComponents),
    'Enter a different name...',
  ];

  if (choices.length > 1) {
    const selected = await askUserSelect('Select backend repo name:', choices, 0);
    if (selected !== 'Enter a different name...') return selected;
  }

  return await askUser('Backend repository name', {
    validate:      /^[a-z0-9][a-z0-9-]{0,99}$/,
    validationMsg: 'Repo name must be lowercase alphanumeric with hyphens',
  });
}

// ── Backend repo setup ────────────────────────────────────────────────────────
async function setupBackendRepo(repoName) {
  const branchName = `feature/${TICKET_ID}-${slugify(ticket.summary)}`;
  const repoUrl    = `https://github.com/${GITHUB_ORG}/${repoName}`;
  const localPath  = path.join(PROJECT_ROOT, repoName);

  console.log(`\n🔧  Backend Repo Setup`);
  console.log(`    Org/Repo : ${GITHUB_ORG}/${repoName}`);
  console.log(`    Branch   : ${branchName}\n`);

  let repoExists = false;
  try { ghExec(`repo view ${GITHUB_ORG}/${repoName} --json name`); repoExists = true; }
  catch { /* does not exist */ }

  if (!repoExists) {
    console.log(`📁  Creating: ${GITHUB_ORG}/${repoName}`);
    ghExec(
      `repo create ${GITHUB_ORG}/${repoName}` +
      ` --private` +
      ` --description "Backend for ${TICKET_ID}: ${ticket.summary}"` +
      ` --gitignore ${detectGitignoreTemplate()}` +
      ` --add-readme`,
    );
    console.log(`✅  Repo created: ${repoUrl}`);
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log(`✅  Repo exists: ${repoUrl}`);
  }

  if (fs.existsSync(path.join(localPath, '.git'))) {
    console.log(`\n📥  Syncing existing clone...`);
    exec(`git -C "${localPath}" fetch origin`);
    exec(`git -C "${localPath}" checkout ${DEFAULT_BASE_BRANCH}`);
    exec(`git -C "${localPath}" pull origin ${DEFAULT_BASE_BRANCH}`);
  } else {
    console.log(`\n📥  Cloning...`);
    ghExec(`repo clone ${GITHUB_ORG}/${repoName} "${localPath}"`);
  }

  const remoteBranchExists = execSync(
    `git -C "${localPath}" ls-remote --heads origin ${branchName}`,
    { stdio: 'pipe' },
  ).toString().trim();

  if (remoteBranchExists) {
    try { exec(`git -C "${localPath}" checkout ${branchName}`); }
    catch { exec(`git -C "${localPath}" checkout -b ${branchName} --track origin/${branchName}`); }
  } else {
    exec(`git -C "${localPath}" switch -c ${branchName}`);
  }

  configureGitIdentity(localPath);
  console.log(`\n✅  Backend ready: ${localPath}`);

  return { repoName, localPath, branchName, repoUrl, stack: 'spring-boot-kotlin' };
}

// ── Write unified repo context ────────────────────────────────────────────────
function writeContext({ backend, frontend }) {
  const contextDir = path.join(PROJECT_ROOT, '.github', 'context');
  fs.mkdirSync(contextDir, { recursive: true });

  let repoJson;
  if (backend && frontend) {
    // Fullstack — nested structure; create-pr.js will create one PR per repo
    repoJson = {
      backend:  { org: GITHUB_ORG, baseBranch: DEFAULT_BASE_BRANCH, ...backend  },
      frontend: { org: GITHUB_ORG, baseBranch: DEFAULT_BASE_BRANCH, ...frontend },
    };
  } else {
    // Single repo — flat structure (backward compatible with create-pr.js)
    const single = backend ?? frontend;
    repoJson = { org: GITHUB_ORG, baseBranch: DEFAULT_BASE_BRANCH, ...single };
  }

  fs.writeFileSync(path.join(contextDir, 'repo.json'), JSON.stringify(repoJson, null, 2));
  const branchName = (backend ?? frontend).branchName ?? (backend ?? frontend).branch;
  fs.writeFileSync(path.join(contextDir, 'branch.txt'), branchName);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── Phase 2a: Detect mode (new-app vs new-feature) ───────────────────────
  const detectModeScript = path.join(__dirname, 'detect-mode.js');
  const modeResult = spawnSync(
    process.execPath,
    [detectModeScript, TICKET_ID],
    { stdio: 'inherit', env: process.env },
  );
  if (modeResult.status !== 0) {
    console.error('❌  Mode detection failed');
    process.exit(modeResult.status ?? 1);
  }

  // Load the mode written by detect-mode.js
  const modePath = path.join(PROJECT_ROOT, '.github', 'context', 'mode.json');
  const mode = JSON.parse(fs.readFileSync(modePath, 'utf-8'));
  const isNewApp = mode.mode === 'new-app';

  console.log(`
ℹ️   Mode: ${isNewApp ? '🆕 New application' : '➕ New feature on existing app'}`);

  // ── Phase 2b: Detect stack ────────────────────────────────────────────────
  const { needsFrontend, needsBackend } = detectStack(ticket);

  const stackLabel = needsFrontend && needsBackend
    ? 'fullstack (frontend + backend)'
    : needsFrontend ? 'frontend only'
    : 'backend only';

  console.log(`\n📦  Detected stack: ${stackLabel}`);
  const confirmed = await askUserConfirm(`Proceed with ${stackLabel}?`, true);

  let doFrontend = needsFrontend;
  let doBackend  = needsBackend;

  if (!confirmed) {
    const choice = await askUserSelect('Select the correct stack:', [
      'backend only',
      'frontend only',
      'fullstack (frontend + backend)',
    ], 0);
    doFrontend = choice !== 'backend only';
    doBackend  = choice !== 'frontend only';
  }

  const results = { backend: null, frontend: null };

  // ── 1. Backend first (if needed) ─────────────────────────────────────────
  if (doBackend) {
    const backendRepoName = await resolveBackendRepoName();
    results.backend = await setupBackendRepo(backendRepoName);
  }

  // ── 2. Frontend bootstrap (if needed) ────────────────────────────────────
  if (doFrontend) {
    console.log(`\n🅰️   Bootstrapping Angular frontend...`);
    const bootstrapScript = path.join(__dirname, 'bootstrap-frontend.js');
    const result = spawnSync(
      process.execPath,
      [bootstrapScript, TICKET_ID],
      { stdio: 'inherit', env: process.env },
    );
    if (result.status !== 0) {
      console.error('❌  Frontend bootstrap failed — see output above');
      process.exit(result.status ?? 1);
    }

    // Read frontend entry written by bootstrap-frontend.js
    const repoJson = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'context', 'repo.json'), 'utf-8'),
    );
    results.frontend = repoJson.frontend ?? repoJson;
  }

  // ── 3. Database setup (new-app + backend only) ──────────────────────────
  if (isNewApp && (doBackend || results.backend)) {
    console.log(`
🗄️   Running database setup...`);
    const dbScript = path.join(__dirname, 'setup-database.js');
    const dbResult = spawnSync(
      process.execPath,
      [dbScript, TICKET_ID],
      { stdio: 'inherit', env: process.env },
    );
    if (dbResult.status !== 0) {
      console.error('❌  Database setup failed — see output above');
      process.exit(dbResult.status ?? 1);
    }
  }

  // ── 4. Write unified context ──────────────────────────────────────────────
  writeContext(results);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log(`✅  Phase 2 complete`);
  if (results.backend)  {
    console.log(`    Backend  : ${results.backend.localPath}`);
    console.log(`               Branch: ${results.backend.branchName}`);
  }
  if (results.frontend) {
    console.log(`    Frontend : ${results.frontend.localPath}`);
    console.log(`               Branch: ${results.frontend.branch ?? results.frontend.branchName}`);
  }
  console.log('━'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
