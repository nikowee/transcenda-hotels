import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

const BACKEND_PORT = 5000;
const FRONTEND_PORT = 3000;

/** Every route a spec navigates to. Add new ones here when adding a spec. */
const ROUTES = ['/', '/results', '/booking', '/checkout', '/payment', '/confirmation'];

/**
 * Loads each route once in a real browser before any spec runs.
 *
 * Vite transforms route modules on demand and may trigger a full reload when it
 * discovers a new dependency. With fullyParallel workers hitting different
 * routes at once, whichever spec lands on a cold route first sees a blank page
 * and times out — while every other spec passes against the warmed server. The
 * failure therefore moves around between runs and reads as flakiness rather
 * than as a missing warm-up.
 */
async function warmRoutes(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const route of ROUTES) {
      await page.goto(`http://localhost:${FRONTEND_PORT}${route}`, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });
    }
  } finally {
    await browser.close();
  }
}

/**
 * The backend container reads PAYMENTS_MODE from server/.env (compose
 * env_file), not from the shell that launched Playwright — so the pin must
 * come from the same file or it describes a server that is not running.
 * Returns undefined when neither source names a mode.
 */
function readPaymentsMode(rootDir: string): string | undefined {
  try {
    const env = fs.readFileSync(path.join(rootDir, 'server', '.env'), 'utf8');
    const fromFile = env.match(/^\s*(?:export\s+)?PAYMENTS_MODE\s*=\s*['"]?(\w+)/m)?.[1];
    if (fromFile) return fromFile;
  } catch {
    // No server/.env: fall through to the shell env
  }
  return process.env.PAYMENTS_MODE || undefined;
}

async function waitForServer(url: string, timeoutMs = 60000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet, keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  const rootDir = path.resolve(__dirname, '..');

  console.log('🐳 Starting Docker containers...');

  // Pin the expected payment UI from the server's own mode, so a stray Stripe
  // key in server/.env cannot silently flip the suite onto live Stripe while
  // the specs still believe they are driving the demo form. Not hardcoded in
  // playwright.config.ts: server/.env is gitignored, and a teammate without
  // Stripe keys is meant to run simulate. When no mode is declared anywhere,
  // leave the pin unset and let detectPaymentUI adapt to whatever mounts.
  const paymentsMode = readPaymentsMode(rootDir);
  if (paymentsMode) {
    process.env.E2E_EXPECT_UI ??= paymentsMode === 'simulate' ? 'demo' : 'elements';
  }
  console.log(`💳 Payment UI pinned to: ${process.env.E2E_EXPECT_UI ?? '(unpinned)'}`);

  // Start docker-compose (detached mode). 
  // Relaxed rate limits only here (defaults to false in docker-compose.yaml 
  // so normal dev runs retain the same prod limits)
  const dockerUp = spawn(
    'docker',
    ['compose', 'up', '-d', '--build'],
    {
      cwd: rootDir,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, RATE_LIMIT_RELAXED: 'true' },
    },
  );

  dockerUp.stdout?.on('data', (data: Buffer) => {
    console.log(`[Docker] ${data.toString().trim()}`);
  });
  dockerUp.stderr?.on('data', (data: Buffer) => {
    console.error(`[Docker] ${data.toString().trim()}`);
  });

  // Wait for docker-compose to finish starting
  await new Promise<void>((resolve, reject) => {
    dockerUp.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker compose up failed with exit code ${code}`));
      }
    });
  });

  // Wait for both servers to be ready
  console.log('⏳ Waiting for backend to be ready...');
  await waitForServer(`http://localhost:${BACKEND_PORT}/api/health`);
  console.log('✅ Backend is ready!');

  console.log('⏳ Waiting for frontend to be ready...');
  await waitForServer(`http://localhost:${FRONTEND_PORT}`);

  // A 200 on / only proves Vite is serving the HTML shell. It returns that
  // immediately, while dependency optimisation is still running and requests for
  // the module graph hang — so the first spec to run gets a blank page and times
  // out while every later spec passes against the warmed server. Probing an
  // actual module is what proves the app can render.
  await waitForServer(`http://localhost:${FRONTEND_PORT}/src/main.tsx`);
  console.log('✅ Frontend is ready!');

  console.log('🔥 Warming routes so the first spec does not pay for Vite...');
  await warmRoutes();
  console.log('✅ Routes warmed!');
}