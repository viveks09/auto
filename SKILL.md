# Skill: Jira-to-PR Full Dev Automation

## Purpose
Automates the **complete enterprise development lifecycle** — from reading a Jira ticket
to raising a GitHub Pull Request — including implementation planning, feature code,
unit/integration tests, and Playwright E2E automation.

**Trigger phrases (any of these activates this skill):**
- "implement ticket [JIRA-ID]"
- "start work on [JIRA-ID]"
- "build feature from jira"
- "automate jira to pr"
- "pick up ticket and implement"

---

## Prerequisites & Secrets

### GitHub Auth

All GitHub operations use **gh CLI** exclusively. Run `gh auth login` once and the scripts
handle everything — repo creation, cloning, branch management, and PR creation — with no
tokens or credentials in `.env`.

```bash
# One-time setup
gh auth login   # follow prompts — select GitHub.com, HTTPS, browser auth
gh auth status  # verify it worked
```

### Environment variables

| Variable                  | Required | Purpose                                                        |
|---------------------------|----------|----------------------------------------------------------------|
| `JIRA_BASE_URL`           | Yes      | On-premise Jira URL e.g. `http://jira.yourcompany.com`         |
| `JIRA_EMAIL`              | Yes      | Jira username (on-premise is usually username, not email)      |
| `JIRA_API_TOKEN`          | Yes      | Jira API token or password (see `.env.example` for details)    |
| `GITHUB_ORG`              | Yes      | GitHub org or username                                         |
| `DEFAULT_BASE_BRANCH`     | No       | Branch to PR against (default: `main`)                         |
| `REVIEWERS`               | No       | Comma-separated GitHub usernames for review                    |
| `ANGULAR_STARTER_REPO`    | Frontend | Company Angular starter e.g. `company-org/angular-starter`     |
| `FRONTEND_REPO_NAME`      | No       | Fixed frontend repo name — skips prompt if set                 |
| `DB_USERNAME`             | new-app  | Database username (also used in generated application.yml)     |
| `DB_PASSWORD`             | new-app  | Database password — never committed, always from env           |
| `JIRA_REPO_FIELD_IDS`     | No       | Comma-separated custom field IDs for GitHub repo name          |
| `JIRA_STORY_POINTS_FIELD` | No       | Custom field ID for story points if non-standard               |
| `JIRA_AC_FIELD`           | No       | Custom field ID for Acceptance Criteria if separate from desc  |
| `JIRA_SPRINT_FIELD`       | No       | Custom field ID for sprint info if non-standard                |

---

## Step-by-Step Execution Plan

When triggered, Copilot Agent MUST follow these phases **in strict order**.
Do NOT skip any phase. Check off each phase as it completes.

---

### PHASE 1 — Fetch & Parse Jira Ticket

**Goal:** Retrieve structured requirement data from Jira.

```bash
# Run the Jira fetch script
node .github/scripts/fetch-jira.js <TICKET_ID>
```

**Script behavior (`fetch-jira.js`):**
- Calls Jira REST API **v2**: `GET /rest/api/2/issue/{ticketId}` — for on-premise / Data Center
- Description is **wiki markup** (plain string) in v2, not ADF JSON — stripped to clean text
- Extracts: summary, description, acceptance criteria, story points (tries multiple field IDs),
  sprint name (parses on-premise sprint string format), fix versions, priority, assignee
- Configurable custom field IDs via env vars for story points, AC, sprint, and repo name
- Writes output to `.github/context/ticket.json`
- Prints a human-readable summary to stdout

**Output schema (`ticket.json`):**
```json
{
  "id": "<YOUR-TICKET-ID>",
  "summary": "<ticket summary from Jira>",
  "description": "...",
  "acceptanceCriteria": ["AC1: ...", "AC2: ..."],
  "priority": "High",
  "storyPoints": 5,
  "labels": ["backend", "api"],
  "components": ["reporting"],
  "epicLink": "PROJ-100"
}
```

**Copilot action:** Read `.github/context/ticket.json` and internalize the full requirement before proceeding.

---

### PHASE 2 — Repository Setup

