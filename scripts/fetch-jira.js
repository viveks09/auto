#!/usr/bin/env node
/**
 * fetch-jira.js
 * Phase 1: Fetches a Jira ticket and writes structured context to .github/context/ticket.json
 *
 * Targets Jira REST API v2 — for on-premise / Data Center deployments.
 * Key v2 differences from v3:
 *   - Endpoint:    /rest/api/2/issue/:id   (not /rest/api/3/)
 *   - Description: plain wiki markup string (not Atlassian Document Format JSON)
 *   - Story points: customfield_10016 (classic) or customfield_10028 (next-gen) — both checked
 *   - No `renderedFields` needed — description is already a readable string
 *
 * Repo name resolution (priority order):
 *   1. Custom Jira field — configure via JIRA_REPO_FIELD_IDS env var (comma-separated)
 *   2. Label prefixed with "repo:"  e.g. repo:<your-repo-name>
 *   3. GitHub URL found in description text
 *   4. First component name (slugified) — flagged as uncertain
 *   5. null — Phase 2 (repo-setup.js) will prompt the user interactively
 *
 * Usage: node .github/scripts/fetch-jira.js <TICKET_ID>
 */

const fs   = require('fs');
const path = require('path');
require('./load-env');

const TICKET_ID = process.argv[2];
if (!TICKET_ID) {
  console.error('❌  Usage: node fetch-jira.js <TICKET_ID>  e.g. ABC-101');
  process.exit(1);
}

const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

// Jira Server / Data Center uses Basic auth: username:password or username:api-token
const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

// Custom field IDs where teams store the GitHub repo name.
// Add your org's field IDs via JIRA_REPO_FIELD_IDS=customfield_10500,customfield_10600
const REPO_CUSTOM_FIELDS = [
  'customfield_10100',
  'customfield_10200',
  'customfield_10300',
  ...( process.env.JIRA_REPO_FIELD_IDS?.split(',').map(f => f.trim()) ?? [] ),
];

// Story points field IDs — on-premise Jira often uses different field IDs than Cloud
// Add your org's field ID via JIRA_STORY_POINTS_FIELD=customfield_10028
const STORY_POINTS_FIELDS = [
  'customfield_10016',   // Jira classic (most common on-premise)
  'customfield_10028',   // Jira next-gen / team-managed
  'customfield_10004',   // older on-premise installations
  process.env.JIRA_STORY_POINTS_FIELD,
].filter(Boolean);

