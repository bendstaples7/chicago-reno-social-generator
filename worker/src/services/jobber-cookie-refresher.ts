/**
 * Jobber Cookie Refresher
 *
 * Uses Cloudflare Browser Rendering REST API to automatically log into Jobber
 * and extract session cookies. This runs entirely server-side inside the Worker
 * without requiring a browser binding (works in both local and remote mode).
 *
 * The refresher is triggered on-demand by the systems check when cookies
 * are expired or missing.
 *
 * Requires: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN secrets.
 */
import { JobberWebSession } from './jobber-web-session.js';

const COOKIE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INTERNAL_GQL_URL = 'https://api.getjobber.com/api/graphql?location=j';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export class JobberCookieRefresher {
  private db: D1Database;
  private email: string;
  private password: string;
  private accountId: string;
  private apiToken: string;

  constructor(
    db: D1Database,
    opts: {
      email: string;
      password: string;
      accountId: string;
      apiToken: string;
    },
  ) {
    this.db = db;
    this.email = opts.email;
    this.password = opts.password;
    this.accountId = opts.accountId;
    this.apiToken = opts.apiToken;
  }

  /**
   * Refresh Jobber session cookies using Cloudflare Browser Rendering REST API.
   * 
   * Flow:
   * 1. Open Jobber login page via Browser Rendering
   * 2. Fill credentials and submit
   * 3. Extract cookies from the authenticated session
   * 4. Validate cookies against Jobber's internal API
   * 5. Store in D1
   */
  async refresh(): Promise<{ success: boolean; error?: string }> {
    if (!this.email || !this.password) {
      return { success: false, error: 'JOBBER_WEB_EMAIL or JOBBER_WEB_PASSWORD not configured' };
    }
    if (!this.accountId || !this.apiToken) {
      return { success: false, error: 'CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not configured' };
    }

    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/browser-rendering`;

    try {
      // Step 1: Navigate to Jobber login page and get the HTML
      const contentResp = await fetch(`${baseUrl}/content`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://secure.getjobber.com/login',
          rejectResourceTypes: ['image', 'font', 'media'],
        }),
      });

      if (!contentResp.ok) {
        const text = await contentResp.text();
        return { success: false, error: `Browser Rendering content fetch failed (${contentResp.status}): ${text.slice(0, 200)}` };
      }

      // Step 2: Use the scrape endpoint to fill the form and submit
      // The scrape endpoint can execute JavaScript on the page
      const scrapeResp = await fetch(`${baseUrl}/scrape`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: 'https://secure.getjobber.com/login',
          wait: 3000,
          elements: [{ selector: 'body' }],
          javascript: `
            (async () => {
              // Wait for form fields
              await new Promise(r => setTimeout(r, 2000));
              
              const usernameField = document.querySelector('#username') 
                || document.querySelector('input[name="username"]')
                || document.querySelector('input[type="text"]')
                || document.querySelector('input[type="email"]');
              const passwordField = document.querySelector('#password')
                || document.querySelector('input[name="password"]')
                || document.querySelector('input[type="password"]');
              
              if (!usernameField || !passwordField) {
                return JSON.stringify({ error: 'Could not find login form fields' });
              }
              
              // Set values using native input setter to trigger React state updates
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              ).set;
              
              nativeInputValueSetter.call(usernameField, ${JSON.stringify(this.email)});
              usernameField.dispatchEvent(new Event('input', { bubbles: true }));
              usernameField.dispatchEvent(new Event('change', { bubbles: true }));
              
              nativeInputValueSetter.call(passwordField, ${JSON.stringify(this.password)});
              passwordField.dispatchEvent(new Event('input', { bubbles: true }));
              passwordField.dispatchEvent(new Event('change', { bubbles: true }));
              
              // Submit the form
              const submitBtn = document.querySelector('button[type="submit"]')
                || document.querySelector('button[name="action"]');
              if (submitBtn) {
                submitBtn.click();
              } else {
                usernameField.closest('form')?.submit();
              }
              
              // Wait for navigation
              await new Promise(r => setTimeout(r, 5000));
              
              return JSON.stringify({
                url: window.location.href,
                cookies: document.cookie
              });
            })()
          `,
        }),
      });

      if (!scrapeResp.ok) {
        const text = await scrapeResp.text();
        return { success: false, error: `Browser Rendering scrape failed (${scrapeResp.status}): ${text.slice(0, 200)}` };
      }

      const scrapeData = await scrapeResp.json() as any;
      
      // Extract cookies from the response
      let cookieString = '';
      
      // Try to get cookies from the JavaScript execution result
      if (scrapeData?.result) {
        try {
          const jsResult = JSON.parse(scrapeData.result);
          if (jsResult.error) {
            return { success: false, error: jsResult.error };
          }
          if (jsResult.cookies) {
            cookieString = jsResult.cookies;
          }
          if (jsResult.url?.includes('login')) {
            return { success: false, error: 'Login failed — still on login page after form submission' };
          }
        } catch { /* not JSON, try other extraction */ }
      }

      // Also check response cookies/headers
      if (!cookieString && scrapeData?.cookies) {
        cookieString = Array.isArray(scrapeData.cookies)
          ? scrapeData.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ')
          : '';
      }

      if (!cookieString) {
        return { success: false, error: 'No cookies extracted from login session' };
      }

      // Step 3: Validate cookies
      const valid = await this.validateCookies(cookieString);
      if (!valid) {
        return { success: false, error: 'Cookie validation failed — cookies may not be authenticated' };
      }

      // Step 4: Store in D1
      const webSession = new JobberWebSession(this.db);
      await webSession.setCookies(cookieString, COOKIE_TTL_MS);

      console.log('[JobberCookieRefresher] Cookies refreshed successfully via Browser Rendering REST API');
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[JobberCookieRefresher] Refresh failed:', message);
      return { success: false, error: message };
    }
  }

  private async validateCookies(cookieString: string): Promise<boolean> {
    try {
      const resp = await fetch(INTERNAL_GQL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString,
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ query: '{ account { id } }' }),
      });

      if (!resp.ok) return false;

      const data = await resp.json() as { data?: { account?: { id?: string } }; errors?: unknown[] };
      if (data?.errors && (data.errors as unknown[]).length > 0) return false;
      if (!data?.data?.account?.id) return false;

      return true;
    } catch {
      return false;
    }
  }
}