**Goal:** Ensure the correct GitHub repo exists and is locally available.

```bash
node .github/scripts/repo-setup.js <TICKET_ID>
```

**Script behavior (`repo-setup.js`):**
1. Verifies gh CLI is available and authenticated (exits with a clear message if not)
2. Uses `gh repo view` to check if repo exists, `gh repo create` to create it if not
3. Uses `gh repo clone` to clone **into the project directory** (sibling to `.github/`) — not an external path
4. Creates feature branch: `feature/<TICKET_ID>-<slugified-summary>`
   - Example: `feature/<TICKET-ID>-<slugified-summary>`
5. Uses `git switch -c` for new branches
6. Writes branch name to `.github/context/branch.txt` and repo metadata to `.github/context/repo.json`

**Copilot action:** Confirm branch is checked out. All subsequent file changes go on this branch.

---

### PHASE 3 — Generate Implementation Plan

**Goal:** Create a structured, file-level implementation plan before writing any code.

**Copilot MUST generate `.github/context/PLAN.md` with the following structure:**

```markdown
# Implementation Plan: <TICKET_ID> — <Summary>

## Requirement Summary
<2–3 sentence summary of what needs to be built>

## Acceptance Criteria
- [ ] AC1: ...
- [ ] AC2: ...

## Affected Areas
| Layer         | Files / Modules                         | Change Type        |
|---------------|-----------------------------------------|--------------------|
| API / Backend | src/api/reports/export.ts               | New file           |
| Service       | src/services/ReportService.ts           | Add method         |
| Controller    | src/controllers/ReportController.ts     | Add endpoint       |
| Frontend      | src/components/<Feature>/<Component>.tsx | New component      |
| Tests         | src/__tests__/export.test.ts            | New unit tests     |
| E2E           | e2e/<feature-slug>.spec.ts               | New Playwright spec|

## Implementation Steps
1. Step description → file(s) touched
2. ...
N. Wire up and integration test

## API Contract (if applicable)
### Endpoint: POST /api/reports/:id/export
Request: `{ format: "csv" | "xlsx", filters: {...} }`
Response: `{ downloadUrl: string, expiresAt: string }`

## Data Model Changes (if applicable)
- New field: `exportFormat` on `ReportConfig` entity

## Risk / Notes
- Potential impact on existing pagination logic
- Check rate limits on export endpoint

## Test Strategy
- Unit: Service layer, transformation logic
- Integration: Controller → Service → DB
- E2E: Full user flow from Report View → Export → File download
```

**Copilot action:** Write this file FIRST. Do not write feature code until PLAN.md is committed.

```bash
git add .github/context/PLAN.md
git commit -m "plan(<TICKET_ID>): add implementation plan"
```

---

### PHASE 4 — Implement the Feature

**Goal:** Write production-quality feature code following the plan.

**Rules Copilot MUST follow:**
1. Implement files **in the order listed** in the PLAN.md Affected Areas table
2. Follow the existing code style, naming conventions, and folder structure of the repo
3. Add JSDoc/KDoc comments on all public methods
4. Never hardcode secrets, URLs, or environment values — use config/env abstractions
5. Handle errors explicitly — no silent catches
6. After each logical group of files, do an incremental commit:
   ```bash
   git add <files>
   git commit -m "feat(<TICKET_ID>): <short description of what was implemented>"
   ```
7. Update PLAN.md checkboxes as each acceptance criterion is met

**Tech stack detection:** Before writing code, inspect `package.json` / `pom.xml`
to detect the stack and use appropriate patterns:
- **Spring Boot / Kotlin**: use data classes, coroutines, jOOQ for DB, RestController pattern
- **Angular**: use standalone components, signals, Angular 19+ patterns
- **React/Next.js**: use functional components, hooks, server actions where applicable
- **Node/Express**: use typed routes, middleware pattern, zod for validation

---

### PHASE 5 — Generate Tests (Vitest for Angular · JUnit 5 for Kotlin)

**Goal:** Achieve meaningful, CI-runnable test coverage for all new code.

