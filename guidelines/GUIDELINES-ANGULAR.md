# Angular Coding Guidelines
# Version: 1.0 | Angular 19+ / Standalone Components

## 1. Architecture & File Structure

### Folder layout (feature-first)
```
src/
  app/
    core/                   # Singleton services, interceptors, guards
      interceptors/
      guards/
      services/
    shared/                 # Reusable components, directives, pipes, design system wrappers
      components/
      directives/
      pipes/
      design-system/        # Wrappers around org design system tokens & components
    features/
      <feature-name>/
        components/         # Presentational (dumb) components — no direct service injection
        containers/         # Smart components — own data fetching / state
        services/           # Feature-scoped services
        models/             # Interfaces, types, enums for this feature
        store/              # NgRx signals store or component store (if needed)
        <feature>.routes.ts
        index.ts            # Public API barrel export
    app.config.ts
    app.routes.ts
```

### Rules
- Every feature is a **lazy-loaded route** — never eagerly import feature modules
- `index.ts` barrel files expose only what is needed by other features
- No cross-feature imports — features communicate via shared services or signals only

---

## 2. Components

### Always use standalone components (Angular 15+)
```typescript
// ✅ Correct
@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule, RouterLink, UserAvatarComponent],
  template: `...`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserCardComponent { }

// ❌ Wrong — no NgModules for new code
@NgModule({ declarations: [UserCardComponent] })
```

### Change detection
- Always use `ChangeDetectionStrategy.OnPush` for every component
- Use `input()` signals and `output()` signals (Angular 17+) instead of `@Input()` / `@Output()`

```typescript
// ✅ Signals-based I/O (Angular 17+)
export class UserCardComponent {
  user     = input.required<User>();
  selected = input(false);
  select   = output<User>();

  onSelect() { this.select.emit(this.user()); }
}

// ❌ Decorator-based (legacy — only for existing code)
@Input()  user!: User;
@Output() select = new EventEmitter<User>();
```

### Component size
- Max 200 lines per component file (template + class combined)
- Extract child components when a template exceeds ~50 lines
- No business logic in templates — move to computed signals or methods

---

## 3. Signals & State

### Prefer signals over RxJS for local state
```typescript
// ✅ Signals for local, synchronous state
export class CounterComponent {
  count    = signal(0);
  doubled  = computed(() => this.count() * 2);

  increment() { this.count.update(n => n + 1); }
}

// ✅ RxJS for async streams, HTTP, WebSocket
export class NotificationsService {
  private _items$ = new BehaviorSubject<Notification[]>([]);
  items$ = this._items$.asObservable();
}
```

### toSignal / toObservable for bridging
```typescript
// Convert observable to signal for template use
readonly items = toSignal(this.notificationService.items$, { initialValue: [] });
```

---

## 4. Services

```typescript
@Injectable({ providedIn: 'root' })   // root for singletons
@Injectable({ providedIn: 'any' })    // feature-scoped (rare)
export class UserService {
  private readonly http = inject(HttpClient);  // ✅ inject() — not constructor DI

  getUser(id: string): Observable<User> {
    return this.http.get<User>(`/api/users/${id}`).pipe(
      catchError(this.handleError)
    );
  }

  private handleError(err: HttpErrorResponse): Observable<never> {
    // Log to monitoring service, rethrow typed error
    return throwError(() => new AppError(err.status, err.message));
  }
}
```

### Rules
- Use `inject()` function, not constructor parameter injection, for all new services
- Services must not hold mutable state that is not protected by signals or subjects
- One responsibility per service — split at ~150 lines

---

## 5. Routing

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: 'reports',
    loadComponent: () => import('./features/reports/containers/reports-shell.component')
      .then(m => m.ReportsShellComponent),
    canActivate: [authGuard],
  },
  {
    path: 'reports/:id',
    loadComponent: () => import('./features/reports/containers/report-detail.component')
      .then(m => m.ReportDetailComponent),
    resolve: { report: reportResolver },
  },
];
```

---

## 6. HTTP & Error Handling

```typescript
// ✅ Always type HTTP responses; never use `any`
this.http.get<ApiResponse<User[]>>('/api/users')

