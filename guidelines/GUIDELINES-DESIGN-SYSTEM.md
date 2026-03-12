# Organisation Design System Standards
# Version: 1.0 | Applies to all Angular / Web frontends

## 1. Core Principle

> Every UI element must trace back to a design system token or component.
> Custom one-off styles are a last resort, documented with a `// DS-EXCEPTION:` comment.

The design system is the single source of truth for:
- Colour, typography, spacing, elevation, motion
- Interactive components (buttons, inputs, modals, toasts, tables)
- Layout primitives (grid, stack, divider)
- Accessibility contracts (focus rings, ARIA roles, keyboard nav)

---

## 2. Token Usage

### Colour tokens
```scss
// ✅ Always use semantic tokens — NOT primitive tokens in component code
color: var(--ds-color-text-primary);
background: var(--ds-color-surface-raised);
border-color: var(--ds-color-border-subtle);

// ✅ Status colours
color: var(--ds-color-status-success);   // green
color: var(--ds-color-status-warning);   // amber
color: var(--ds-color-status-danger);    // red
color: var(--ds-color-status-info);      // blue

// ❌ Never reference primitive tokens directly in components
color: var(--ds-primitive-blue-500);     // ❌ breaks theming
color: #1a73e8;                          // ❌ hardcoded
```

### Spacing tokens (4px base grid)
```scss
// Token scale: --ds-space-1 (4px), --ds-space-2 (8px), --ds-space-3 (12px),
//              --ds-space-4 (16px), --ds-space-6 (24px), --ds-space-8 (32px),
//              --ds-space-12 (48px), --ds-space-16 (64px)

padding: var(--ds-space-4);              // ✅ 16px
gap: var(--ds-space-2);                  // ✅ 8px
margin-top: var(--ds-space-6);           // ✅ 24px
padding: 16px;                           // ❌ hardcoded
```

### Typography tokens
```scss
// Font size
font-size: var(--ds-font-size-sm);       // 14px
font-size: var(--ds-font-size-base);     // 16px
font-size: var(--ds-font-size-lg);       // 18px
font-size: var(--ds-font-size-xl);       // 20px
font-size: var(--ds-font-size-2xl);      // 24px
font-size: var(--ds-font-size-3xl);      // 30px

// Font weight
font-weight: var(--ds-font-weight-regular);   // 400
font-weight: var(--ds-font-weight-medium);    // 500
font-weight: var(--ds-font-weight-semibold);  // 600
font-weight: var(--ds-font-weight-bold);      // 700

// Line height
line-height: var(--ds-line-height-tight);     // 1.25
line-height: var(--ds-line-height-normal);    // 1.5
line-height: var(--ds-line-height-relaxed);   // 1.75
```

### Elevation tokens
```scss
box-shadow: var(--ds-shadow-sm);         // cards, dropdowns
box-shadow: var(--ds-shadow-md);         // modals, popovers
box-shadow: var(--ds-shadow-lg);         // drawers, overlays
```

### Border radius tokens
```scss
border-radius: var(--ds-radius-sm);      // inputs, tags
border-radius: var(--ds-radius-md);      // cards, panels
border-radius: var(--ds-radius-lg);      // modals
border-radius: var(--ds-radius-full);    // pills, avatars
```

---

## 3. Component Usage Rules

### Buttons
```html
<!-- ✅ Always use ds-button — never raw <button> with custom styles -->
<ds-button variant="primary" size="md" (click)="onSave()">Save</ds-button>
<ds-button variant="secondary">Cancel</ds-button>
<ds-button variant="danger" [loading]="isSaving">Delete</ds-button>
<ds-button variant="ghost" icon="download">Export</ds-button>

<!-- Button variants: primary | secondary | tertiary | danger | ghost | link -->
<!-- Button sizes:    sm | md | lg -->
```

### Form inputs
```html
<!-- ✅ Use ds-form-field wrapper — handles label, validation, helper text -->
<ds-form-field label="Email address" [required]="true">
  <ds-input
    type="email"
    placeholder="you@example.com"
    formControlName="email"
    data-testid="input-email"
  />
  <ds-field-error *dsFieldError="'email'">Enter a valid email</ds-field-error>
</ds-form-field>
```

### Tables
```html
<!-- ✅ Always use ds-data-table for tabular data -->
<ds-data-table
  [data]="reports()"
  [columns]="columns"
  [sortable]="true"
  [paginator]="true"
  [pageSize]="25"
  data-testid="reports-table"
/>
```

### Modals & Dialogs
```typescript
// ✅ Use ModalService from design system
this.modalService.open(ConfirmDeleteComponent, {
  data:  { itemName: report.name },
  size:  'sm',                     // sm | md | lg | xl
  title: 'Delete report?',
}).afterClosed().subscribe(confirmed => { if (confirmed) this.delete(); });
```

### Toast notifications
```typescript
// ✅ Use ToastService — never custom snackbar implementations
this.toast.success('Report exported successfully');
this.toast.error('Export failed. Please try again.');
this.toast.warning('Large export may take a few minutes.', { duration: 8000 });
this.toast.info('No filters applied — exporting all rows.');
```

### Loading states
```html
<!-- ✅ Use ds-skeleton for content placeholders during load -->
<ds-skeleton *ngIf="isLoading()" variant="card" [lines]="3" />

<!-- ✅ Use ds-spinner for action loading (button, inline) -->
<ds-spinner size="sm" aria-label="Saving report" />
```

---

## 4. Iconography

```html
<!-- ✅ Use only icons from the design system icon library -->
<ds-icon name="download" size="md" />
<ds-icon name="chevron-right" size="sm" color="var(--ds-color-text-secondary)" />

<!-- ❌ Never import third-party icon libraries (lucide, heroicons, fontawesome)
     directly in feature components — request icon additions via design system team -->
```

---

## 5. Responsive Design

```scss
// ✅ Use design system breakpoint mixins
@include ds-breakpoint(md) { ... }   // ≥ 768px
@include ds-breakpoint(lg) { ... }   // ≥ 1024px
@include ds-breakpoint(xl) { ... }   // ≥ 1280px

// ✅ Use ds-grid for layout
<ds-grid cols="12" gap="4">
  <ds-col [span]="12" [spanMd]="6" [spanLg]="4"> ... </ds-col>
</ds-grid>
```

---

## 6. Dark Mode / Theming

- Never hard-code colours that would break in dark mode
- All semantic tokens automatically adapt to active theme
- Test UI in both `light` and `dark` mode before raising a PR
- Use `prefers-color-scheme` media query only for fallback; prefer theme class on `<html>`

---

## 7. Accessibility Baseline (WCAG 2.1 AA)

- All interactive elements must be keyboard navigable (Tab, Enter, Space, Escape)
- Colour contrast ratio ≥ 4.5:1 for body text, ≥ 3:1 for large text/UI components
- All images must have `alt` text; decorative images use `alt=""`
- All form inputs must have associated `<label>` (use `ds-form-field`)
- Focus ring must never be removed (`outline: none` is forbidden without an alternative)
- All DS components ship with correct ARIA roles — do not override unless necessary
- Screen reader test using NVDA/VoiceOver before PR for any new interactive pattern

---

## 8. DS Exception Protocol

When a one-off style deviation is genuinely required:

```scss
// DS-EXCEPTION: Custom width needed because report table requires fixed 120px action column.
// Raised with DS team: https://jira.example.com/DSREQ-456
// Approved by: @design-system-team on 2024-03-01
.report-actions-col { width: 120px; }
```

Unapproved exceptions will be flagged during PR review and must be resolved.