> ⚠️ **Playwright is NOT generated here.** Playwright runs outside CI (see Phase 6).
> This phase produces only Vitest component/service tests and JUnit 5 unit/slice tests.

**Rules:**
1. Generate test files immediately after each implementation file — never batch at the end
2. **Angular / TypeScript:** Use **Vitest** + `@testing-library/angular` — NOT Jest, NOT Karma
3. **Kotlin / Spring Boot:** Use JUnit 5 + MockK — NOT Mockito
4. Co-locate test files next to the source file: `user-card.component.spec.ts` beside `user-card.component.ts`
5. Each test file MUST include:
   - Happy path test
   - Edge case / boundary test
   - Error/exception path test
   - At least one parameterised/data-driven test where applicable
6. For Angular components: use `render()` from `@testing-library/angular` and `userEvent` for interactions.
   Query elements exclusively by `data-testid` — add missing `data-testid` attributes to components in Phase 4.
7. Run and fix until green:
   ```bash
   # Angular — Vitest (fast, no browser needed)
   npx vitest run src/features/<feature>/

   # Kotlin — JUnit 5
   mvn test -Dtest="*Feature*" --batch-mode
   ```
8. Commit:
   ```bash
   git add <test files>
   git commit -m "test(<TICKET_ID>): add vitest component tests and junit unit tests"
   ```

**Coverage targets (CI-enforced):**
- Angular components ≥ 80% · services ≥ 85% · pipes/utilities ≥ 90%
- Kotlin domain services ≥ 90% · app services ≥ 85% · controllers ≥ 80%

---

### PHASE 6 — Generate Playwright E2E Specs (runs outside CI)

**Goal:** Write browser-level end-to-end tests covering the full user journey.

> ⚠️ Playwright specs are **NOT** part of the CI/CD pipeline.
> They run locally (for debugging) or on a nightly schedule against a deployed staging environment.
> Do NOT add `npx playwright test` to the CI workflow — it belongs in `playwright-nightly.yml` only.

**File location:**
```
e2e/<ticket-id-lowercase>-<feature-slug>.spec.ts
```
Example: `e2e/<ticket-id>-<slug>.spec.ts`

Use `e2e/_TEMPLATE.spec.ts` as the structural reference.
Replace ALL occurrences of `<YOUR-TICKET-ID>` with the real ticket ID from `ticket.json`.
Derive the filename dynamically — never copy the template filename literally.

**Spec structure Copilot MUST follow:**

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage }   from './pages/LoginPage';
// import { FeaturePage } from './pages/FeaturePage'; // create POM if missing

const TICKET_ID = process.env.TICKET_ID; // injected from ticket.json by Copilot Agent

test.describe(`[${TICKET_ID}] <Feature Name>`, () => {

  test.beforeEach(async ({ page }) => {
    // Reuse saved auth state — no re-login per test
    await page.goto(process.env.BASE_URL + '/start-path');
    await page.waitForLoadState('networkidle');
  });

  test('should successfully complete main acceptance criterion', async ({ page }) => {
    // Arrange → Act → Assert
  });

  test('should show validation error when input is invalid', async ({ page }) => { });

  test('should handle downstream failure gracefully', async ({ page }) => {
    await page.route('**/api/reports/*/export', route => route.abort('failed'));
    // ...
  });

  test('should pass basic accessibility checks', async ({ page }) => {
    // Use @axe-core/playwright if available
  });

  test('should be usable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // ...
  });
});
```

**Page Object Model (POM):**
- Create/update POM files in `e2e/pages/` for any new pages introduced
- All selectors live in POMs — no raw `getByTestId` calls in spec bodies
- Every interactive element needs a `data-testid` (added in Phase 4)

**Local verification (do NOT run in CI):**
```bash
npx playwright test e2e/<ticket-id>-<slug>.spec.ts --headed
```

**Commit:**
```bash
git add e2e/
git commit -m "test(<TICKET_ID>): add playwright e2e spec (runs outside CI)"
```

---

### PHASE 7 — Final Checks & Push

**Goal:** Validate everything is green before raising the PR.

```bash
# ── Angular ──────────────────────────────────────────────────────
# Run Vitest (all component + service tests)
npx vitest run

