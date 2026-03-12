#!/usr/bin/env node
/**
 * bootstrap-frontend.js
 * Creates a new Angular frontend repo from the company starter template.
 *
 * What it does:
 *   1. Clones the company Angular starter (ANGULAR_STARTER_REPO) into a temp dir
 *   2. Strips the starter's git history — fresh slate, no starter commits
 *   3. Creates a new private repo in GITHUB_ORG named after the ticket
 *   4. Pushes the clean starter code as the first commit
 *   5. Clones the new repo into the project directory (sibling to .github/)
 *   6. Creates the feature branch
 *   7. Writes repo.json context for downstream phases
 *
 * Repo naming (priority order):
 *   1. FRONTEND_REPO_NAME env var — fixed name set per project
 *   2. Jira ticket repoName (if source looks frontend-related)
 *   3. Interactive prompt — prefilled with <ticket-id>-frontend suggestion
 *
 * Trigger: called by repo-setup.js when ticket is detected as frontend or fullstack
 *
 * Usage: node .github/scripts/bootstrap-frontend.js TICKET-ID [repo-name]
 */

const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const { execSync } = require('child_process');
require('./load-env');

const { exec, ghExec }             = require('./gh-or-api');
const { askUser, askUserConfirm }  = require('./ask-user');

const TICKET_ID     = process.argv[2];
const EXPLICIT_REPO = process.argv[3];

if (!TICKET_ID) {
  console.error('❌  Usage: node bootstrap-frontend.js <TICKET_ID> [repo-name]');
  process.exit(1);
}

const {
  GITHUB_ORG,
  ANGULAR_STARTER_REPO,            // e.g. company-org/angular-starter
  FRONTEND_REPO_NAME,              // optional fixed override
  DEFAULT_BASE_BRANCH = 'main',
} = process.env;

if (!ANGULAR_STARTER_REPO) {
  console.error('❌  ANGULAR_STARTER_REPO is not set in .env');
  console.error('    Set it to the full repo path: company-org/angular-starter');
  process.exit(1);
}

// ── Load ticket context ───────────────────────────────────────────────────────
const PROJECT_ROOT = (() => {
  let dir = path.resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, '.github'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
})();

const ticketPath = path.join(PROJECT_ROOT, '.github', 'context', 'ticket.json');
if (!fs.existsSync(ticketPath)) {
  console.error('❌  ticket.json not found — run fetch-jira.js first');
  process.exit(1);
}
const ticket = JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}

// ── Repo name resolution ──────────────────────────────────────────────────────
async function resolveRepoName() {
  // 1. Explicit CLI arg
  if (EXPLICIT_REPO) {
    console.log(`ℹ️   Repo name from CLI argument: ${EXPLICIT_REPO}`);
    return EXPLICIT_REPO;
  }

  // 2. Fixed env var override
  if (FRONTEND_REPO_NAME) {
    console.log(`ℹ️   Repo name from FRONTEND_REPO_NAME: ${FRONTEND_REPO_NAME}`);
    return FRONTEND_REPO_NAME;
  }

  // 3. Jira-extracted repo name (if it looks frontend-related)
  if (ticket.repoName && isFrontendRepoName(ticket.repoName)) {
    const confirmed = await askUserConfirm(
      `Use "${ticket.repoName}" (from Jira) as the frontend repo name?`, true,
    );
    if (confirmed) return ticket.repoName;
  }

  // 4. Interactive — suggest <ticket-id>-frontend
  const suggestion = `${TICKET_ID.toLowerCase()}-frontend`;
  console.log(`\n💡  Suggested repo name: ${suggestion}`);
  const useSuggestion = await askUserConfirm(`Use "${suggestion}"?`, true);
  if (useSuggestion) return suggestion;

  return await askUser('Frontend repo name', {
    validate:      /^[a-z0-9][a-z0-9-]{0,99}$/,
    validationMsg: 'Repo name must be lowercase alphanumeric with hyphens',
  });
}

