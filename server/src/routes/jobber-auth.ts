import { Router } from 'express';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { resolve } from 'path';
import { JobberTokenStore } from '../services/jobber-token-store.js';
import { jobberIntegration } from './quotes.js';

const router = Router();

const JOBBER_CLIENT_ID = process.env.JOBBER_CLIENT_ID || '';
const JOBBER_CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET || '';
const REDIRECT_URI = `http://localhost:${process.env.PORT || 3001}/api/jobber/callback`;

// In-memory CSRF state store (sufficient for single-server local dev)
const pendingStates = new Map<string, number>();

/**
 * GET /api/jobber/authorize
 * Redirects to Jobber OAuth authorization page with CSRF state parameter.
 */
router.get('/authorize', (_req, res) => {
  const state = crypto.randomUUID();
  pendingStates.set(state, Date.now());

  // Clean up old states (> 10 minutes)
  for (const [s, ts] of pendingStates) {
    if (Date.now() - ts > 10 * 60 * 1000) pendingStates.delete(s);
  }

  const url = `https://api.getjobber.com/api/oauth/authorize?client_id=${JOBBER_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=${state}`;
  res.redirect(url);
});

/**
 * GET /api/jobber/callback
 * Handles the OAuth callback, exchanges code for tokens, persists to .env.
 */
router.get('/callback', async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;

  if (!code) {
    res.status(400).send('Missing authorization code.');
    return;
  }

  // Verify CSRF state
  if (!state || !pendingStates.has(state)) {
    res.status(403).send('Invalid or missing state parameter (CSRF check failed).');
    return;
  }
  pendingStates.delete(state);

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

    // BACKWARD COMPAT: Persist tokens to .env as a fallback seed for first-run scenarios.
    // The database (via JobberTokenStore) is the primary durable store and is always
    // preferred on startup. This .env write should be removed once DB persistence is
    // fully validated in production.
    const envPath = resolve(import.meta.dirname, '../../.env');
    let envContent = '';
    try {
      envContent = readFileSync(envPath, 'utf-8');
    } catch {
      envContent = '';
    }

    if (/^JOBBER_ACCESS_TOKEN=.*/m.test(envContent)) {
      envContent = envContent.replace(/^JOBBER_ACCESS_TOKEN=.*/m, `JOBBER_ACCESS_TOKEN=${data.access_token}`);
    } else {
      envContent += `\nJOBBER_ACCESS_TOKEN=${data.access_token}`;
    }

    if (/^JOBBER_REFRESH_TOKEN=.*/m.test(envContent)) {
      envContent = envContent.replace(/^JOBBER_REFRESH_TOKEN=.*/m, `JOBBER_REFRESH_TOKEN=${data.refresh_token}`);
    } else {
      envContent += `\nJOBBER_REFRESH_TOKEN=${data.refresh_token}`;
    }

    writeFileSync(envPath + '.tmp', envContent, 'utf-8');
    renameSync(envPath + '.tmp', envPath);

    // Also persist to database (primary durable store)
    try {
      const tokenStore = new JobberTokenStore();
      await tokenStore.save(data.access_token, data.refresh_token);
    } catch (dbErr) {
      console.error('[jobber-auth] Failed to persist tokens to database:', dbErr);
    }

    // Reload tokens into the long-lived JobberIntegration singleton
    // so it picks up the new tokens without waiting for the next refresh cycle.
    try {
      await jobberIntegration.reloadTokens();
    } catch {
      // Best-effort — the next API call will pick them up via ensureInitialized
    }

    res.send(
      '<h2>Jobber re-authenticated successfully!</h2>' +
      '<p>New tokens have been saved. They will be used automatically on the next API call.</p>' +
      '<p><a href="http://localhost:5173">Back to app</a></p>',
    );
  } catch (err) {
    res.status(500).send(`OAuth error: ${(err as Error).message}`);
  }
});

export default router;
