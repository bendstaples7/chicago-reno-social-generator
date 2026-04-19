import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

export const AUTH_FILE = path.join(__dirname, '../../.auth/state.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill('office@chicago-reno.com');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for redirect to the social dashboard after login
  await page.waitForURL('**/social/dashboard', { timeout: 15_000 });

  // Verify we actually landed on the authenticated page
  await expect(page.locator('nav')).toBeVisible();

  // Persist auth state (localStorage + cookies) for subsequent tests
  await page.context().storageState({ path: AUTH_FILE });
});
