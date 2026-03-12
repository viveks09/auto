// e2e/pages/BasePage.ts
// Base Page Object Model — extend this for every page in your app

import { Page, Locator, expect } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path = '/') {
    await this.page.goto(`${process.env.BASE_URL ?? 'http://localhost:4200'}${path}`);
    await this.waitForPageLoad();
  }

  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  async setAuthToken(token: string) {
    await this.page.evaluate((t) => localStorage.setItem('auth_token', t), token);
  }

  async screenshot(name: string) {
    await this.page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// e2e/pages/LoginPage.ts

export class LoginPage extends BasePage {
  private readonly usernameInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitBtn:     Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByTestId('login-username');
    this.passwordInput = page.getByTestId('login-password');
    this.submitBtn     = page.getByTestId('login-submit');
  }

  async login(username: string, password: string) {
    await this.goto('/login');
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitBtn.click();
    await this.page.waitForURL('**/dashboard', { timeout: 10_000 });
  }

  async loginWithStoredState() {
    // Uses storageState from playwright.config.ts — set up via global-setup
    await this.goto('/dashboard');
  }
}
