import { test, expect } from '@playwright/test';

// storageState is configured at the project level in playwright.config.ts
// so all tests in this file run as the authenticated user.

// ---------------------------------------------------------------------------
// All navigable pages across both sections
// ---------------------------------------------------------------------------
const pages = [
  // Social
  { name: 'Dashboard', url: '/social/dashboard' },
  { name: 'Quick Post', url: '/social/posts/quick' },
  { name: 'Media Library', url: '/social/media' },
  { name: 'Settings', url: '/social/settings' },
  { name: 'Activity Log', url: '/social/activity-log' },
  // Quotes
  { name: 'New Quote', url: '/quotes' },
  { name: 'Saved Drafts', url: '/quotes/drafts' },
  { name: 'Rules', url: '/quotes/rules' },
  { name: 'Catalog & Templates', url: '/quotes/catalog' },
];

// ---------------------------------------------------------------------------
// Smoke: every sidebar nav link loads without error
// ---------------------------------------------------------------------------
for (const p of pages) {
  test(`"${p.name}" (${p.url}) loads without error`, async ({ page }) => {
    const response = await page.goto(p.url, { waitUntil: 'networkidle' });

    // Page loaded with a successful HTTP status
    expect(response?.ok()).toBe(true);

    // No error toast appeared
    const errorToasts = page.locator('[role="alert"]');
    await expect(errorToasts).toHaveCount(0);

    // Page has visible content (not a blank page)
    const body = page.locator('body');
    const text = await body.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });
}

// ---------------------------------------------------------------------------
// Smoke: no console errors on page load
// ---------------------------------------------------------------------------
for (const p of pages) {
  test(`"${p.name}" (${p.url}) has no console errors`, async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(p.url, { waitUntil: 'networkidle' });

    expect(consoleErrors).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// Smoke: API health check
// ---------------------------------------------------------------------------
test('API /health returns ok', async ({ request }) => {
  // Hit the worker health endpoint directly via the Vite proxy
  const response = await request.get('/health');

  expect(response.ok()).toBe(true);

  const body = await response.json();
  // In local dev the worker may report "degraded" if secrets are missing,
  // but the endpoint itself should respond successfully.
  expect(body.status).toBeDefined();
  expect(['ok', 'degraded']).toContain(body.status);
});