function isFrontendRepoName(name) {
  return /frontend|ui|angular|web|portal|app|client/i.test(name);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const repoName   = await resolveRepoName();
  const branchName = `feature/${TICKET_ID}-${slugify(ticket.summary)}`;
  const repoUrl    = `https://github.com/${GITHUB_ORG}/${repoName}`;
  const localPath  = path.join(PROJECT_ROOT, repoName);

  console.log(`\n🚀  Bootstrapping Angular frontend`);
  console.log(`    Starter  : ${ANGULAR_STARTER_REPO}`);
  console.log(`    New repo : ${GITHUB_ORG}/${repoName}`);
  console.log(`    Branch   : ${branchName}\n`);

  // ── 1. Check if target repo already exists ────────────────────────────────
  let repoExists = false;
  try {
    ghExec(`repo view ${GITHUB_ORG}/${repoName} --json name`);
    repoExists = true;
  } catch { /* does not exist yet */ }

  if (repoExists) {
    console.log(`ℹ️   Repo already exists: ${repoUrl} — skipping bootstrap, cloning directly`);
    await cloneAndBranch(repoName, localPath, branchName);
    writeContext(repoName, localPath, branchName, repoUrl, 'existing-repo');
    return;
  }

  // ── 2. Clone starter into a temp directory ────────────────────────────────
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'angular-starter-'));
  console.log(`📥  Cloning starter into temp dir: ${tmpDir}`);

  try {
    ghExec(`repo clone ${ANGULAR_STARTER_REPO} "${tmpDir}" -- --depth=1`);
  } catch (e) {
    console.error(`❌  Could not clone starter repo: ${ANGULAR_STARTER_REPO}`);
    console.error(`    Check ANGULAR_STARTER_REPO is correct and you have read access`);
    console.error(`    gh auth status: run to verify your access`);
    throw e;
  }

  // ── 3. Strip git history — remove .git, re-init fresh ────────────────────
  console.log(`🧹  Stripping starter git history...`);
  fs.rmSync(path.join(tmpDir, '.git'), { recursive: true, force: true });
  execSync('git init',                               { cwd: tmpDir, stdio: 'pipe' });
  execSync(`git checkout -b ${DEFAULT_BASE_BRANCH}`, { cwd: tmpDir, stdio: 'pipe' });
  execSync('git add .',                              { cwd: tmpDir, stdio: 'pipe' });
  execSync(
    `git commit -m "chore: bootstrap from company Angular starter\n\nSource: ${ANGULAR_STARTER_REPO}\nTicket: ${TICKET_ID} — ${ticket.summary}"`,
    { cwd: tmpDir, stdio: 'pipe' },
  );
  console.log(`✅  Fresh git history initialised`);

  // ── 4. Create new repo on GitHub ──────────────────────────────────────────
  console.log(`\n📁  Creating GitHub repo: ${GITHUB_ORG}/${repoName}`);
  ghExec(
    `repo create ${GITHUB_ORG}/${repoName}` +
    ` --private` +
    ` --description "Frontend for ${TICKET_ID}: ${ticket.summary}"`,
  );
  console.log(`✅  Repo created: ${repoUrl}`);
  await new Promise(r => setTimeout(r, 2000)); // let GitHub settle

  // ── 5. Add remote and push ────────────────────────────────────────────────
  console.log(`\n📤  Pushing starter code to ${repoUrl}`);
  const remoteUrl = `https://github.com/${GITHUB_ORG}/${repoName}.git`;
  execSync(`git remote add origin ${remoteUrl}`, { cwd: tmpDir, stdio: 'pipe' });
  execSync(`git push -u origin ${DEFAULT_BASE_BRANCH}`, { cwd: tmpDir, stdio: 'inherit' });
  console.log(`✅  Starter code pushed`);

  // ── 6. Clean up temp dir ──────────────────────────────────────────────────
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ── 7. Clone the new repo into the project directory ─────────────────────
  await cloneAndBranch(repoName, localPath, branchName);
  writeContext(repoName, localPath, branchName, repoUrl, 'angular-starter');

  console.log('\n' + '━'.repeat(60));
  console.log(`✅  Frontend bootstrap complete`);
  console.log(`    Starter  : ${ANGULAR_STARTER_REPO}`);
  console.log(`    New repo : ${repoUrl}`);
  console.log(`    Local    : ${localPath}`);
  console.log(`    Branch   : ${branchName}`);
  console.log('━'.repeat(60) + '\n');
}

async function cloneAndBranch(repoName, localPath, branchName) {
  if (fs.existsSync(path.join(localPath, '.git'))) {
    console.log(`\n📥  Already cloned. Syncing...`);
    exec(`git -C "${localPath}" fetch origin`);
    exec(`git -C "${localPath}" checkout ${DEFAULT_BASE_BRANCH}`);
    exec(`git -C "${localPath}" pull origin ${DEFAULT_BASE_BRANCH}`);
  } else {
    console.log(`\n📥  Cloning new repo locally...`);
    ghExec(`repo clone ${GITHUB_ORG}/${repoName} "${localPath}"`);
  }

  // Create feature branch
  const remoteBranchExists = execSync(
    `git -C "${localPath}" ls-remote --heads origin ${branchName}`,
    { stdio: 'pipe' },
  ).toString().trim();

  if (remoteBranchExists) {
    console.log(`🌿  Branch exists — checking out: ${branchName}`);
    try {
      exec(`git -C "${localPath}" checkout ${branchName}`);
    } catch {
      exec(`git -C "${localPath}" checkout -b ${branchName} --track origin/${branchName}`);
    }
  } else {
    console.log(`🌿  Creating branch: ${branchName}`);
    exec(`git -C "${localPath}" switch -c ${branchName}`);
  }

  // Git identity
  try { execSync(`git -C "${localPath}" config user.email`, { stdio: 'pipe' }); }
  catch { exec(`git -C "${localPath}" config user.email "copilot-agent@dev.local"`); }
  try { execSync(`git -C "${localPath}" config user.name`, { stdio: 'pipe' }); }
  catch { exec(`git -C "${localPath}" config user.name "Copilot Agent"`); }
}

function writeContext(repoName, localPath, branchName, repoUrl, source) {
  const contextDir = path.join(PROJECT_ROOT, '.github', 'context');
  fs.mkdirSync(contextDir, { recursive: true });

  // Read existing repo.json if present (backend may have already written it)
  const repoJsonPath = path.join(contextDir, 'repo.json');
  let existing = {};
  if (fs.existsSync(repoJsonPath)) {
    try { existing = JSON.parse(fs.readFileSync(repoJsonPath, 'utf-8')); } catch {}
    // If existing is a single repo object (not multi), wrap it as backend
    if (existing.name && !existing.backend && !existing.frontend) {
      existing = { backend: existing };
    }
  }

  const frontendEntry = {
    org:        GITHUB_ORG,
    name:       repoName,
    localPath,
    branch:     branchName,
    baseBranch: DEFAULT_BASE_BRANCH,
    url:        repoUrl,
    source,
    stack:      'angular',
  };

  // Write multi-repo context
  const multiRepo = { ...existing, frontend: frontendEntry };
  fs.writeFileSync(repoJsonPath, JSON.stringify(multiRepo, null, 2));
  fs.writeFileSync(path.join(contextDir, 'branch.txt'), branchName);
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
