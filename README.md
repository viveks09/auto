# 🤖 Jira-to-PR Copilot Agent Automation

Complete enterprise dev lifecycle automation — from Jira ticket to merged PR, driven by a single prompt in VS Code Copilot Agent Mode.

Supports **new applications from scratch** and **new features on existing apps**, with automatic stack detection (frontend / backend / fullstack), Angular starter bootstrapping, Flyway database setup, and dual PRs for fullstack tickets.

---

## 🔄 Full Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Developer creates Jira ticket                                              │
│  (description, acceptance criteria, user stories, components, labels)       │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1 — Fetch from Jira  (fetch-jira.js)                                │
│                                                                             │
│  • Calls on-premise Jira REST API v2                                        │
│  • Extracts: summary, description, acceptance criteria, story points,       │
│    sprint, components, labels, fix versions                                 │
│  • Infers GitHub repo name from custom fields / labels / description        │
│  • Writes: .github/context/ticket.json                                      │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2a — Mode Detection  (detect-mode.js)                               │
│                                                                             │
│  Asks the developer one question (infers answer from ticket first):         │
│                                                                             │
│    🆕 New application from scratch                                          │
│       → new repos, DB setup, full bootstrap                                 │
│                                                                             │
│    ➕ New feature on existing app                                           │
│       → clone existing repos, implement on top                              │
│                                                                             │
│  • Writes: .github/context/mode.json                                        │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2b — Stack Detection & Repo Setup  (repo-setup.js)                  │
│                                                                             │
│  Scores ticket signals to detect: frontend / backend / fullstack            │
│  Signals: component names, labels, summary keywords, description keywords   │
│  Confirms with developer before creating anything                           │
│                                                                             │
│  ┌─────────────────────────┐    ┌──────────────────────────────────────┐   │
│  │  FRONTEND               │    │  BACKEND                             │   │
│  │  (bootstrap-frontend.js)│    │                                      │   │
│  │                         │    │  new-app:                            │   │
│  │  new-app:               │    │  • Create new private GitHub repo    │   │
│  │  • Clone company        │    │  • Push with README + .gitignore     │   │
│  │    Angular starter      │    │  • Clone locally                     │   │
│  │  • Strip git history    │    │                                      │   │
│  │  • Create new GitHub    │    │  new-feature:                        │   │
│  │    repo in your org     │    │  • Clone EXISTING repo from GitHub   │   │
│  │  • Push as first commit │    │                                      │   │
│  │  • Clone locally        │    │  Both: create feature branch         │   │
│  │                         │    │  feature/<TICKET-ID>-<slug>          │   │
│  │  new-feature:           │    └──────────────────────────────────────┘   │
│  │  • Clone EXISTING repo  │                                               │
│  │  Both: feature branch   │    All repos cloned as siblings to .github/:  │
│  └─────────────────────────┘    <skill-repo>/                              │
│                                   .github/                                  │
│                                   <backend-repo>/                           │
│                                   <frontend-repo>/                          │
│                                                                             │
│  • Writes: .github/context/repo.json                                        │
│    Single repo → flat  { name, localPath, branch, ... }                    │
│    Fullstack   → nested { backend: {...}, frontend: {...} }                 │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2c — Database Setup  (setup-database.js)  ← new-app only            │
│                                                                             │
│  Skipped entirely for new-feature tickets.                                  │
│                                                                             │
│  Produces inside the backend repo:                                          │
│                                                                             │
│  • src/main/resources/db/migration/V1__init.sql                             │
│    Flyway initial migration — table stubs inferred from AC and description  │
│    Every table: UUID PK, created_at, updated_at, deleted_at, audit trigger  │
│    All stubs have TODO comments — must be completed before running          │
│                                                                             │
│  • src/main/resources/application.yml                                       │
│    Datasource + Hikari pool config                                          │
│    Flyway config (baseline-on-migrate, validate-on-migrate)                 │
│    spring.jpa.hibernate.ddl-auto: validate  (Flyway owns the schema)        │
│    Prod profile: all values from environment variables — no hardcoded creds │
│                                                                             │
│  • src/test/resources/application-test.yml                                  │
│    H2 in-memory (MODE=PostgreSQL) — no external DB needed in CI             │
│    Flyway auto-runs migrations on test context startup                      │
│                                                                             │
│  • DB_SETUP.md at backend repo root                                         │
│    Local PostgreSQL setup commands, env var instructions,                   │
│    migration file table, rules for adding future migrations                 │
│                                                                             │
│  • Writes: .github/context/db.json                                          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3 — Implementation Plan                                             │
│                                                                             │
│  Copilot writes PLAN.md before a single line of feature code.               │
│  Covers: affected files per layer, approach, DB changes (if any),           │
│  AC mapping, assumptions, risks.                                            │
│                                                                             │
│  • Writes: .github/context/PLAN.md                                          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4 — Feature Implementation                                          │
│                                                                             │
│  Copilot implements the feature following all coding guidelines:            │
│                                                                             │
│  Frontend (Angular):                                                        │
│  • Standalone components + OnPush + input() signals                         │
│  • Design system tokens and components only — no raw HTML buttons/inputs    │
│  • inject() function, not constructor injection                             │
│  • data-testid on every interactive element                                 │
│                                                                             │
│  Backend (Spring Boot / Kotlin):                                            │
│  • Sealed classes for domain results                                        │
│  • @Transactional on application service, not repository                   │
│  • jOOQ DSL only — no raw SQL strings                                       │
│  • Typed config via @ConfigurationProperties                                │
│  • New Flyway migrations for any schema changes (V2, V3, ...)               │
│                                                                             │
│  AI coding rules (Karpathy):                                                │
│  • Think before coding — surface assumptions first                          │
│  • Surgical changes — touch only what the ticket requires                   │
│  • Incremental commits — one layer at a time, verify each                   │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5 — Tests                                                           │
│                                                                             │
│  Frontend — Vitest + @testing-library/angular                               │
│  • Component tests: render → interact → assert (AAA, data-testid selectors) │
│  • Service tests: HttpTestingController, mock dependencies                  │
│  • Coverage thresholds enforced (components ≥80%, services ≥85%)           │
│                                                                             │
│  Backend — JUnit 5 + MockK                                                  │
│  • Unit tests: MockK, no Spring context                                     │
│  • Slice tests: @WebMvcTest, @JooqTest — H2 in-memory, no external DB       │
│  • Test data builders in src/test/kotlin/.../testdata/                      │
│  • Coverage thresholds enforced (services ≥90%, controllers ≥80%)          │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 6 — Playwright E2E Spec  ← outside CI, nightly only                 │
│                                                                             │
│  Generated from _TEMPLATE.spec.ts — real spec named after the ticket.      │
│  Never runs in the main CI pipeline (ci.yml).                               │
│  Runs nightly via playwright-nightly.yml against deployed staging.          │
│  Multi-browser (Chrome, Firefox, Safari) + mobile viewports.               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 7 — Build Verification + Quality Gate                               │
│                                                                             │
│  Build first (catches compile errors before wasting time on tests):         │
│    mvn package -DskipTests          ← backend compiles                      │
│    ng build --configuration production  ← Angular template/type errors      │
│                                                                             │
│  Then full quality gate:                                                    │
│    mvn verify --batch-mode          ← unit + integration tests              │
│    mvn ktlint:check --batch-mode    ← Kotlin lint                           │
│    npx tsc --noEmit                 ← TypeScript type check                 │
│    npm run lint                     ← Angular ESLint                        │
│    npx vitest run                   ← unit tests with coverage              │
│                                                                             │
│  Non-negotiable: everything must be green before Phase 8.                  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 8 — Pull Request(s)  (create-pr.js)                                 │
│                                                                             │
│  Single repo ticket → 1 PR                                                  │
│  Fullstack ticket   → 2 PRs with cross-references in both bodies            │
│                                                                             │
│  PR body auto-populated from:                                               │
│  • Jira ticket summary, description, priority, story points                 │
│  • Acceptance criteria as a checklist  ← directly from Jira                │
│  • Affected areas from PLAN.md                                              │
│  • Test coverage summary                                                    │
│  • DB migration note (new-app only)                                         │
│  • Link to the other PR (fullstack only)                                    │
│                                                                             │
│  Labels auto-applied: feature, copilot-generated, priority-*, backend/     │
│  frontend (created on GitHub if they don't exist)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 File Structure

```
.github/
  copilot-instructions.md    ← Rename of SKILL.md — Copilot Agent reads automatically
  scripts/
    fetch-jira.js            ← Phase 1:  Jira API v2 fetch
    detect-mode.js           ← Phase 2a: New app or new feature?
    repo-setup.js            ← Phase 2b: Stack detection + repo orchestration
    bootstrap-frontend.js    ← Phase 2b: Angular starter → new GitHub repo
    setup-database.js        ← Phase 2c: Flyway migration + application.yml + DB_SETUP.md
    create-pr.js             ← Phase 8:  PR creation (1 or 2 PRs)
    gh-or-api.js             ← gh CLI wrapper + startup verification
    load-env.js              ← Shared .env loader & validator
    ask-user.js              ← Interactive prompts (text, select, confirm)
  guidelines/
    GUIDELINES-ANGULAR.md           ← Angular 19+, signals, OnPush, DS usage
    GUIDELINES-DESIGN-SYSTEM.md     ← DS tokens, components, WCAG, exceptions
    GUIDELINES-SPRING-BOOT-KOTLIN.md ← Kotlin idioms, jOOQ, sealed classes
    GUIDELINES-AI-CODING.md         ← Karpathy rules, think-before-coding
    GUIDELINES-TESTING.md           ← Vitest, JUnit 5, MockK, AAA, H2
  workflows/
    ci.yml                   ← Vitest + JUnit 5 on every push/PR (no Playwright)
    playwright-nightly.yml   ← Playwright on nightly schedule only
  context/                   ← Created at runtime — gitignore this folder
    ticket.json              ← Jira ticket data
    mode.json                ← new-app or new-feature
    repo.json                ← repo(s) metadata (flat or nested for fullstack)
    db.json                  ← DB setup info (new-app only)
    branch.txt               ← Feature branch name
    PLAN.md                  ← Implementation plan
    run.log                  ← Append-only run history

e2e/
  _TEMPLATE.spec.ts          ← Playwright template
  pages/
    BasePage.ts

src/
  test-setup.ts              ← Vitest global setup for Angular

vitest.config.ts             ← V8 coverage, jsdom, thresholds enforced
playwright.config.ts         ← Multi-browser config (nightly use only)
.env.example                 ← Copy to .env and fill in values
```

---

## ⚙️ One-Time Setup

### 1. Install gh CLI and authenticate

```bash
# Install: https://cli.github.com
gh auth login
# Follow prompts: GitHub.com → HTTPS → authenticate via browser
gh auth status   # verify it worked
```

No tokens, no PATs, no `.env` entries for GitHub.

### 2. Configure Jira credentials

```bash
cp .env.example .env
# Fill in: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, GITHUB_ORG
```

**On-premise / Data Center notes:**
- `JIRA_BASE_URL` — internal Jira URL e.g. `http://jira.yourcompany.com` or `http://jira.yourcompany.com:8080`
- `JIRA_EMAIL` — your Jira **username** (not email address, unless your instance uses email as username)
- `JIRA_API_TOKEN` — generate from your Jira profile: *Profile → Manage Account → Security → API Tokens*. On older Jira Server (<8.14), use your Jira password.
- Custom field IDs vary per installation — see `.env.example` for optional overrides. Find field IDs at `http://jira.yourcompany.com/rest/api/2/field`

### 3. Configure the Angular starter

```bash
# In .env:
ANGULAR_STARTER_REPO=your-company-org/angular-starter
```

Must be accessible via your `gh auth` session. The skill clones it fresh each time, strips history, and pushes clean — the starter's commit history never appears in the new repo.

### 4. Place the skill file

Rename `SKILL.md` → `.github/copilot-instructions.md` in your repo.
Copilot Agent Mode reads this file automatically — no manual loading needed.

> **No `npm install` needed.** Scripts use only Node.js built-ins — zero npm dependencies.

### 5. (Optional) Install Playwright for local E2E runs

```bash
npx playwright install --with-deps
```

Playwright is not in CI — runs locally or via the nightly workflow only.

---

## 🚀 Usage

Open VS Code → Copilot Chat → switch to **Agent** mode, then type:

```
implement ticket <YOUR-TICKET-ID>
```

### Other trigger phrases

```
start work on <YOUR-TICKET-ID>
implement ticket <YOUR-TICKET-ID> in repo <backend-repo-name>
implement ticket <YOUR-TICKET-ID> and request review from <github-username>
plan ticket <YOUR-TICKET-ID>   ← PLAN.md only, no code written
```

---

## 🧪 Running Tests

```bash
# Angular — Vitest
npx vitest run
npx vitest           # watch mode for local dev

# Kotlin — JUnit 5 + Maven
mvn test --batch-mode
mvn verify -P integration-tests --batch-mode   # H2 in-memory — no external DB needed

# Playwright E2E — local only, NOT in CI
npx playwright test
npx playwright test --headed
npx playwright test e2e/<ticket-id>-<slug>.spec.ts
npx playwright show-report
```

---

## 🛡️ .gitignore additions

```gitignore
.env
.github/context/
e2e/.auth/
playwright-report/
test-results/
coverage/
```

---

## 💡 Tips

- **New app vs new feature:** Phase 2a asks every time — it infers from the ticket first and pre-selects, so for obvious tickets it's just a one-key confirmation.
- **Stack detection:** scores components, labels, summary, and description keywords. You always confirm the detected stack before anything is created.
- **Database (new app only):** Flyway migration stubs are inferred from AC keywords. All stubs have `-- TODO:` markers — review them before the first `mvn spring-boot:run`.
- **Design system compliance:** all Angular code follows `GUIDELINES-DESIGN-SYSTEM.md` — DS tokens and components only, no raw HTML buttons/inputs, no hardcoded colours.
- **Build before tests:** Phase 7 runs `mvn package` and `ng build --configuration production` first to catch compilation errors before running the full test suite.
- **Fullstack PRs:** two PRs are created — one per repo — with cross-references in both bodies so reviewers can navigate between them.
- **Clone location:** repos always land inside your skill repo as siblings to `.github/` — never in an arbitrary working directory.
- **H2 for CI:** no Postgres, no Docker needed in the CI pipeline — Spring Boot auto-configures H2 from `application-test.yml`.
