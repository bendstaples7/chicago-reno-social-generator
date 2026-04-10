import { Router } from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const router = Router();

const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID || '';
const JOBBER_CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET || '';
const REDIRECT_URI = `http://localhost:${process.env.PORT || 3001}/api/jobber/callback`;

/**
 * GET /api/jobber/authorize
 * Redirects to Jobber OAuth authorization page.
 */
router.get('/authorize', (_req, res) => {
  const url = `https://api.getjobber.com/api/oauth/authorize?client_id=${JOBBER_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
  res.redirect(url);
});

/**
 * GET /api/jobber/callback
 * Handles the OAuth callback, exchanges code for tokens, persists to .env.
 */
router.get('/callback', async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }

  try {
    const tokenRes = await fetch('https://api.getjobber.com/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: JOBBER_CLIENT_ID,
        client_secret: JOBBER_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      res.status(500).send(`Token exchange failed (${tokenRes.status}): ${errText}`);
      return;
    }

    const data = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
    };

    // Persist tokens to .env
    const envPath = resolve(import.meta.dirname, '../../.env');
    let envContent = readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(
      /^JOBBER_ACCESS_TOKEN=.*/m,
      `JOBBER_ACCESS_TOKEN=${data.access_token}`,
    );
    envContent = envContent.replace(
      /^JOBBER_REFRESH_TOKEN=.*/m,
      `JOBBER_REFRESH_TOKEN=${data.refresh_token}`,
    );
    writeFileSync(envPath, envContent, 'utf-8');

    res.send(
      '<h2>Jobber re-authenticated successfully!</h2>' +
      '<p>New tokens have been saved to .env. Restart the server to pick them up, or they will be used on next token refresh.</p>' +
      '<p><a href="http://localhost:5173">Back to app</a></p>',
    );
  } catch (err) {
    res.status(500).send(`OAuth error: ${(err as Error).message}`);
  }
});

export default router;
