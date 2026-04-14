/**
 * Jobber Web Session Service
 *
 * Uses Puppeteer to authenticate with Jobber's web UI and extract session
 * cookies, then uses plain fetch calls with those cookies to access internal
 * GraphQL fields (like `requestDetails`) that aren't available through the
 * public developer API.
 *
 * Puppeteer only runs briefly during login (~15 seconds). The browser is
 * closed immediately after cookies are extracted. All subsequent API calls
 * use plain HTTP with the cached cookies until they expire.
 */

import puppeteer from 'puppeteer';

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

interface SessionState {
  cookies: string;
  expiresAt: number;
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
  private session: SessionState | null = null;
  private email: string;
  private password: string;
  private authenticating: Promise<string> | null = null;

  constructor() {
    this.email = process.env.JOBBER_WEB_EMAIL || '';
    this.password = process.env.JOBBER_WEB_PASSWORD || '';
  }

  isConfigured(): boolean {
    return !!this.email && !!this.password;
  }

  hasValidSession(): boolean {
    return !!(this.session && Date.now() < this.session.expiresAt);
  }

  /** Set session cookies manually — bypasses Puppeteer login. */
  setManualCookies(cookies: string): void {
    this.session = {
      cookies,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    console.log('JobberWebSession: Manual cookies set');
  }

  getManualCookiesStatus(): { configured: boolean; expiresAt: number | null } {
    return {
      configured: this.hasValidSession(),
      expiresAt: this.session?.expiresAt ?? null,
    };
  }

  /**
   * Fetch the form submission data for a Jobber request.
   * Automatically refreshes cookies via Puppeteer when expired.
   */
  async fetchRequestFormData(requestId: string): Promise<RequestFormData | null> {
    if (!this.isConfigured()) return null;

    try {
      const result = await this.queryInternalApi(requestId);
      if (result) return result;

      // First attempt failed (expired/invalid session) — retry with fresh cookies
      this.session = null;
      return await this.queryInternalApi(requestId);
    } catch (err) {
      console.error('JobberWebSession: Failed to fetch request form data:', err);
      return null;
    }
  }

  /**
   * Make a single attempt to query the internal Jobber API.
   * Returns null if the session is invalid or the request has no form data.
   */
  private async queryInternalApi(requestId: string): Promise<RequestFormData | null> {
    const cookies = await this.getSessionCookies();
    if (!cookies) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const resp = await fetch(INTERNAL_GQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookies,
        },
        body: JSON.stringify({
          query: REQUEST_DETAILS_QUERY,
          variables: { id: requestId },
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          this.session = null;
        }
        return null;
      }

      const respData = await resp.json() as any;
      if (respData?.errors?.length > 0) {
        const msg = respData.errors.map((e: any) => e.message).join(', ');
        console.error('JobberWebSession: GraphQL errors:', msg);
        if (msg.includes('unauthenticated') || msg.includes('hidden')) {
          this.session = null;
        }
        return null;
      }

      return this.parseFormResponse(respData);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseFormResponse(data: any): RequestFormData | null {
    const sections = data?.data?.request?.requestDetails?.form?.sections?.nodes;
    if (!sections || !Array.isArray(sections)) return null;

    const formSections: FormSection[] = sections
      // Jobber form convention: sortOrder <= 0 = contact/address headers, 999 = file upload footer
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
   * Get valid session cookies, launching Puppeteer to log in if needed.
   */
  private async getSessionCookies(): Promise<string> {
    if (this.session && Date.now() < this.session.expiresAt) {
      return this.session.cookies;
    }

    // Prevent concurrent auth attempts
    if (this.authenticating) {
      return this.authenticating;
    }

    this.authenticating = this.loginAndExtractCookies();
    try {
      return await this.authenticating;
    } finally {
      this.authenticating = null;
    }
  }

  /**
   * Launch a headless browser, log into Jobber, extract session cookies,
   * then close the browser immediately.
   */
  private async loginAndExtractCookies(): Promise<string> {
    console.log('JobberWebSession: Launching browser to refresh session...');
    let browser;

    try {
      browser = await puppeteer.launch({
        headless: 'shell',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Navigate to Jobber login
      await page.goto('https://secure.getjobber.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await new Promise(r => setTimeout(r, 3000));

      // Wait for login form
      await page.waitForSelector('#username, input[name="email"], input[type="email"]', { timeout: 15000 });

      const usernameField = await page.$('#username');
      const usernameSelector = usernameField ? '#username' : 'input[type="email"]';
      const passwordSelector = usernameField ? '#password' : 'input[type="password"]';

      await page.type(usernameSelector, this.email, { delay: 50 });
      await page.type(passwordSelector, this.password, { delay: 50 });
      await page.click('button[type="submit"]');

      // Wait for redirect to Jobber dashboard
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      const url = page.url();
      if (url.includes('login')) {
        console.error('JobberWebSession: Login failed — still on login page');
        return '';
      }

      // Extract ALL cookies (including HttpOnly) via CDP
      const client = await page.createCDPSession();
      const { cookies: allCookies } = await client.send('Network.getAllCookies') as {
        cookies: Array<{ name: string; value: string; domain: string }>;
      };

      // Filter to Jobber-related cookies
      const jobberCookies = allCookies.filter(c =>
        c.domain.includes('getjobber.com') || c.domain.includes('jobber.com')
      );

      const cookieString = jobberCookies.map(c => `${c.name}=${c.value}`).join('; ');
      console.log('JobberWebSession: Login successful, extracted', jobberCookies.length, 'cookies');

      // Test the extracted cookies work with a plain fetch (not browser context)
      const testController = new AbortController();
      const testTimeout = setTimeout(() => testController.abort(), 10000);
      try {
        const testResp = await fetch(INTERNAL_GQL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieString,
          },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: testController.signal,
        });
        const testData = await testResp.json() as any;
        if (testData?.errors?.length > 0) {
          console.error('JobberWebSession: Cookie test failed:', testData.errors[0]?.message);
          return '';
        }
      } catch (testErr) {
        console.error('JobberWebSession: Cookie test error:', testErr instanceof Error ? testErr.message : testErr);
        return '';
      } finally {
        clearTimeout(testTimeout);
      }

      this.session = {
        cookies: cookieString,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };

      console.log('JobberWebSession: Session cached for', SESSION_TTL_MS / 3600000, 'hours');
      return cookieString;
    } catch (err) {
      console.error('JobberWebSession: Browser login failed:', err instanceof Error ? err.message : err);
      return '';
    } finally {
      // Always close the browser
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }
  }
}
