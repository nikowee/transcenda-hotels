import { spawn, type ChildProcess } from 'child_process';
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