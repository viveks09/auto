#!/usr/bin/env node
/**
 * load-env.js
 * Shared environment loader — loads .env and validates required secrets.
 * GitHub auth is handled entirely by gh CLI — no GITHUB_TOKEN needed.
 *
 * Require at the top of every script: require('./load-env')
 */

const fs   = require('fs');
const path = require('path');

// Walk up from cwd to find .env
function findEnvFile() {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envFile = findEnvFile();
if (envFile) {
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}

// ── Required variables ────────────────────────────────────────────────────────
// GitHub auth is via gh CLI — only Jira credentials and org name are needed here
const REQUIRED = [
  'JIRA_BASE_URL',
  'JIRA_EMAIL',
  'JIRA_API_TOKEN',
  'GITHUB_ORG',
];

const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌  Missing required environment variables:');
  missing.forEach(k => console.error(`    • ${k}`));
  console.error('\n    Add them to your .env file (see .env.example)\n');
  process.exit(1);
}