// ✅ Use interceptors for cross-cutting concerns (auth, error toasts, loading)
// ❌ Never catch errors silently
.pipe(catchError(() => EMPTY))  // ❌ swallows errors
.pipe(catchError(err => { this.errorService.notify(err); return EMPTY; }))  // ✅
```

---

## 7. TypeScript

- `strict: true` must be enabled in `tsconfig.json` — no exceptions
- No `any` — use `unknown` and narrow with type guards
- Prefer `interface` over `type` for object shapes; `type` for unions/intersections
- All public methods/properties must have explicit return types
- Use `readonly` for properties that do not change after construction

```typescript
// ✅
interface UserProfile {
  readonly id:    string;
  readonly email: string;
  displayName:    string;
}

function isUserProfile(val: unknown): val is UserProfile {
  return typeof val === 'object' && val !== null && 'id' in val;
}
```

---

## 8. Design System Integration

> See `GUIDELINES-DESIGN-SYSTEM.md` for full token and component reference.

```typescript
// ✅ Always use design system components from shared/design-system/
// ❌ Never use raw HTML buttons, inputs, or typography where DS equivalents exist

// ✅ Use CSS custom properties (tokens) — never hardcode colours or spacing
.card { background: var(--ds-color-surface-primary); padding: var(--ds-space-4); }

// ❌ Hardcoded values
.card { background: #ffffff; padding: 16px; }
```

---

## 9. Testing (see also GUIDELINES-JUNIT.md for unit test philosophy)

```typescript
// Use TestBed with standalone component testing
describe('UserCardComponent', () => {
  let fixture: ComponentFixture<UserCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserCardComponent],  // standalone — import directly
    }).compileComponents();
    fixture = TestBed.createComponent(UserCardComponent);
  });

  it('should emit select event when clicked', () => {
    const user = { id: '1', displayName: 'Alice' } as User;
    fixture.componentRef.setInput('user', user);
    const emitted: User[] = [];
    fixture.componentInstance.select.subscribe(u => emitted.push(u));

    fixture.debugElement.query(By.css('[data-testid="card-select"]')).nativeElement.click();
    expect(emitted).toEqual([user]);
  });
});
```

### `data-testid` requirement
Every interactive element and significant container MUST have a `data-testid` attribute.
Format: `kebab-case`, descriptive, stable across refactors.
```html
<button data-testid="submit-button">Submit</button>
<div    data-testid="report-summary-panel">...</div>
```

---

## 10. Naming Conventions

| Artifact         | Convention         | Example                        |
|------------------|--------------------|--------------------------------|
| Component        | PascalCase + suffix | `UserCardComponent`           |
| Service          | PascalCase + suffix | `PaymentService`         |
| Interface        | PascalCase          | `UserProfile`                 |
| Enum             | PascalCase          | `PaymentStatus`                  |
| Signal           | camelCase           | `selectedUser`, `isLoading`   |
| Observable       | camelCase + `$`     | `users$`, `report$`           |
| File             | kebab-case          | `user-card.component.ts`      |
| Route path       | kebab-case          | `/user-profile`, `/reports`   |
| `data-testid`    | kebab-case          | `submit-button`           |

---

## 11. Forbidden Patterns

```typescript
// ❌ Never use `document` or `window` directly — use Angular CDK / DOCUMENT token
// ❌ Never subscribe inside another subscribe — use switchMap / mergeMap
// ❌ Never leave subscriptions open — use takeUntilDestroyed()
// ❌ Never use setTimeout for change detection — use zone-less signals
// ❌ Never import from feature internals outside the feature barrel
// ❌ No console.log in production code — use a LoggingService
// ❌ No inline styles — use component styleUrls or design system tokens
```
