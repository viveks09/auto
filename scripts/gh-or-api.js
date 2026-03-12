/**
 * gh.js
 * Shared gh CLI wrapper — verifies gh is available and authenticated,
 * then exports helpers used by repo-setup.js and create-pr.js.
 *
 * Usage:
 *   const { exec, ghExec } = require('./gh-or-api');
 */

const { execSync } = require('child_process');

// ── Verify gh CLI is available and authenticated ──────────────────────────────
function verifyGhCli() {
  // 1. Is `gh` on PATH?
  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    console.error('❌  gh CLI not found on PATH.');
    console.error('    Install from https://cli.github.com and run: gh auth login');
    process.exit(1);
  }

  // 2. Is `gh` authenticated?
  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch (e) {
    console.error('❌  gh CLI is not authenticated.');
    console.error('    Run: gh auth login');
    process.exit(1);
  }

  console.log('✅  gh CLI ready');
}

verifyGhCli();

/**
 * Run a shell command, logging it first.
 * @param {string} cmd
 * @param {{ silent?: boolean, cwd?: string }} opts
 */
function exec(cmd, opts = {}) {
  console.log(`    $ ${cmd}`);
  return execSync(cmd, {
    stdio: opts.silent ? 'pipe' : 'inherit',
    cwd:   opts.cwd,
    env:   { ...process.env },
  });
}

/**
 * Run a gh CLI command and return stdout as a trimmed string.
 * @param {string} args  — everything after `gh`
 * @param {{ cwd?: string }} opts
 */
function ghExec(args, opts = {}) {
  console.log(`    $ gh ${args}`);
  return execSync(`gh ${args}`, {
    stdio: 'pipe',
    cwd:   opts.cwd,
    env:   { ...process.env },
  }).toString().trim();
}

module.exports = { exec, ghExec };
