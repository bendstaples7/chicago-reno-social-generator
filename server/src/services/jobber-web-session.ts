/**
 * Jobber Web Session Service
 *
 * Uses Puppeteer to authenticate with Jobber's web UI and access internal
 * GraphQL fields (like `requestDetails`) that aren't available through the
 * public developer API.
 *
 * The public Jobber GraphQL API doesn't expose the form submission data from
 * customer requests. The internal schema (used by the Jobber web app) has a
 * `requestDetails` field on `Request` that returns the submitted form data.
 * This service uses a headless browser to log in and query that field.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';

interface FormAnswer {
  label: string;
  value: string | null;
}

interface FormSection {
  label: string;
  sortOrder: number;
  answers: FormAnswer[];
}

export interface RequestFormData {
  sections: FormSection[];
  /** Flattened text representation of all form answers */
  text: string;
}

const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INTERNAL_GQL_URL = 'https://api.getjobber.com/api/graphql?location=j';

const REQUEST_DETAILS_QUERY = `
  query GetRequestDetails($id: EncodedId!) {
    request(id: $id) {
      id
      title
      requestDetails {
        form {
          sections(first: 10) {
            nodes {
              label
              sortOrder
              items(first: 20) {
                nodes {
                  ... on FormTextInput { label reportableAnswer { value } }
                  ... on FormMultipleChoice { label reportableAnswer { value } }
                  ... on FormDateInput { label reportableAnswer { value } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export class JobberWebSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private authenticatedAt: number = 0;
  private authenticating: Promise<boolean> | null = null;
  private email: string;
  private password: string;

  constructor() {
    this.email = process.env.JOBBER_WEB_EMAIL || '';
    this.password = process.env.JOBBER_WEB_PASSWORD || '';
  }

  isConfigured(): boolean {
    return !!this.email && !!this.password;
  }

  hasValidSession(): boolean {
    return !!this.page && Date.now() - this.authenticatedAt < SESSION_TTL_MS;
  }

  /** Kept for backward compat with the settings route */
  setManualCookies(_cookies: string): void {
    console.log('JobberWebSession: Manual cookies ignored — using Puppeteer browser session');
  }

  getManualCookiesStatus(): { configured: boolean; expiresAt: number | null } {
    return {
      configured: this.hasValidSession(),
      expiresAt: this.authenticatedAt ? this.authenticatedAt + SESSION_TTL_MS : null,
    };
  }

  /**
   * Fetch the form submission data for a Jobber request.
   * Launches a browser and logs in if needed.
   */
  async fetchRequestFormData(requestId: string): Promise<RequestFormData | null> {
    if (!this.isConfigured()) return null;

    try {
      const page = await this.getAuthenticatedPage();
      if (!page) return null;

      // Execute the GraphQL query from within the authenticated browser context
      const result = await page.evaluate(
        async (gqlUrl: string, query: string, reqId: string) => {
          try {
            const resp = await fetch(gqlUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ query, variables: { id: reqId } }),
            });
            if (!resp.ok) return { error: `HTTP ${resp.status}` };
            return await resp.json();
          } catch (err: any) {
            return { error: err?.message || 'fetch failed' };
          }
        },
        INTERNAL_GQL_URL,
        REQUEST_DETAILS_QUERY,
        requestId,
      );

      if (result.error) {
        console.error('JobberWebSession: GraphQL fetch error:', result.error);
        return null;
      }

      if (result.errors?.length > 0) {
        const msg = result.errors.map((e: any) => e.message).join(', ');
        console.error('JobberWebSession: GraphQL errors:', msg);
        // If unauthenticated, invalidate session so next call re-authenticates
        if (msg.includes('unauthenticated') || msg.includes('hidden')) {
          this.authenticatedAt = 0;
        }
        return null;
      }

      return this.parseFormResponse(result);
    } catch (err) {
      console.error('JobberWebSession: Failed to fetch request form data:', err);
      return null;
    }
  }

  /**
   * Get an authenticated Puppeteer page, logging in if needed.
   */
  private async getAuthenticatedPage(): Promise<Page | null> {
    if (this.hasValidSession() && this.page) {
      return this.page;
    }

    // Prevent concurrent auth attempts
    if (this.authenticating) {
      const ok = await this.authenticating;
      return ok ? this.page : null;
    }

    this.authenticating = this.authenticate();
    try {
      const ok = await this.authenticating;
      return ok ? this.page : null;
    } finally {
      this.authenticating = null;
    }
  }

  /**
   * Launch browser and log into Jobber.
   */
  private async authenticate(): Promise<boolean> {
    console.log('JobberWebSession: Starting Puppeteer authentication...');

    try {
      // Launch browser if not already running
      if (!this.browser || !this.browser.connected) {
        this.browser = await puppeteer.launch({
          headless: 'shell',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        });
      }

      // Create a fresh page
      if (this.page) {
        try { await this.page.close(); } catch { /* ignore */ }
      }
      this.page = await this.browser.newPage();

      // Disguise as a real browser to avoid Cloudflare bot detection
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Navigate to Jobber login
      await this.page.goto('https://secure.getjobber.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for page to settle after any redirects
      await new Promise(r => setTimeout(r, 3000));

      console.log('JobberWebSession: Login page URL:', this.page.url());

      // The login form may be on an Auth0 page after redirect
      // Wait for either #username (Auth0) or input[name="email"] (direct Jobber)
      await this.page.waitForSelector('#username, input[name="email"], input[type="email"]', { timeout: 15000 });

      // Determine which selector is present
      const usernameField = await this.page.$('#username');
      const emailField = await this.page.$('input[name="email"]');
      const usernameSelector = usernameField ? '#username' : (emailField ? 'input[name="email"]' : 'input[type="email"]');
      const passwordSelector = usernameField ? '#password' : 'input[type="password"]';

      await this.page.type(usernameSelector, this.email, { delay: 50 });
      await this.page.type(passwordSelector, this.password, { delay: 50 });
      await this.page.click('button[type="submit"]');

      // Wait for navigation to Jobber dashboard
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      const url = this.page.url();
      console.log('JobberWebSession: Post-login URL:', url);

      if (url.includes('secure.getjobber.com') && !url.includes('login')) {
        console.log('JobberWebSession: Authentication successful');
        this.authenticatedAt = Date.now();
        return true;
      }

      console.error('JobberWebSession: Authentication failed — still on login page');
      return false;
    } catch (err) {
      console.error('JobberWebSession: Puppeteer authentication failed:', err);
      return false;
    }
  }

  private parseFormResponse(data: any): RequestFormData | null {
    const sections = data?.data?.request?.requestDetails?.form?.sections?.nodes;
    if (!sections || !Array.isArray(sections)) return null;

    const formSections: FormSection[] = sections
      .filter((s: any) => s.sortOrder > 0 && s.sortOrder < 999)
      .sort((a: any, b: any) => a.sortOrder - b.sortOrder)
      .map((s: any) => ({
        label: s.label,
        sortOrder: s.sortOrder,
        answers: (s.items?.nodes || [])
          .filter((item: any) => item.reportableAnswer?.value)
          .map((item: any) => ({
            label: item.label,
            value: item.reportableAnswer.value,
          })),
      }))
      .filter((s: FormSection) => s.answers.length > 0);

    if (formSections.length === 0) return null;

    const textParts: string[] = [];
    for (const section of formSections) {
      for (const answer of section.answers) {
        if (answer.value) {
          textParts.push(`${answer.label}: ${answer.value}`);
        }
      }
    }

    return {
      sections: formSections,
      text: textParts.join('\n'),
    };
  }

  /**
   * Clean up browser resources.
   */
  async close(): Promise<void> {
    try {
      if (this.page) await this.page.close();
      if (this.browser) await this.browser.close();
    } catch { /* ignore */ }
    this.page = null;
    this.browser = null;
    this.authenticatedAt = 0;
  }
}
