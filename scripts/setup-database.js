#!/usr/bin/env node
/**
 * setup-database.js
 * Phase 2c: Database setup for NEW APPLICATION mode only.
 * Skipped entirely for new-feature tickets.
 *
 * Produces (inside the backend repo):
 *   1. src/main/resources/db/migration/V1__init.sql
 *      — Initial Flyway migration inferred from ticket AC and description.
 *        Contains placeholder table stubs with a clear TODO comment.
 *
 *   2. src/main/resources/application.yml  (merged/created)
 *      — Datasource config block with placeholder values for all environments.
 *        Uses Spring profiles: default (local), test (H2), prod (env vars).
 *
 *   3. src/main/resources/application-test.yml
 *      — H2 in-memory config for CI — auto-wired by Spring Boot test slice.
 *
 *   4. DB_SETUP.md  (at repo root)
 *      — README section: prerequisites, local setup steps, migration commands.
 *
 * All files are written into the backend repo local path from repo.json.
 * If the backend path does not exist, the script exits with a clear message.
 *
 * Usage: node .github/scripts/setup-database.js <TICKET_ID>
 */

const fs   = require('fs');
const path = require('path');
require('./load-env');

const TICKET_ID = process.argv[2];
if (!TICKET_ID) {
  console.error('❌  Usage: node setup-database.js <TICKET_ID>');
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

const contextDir = path.join(PROJECT_ROOT, '.github', 'context');

// ── Load context ──────────────────────────────────────────────────────────────
function loadJson(name) {
  const p = path.join(contextDir, name);
  if (!fs.existsSync(p)) {
    console.error(`❌  ${name} not found — run earlier phases first`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

const ticket = loadJson('ticket.json');
const mode   = loadJson('mode.json');
const repo   = loadJson('repo.json');

// ── Guard: only run for new-app ───────────────────────────────────────────────
if (mode.mode !== 'new-app') {
  console.log(`ℹ️   Mode is "${mode.mode}" — database setup is for new applications only. Skipping.`);
  process.exit(0);
}

// ── Resolve backend local path ────────────────────────────────────────────────
// repo.json is either flat (single repo) or nested { backend, frontend }
const backendRepo = repo.backend ?? repo;
const backendPath = backendRepo.localPath;

if (!backendPath || !fs.existsSync(backendPath)) {
  console.error(`❌  Backend repo not found at: ${backendPath}`);
  console.error(`    Run repo-setup.js first`);
  process.exit(1);
}

const appName    = mode.appName ?? ticket.id.toLowerCase();
// Convert appName to snake_case for SQL identifiers
const dbName     = appName.replace(/-/g, '_');
const schemaName = dbName;

// ── Infer entity hints from AC and description ────────────────────────────────
// Simple heuristic: look for nouns that could be DB entities
function inferEntityHints(ticket) {
  const text = `${ticket.summary} ${ticket.description}`.toLowerCase();
  const candidates = [];

  // Look for patterns like "manage X", "store X", "create X", "list of X"
  const entityPatterns = [
    /\bmanage\s+(\w+s?)\b/g,
    /\bstore\s+(\w+s?)\b/g,
    /\bcreate\s+a?\s+(\w+)\b/g,
    /\blist\s+of\s+(\w+s?)\b/g,
    /\btrack\s+(\w+s?)\b/g,
    /\b(\w+)\s+table\b/g,
    /\b(\w+)\s+entity\b/g,
    /\b(\w+)\s+record\b/g,
  ];

  // Stopwords that are not entity names
  const stopwords = new Set([
    'the', 'a', 'an', 'this', 'that', 'new', 'existing', 'all', 'some',
    'user', 'users', 'data', 'information', 'details', 'feature', 'system',
  ]);

  for (const pattern of entityPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const word = match[1].replace(/s$/, ''); // crude singularise
      if (!stopwords.has(word) && word.length > 2) {
        candidates.push(word);
      }
    }
  }

  return [...new Set(candidates)].slice(0, 3); // max 3 entity hints
}

const entityHints = inferEntityHints(ticket);

// ── Generate V1__init.sql ─────────────────────────────────────────────────────
function generateInitSql() {
  const timestamp = new Date().toISOString().split('T')[0];

  const entityTables = entityHints.length > 0
    ? entityHints.map(entity => `
-- TODO: Review and complete this table definition for entity: ${entity}
-- Inferred from ticket: ${ticket.id} — ${ticket.summary}
CREATE TABLE IF NOT EXISTS ${entity} (
    id          UUID          NOT NULL DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    -- TODO: Add domain-specific columns for ${entity}
    CONSTRAINT pk_${entity} PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_${entity}_created_at ON ${entity} (created_at);
`).join('\n')
    : `
-- TODO: Define your tables here
-- No entity names could be inferred from the ticket description.
-- Review the ticket acceptance criteria and add your schema below.
--
-- Example:
-- CREATE TABLE IF NOT EXISTS my_entity (
--     id         UUID        NOT NULL DEFAULT gen_random_uuid(),
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     deleted_at TIMESTAMPTZ,
--     CONSTRAINT pk_my_entity PRIMARY KEY (id)
-- );
`;

  return `-- Flyway migration: V1__init.sql
-- Application : ${appName}
-- Ticket      : ${ticket.id} — ${ticket.summary}
-- Generated   : ${timestamp}
-- Database    : PostgreSQL 14+
--
-- IMPORTANT: Review all TODO comments before running this migration.
-- Do not run in production without DBA sign-off.
-- ─────────────────────────────────────────────────────────────────

-- Enable UUID generation (PostgreSQL 13+ has gen_random_uuid() built-in)
-- For PostgreSQL <13: CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Audit trigger function (reusable across all tables) ───────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
${entityTables}
-- ── Apply updated_at trigger to each table ────────────────────────────────────
${entityHints.length > 0
  ? entityHints.map(e => `CREATE TRIGGER trg_${e}_updated_at
    BEFORE UPDATE ON ${e}
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();`).join('\n\n')
  : '-- TODO: Add triggers for your tables'}
`;
}

// ── Generate application.yml ──────────────────────────────────────────────────
function generateApplicationYml() {
  return `# application.yml — ${appName}
# Generated for ticket: ${ticket.id}
#
# IMPORTANT: Replace all <PLACEHOLDER> values before running.
# Do NOT commit real credentials — use environment variables or a secrets manager.
#
# Spring profiles:
#   default  → local development (PostgreSQL)
#   test     → CI (H2 in-memory, see application-test.yml)
#   prod     → production (all values from environment variables)

spring:
  application:
    name: ${appName}

  datasource:
    url: jdbc:postgresql://localhost:5432/${dbName}
    username: \${DB_USERNAME:<PLACEHOLDER>}
    password: \${DB_PASSWORD:<PLACEHOLDER>}
    driver-class-name: org.postgresql.Driver
    hikari:
      maximum-pool-size: 10
      minimum-idle: 2
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000

  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true
    validate-on-migrate: true
    schemas: ${schemaName}

  jpa:
    open-in-view: false
    hibernate:
      ddl-auto: validate   # Flyway owns the schema — Hibernate must not modify it

server:
  port: 8080

logging:
  level:
    root: INFO
    org.flywaydb: DEBUG   # Show migration output — reduce to INFO after initial setup

---
# ── Production profile ────────────────────────────────────────────────────────
spring:
  config:
    activate:
      on-profile: prod

  datasource:
    url: \${DB_URL}
    username: \${DB_USERNAME}
    password: \${DB_PASSWORD}

logging:
  level:
    root: WARN
    org.flywaydb: INFO
`;
}

// ── Generate application-test.yml ─────────────────────────────────────────────
function generateTestYml() {
  return `# application-test.yml — CI / unit test profile
# Activated automatically when spring.profiles.active=test
# Used by: @SpringBootTest, @WebMvcTest, @JooqTest, @DataJpaTest
#
# H2 in-memory database configured in PostgreSQL compatibility mode.
# No external database required in CI.

spring:
  datasource:
    url: jdbc:h2:mem:${dbName}_test;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
    username: sa
    password:
    driver-class-name: org.h2.Driver

  flyway:
    enabled: true
    locations: classpath:db/migration
    baseline-on-migrate: true

  jpa:
    hibernate:
      ddl-auto: validate

logging:
  level:
    org.flywaydb: INFO
    org.springframework.jdbc: DEBUG
`;
}

// ── Generate DB_SETUP.md ──────────────────────────────────────────────────────
function generateDbReadme() {
  const entityList = entityHints.length > 0
    ? entityHints.map(e => `- \`${e}\``).join('\n')
    : '- *(inferred from ticket — review V1__init.sql)*';

  return `# Database Setup — ${appName}

Ticket: [${ticket.id}] ${ticket.summary}

---

## Prerequisites

- PostgreSQL 14 or later
- A database user with \`CREATE\` privileges
- Flyway is embedded in the application — no separate Flyway CLI needed for dev

---

## Local Development Setup

### 1. Create the database

\`\`\`sql
-- Connect as a superuser (e.g. psql -U postgres)
CREATE DATABASE ${dbName};
CREATE USER ${dbName}_user WITH ENCRYPTED PASSWORD '<your-password>';
GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbName}_user;
\`\`\`

### 2. Set environment variables

\`\`\`bash
export DB_USERNAME=${dbName}_user
export DB_PASSWORD=<your-password>
\`\`\`

Or add to your \`.env\` file (never commit this file):

\`\`\`
DB_USERNAME=${dbName}_user
DB_PASSWORD=<your-password>
\`\`\`

### 3. Run the application

On first startup, Flyway will automatically apply all migrations in
\`src/main/resources/db/migration/\` in version order.

\`\`\`bash
mvn spring-boot:run
\`\`\`

You should see Flyway output like:
\`\`\`
Flyway ... Migrating schema "${schemaName}" to version 1 - init
Flyway ... Successfully applied 1 migration
\`\`\`

---

## Migration Files

| File | Description |
|------|-------------|
| \`V1__init.sql\` | Initial schema — tables inferred from ticket AC |

### Inferred entities (review before running)

${entityList}

> **Review V1__init.sql before first run.** All table definitions contain TODO
> comments — complete them based on the full domain model before applying.

---

## Adding New Migrations

Every schema change must be a new numbered Flyway migration file:

\`\`\`
V2__add_status_column.sql
V3__create_audit_log_table.sql
\`\`\`

Rules:
- Never edit an already-applied migration file
- Version numbers must be sequential with no gaps
- File names must match the pattern: \`V{n}__{description}.sql\`
- All migrations reviewed by DBA before merging to \`main\`

---

## CI / Test Environment

Tests use H2 in-memory database (PostgreSQL compatibility mode).
No database setup required for CI — configured in \`application-test.yml\`.
Flyway runs automatically when the Spring context starts in tests.

---

## Production

All connection details are supplied via environment variables — see \`application.yml\`.
Never hardcode credentials. Migrations run automatically on deployment startup.
`;
}

// ── Write all files ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🗄️   Database Setup — ${appName} (${TICKET_ID})`);
  console.log(`    Backend path : ${backendPath}`);
  if (entityHints.length) {
    console.log(`    Inferred entities : ${entityHints.join(', ')}`);
  } else {
    console.log(`    No entities inferred — placeholder schema will be generated`);
  }
  console.log();

  // 1. V1__init.sql
  const migrationDir = path.join(backendPath, 'src', 'main', 'resources', 'db', 'migration');
  fs.mkdirSync(migrationDir, { recursive: true });
  const sqlPath = path.join(migrationDir, 'V1__init.sql');
  fs.writeFileSync(sqlPath, generateInitSql());
  console.log(`✅  Written: src/main/resources/db/migration/V1__init.sql`);

  // 2. application.yml — create or merge
  const resourcesDir = path.join(backendPath, 'src', 'main', 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  const appYmlPath = path.join(resourcesDir, 'application.yml');
  if (fs.existsSync(appYmlPath)) {
    // Back up existing before overwriting
    fs.copyFileSync(appYmlPath, appYmlPath + '.bak');
    console.log(`⚠️   application.yml already exists — backed up as application.yml.bak`);
  }
  fs.writeFileSync(appYmlPath, generateApplicationYml());
  console.log(`✅  Written: src/main/resources/application.yml`);

  // 3. application-test.yml
  const testResourcesDir = path.join(backendPath, 'src', 'test', 'resources');
  fs.mkdirSync(testResourcesDir, { recursive: true });
  fs.writeFileSync(path.join(testResourcesDir, 'application-test.yml'), generateTestYml());
  console.log(`✅  Written: src/test/resources/application-test.yml`);

  // 4. DB_SETUP.md
  fs.writeFileSync(path.join(backendPath, 'DB_SETUP.md'), generateDbReadme());
  console.log(`✅  Written: DB_SETUP.md`);

  // 5. Write db.json context so PLAN.md phase knows DB setup was done
  fs.writeFileSync(
    path.join(contextDir, 'db.json'),
    JSON.stringify({
      appName,
      dbName,
      schemaName,
      migrationFile: 'V1__init.sql',
      entityHints,
      setupAt: new Date().toISOString(),
    }, null, 2),
  );

  console.log('\n' + '━'.repeat(60));
  console.log(`✅  Database setup complete`);
  console.log(`    DB name        : ${dbName}`);
  console.log(`    Migration      : V1__init.sql`);
  console.log(`    Review todos   : grep -r "TODO" ${path.relative(PROJECT_ROOT, migrationDir)}`);
  console.log('━'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