# Type check
npx tsc --noEmit

# Lint
npm run lint

# ── Kotlin / Spring Boot ─────────────────────────────────────────
mvn verify ktlint:check --batch-mode
```

> ⚠️ Do NOT run `npx playwright test` here — Playwright is excluded from CI.
> If you want to spot-check the new feature's E2E spec locally before raising the PR,
> run it manually: `npx playwright test e2e/<ticket-id>-<slug>.spec.ts --headed`

If any step fails → fix before pushing.

```bash
# Push branch to origin
git push -u origin $(cat .github/context/branch.txt)
```

---

### PHASE 8 — Create Pull Request

**Goal:** Raise a well-structured PR via GitHub API.

```bash
node .github/scripts/create-pr.js <TICKET_ID>
```

**Script behavior (`create-pr.js`):**
- Reads `ticket.json`, `repo.json`, and `PLAN.md` from context
- Detects gh CLI availability via `gh-or-api.js`
- **With gh CLI:** writes PR body to a temp file, calls `gh pr create --body-file` — clean multi-line support, no shell-escaping issues; labels applied via `gh pr edit`; reviewers via `--reviewer` flags
- PR title: `[<TICKET_ID>] <summary>`
- Outputs PR URL to console and appends to `run.log`

**PR Body Template (auto-generated):**
```markdown
## 🎫 Jira Ticket
[<TICKET_ID>](<JIRA_BASE_URL>/browse/<TICKET_ID>) — <Summary>

## 📋 What & Why
<Description from ticket>

## ✅ Acceptance Criteria
- [x] AC1: ...
- [x] AC2: ...

## 🗂️ Changes
| File | Change |
|------|--------|
| src/... | Added export endpoint |

## 🧪 Test Coverage
- Unit tests: `src/__tests__/export.test.ts`
- Integration: `src/__tests__/integration/export.integration.test.ts`
- E2E (Playwright): `e2e/<ticket-id>-<feature-slug>.spec.ts`

## 📸 Screenshots / Recordings
<!-- Add if UI changes are involved -->

## 🔍 Review Notes
<!-- Anything reviewers should pay special attention to -->

---
*Generated by Copilot Agent Mode · Jira-to-PR Skill*
```

---

## Helper Scripts

Place all scripts in `.github/scripts/`. They share a common `.env` loader.

### `gh-or-api.js`
gh CLI wrapper — verifies `gh` is on PATH and authenticated at startup (exits with a clear
message if not). Exports `exec` and `ghExec` helpers used by all other scripts.

### `fetch-jira.js`
Calls Jira REST API v3 — fetches issue, converts ADF to plain text, extracts repo name, writes `ticket.json`.

### `repo-setup.js`
Detects required stack (frontend/backend/fullstack) from ticket signals, confirms with user, then orchestrates
`bootstrap-frontend.js` for Angular repos and plain repo creation for backend repos.

### `create-pr.js`
Uses `gh pr create --body-file` for clean multi-line PR body creation.

### `load-env.js`
Loads `.env`, validates Jira credentials and `GITHUB_ORG`. No GitHub token required.

---

## `.github/context/` Directory

This directory is the **shared state** between all phases.
Never delete it during a run.

```
.github/
  context/
    ticket.json       ← Written by Phase 1
    branch.txt        ← Written by Phase 2
    PLAN.md           ← Written by Phase 3
    run.log           ← Append-only log of each phase completion
  scripts/
    fetch-jira.js
    repo-setup.js
    create-pr.js
    load-env.js
```

---

## Error Handling

| Failure Scenario                    | Recovery Action                                              |
|-------------------------------------|--------------------------------------------------------------|
| Jira API 401                        | Validate `JIRA_API_TOKEN` and `JIRA_EMAIL` in `.env`         |
| Jira ticket not found (404)         | Confirm ticket ID format matches your Jira project key (e.g. `ABC-123`)    |
| GitHub repo creation fails          | Run `gh auth status` — re-authenticate with `gh auth login`  |
| Branch already exists               | Append `-v2` suffix or prompt for action                     |
| Tests fail after implementation     | Do NOT push. Fix failures in Phase 4/5 files first           |
| Playwright tests fail               | Run `--headed` to visually debug; check `data-testid` attrs  |
| PR creation fails (422)             | Branch may not be pushed yet; re-run Phase 7 push step       |

---

## Invocation Examples

```
# Minimal invocation
implement ticket <YOUR-TICKET-ID>

