/**
 * Jobber Web Session Service
 *
 * Authenticates with Jobber's web UI via Auth0 to access internal GraphQL fields
 * (like `requestDetails`) that aren't available through the public developer API.
 *
 * The public Jobber GraphQL API doesn't expose the form submission data from
 * customer requests. The internal schema (used by the Jobber web app) has a
 * `requestDetails` field on `Request` that returns the submitted form data.
 * This service authenticates via Auth0 to get a web session and queries that field.
 */

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

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
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
  private manualCookies: string | null = null;
  private auth0ClientId: string;

  constructor() {
    this.email = process.env.JOBBER_WEB_EMAIL || '';
    this.password = process.env.JOBBER_WEB_PASSWORD || '';
    this.auth0ClientId = process.env.JOBBER_AUTH0_CLIENT_ID || 'q9lB1bI9LPm31Q29WnuLQi3y75q7kcIQ';
  }

  isConfigured(): boolean {
    return !!this.manualCookies || (!!this.email && !!this.password);
  }

  /**
   * Returns true only if we have a currently valid cached session.
   * Does NOT trigger the Auth0 login flow.
   */
  hasValidSession(): boolean {
    return !!(this.session && Date.now() < this.session.expiresAt);
  }

  /**
   * Set session cookies manually (from browser DevTools).
   * This bypasses the Auth0 login flow entirely.
   */
  setManualCookies(cookies: string): void {
    this.manualCookies = cookies;
    this.session = {
      cookies,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };
    console.log('JobberWebSession: Manual cookies set');
  }

  getManualCookiesStatus(): { configured: boolean; expiresAt: number | null } {
    return {
      configured: !!this.session?.cookies,
      expiresAt: this.session?.expiresAt ?? null,
    };
  }

  /**
   * Fetch the form submission data for a Jobber request.
   * Returns null if web session is not configured or the request has no form data.
   * Only uses an existing valid session — does NOT trigger the Auth0 login flow.
   */
  async fetchRequestFormData(requestId: string): Promise<RequestFormData | null> {
    if (!this.hasValidSession()) return null;

    try {
      const cookies = await this.getSessionCookies();
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
      });

      if (!resp.ok) {
        // Session might be expired — if using manual cookies, don't retry (same cookies would be reused)
        if (resp.status === 401 || resp.status === 403) {
          if (this.manualCookies) {
            this.session = null;
            this.manualCookies = null;
            return null;
          }
          this.session = null;
          const freshCookies = await this.getSessionCookies();
          const retryResp = await fetch(INTERNAL_GQL_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': freshCookies,
            },
            body: JSON.stringify({
              query: REQUEST_DETAILS_QUERY,
              variables: { id: requestId },
            }),
          });
          if (!retryResp.ok) return null;
          return this.parseFormResponse(await retryResp.json());
        }
        return null;
      }

      const respData = await resp.json() as any;
      if (respData?.errors?.length > 0) {
        console.error('JobberWebSession: GraphQL errors:', respData.errors.map((e: any) => e.message).join(', '));
        return null;
      }
      return this.parseFormResponse(respData);
    } catch (err) {
      console.error('JobberWebSession: Failed to fetch request form data:', err);
      return null;
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

    // Build flattened text
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

  private async getSessionCookies(): Promise<string> {
    if (this.session && Date.now() < this.session.expiresAt) {
      return this.session.cookies;
    }

    // If manual cookies are set, restore the session from them
    // instead of falling through to the Auth0 authenticate flow
    if (this.manualCookies) {
      this.session = {
        cookies: this.manualCookies,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      };
      return this.session.cookies;
    }

    // Prevent concurrent auth attempts
    if (this.authenticating) {
      return this.authenticating;
    }

    this.authenticating = this.authenticate();
    try {
      const cookies = await this.authenticating;
      return cookies;
    } finally {
      this.authenticating = null;
    }
  }

  /**
   * Authenticate with Jobber via Auth0 to get session cookies.
   * This simulates the browser login flow:
   * 1. GET secure.getjobber.com → redirects to Auth0 login
   * 2. POST credentials to Auth0
   * 3. Follow redirects back to secure.getjobber.com
   * 4. Capture the session cookies
   */
  private async authenticate(): Promise<string> {
    const cookieJar: Record<string, string> = {};
    console.log('JobberWebSession: Starting Auth0 authentication flow...');

    try {
      // Step 1: Hit secure.getjobber.com/login which redirects to Auth0
      // Don't pass redirect_uri — let Auth0 use the default configured for the app
      const authorizeUrl = 'https://login.auth.getjobber.com/authorize?' + new URLSearchParams({
        response_type: 'code',
        client_id: this.auth0ClientId,
        scope: 'openid profile email',
        state: crypto.randomUUID(),
      }).toString();

      const authorizeResp = await fetch(authorizeUrl, { redirect: 'manual' });
      this.captureCookies(authorizeResp, cookieJar);
      const loginUrl = authorizeResp.headers.get('location') || '';
      console.log('JobberWebSession: Step 1 - Authorize redirect:', loginUrl ? 'got login URL' : 'no redirect');

      if (!loginUrl) {
        console.error('JobberWebSession: No redirect from authorize endpoint');
        return '';
      }

      // Resolve relative URLs against the Auth0 domain
      const resolvedLoginUrl = loginUrl.startsWith('/') ? `https://login.auth.getjobber.com${loginUrl}` : loginUrl;

      // Step 2: GET the login page to get the state parameter
      const loginPageResp = await fetch(resolvedLoginUrl, {
        redirect: 'manual',
        headers: { 'Cookie': this.buildCookieHeader(cookieJar) },
      });
      this.captureCookies(loginPageResp, cookieJar);
      const html = await loginPageResp.text();

      // Auth0 Universal Login puts state in hidden inputs: <input type="hidden" name="state" value="...">
      const stateMatch = html.match(/name="state"\s+value="([^"]+)"/)
        || html.match(/value="([^"]+)"\s+name="state"/)
        || html.match(/name='state'\s+value='([^']+)'/)
        || html.match(/type="hidden"[^>]*name="state"[^>]*value="([^"]+)"/);
      const state = stateMatch?.[1] || '';
      console.log('JobberWebSession: Step 2 - Got login form state:', state ? 'yes' : 'no');

      if (!state) {
        // Try extracting state from the URL query parameter instead
        const urlState = new URL(resolvedLoginUrl).searchParams.get('state');
        if (urlState) {
          console.log('JobberWebSession: Using state from URL parameter');
          return this.authenticateWithState(urlState, loginUrl, cookieJar);
        }
        console.error('JobberWebSession: Could not extract Auth0 state from login form');
        return '';
      }

      return this.authenticateWithState(state, loginUrl, cookieJar);
    } catch (err) {
      console.error('JobberWebSession: Authentication failed:', err);
      return '';
    }
  }

  private async authenticateWithState(state: string, loginUrl: string, cookieJar: Record<string, string>): Promise<string> {
    // Step 3: POST credentials to Auth0
    const postUrl = `https://login.auth.getjobber.com/u/login?state=${state}`;
    const authResp = await fetch(postUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.buildCookieHeader(cookieJar),
      },
      body: new URLSearchParams({
        state,
        username: this.email,
        password: this.password,
      }).toString(),
    });
    this.captureCookies(authResp, cookieJar);
    console.log('JobberWebSession: Step 3 - Login POST status:', authResp.status, 'redirect:', (authResp.headers.get('location') || '').substring(0, 100));

    // Step 4: Follow redirects back to Jobber, tracking the current domain
    let nextUrl = authResp.headers.get('location') || '';
    let lastDomain = 'https://login.auth.getjobber.com';
    let maxRedirects = 10;
    while (nextUrl && maxRedirects-- > 0) {
      // Resolve relative URLs against the last domain we were on
      if (nextUrl.startsWith('/')) {
        nextUrl = `${lastDomain}${nextUrl}`;
      }
      // Track the domain for resolving future relative redirects
      try {
        const parsed = new URL(nextUrl);
        lastDomain = `${parsed.protocol}//${parsed.host}`;
      } catch { /* keep previous domain */ }
      console.log('JobberWebSession: Following redirect to:', nextUrl.substring(0, 80) + '...');
      const redirectResp = await fetch(nextUrl, {
        redirect: 'manual',
        headers: { 'Cookie': this.buildCookieHeader(cookieJar) },
      });
      this.captureCookies(redirectResp, cookieJar);
      nextUrl = redirectResp.headers.get('location') || '';
    }

    const cookies = this.buildCookieHeader(cookieJar);
    console.log('JobberWebSession: Authentication complete. Cookie count:', Object.keys(cookieJar).length);
    console.log('JobberWebSession: Cookie names:', Object.keys(cookieJar).join(', '));

    // Test the session with a real query (not just __typename)
    const testResp = await fetch(INTERNAL_GQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
      },
      body: JSON.stringify({ query: '{ currentUser { id } }' }),
    });
    const testData = await testResp.json() as any;
    const testPassed = !!testData?.data?.currentUser?.id;
    console.log('JobberWebSession: Session test:', testPassed ? 'SUCCESS' : 'FAILED', testPassed ? '' : JSON.stringify(testData?.errors?.[0]?.message ?? testData).substring(0, 200));

    if (!testPassed) {
      console.error('JobberWebSession: Session test failed — not caching invalid cookies');
      return '';
    }

    this.session = {
      cookies,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    return cookies;
  }

  private captureCookies(resp: Response, jar: Record<string, string>): void {
    const setCookies = resp.headers.getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const [nameValue] = cookie.split(';');
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) {
        const name = nameValue.substring(0, eqIdx).trim();
        const value = nameValue.substring(eqIdx + 1).trim();
        jar[name] = value;
      }
    }
  }

  private buildCookieHeader(jar: Record<string, string>): string {
    return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}
