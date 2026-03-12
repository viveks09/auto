# Testing Guidelines
# Version: 2.0 | JUnit 5 + MockK (Kotlin/Spring Boot) · Vitest + @testing-library (Angular) · Playwright (manual E2E only)

## Testing Strategy — What runs where

```
┌─────────────────────────────────────────────────────────────────┐
│  CI / CD Pipeline  (runs on every push / PR)                    │
│                                                                 │
│  Angular UI           Spring Boot / Kotlin                      │
│  ─────────────        ───────────────────────                   │
│  Vitest               JUnit 5 unit tests                        │
│  @testing-library     @WebMvcTest slice tests                   │
│  Component tests      @JooqTest / @DataJpaTest                  │
│  Service/pipe tests   MockK mocks                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Playwright E2E  (manual run / scheduled nightly — NOT in CI)   │
│                                                                 │
│  Full browser journeys against a deployed environment           │
│  Run locally with: npx playwright test                          │
│  Scheduled: nightly against staging (separate workflow)         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Rationale for keeping Playwright out of CI:**
- Browser test startup time (10–30s per worker) would double pipeline duration
- Flakiness on transient network/DOM timing would cause false failures on good code
- Component behaviour is fully covered by Vitest + @testing-library at the unit level
- Full user journeys are validated by Playwright on a stable deployed environment instead

---

## Core Philosophy

> A test suite that you don't trust is worse than no tests at all.
> Write tests you can read, run, and rely on.

Tests serve three audiences:
1. **The compiler** — prove correctness at change time
2. **The reviewer** — document intended behaviour as living specification
3. **Future you** — understand what a piece of code was supposed to do 6 months from now

---

## The Three Laws of Unit Testing

1. A unit test tests **one** logical behaviour — one reason to fail
2. A unit test is **completely isolated** — no shared mutable state between tests
3. A unit test is **deterministic** — same result every run, regardless of order

---

## Structure: Arrange / Act / Assert (AAA)

Every test body — Vitest, JUnit, or Playwright — must follow AAA with blank lines separating each phase:

```typescript
// Vitest / Angular example
it('should emit exportRequested event when Export button is clicked', async () => {
  // Arrange
  const { fixture, component } = await setup();
  const emitted: PaymentFormat[] = [];
  component.exportRequested.subscribe(f => emitted.push(f));

  // Act
  await userEvent.click(screen.getByTestId('submit-button'));

  // Assert
  expect(emitted).toEqual(['csv']);
});
```

```kotlin
// JUnit 5 / Kotlin example
@Test
fun `should return PaymentResult_Success when order exists and is processable`() {
    // Arrange
    val orderId = OrderId(UUID.randomUUID())
    every { repository.findById(orderId) } returns buildOrder(id = orderId)
    every { csvWriter.write(any()) } returns "s3://exports/file.csv"

    // Act
    val result = paymentService.export(PaymentRequest(orderId, PaymentFormat.STANDARD))

    // Assert
    assertThat(result).isInstanceOf(PaymentResult.Success::class.java)
    assertThat((result as PaymentResult.Success).downloadUrl).startsWith("s3://")
}
```

---

## Naming: Tests as Specifications

Test names describe **behaviour**, not implementation:

```typescript
// ✅ Vitest — describes observable behaviour
it('should disable Export button while export is in progress')
it('should show validation error when report name is blank')
it('should render skeleton placeholders while data is loading')

// ❌ Describes implementation
it('testSubmitButton')
it('exportReturnsNull')
```

```kotlin
// ✅ Kotlin backtick sentences
@Test fun `should throw OrderNotFoundException when order does not exist`()
@Test fun `should apply pagination limit of 100 when requested size exceeds maximum`()

// ❌
@Test fun `testPaymentService`()
```

---

## Part A — Angular / TypeScript with Vitest

### Setup

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals:     true,
    environment: 'jsdom',
    setupFiles:  ['src/test-setup.ts'],
    include:     ['src/**/*.spec.ts'],
    exclude:     ['e2e/**'],          // ← Playwright specs never run in Vitest
    coverage: {
      provider:  'v8',
      reporter:  ['text', 'lcov'],
      exclude:   ['**/*.config.*', '**/index.ts', '**/*.routes.ts'],
      thresholds: {
        lines:    80,
        branches: 75,
        functions: 80,
      },
    },
  },
});
```

```typescript
// src/test-setup.ts
import '@testing-library/jest-dom/vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';

// Reset TestBed after each test
afterEach(() => TestBed.resetTestingModule());
```

### Component tests with @testing-library/angular