# With explicit repo (when auto-detect is ambiguous)
implement ticket <YOUR-TICKET-ID> in repo <your-repo-name>

# With reviewer assignment
implement ticket <YOUR-TICKET-ID> and request review from <github-username>

# Dry run — plan only, no code
plan ticket <YOUR-TICKET-ID>
```

---

## Skill Metadata
- **Version:** 2.0.0
- **Compatible with:** GitHub Copilot Agent Mode (VS Code 1.95+)
- **Works with:** Any JS/TS, Kotlin/Spring Boot, Angular, React project
- **Author:** Enterprise Dev Automation

---

## Coding Guidelines

Copilot Agent MUST read and apply the following guideline files **before writing any code**
in Phases 4, 5, and 6. These are non-negotiable — all generated code must conform.

```
.github/
  guidelines/
    GUIDELINES-ANGULAR.md           ← Angular 19+ / Standalone / Signals
    GUIDELINES-DESIGN-SYSTEM.md     ← Organisation DS tokens, components, exceptions
    GUIDELINES-SPRING-BOOT-KOTLIN.md← Kotlin idioms, jOOQ, REST, transactions
    GUIDELINES-AI-CODING.md         ← Karpathy-inspired AI-assisted dev principles
    GUIDELINES-TESTING.md           ← JUnit 5, Jest, AAA structure, mocking rules
```

### How to apply guidelines in each phase

**Phase 3 (PLAN.md):** Note which guidelines apply to each affected area in the table.

```markdown
| Layer     | File                        | Guideline             |
|-----------|-----------------------------|-----------------------|
| Frontend  | src/components/<Feature>/           | ANGULAR, DESIGN-SYSTEM|
| Backend   | src/service/<Feature>Service/ | SPRING-BOOT-KOTLIN    |
| Tests     | src/__tests__/export.test   | TESTING               |
| E2E       | e2e/export.spec.ts          | TESTING               |
```

**Phase 4 (Implementation):** Before writing each file, state which guideline you are following.
Example: *"Writing ExportController.kt — applying GUIDELINES-SPRING-BOOT-KOTLIN.md §3 REST Controllers"*

**Phase 5 (Tests):** Apply GUIDELINES-TESTING.md AAA structure, naming, and mocking rules.
All test names must be sentences describing behaviour, not implementation.

**Phase 6 (Playwright):** Apply GUIDELINES-TESTING.md §Playwright and GUIDELINES-ANGULAR.md
§`data-testid` rules. Every interactive element that lacks `data-testid` must have one added
as part of Phase 4 before the Playwright spec can reference it.

### Quick reference — non-negotiable rules

| Rule | Guideline |
|------|-----------|
| Standalone components + OnPush + `input()` signals | ANGULAR §2 |
| `inject()` function, not constructor params | ANGULAR §4 |
| DS components only — no raw HTML buttons/inputs | DESIGN-SYSTEM §3 |
| CSS custom property tokens only — no hardcoded colours | DESIGN-SYSTEM §2 |
| Sealed classes for domain results | SPRING-BOOT-KOTLIN §2 |
| `@Transactional` on app service, not repository | SPRING-BOOT-KOTLIN §8 |
| AAA test structure — always | TESTING §2 |
| Test names as behaviour sentences | TESTING §3 |
| MockK, not Mockito, for Kotlin | TESTING §6 |
| Think before coding — surface assumptions, ask when uncertain | AI-CODING §1 |
| Simplicity first — no speculative abstractions | AI-CODING §2 |
| Surgical changes — touch only what the ticket requires | AI-CODING §3 |
| Define verifiable success criteria before implementing | AI-CODING §4 |
| Generate one layer at a time, verify and commit each | AI-CODING §5 |
