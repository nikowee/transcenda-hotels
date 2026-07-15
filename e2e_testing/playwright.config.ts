import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Timeout for each test
  timeout: 30000,

  // Run tests in parallel
  fullyParallel: true,

  // Fail build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ['html'],
    ['list'],
  ],

  // Global setup
  use: {
    // Base URL for all tests
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure
    video: 'retain-on-failure',
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment for cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Run tests in this directory
  testDir: './',

  // Test files pattern
  testMatch: 'tests/*.spec.ts',

  // Global setup: starts backend and frontend servers before all tests
  globalSetup: './global-setup.ts',

  // Global teardown: shuts down servers after all tests
  globalTeardown: './global-teardown.ts',
});