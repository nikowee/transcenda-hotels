import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

const BACKEND_PORT = 5000;
const FRONTEND_PORT = 3000;

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

  // Start docker-compose (detached mode)
  const dockerUp = spawn('docker', ['compose', 'up', '-d', '--build'], {
    cwd: rootDir,
    stdio: 'pipe',
    shell: true,
  });

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
  console.log('✅ Frontend is ready!');
}