/**
 * Jobber OAuth Authorization Routes
 *
 * Provides a local OAuth flow to obtain fresh Jobber access/refresh tokens.
 * Hit GET /api/jobber-auth/authorize in your browser to start the flow.
 * The callback exchanges the code for tokens and persists them to D1.
 */
import { Hono } from 'hono';
import type { Bindings } from '../bindings.js';
import { JobberTokenStore } from '../services/jobber-token-store.js';
import { JobberWebSession } from '../services/jobber-web-session.js';

const app = new Hono<{ Bindings: Bindings }>();

const JOBBER_AUTHORIZE_URL = 'https://api.getjobber.com/api/oauth/authorize';
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';

/**
 * GET /authorize
 * Redirects the user to Jobber's OAuth authorization page.
 */
app.get('/authorize', (c) => {
  const clientId = c.env.JOBBER_CLIENT_ID;
  if (!clientId) {
    return c.json({ error: 'JOBBER_CLIENT_ID is not configured' }, 500);
  }

  // Callback URL points back to this worker
  const redirectUri = new URL('/api/jobber-auth/callback', c.req.url).toString();

  const authUrl = new URL(JOBBER_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');

  return c.redirect(authUrl.toString());
});

/**
 * GET /callback
 * Handles the OAuth callback from Jobber, exchanges the authorization code
 * for access + refresh tokens, persists them to D1, and displays them.
 */
app.get('/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  const clientId = c.env.JOBBER_CLIENT_ID;
  const clientSecret = c.env.JOBBER_CLIENT_SECRET;
  const redirectUri = new URL('/api/jobber-auth/callback', c.req.url).toString();

  // Exchange authorization code for tokens
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    return c.json({ error: `Token exchange failed (${response.status})`, details: text }, 500);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };

  if (!data.access_token || !data.refresh_token) {
    return c.json({ error: 'Token response missing required fields', data }, 500);
  }

  // Persist to D1 so the worker picks them up on next request
  const tokenStore = new JobberTokenStore(c.env.DB);
  await tokenStore.save(data.access_token, data.refresh_token);

  return c.html(`
    <html>
      <body style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px;">
        <h2>Jobber OAuth Tokens Refreshed</h2>
        <p>Tokens have been saved to your local D1 database. The worker will use these automatically.</p>
        <p>You can also update your <code>.dev.vars</code> file with these values:</p>
        <pre style="background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto;">JOBBER_ACCESS_TOKEN=${data.access_token}
JOBBER_REFRESH_TOKEN=${data.refresh_token}</pre>
        <p style="color: #666; font-size: 14px;">Tokens expire periodically. The worker will auto-refresh them and persist new tokens to D1.</p>
      </body>
    </html>
  `);
});

/**
 * POST /set-cookies
 * Manually set Jobber web session cookies for accessing internal API fields.
 * To get cookies: log into Jobber in your browser, open DevTools → Application
 * → Cookies → getjobber.com, and copy all cookies as a semicolon-separated string.
 */
app.post('/set-cookies', async (c) => {
  const contentType = c.req.header('content-type') || '';
  let cookies: string | undefined;

  if (contentType.includes('application/json')) {
    const body = await c.req.json() as { cookies?: string };
    cookies = body.cookies;
  } else {
    // Handle form submission
    const body = await c.req.parseBody();
    cookies = body.cookies as string;
  }

  if (!cookies || typeof cookies !== 'string' || cookies.trim().length === 0) {
    return c.json({ error: 'Please provide a cookies string' }, 400);
  }

  const webSession = new JobberWebSession(c.env.DB);
  await webSession.setCookies(cookies.trim());

  return c.html(`
    <html>
      <body style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px;">
        <h2>✅ Session Cookies Saved</h2>
        <p>Jobber web session cookies have been stored. The worker will use them to fetch request form data (customer submission text).</p>
        <p style="color: #666; font-size: 14px;">Cookies expire after 24 hours. You'll need to update them when they expire.</p>
        <a href="/api/jobber-auth/set-cookies" style="color: #00a89d;">← Back</a>
      </body>
    </html>
  `);
});

/**
 * GET /set-cookies
 * Simple form to paste Jobber web session cookies.
 */
app.get('/set-cookies', async (c) => {
  const webSession = new JobberWebSession(c.env.DB);
  const configured = await webSession.isConfigured();

  return c.html(`
    <html>
      <body style="font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px;">
        <h2>Set Jobber Session Cookies</h2>
        <p>These cookies are needed to fetch the customer's original request submission text from Jobber's internal API.</p>
        <p><strong>Status:</strong> ${configured ? '🟢 Cookies configured' : '🔴 No cookies set'}</p>
        <h3>How to get cookies:</h3>
        <ol>
          <li>Open <a href="https://app.getjobber.com" target="_blank">app.getjobber.com</a> and log in</li>
          <li>Open DevTools (F12) → Console tab</li>
          <li>Run: <code>copy(document.cookie)</code></li>
          <li>Paste below and submit</li>
        </ol>
        <form method="POST" action="/api/jobber-auth/set-cookies">
          <textarea name="cookies" rows="6" style="width: 100%; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 0.85rem; box-sizing: border-box;" placeholder="Paste cookies here..."></textarea>
          <button type="submit" style="margin-top: 0.5rem; padding: 0.5rem 1rem; background: #00a89d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">Save Cookies</button>
        </form>
      </body>
    </html>
  `);
});

/**
 * GET /session-cookies/status
 * Check if Jobber web session cookies are configured and valid.
 * Returns { configured, expired } to let the client detect stale sessions.
 */
app.get('/session-cookies/status', async (c) => {
  const webSession = new JobberWebSession(c.env.DB);
  const { configured, expired } = await webSession.getStatus();
  return c.json({ configured, expired });
});

export default app;
