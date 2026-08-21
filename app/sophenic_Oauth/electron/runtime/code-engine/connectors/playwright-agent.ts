import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";

export type BrowserCheck = { url: string; title: string; status: "ready"; consoleErrors: string[]; pageErrors: string[] };

export class PlaywrightAgent {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    const { chromium } = await import("playwright");
    try {
      this.browser = await chromium.launch({ headless: true });
    } catch (firstError) {
      if (process.platform !== "win32") throw firstError;
      this.browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(() => { throw firstError; });
    }
    const context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 } });
    this.page = await context.newPage();
    this.page.on("console", (message) => { if (message.type() === "error") this.consoleErrors.push(message.text().slice(0, 1000)); });
    this.page.on("pageerror", (error) => this.pageErrors.push(error.message.slice(0, 1000)));
    return this.page;
  }

  async open(url: string): Promise<BrowserCheck> {
    const page = await this.ensurePage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    if (response && response.status() >= 400) throw new Error(`Navigation HTTP ${response.status()} vers ${url}`);
    return { url: page.url(), title: await page.title(), status: "ready", consoleErrors: [...this.consoleErrors], pageErrors: [...this.pageErrors] };
  }

  async click(selector: string): Promise<{ ok: true; url: string }> {
    const page = await this.ensurePage();
    await page.locator(selector).first().click({ timeout: 20_000 });
    return { ok: true, url: page.url() };
  }

  async fill(selector: string, value: string): Promise<{ ok: true }> {
    const page = await this.ensurePage();
    await page.locator(selector).first().fill(value, { timeout: 20_000 });
    return { ok: true };
  }

  async press(selector: string, key: string): Promise<{ ok: true }> {
    const page = await this.ensurePage();
    await page.locator(selector).first().press(key, { timeout: 20_000 });
    return { ok: true };
  }

  async inspect(): Promise<{ url: string; title: string; text: string; consoleErrors: string[]; pageErrors: string[] }> {
    const page = await this.ensurePage();
    const text = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    return { url: page.url(), title: await page.title(), text: text.slice(0, 18_000), consoleErrors: [...this.consoleErrors].slice(-20), pageErrors: [...this.pageErrors].slice(-20) };
  }

  async screenshot(filePath: string, fullPage = true): Promise<{ path: string; url: string }> {
    const page = await this.ensurePage();
    const target = path.resolve(filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, fullPage });
    return { path: target, url: page.url() };
  }

  async close(): Promise<void> {
    this.page = null;
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
  }
}
