# Spring Boot / Kotlin Coding Guidelines
# Version: 1.0 | Spring Boot 3.x, Kotlin 1.9+, jOOQ

## 1. Project Structure

```
src/
  main/
    kotlin/com/example/app/
      config/           # Spring configuration classes
      domain/           # Pure domain model — no Spring deps
        model/          # Data classes, value objects, enums
        service/        # Domain service interfaces
        repository/     # Repository interfaces (port)
        exception/      # Domain-specific exceptions
      application/      # Use-case orchestration (thin layer)
        service/        # Application services — call domain + infra
        dto/            # Request/response DTOs (input/output boundary)
        mapper/         # DTO ↔ domain mappers
      infrastructure/
        persistence/    # jOOQ repositories (adapters)
        web/            # REST controllers, exception handlers
          controller/
          advice/
        messaging/      # Kafka, RabbitMQ adapters
        external/       # HTTP clients (RestClient, WebClient)
      AppApplication.kt
  test/
    kotlin/com/example/app/
      unit/             # Pure unit tests (no Spring context)
      integration/      # @SpringBootTest slice tests
      e2e/              # Full application tests
```

---

## 2. Kotlin Idioms

### Data classes for DTOs and value objects
```kotlin
// ✅ Data class for immutable value objects
data class MoneyAmount(
    val amount: BigDecimal,
    val currency: Currency,
) {
    init {
        require(amount >= BigDecimal.ZERO) { "Amount cannot be negative: $amount" }
    }
}

// ✅ Data class for DTOs
data class CreateReportRequest(
    @field:NotBlank val name:        String,
    @field:NotNull  val reportType:  ReportType,
    val filters: List<ReportFilter> = emptyList(),
)
```

### Null safety — exhaust the type system
```kotlin
// ✅ Use nullable types explicitly; never platform types from Java
fun findUser(id: UserId): User?   // clearly nullable
fun getUser(id: UserId): User     // guaranteed non-null — throws if absent

// ✅ Safe navigation and Elvis
val name = user?.profile?.displayName ?: "Anonymous"

// ✅ let / run for null-safe blocks
user?.let { sendWelcomeEmail(it) }

// ❌ Never !! unless you have absolute proof it's non-null and you comment why
val id = result!!.id   // ❌
```

### Extension functions — prefer over utility classes
```kotlin
// ✅
fun String.toSlug(): String = lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
fun BigDecimal.formatCurrency(currency: Currency): String = ...

// ❌ Utility classes with static methods
object StringUtils { fun toSlug(s: String): String = ... }
```

### Sealed classes for domain results
```kotlin
sealed class PaymentResult {
    data class Success(val downloadUrl: String, val expiresAt: Instant) : PaymentResult()
    data class Empty(val reason: String)                                 : PaymentResult()
    data class Failed(val error: PaymentError)                           : PaymentResult()
}

// Exhaustive when — no else branch needed
when (val result = orderService.process(request)) {
    is PaymentResult.Success -> ResponseEntity.ok(result.downloadUrl)
    is PaymentResult.Empty   -> ResponseEntity.noContent().build()
    is PaymentResult.Failed  -> ResponseEntity.internalServerError().body(result.error)
}
```

---

## 3. REST Controllers

```kotlin
@RestController
@RequestMapping("/api/v1/reports")
class ReportController(
    private val reportService: ReportApplicationService,
) {
    // ✅ Return ResponseEntity with explicit types
    @GetMapping("/{id}")
    fun getReport(@PathVariable id: UUID): ResponseEntity<ReportResponse> {
        val order = orderService.findById(OrderId(id))
            ?: return ResponseEntity.notFound().build()
        return ResponseEntity.ok(report.toResponse())
    }

    // ✅ Use @Valid for request body validation
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun createReport(@RequestBody @Valid request: CreateReportRequest): ReportResponse =
        reportService.create(request).toResponse()

    // ✅ Pagination with Pageable
    @GetMapping
    fun listReports(
        @RequestParam(defaultValue = "0")  page: Int,
        @RequestParam(defaultValue = "25") size: Int,
        @RequestParam(required = false)    sortBy: String?,
    ): Page<ReportSummaryResponse> =
        reportService.list(PageRequest.of(page, size.coerceAtMost(100))).map { it.toSummary() }
}
```

### Rules
- Controllers are thin — no business logic; delegate to application services
- No direct repository calls from controllers
- Use `@ControllerAdvice` for all exception mapping — no try/catch in controllers
- Max 5 handler methods per controller; split by resource if more are needed

---

## 4. Exception Handling

```kotlin
// ✅ Typed domain exceptions
class OrderNotFoundException(id: OrderId) :
    RuntimeException("Report not found: ${id.value}")

class InsufficientPermissionsException(userId: UserId, action: String) :
    RuntimeException("User ${userId.value} not permitted to $action")

// ✅ Global handler maps domain exceptions → HTTP responses
@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(OrderNotFoundException::class)
    fun handleNotFound(ex: OrderNotFoundException): ResponseEntity<ErrorResponse> =
        ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ErrorResponse(code = "REPORT_NOT_FOUND", message = ex.message))

    @ExceptionHandler(ConstraintViolationException::class)
    fun handleValidation(ex: ConstraintViolationException): ResponseEntity<ValidationErrorResponse> = ...
}
```

---

## 5. jOOQ Repository Pattern

