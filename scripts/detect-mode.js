#!/usr/bin/env node
/**
 * detect-mode.js
 * Phase 2a: Asks the user whether this ticket is a new application or a new
 * feature on an existing application. Writes the result to
 * .github/context/mode.json so all downstream phases can branch accordingly.
 *
 * mode.json shape:
 * {
 *   "mode": "new-app" | "new-feature",
 *   "appName": "my-app",          // new-app only — used as base name for repos
 *   "detectedAt": "<iso-date>"
 * }
 *
 * Usage: node .github/scripts/detect-mode.js <TICKET_ID>
 */

const fs   = require('fs');
const path = require('path');
require('./load-env');

const { askUser, askUserSelect, askUserConfirm } = require('./ask-user');

const TICKET_ID = process.argv[2];
if (!TICKET_ID) {
  console.error('❌  Usage: node detect-mode.js <TICKET_ID>');
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

// ── Load ticket ───────────────────────────────────────────────────────────────
const ticketPath = path.join(PROJECT_ROOT, '.github', 'context', 'ticket.json');
if (!fs.existsSync(ticketPath)) {
  console.error('❌  ticket.json not found — run fetch-jira.js first');
  process.exit(1);
}
const ticket = JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));

// ── Weak signal detection — help pre-select the prompt default ────────────────
function inferMode(ticket) {
  const text = [
    ticket.summary ?? '',
    ticket.description ?? '',
    ...(ticket.labels ?? []),
    ...(ticket.components ?? []),
  ].join(' ').toLowerCase();

  const newAppSignals  = /\bnew (app|application|system|platform|portal|product|service)\b|from scratch|greenfield|bootstrap|initialise|initialize|set.?up new/;
  const featureSignals = /\bnew feature|add feature|implement|enhance|extend|update|fix|refactor|improve/;

  if (newAppSignals.test(text))  return 'new-app';
  if (featureSignals.test(text)) return 'new-feature';
  return null; // no clear signal
}

async function main() {
  const inferred = inferMode(ticket);

  console.log(`\n🎯  Mode Detection — ${ticket.id}: ${ticket.summary}`);
  if (inferred) {
    console.log(`    Inferred from ticket: ${inferred === 'new-app' ? '🆕 New application' : '➕ New feature'}`);
  } else {
    console.log(`    No clear signal from ticket — please confirm below`);
  }
  console.log();

  // Map inferred to choice index
  const defaultIndex = inferred === 'new-app' ? 0 : 1;

  const choice = await askUserSelect(
    'Is this ticket for a brand new application or a new feature on an existing app?',
    [
      '🆕  New application from scratch  — new repos, DB setup, full bootstrap',
      '➕  New feature on existing app   — clone existing repos, implement on top',
    ],
    defaultIndex,
  );

  const mode = choice.startsWith('🆕') ? 'new-app' : 'new-feature';

  let appName = null;
  if (mode === 'new-app') {
    // Suggest an app name derived from the ticket summary
    const suggested = ticket.summary
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-');

    console.log(`\n💡  Suggested app name: ${suggested}`);
    const useSuggestion = await askUserConfirm(`Use "${suggested}" as the app name?`, true);
    if (useSuggestion) {
      appName = suggested;
    } else {
      appName = await askUser('App name (used as base for repo names and config)', {
        validate:      /^[a-z0-9][a-z0-9-]{0,60}$/,
        validationMsg: 'App name must be lowercase alphanumeric with hyphens',
      });
    }
  }

  // ── Write mode.json ───────────────────────────────────────────────────────
  const contextDir = path.join(PROJECT_ROOT, '.github', 'context');
  fs.mkdirSync(contextDir, { recursive: true });

  const modeData = {
    mode,
    appName,
    detectedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(contextDir, 'mode.json'),
    JSON.stringify(modeData, null, 2),
  );

  console.log('\n' + '━'.repeat(60));
  console.log(`✅  Mode: ${mode === 'new-app' ? '🆕 New application' : '➕ New feature'}`);
  if (appName) console.log(`    App name : ${appName}`);
  console.log('━'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