async function fetchTicket() {
  // ── v2 endpoint ───────────────────────────────────────────────────────────────
  const url = `${JIRA_BASE_URL}/rest/api/2/issue/${TICKET_ID}`;
  console.log(`\n🔍  Fetching Jira ticket: ${TICKET_ID}`);
  console.log(`    URL: ${url}\n`);

  const res = await fetch(url, {
    headers: {
      'Authorization': authHeader,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    // Provide specific guidance for common on-premise errors
    if (res.status === 401) {
      console.error(`❌  Jira auth failed (401). Check JIRA_EMAIL and JIRA_API_TOKEN in .env`);
      console.error(`    On-premise Jira: use your Jira username (not email) if SSO is not configured`);
    } else if (res.status === 403) {
      console.error(`❌  Jira permission denied (403). Your account may not have Browse Project permission`);
    } else if (res.status === 404) {
      console.error(`❌  Ticket not found (404): ${TICKET_ID}`);
      console.error(`    Check JIRA_BASE_URL — for on-premise it is typically http://jira.yourcompany.com`);
    } else {
      console.error(`❌  Jira API error ${res.status}: ${body}`);
    }
    process.exit(1);
  }

  const data   = await res.json();
  const fields = data.fields;

  // ── Description — v2 returns plain wiki markup, not ADF ──────────────────────
  // Wiki markup is already a readable string; we just clean it up lightly
  const descriptionText = wikiMarkupToText(fields.description);

  // ── Story points — try each known field ID in order ──────────────────────────
  const storyPoints = STORY_POINTS_FIELDS
    .map(f => fields[f])
    .find(v => v !== null && v !== undefined) ?? null;

  // ── Acceptance Criteria ───────────────────────────────────────────────────────
  const acCriteria = extractAcceptanceCriteria(descriptionText, fields);

  // ── Repo name ─────────────────────────────────────────────────────────────────
  const { repoName, repoNameSource } = extractRepoName(fields, descriptionText);

  // ── Build structured ticket object ───────────────────────────────────────────
  const ticket = {
    id:                 TICKET_ID,
    summary:            fields.summary,
    description:        descriptionText,
    acceptanceCriteria: acCriteria,
    priority:           fields.priority?.name ?? 'Medium',
    storyPoints,
    labels:             fields.labels ?? [],
    components:         (fields.components ?? []).map(c => c.name),
    fixVersions:        (fields.fixVersions ?? []).map(v => v.name),
    epicLink:           fields.customfield_10014 ?? fields.customfield_10008 ?? null,
    sprint:             extractSprintName(fields),
    assignee:           fields.assignee?.displayName ?? fields.assignee?.name ?? null,
    reporter:           fields.reporter?.displayName ?? fields.reporter?.name ?? null,
    status:             fields.status?.name ?? null,
    issueType:          fields.issuetype?.name ?? null,
    project:            fields.project?.key ?? null,
    repoName,
    repoNameSource,
    fetchedAt:          new Date().toISOString(),
    apiVersion:         'v2',
  };

  // ── Write context file ────────────────────────────────────────────────────────
  const contextDir = path.resolve('.github', 'context');
  fs.mkdirSync(contextDir, { recursive: true });
  const outPath = path.join(contextDir, 'ticket.json');
  fs.writeFileSync(outPath, JSON.stringify(ticket, null, 2));

  // ── Human-readable summary ────────────────────────────────────────────────────
  console.log('━'.repeat(60));
  console.log(`✅  Ticket fetched: ${ticket.id}`);
  console.log(`    Summary   : ${ticket.summary}`);
  console.log(`    Priority  : ${ticket.priority}  |  Points: ${ticket.storyPoints ?? 'unset'}`);
  console.log(`    Type      : ${ticket.issueType}  |  Status: ${ticket.status}`);
  console.log(`    Project   : ${ticket.project ?? 'unknown'}`);
  console.log(`    Sprint    : ${ticket.sprint ?? 'none'}`);
  console.log(`    Labels    : ${ticket.labels.join(', ') || 'none'}`);
  console.log(`    Components: ${ticket.components.join(', ') || 'none'}`);
  if (ticket.repoName) {
    console.log(`    Repo      : ${ticket.repoName}  (source: ${ticket.repoNameSource})`);
  } else {
    console.log(`    Repo      : ⚠️  Not found in ticket — will prompt at Phase 2`);
  }
  if (ticket.acceptanceCriteria.length) {
    console.log(`\n    Acceptance Criteria (${ticket.acceptanceCriteria.length}):`);
    ticket.acceptanceCriteria.forEach((ac, i) => console.log(`      ${i + 1}. ${ac}`));
  }
  console.log('━'.repeat(60));
  console.log(`\n📄  Context written to: ${outPath}\n`);
}

// ── Wiki markup → plain text ──────────────────────────────────────────────────
// Jira v2 description is Jira wiki markup (not ADF).
// We strip the most common markup tokens to produce readable plain text.
function wikiMarkupToText(markup) {
  if (!markup || typeof markup !== 'string') return '';

  return markup
    // Headings: h1. h2. etc → text
    .replace(/^h[1-6]\.\s*/gm, '')
    // Bold: *text* → text
    .replace(/\*([^*]+)\*/g, '$1')
    // Italic: _text_ → text
    .replace(/_([^_]+)_/g, '$1')
    // Strikethrough: -text- → text (careful — only within a line)
    .replace(/(?<!\w)-([^-\n]+)-(?!\w)/g, '$1')
    // Monospace: {{text}} → text
    .replace(/\{\{([^}]+)\}\}/g, '$1')
    // Links: [text|url] → text (url)  or  [url] → url
    .replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]/g, '$1')
    // Colour macros: {color:red}text{color} → text
    .replace(/\{color:[^}]+\}([^{]*)\{color\}/g, '$1')
    // Panels and other macros: {panel:title=...} ... {panel} — strip the tags
    .replace(/\{[a-zA-Z][^}]*\}/g, '')
    // Bullet lists: * item or - item → • item
    .replace(/^[*-]\s+/gm, '• ')
    // Numbered lists: # item → keep the # stripped
    .replace(/^#+\s+/gm, '')
    // Horizontal rules
    .replace(/^----$/gm, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Extract Acceptance Criteria from description plain text ──────────────────
function extractAcceptanceCriteria(descriptionText, fields) {
  // 1. Dedicated AC custom field (some on-premise Jira setups have this)
  const acField = process.env.JIRA_AC_FIELD;   // e.g. customfield_10500
  if (acField && fields[acField] && typeof fields[acField] === 'string') {
    return fields[acField]
      .split('\n')
      .map(l => l.replace(/^[•\-*#]+\s*/, '').trim())
      .filter(Boolean);
  }

  // 2. Parse from description — look for an "Acceptance Criteria" section heading
  const acMatch = descriptionText.match(
    /acceptance criteria[:\s]*\n([\s\S]*?)(?=\n[A-Z][^\n]{2,}:\s*\n|\n•\s*\n|$)/i,
  );
  if (acMatch) {
    return acMatch[1]
      .split('\n')
      .map(l => l.replace(/^[•\-*#\d.]+\s*/, '').trim())
      .filter(Boolean);
  }

  return [];
}

// ── Sprint name extraction ────────────────────────────────────────────────────
// On-premise Jira stores sprint info as a serialised string in a custom field
function extractSprintName(fields) {
  // Common sprint field IDs on Jira Server / Data Center
  const sprintFieldIds = [
    'customfield_10020',
    'customfield_10007',
    process.env.JIRA_SPRINT_FIELD,
  ].filter(Boolean);

  for (const fieldId of sprintFieldIds) {
    const val = fields[fieldId];
    if (!val) continue;

    // Sprint field is an array of sprint strings like:
    // "com.atlassian.greenhopper.service.sprint.Sprint@abc[name=Sprint 5,state=ACTIVE,...]"
    const sprints = Array.isArray(val) ? val : [val];
    for (const sprint of sprints) {
      const nameMatch = String(sprint).match(/name=([^,\]]+)/);
      if (nameMatch) return nameMatch[1].trim();
    }
  }
  return null;
}

// ── Repo name extraction (priority-ordered) ───────────────────────────────────
function extractRepoName(fields, descriptionText) {
  // 1. Dedicated custom fields
  for (const field of REPO_CUSTOM_FIELDS) {
    const val = fields[field];
    if (val && typeof val === 'string' && val.trim()) {
      return { repoName: slugifyRepo(val.trim()), repoNameSource: `custom-field:${field}` };
    }
    if (val && typeof val === 'object' && val.value) {
      return { repoName: slugifyRepo(val.value), repoNameSource: `custom-field:${field}` };
    }
  }

  // 2. Label prefixed with "repo:"
  const repoLabel = (fields.labels ?? []).find(l => l.toLowerCase().startsWith('repo:'));
  if (repoLabel) {
    const name = repoLabel.slice('repo:'.length).trim();
    if (name) return { repoName: slugifyRepo(name), repoNameSource: 'label:repo:' };
  }

  // 3. GitHub URL in description
  const ghUrlMatch = descriptionText.match(/github\.com\/[^/\s]+\/([a-zA-Z0-9_.-]+)/);
  if (ghUrlMatch) {
    return { repoName: slugifyRepo(ghUrlMatch[1]), repoNameSource: 'description:github-url' };
  }

  // 4. First component (weak signal)
  if (fields.components?.length) {
    return {
      repoName:       slugifyRepo(fields.components[0].name),
      repoNameSource: 'component:first (uncertain — please confirm)',
    };
  }

  // 5. Not found
  return { repoName: null, repoNameSource: null };
}

function slugifyRepo(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

fetchTicket().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
