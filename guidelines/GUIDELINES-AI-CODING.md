# AI-Assisted Coding Guidelines
# Version: 2.0
# Source: Andrej Karpathy's observations on LLM coding pitfalls
# https://x.com/karpathy/status/2015883857489522876

> **Tradeoff:** These guidelines bias toward caution over speed.
> For trivial tasks (renaming a variable, adding a config key), use judgment.
> For anything structural, follow them fully.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before writing a single line of implementation, Copilot MUST:

- State assumptions explicitly. If uncertain about intent, **ask** — do not guess silently.
- If multiple valid interpretations of a requirement exist, **present them** and wait for
  a choice rather than picking one without disclosure.
- If a simpler approach exists than what was asked for, **say so and push back**.
  The best solution is often not the one literally described in the ticket.
- If something in the existing codebase is confusing or contradictory, **name it**.
  Do not paper over confusion with code that works by accident.

```
❌ Silently picks one interpretation, implements it, hopes for the best
✅ "I see two ways to interpret this AC:
    A) Export filters the current view only
    B) Export always exports all rows regardless of filters
   Which did you mean?"
```

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was explicitly asked for
- No abstractions introduced for single-use code
- No "flexibility" or "configurability" that was not requested
- No error handling for scenarios that cannot actually occur
- No future-proofing that adds complexity today for hypothetical value later

**The rewrite test:** If you wrote 200 lines and it could be 50, rewrite it.

**The senior engineer test:** Ask yourself — *"Would a senior engineer say this is
overcomplicated?"* If yes, simplify before showing it.

```kotlin
// ❌ Over-engineered for a single call site
interface ExportStrategyFactory {
    fun <T : ExportStrategy> create(type: KClass<T>): T
}

// ✅ Simple — one use case, one function
fun createOrder(request: CreateOrderRequest): OrderResult { ... }
```

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

### When editing existing code
- Do not "improve" adjacent code, comments, or formatting unrelated to the task
- Do not refactor things that are not broken
- Match the existing style of the file, even if you would do it differently from scratch
- If you notice unrelated dead code or a bug, **mention it in a PR note** —
  do not silently fix it (that makes the diff harder to review)

### When your changes create orphans
- Remove imports, variables, and functions that **your changes** made unused
- Do not remove pre-existing dead code unless explicitly asked

**The traceability test:** Every changed line must trace directly to the user's request.
If you cannot justify a change against the ticket, revert it.

```kotlin
// You were asked to add an `exportedAt` field to Report.
// ✅ Add the field and update the mapper that uses Report
// ❌ Also "clean up" the unrelated status field naming while you're in there
```

---

## 4. Goal-Driven Execution

**Define success criteria upfront. Loop until verified.**

Before implementing, transform the task into verifiable goals:

| Vague task | Verifiable goal |
|---|---|
| "Add validation" | Write tests for invalid inputs, then make them pass |
| "Fix the bug" | Write a test that reproduces the bug, then make it pass |
| "Refactor X" | Ensure all existing tests pass before and after — no behaviour change |
| "Add the export endpoint" | `POST /api/reports/:id/export` returns `{ downloadUrl }` with status 201 |

For any multi-step task, state a brief plan with explicit verification steps:

```
Plan for <TICKET-ID>: <short feature description>

1. Add domain result sealed class            → verify: compiles, data class equality works
2. Add Repository interface               → verify: compiles, used by service
3. Implement ApplicationService           → verify: unit tests green
4. Add Controller endpoint                → verify: @WebMvcTest slice returns 201
5. Add Vitest test for new component      → verify: npx vitest run passes
6. Run full test suite                    → verify: mvn verify && npx vitest run
```

Strong success criteria let Copilot loop and self-correct independently.
Weak criteria ("make it work") require constant back-and-forth.

---

## 5. Incremental Generation — One Layer at a Time

Never generate an entire feature in one shot. Generate, verify, commit, repeat.