```typescript
// user-card.component.spec.ts
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { UserCardComponent } from './user-card.component';

describe('UserCardComponent', () => {

  async function setup(overrides: Partial<{ user: User }> = {}) {
    const user = overrides.user ?? buildUser();
    const result = await render(UserCardComponent, {
      componentInputs: { user },
    });
    return { ...result, user };
  }

  it('should display the user display name', async () => {
    // Arrange
    const { user } = await setup({ user: buildUser({ displayName: 'Vivek' }) });

    // Act — (render is the act here)

    // Assert
    expect(screen.getByTestId('user-display-name')).toHaveTextContent('Vivek');
  });

  it('should emit select event when card is clicked', async () => {
    // Arrange
    const { fixture } = await setup();
    const emitted: User[] = [];
    fixture.componentInstance.select.subscribe((u: User) => emitted.push(u));

    // Act
    await userEvent.click(screen.getByTestId('user-card'));

    // Assert
    expect(emitted).toHaveLength(1);
  });

  it('should show loading skeleton when isLoading input is true', async () => {
    await render(UserCardComponent, {
      componentInputs: { user: buildUser(), isLoading: true },
    });
    expect(screen.getByTestId('user-card-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('user-display-name')).not.toBeInTheDocument();
  });
});
```

### Service tests

```typescript
// report-export.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PaymentService } from './payment.service';

describe('PaymentService', () => {
  let sut:        PaymentService;
  let httpMock:   HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports:   [HttpClientTestingModule],
      providers: [PaymentService],
    });
    sut      = TestBed.inject(PaymentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify()); // ensures no unexpected HTTP calls

  it('should POST to /api/reports/:id/export and return download URL', () => {
    // Arrange
    const orderId = 'r-123';
    let result: PaymentResult | undefined;

    // Act
    sut.export(orderId, 'csv').subscribe(r => result = r);

    const req = httpMock.expectOne(`/api/reports/${orderId}/export`);
    expect(req.request.method).toBe('POST');
    req.flush({ downloadUrl: 'https://cdn/file.csv', expiresAt: '2099-01-01T00:00:00Z' });

    // Assert
    expect(result?.downloadUrl).toBe('https://cdn/file.csv');
  });

  it('should throw PaymentError when API returns 500', () => {
    // Arrange
    let thrownError: unknown;
    sut.export('r-bad', 'csv').subscribe({ error: e => thrownError = e });

    // Act
    httpMock.expectOne('/api/reports/r-bad/export')
      .flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

    // Assert
    expect(thrownError).toBeInstanceOf(PaymentError);
  });
});
```

### Signal / computed tests

```typescript
it('should recompute filteredReports when search signal changes', async () => {
  // Arrange
  const { fixture } = await render(ReportListComponent, {
    componentInputs: { reports: [buildReport({ name: 'Alpha' }), buildReport({ name: 'Beta' })] },
  });
  const component = fixture.componentInstance;

  // Act
  component.searchQuery.set('alp');
  fixture.detectChanges();

  // Assert
  expect(component.filteredReports()).toHaveLength(1);
  expect(component.filteredReports()[0].name).toBe('Alpha');
});
```

### Pipe tests

```typescript
describe('CurrencyFormatPipe', () => {
  const pipe = new CurrencyFormatPipe();

  it.each([
    [1234567.89, 'INR', '₹12,34,567.89'],   // Indian lakh formatting
    [1000,       'USD', '$1,000.00'],
    [0,          'EUR', '€0.00'],
  ])('should format %d %s as %s', (amount, currency, expected) => {
    expect(pipe.transform(amount, currency)).toBe(expected);
  });
});
```

### What to test with Vitest

| What | Test with |
|------|-----------|
| Component rendering, inputs, outputs | `@testing-library/angular` + `render()` |
| User interactions (click, type, tab) | `@testing-library/user-event` |
| HTTP service calls | `HttpClientTestingModule` + `HttpTestingController` |
| Signals, computed, effects | `TestBed` + `fixture.detectChanges()` |
| Pipes, pure functions | Direct instantiation — no TestBed needed |
| Directives | `render()` with a host component wrapper |
| Guards, resolvers | Direct unit test with mocked router/services |

### What NOT to test with Vitest

| What | Why | Alternative |
|------|-----|-------------|
| Full page navigation flows | Too complex, brittle | Playwright |
| Real API integration | Slow, requires server | Backend integration tests |
| Cross-browser rendering | Not the concern of unit tests | Playwright multi-browser |
| Design system components | Tested by DS team | Trust the DS |

---

## Part B — Kotlin / Spring Boot with JUnit 5

### Unit tests (no Spring context)

