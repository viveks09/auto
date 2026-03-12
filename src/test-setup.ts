// src/test-setup.ts
// Global setup file for Vitest — referenced in vitest.config.ts setupFiles

// Extend Vitest's expect with @testing-library/jest-dom matchers:
// toBeInTheDocument(), toHaveTextContent(), toBeDisabled(), toHaveAttribute(), etc.
import '@testing-library/jest-dom/vitest';

import { getTestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';

// Initialize the Angular testing environment once
getTestBed().initTestEnvironment(
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting(),
);
