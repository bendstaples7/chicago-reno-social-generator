import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: '.auth/state.json',
      },
      dependencies: ['setup'],
    },
  ],
});