```kotlin
@Repository
class ReportJooqRepository(
    private val dsl: DSLContext,
) : ReportRepository {

    override fun findById(id: OrderId): Order? =
        dsl.selectFrom(REPORTS)
            .where(REPORTS.ID.eq(id.value))
            .and(REPORTS.DELETED_AT.isNull)         // always filter soft deletes
            .fetchOne()
            ?.toDomain()

    override fun findAll(filter: ReportFilter, page: Pageable): Page<Report> {
        val conditions = buildConditions(filter)
        val total = dsl.fetchCount(dsl.selectFrom(REPORTS).where(conditions))
        val records = dsl.selectFrom(REPORTS)
            .where(conditions)
            .orderBy(page.sort.toJooqSortField())
            .limit(page.pageSize)
            .offset(page.offset)
            .fetch()
            .map { it.toDomain() }
        return PageImpl(records, page, total.toLong())
    }

    // ✅ Private mapper keeps DB ↔ domain concern local
    private fun ReportsRecord.toDomain(): Report = Report(
        id          = OrderId(id),
        name        = name,
        reportType  = ReportType.valueOf(reportType),
        createdAt   = createdAt.toInstant(),
    )
}
```

### Rules
- Never expose jOOQ `Record` types outside the `infrastructure/persistence` package
- Always use `.and(TABLE.DELETED_AT.isNull)` for soft-deleted entities
- Complex queries must have an inline comment explaining intent
- No raw SQL strings — use jOOQ DSL exclusively

---

## 6. Configuration & Properties

```kotlin
// ✅ Typed configuration properties — no @Value field injection
@ConfigurationProperties(prefix = "app.export")
@Validated
data class ExportProperties(
    @field:NotBlank  val storageBucket:  String,
    @field:Min(60)   val urlTtlSeconds:  Long = 3600,
    @field:NotNull   val maxRowsPerExport: Int = 100_000,
)

// Register in main config
@EnableConfigurationProperties(ExportProperties::class)
```

```yaml
# application.yml — all env-specific values use ${ENV_VAR:default}
app:
  export:
    storage-bucket: ${EXPORT_STORAGE_BUCKET:dev-exports}
    url-ttl-seconds: ${EXPORT_URL_TTL:3600}
    max-rows-per-export: 100000
```

---

## 7. Logging

```kotlin
// ✅ Use SLF4J via Kotlin extension (kotlin-logging)
private val log = KotlinLogging.logger {}

class ReportService {
    fun export(request: PaymentRequest) {
        log.info { "Processing payment: orderId=${request.orderId}, amount=${request.amount}" }
        // ...
        log.debug { "Export rows fetched: count=${rows.size}" }
        log.warn  { "Export size approaching limit: rows=${rows.size}, max=$maxRows" }
    }
}

// ❌ Never log sensitive data (PII, passwords, tokens)
log.info { "User password: $password" }  // ❌
// ❌ No System.out.println or java.util.logging
```

---

## 8. Transactions

```kotlin
// ✅ @Transactional on application service methods, not repository methods
@Service
@Transactional(readOnly = true)          // default read-only for performance
class ReportApplicationService(
    private val repository: ReportRepository,
) {
    fun findById(id: OrderId): Order? = repository.findById(id)

    @Transactional                        // override for writes
    fun create(request: CreateReportRequest): Report {
        val report = Report.create(request)
        return repository.save(report)
    }
}

// ✅ Rollback for domain exceptions
@Transactional(rollbackFor = [DomainException::class])
```

---

## 9. Security

- Never log request bodies that may contain sensitive fields — use `@JsonIgnore` or field masking
- Always validate input at controller boundary with Bean Validation (`@Valid`, `@Validated`)
- Use Spring Security method-level security (`@PreAuthorize`) for fine-grained access control
- Secrets must come from environment variables or a secret manager — never hardcoded or in `application.yml` plaintext
- HTTP responses must never leak internal stack traces to clients — use `GlobalExceptionHandler`

---

## 10. Naming Conventions

| Artifact           | Convention     | Example                          |
|--------------------|----------------|----------------------------------|
| Class / Interface  | PascalCase     | `PaymentService`            |
| Function / var     | camelCase      | `processPayment`, `findByStatus`      |
| Constant           | SCREAMING_SNAKE| `MAX_EXPORT_ROWS`                |
| Package            | lowercase      | `com.example.app.domain.model`   |
| DB table (jOOQ)    | SCREAMING_SNAKE| `REPORT_EXPORTS`                 |
| Config prefix      | kebab-case     | `app.export.storage-bucket`      |
| Test class         | suffix `Test`  | `PaymentServiceTest`        |
| Integration test   | suffix `IT`    | `ReportControllerIT`             |

---

## 11. Forbidden Patterns

```kotlin
// ❌ No field injection — constructor injection only
@Autowired lateinit var service: ReportService  // ❌

// ❌ No mutable state in @Service / @Component beans (unless thread-safe)
@Service class ReportService { var cache = mutableListOf<Report>() }  // ❌

// ❌ No blocking calls inside coroutine suspending functions without Dispatchers.IO
suspend fun fetchSlowResource() = slowBlockingCall()  // ❌
suspend fun fetchSlowResource() = withContext(Dispatchers.IO) { slowBlockingCall() }  // ✅

// ❌ No Optional<T> — use Kotlin nullable T? instead
fun findById(id: UUID): Optional<Report>  // ❌
fun findById(id: UUID): Report?           // ✅
```
