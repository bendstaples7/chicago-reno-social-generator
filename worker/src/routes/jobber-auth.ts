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
 * for access + refresh tokens, persists them to D1, and redirects back to the app.
 */
app.get('/callback', async (c) => {
  const origin = new URL(c.req.url).origin;

  const code = c.req.query('code');
  if (!code) {
    return c.redirect(origin + '/social/dashboard?oauth_error=' + encodeURIComponent('Missing authorization code'));
  }

  const clientId = c.env.JOBBER_CLIENT_ID;
  const clientSecret = c.env.JOBBER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return c.redirect(origin + '/social/dashboard?oauth_error=' + encodeURIComponent('Server configuration error'));
  }

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
    const errorMsg = `Token exchange failed (${response.status})`;
    return c.redirect(origin + '/social/dashboard?oauth_error=' + encodeURIComponent(errorMsg));
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
  };

  if (!data.access_token || !data.refresh_token) {
    return c.redirect(origin + '/social/dashboard?oauth_error=' + encodeURIComponent('Token response missing required fields'));
  }

  // Persist to D1 so the worker picks them up on next request
  const tokenStore = new JobberTokenStore(c.env.DB);
  await tokenStore.save(data.access_token, data.refresh_token);

  return c.redirect(origin + '/social/dashboard');
});

export default app;