```kotlin
@ExtendWith(MockKExtension::class)
class PaymentServiceTest {
    @MockK lateinit var repository:  ReportRepository
    @MockK lateinit var csvWriter:   CsvExportWriter
    @MockK lateinit var blobStorage: BlobStorageService

    @InjectMockKs
    lateinit var sut: PaymentService

    @Test
    fun `should return PaymentResult_Success when order data is valid`() {
        // Arrange
        val report = buildOrder(rowCount = 50)
        every { repository.findById(report.id) } returns report
        every { csvWriter.write(any()) }          returns "/tmp/export.csv"
        every { blobStorage.upload(any(), any()) } returns "https://cdn/export.csv"

        // Act
        val result = sut.process(PaymentRequest(report.id, PaymentFormat.STANDARD))

        // Assert
        assertThat(result).isInstanceOf(PaymentResult.Success::class.java)
        verify(exactly = 1) { blobStorage.upload(any(), any()) }
    }

    @Test
    fun `should return PaymentResult_Empty when order has no line items`() {
        every { repository.findById(any()) } returns buildOrder(rowCount = 0)

        val result = sut.process(PaymentRequest(OrderId(UUID.randomUUID()), PaymentFormat.STANDARD))

        assertThat(result).isInstanceOf(PaymentResult.Empty::class.java)
        verify(exactly = 0) { blobStorage.upload(any(), any()) }
    }
}
```

### Controller slice tests

```kotlin
@WebMvcTest(ReportController::class)
class ReportControllerIT {
    @Autowired lateinit var mockMvc: MockMvc
    @MockBean  lateinit var reportService: ReportApplicationService

    @Test
    fun `GET report returns 200 with body when report exists`() {
        val order = buildOrder()
        every { reportService.findById(any()) } returns report

        mockMvc.perform(get("/api/v1/reports/${report.id.value}").accept(APPLICATION_JSON))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.id").value(report.id.value.toString()))
            .andExpect(jsonPath("$.name").value(report.name))
    }

    @Test
    fun `GET report returns 404 when report does not exist`() {
        every { reportService.findById(any()) } returns null

        mockMvc.perform(get("/api/v1/reports/${UUID.randomUUID()}"))
            .andExpect(status().isNotFound)
    }
}
```

### Test data builders

```kotlin
// src/test/kotlin/.../testdata/ReportFixtures.kt
fun buildReport(
    id:         OrderId     = OrderId(UUID.randomUUID()),
    name:       String       = "Report-${id.value.toString().take(8)}",
    reportType: ReportType   = ReportType.SUMMARY,
    status:     ReportStatus = ReportStatus.ACTIVE,
    rowCount:   Int          = 10,
): Report = Report(id, name, reportType, status, rowCount)
```

### Parameterised tests

```kotlin
@ParameterizedTest
@ValueSource(ints = [101, 500, 1000, Int.MAX_VALUE])
fun `should clamp page size to 100 for any value above maximum`(requestedSize: Int) {
    val result = reportService.list(PageRequest.of(0, requestedSize))
    assertThat(result.pageable.pageSize).isEqualTo(100)
}
```

---

## Part C — Playwright (Manual / Scheduled Only)

> ⚠️ Playwright specs are **NOT** part of the CI/CD pipeline.
> They run locally or on a nightly schedule against a deployed staging environment.

```bash
# Local run (headed for debugging)
npx playwright test --headed

# Local run (headless)
npx playwright test

# Single spec
npx playwright test e2e/<ticket-id>-<slug>.spec.ts

# Nightly scheduled — triggered by .github/workflows/playwright-nightly.yml
```

Playwright specs live in `e2e/` and follow the template in `e2e/_TEMPLATE.spec.ts`.
See Phase 6 of the skill for spec generation rules.

---

## Coverage Targets (CI-enforced)

| Layer (Angular)        | Tool   | Target   |
|------------------------|--------|----------|
| Components             | Vitest | ≥ 80%    |
| Services               | Vitest | ≥ 85%    |
| Pipes / utilities      | Vitest | ≥ 90%    |

| Layer (Kotlin)         | Tool      | Target   |
|------------------------|-----------|----------|
| Domain services        | JUnit 5   | ≥ 90%    |
| Application services   | JUnit 5   | ≥ 85%    |
| Controllers            | JUnit 5   | ≥ 80%    |
| Repositories           | JUnit 5   | ≥ 70%    |

Coverage is a **floor**, not a goal. Meaningful tests beat coverage padding.

---

## Anti-Patterns to Avoid

```typescript
// ❌ Using Playwright/browser APIs in Vitest specs
import { chromium } from 'playwright'; // ❌ wrong test layer

// ❌ Testing DOM details that don't reflect user-facing behaviour
expect(component['_internalSignal']()).toBe(true); // ❌ private impl

// ❌ Snapshot tests for component templates (too brittle, noise in PRs)
expect(fixture.nativeElement).toMatchSnapshot(); // ❌

// ❌ Shared mutable state between tests
let sharedService: PaymentService; // ❌ at describe scope without reset
```

```kotlin
// ❌ Thread.sleep — use Awaitility
Thread.sleep(1000) // ❌

// ❌ Silent mock verification just for coverage
verify { repo.findById(any()) } // ❌ if return value was already asserted

// ❌ Commented-out tests — delete or fix them
// @Test fun `old broken thing`() { }
```