```
❌ "Write the complete export feature end-to-end"

✅ Step 1: "Write domain result sealed class"           → review → commit
✅ Step 2: "Write ExportRepository interface"        → review → commit
✅ Step 3: "Write ExportApplicationService"          → review → commit
✅ Step 4: "Write ExportController"                  → review → commit
✅ Step 5: "Write Vitest tests for new component"      → review → commit
✅ Step 6: "Write JUnit tests for application service" → review → commit
```

This prevents cascading hallucinations where a wrong assumption in layer N
silently propagates through N+1, N+2, and only surfaces at N+3.

---

## 6. Write the Test First, Then Implement

AI-written tests that come after the implementation tend to mirror the implementation
rather than verify the requirements. The correct sequence:

1. **You write** the test skeleton — method names and assertions derived from the AC
2. **Copilot fills** the test bodies (arrange/act/assert detail)
3. **You review** — does this actually verify the requirement, or just the code path?
4. **Copilot writes** the implementation to make those tests pass
5. **You run** the tests — green means done, not "green means Copilot thinks it's done"

---

## 7. Never Trust AI with Security-Sensitive Code

The following areas require **human-authored or senior-reviewed code**:

- Authentication and authorisation logic
- SQL construction (use jOOQ DSL — never string concatenation)
- Cryptographic operations (use the standard library — never roll your own)
- File path construction (always sanitise and validate inputs)
- Token validation and session management
- PII handling, masking, and data retention logic

When Copilot generates code in these areas, add a `// SECURITY-REVIEW:` comment
so a reviewer knows to inspect it explicitly during PR review.

---

## 8. Verify Library and API Usage

Copilot's training data has a cutoff. It may suggest deprecated APIs, renamed methods,
or signatures that changed between major versions.

Always verify against the actual version in your `pom.xml` / `package.json`:

- Spring Security 6.x changed `HttpSecurity` configuration significantly from 5.x
- Spring Boot 3.x requires `jakarta.*` imports, not `javax.*`
- jOOQ DSL methods vary between 3.14 and 3.19
- Angular 17+ `input()` / `output()` signals replace `@Input()` / `@Output()` decorators

```bash
mvn dependency:tree | grep -E "spring-security|jooq"
cat package.json | grep -E "angular|vitest"
```

---

## 9. Refactor Copilot Output to Codebase Conventions

AI does not know your naming conventions or architecture unless you tell it.
After generation, before committing:

1. Rename to match project conventions (see language-specific guidelines)
2. Move to the correct package/folder per project structure
3. Replace generic `Exception` / `Error` with your typed exception hierarchy
4. Replace `println` / `console.log` with your logging patterns
5. Remove speculative abstractions — one call site does not need an interface

---

## 10. The Newspaper Test

Before committing any AI-generated logic, ask:

> *"If this code caused a production incident, could I explain exactly what it does
>  and why I chose to trust it?"*

If the answer is no — read it again, add explaining comments, or rewrite the unclear parts.
The bar is not "it looks fine". The bar is "I can defend every line in an incident review".

---

## 11. What Copilot is Good At — Lean Into These

| Task | Why Copilot excels |
|------|--------------------|
| Data classes, DTOs, mappers | Pure structure, low risk |
| Test scaffolding (AAA setup, mock wiring) | Repetitive pattern it knows well |
| Boilerplate controllers and CRUD | Well-established patterns |
| Regex and string transformations | Bounded, verifiable output |
| KDoc / JSDoc / OpenAPI descriptions | Low-stakes, easily reviewed |
| `vitest.config.ts`, `application.yml` setup | Declarative and easy to check |

---

## 12. What Copilot is Bad At — Extra Caution Required

| Task | Risk |
|------|------|
| Distributed systems (transactions, idempotency) | Subtle correctness bugs |
| Performance at scale (query plans, connection pools) | Works locally, fails at 10x load |
| Security edge cases (IDOR, path traversal, replay) | Plausible-looking but wrong |
| Your org's domain logic and business rules | It has never seen your domain |
| Financial calculations requiring exact precision | Off-by-one in `BigDecimal` rounding |
| Long-range dependencies across files it has not seen | Hallucinates interfaces/signatures |
