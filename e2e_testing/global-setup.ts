import { type ChildProcess, spawn } from 'child_process';
import path from 'path';

const BACKEND_PORT = 5000;
const FRONTEND_PORT = 3000;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet, keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

// Track spawned processes so we can kill them later
const processes: ChildProcess[] = [];

export default async function globalSetup() {
  console.log('🌐 Starting backend server...');
  
  const serverPath = path.resolve(__dirname, '../server');
  const backend = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverPath,
    stdio: 'pipe',
    shell: true,
  });
  processes.push(backend);

  backend.stdout?.on('data', (data: Buffer) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });
  backend.stderr?.on('data', (data: Buffer) => {
    console.error(`[Backend] ${data.toString().trim()}`);
  });

  console.log('🌐 Starting frontend dev server...');
  
  const clientPath = path.resolve(__dirname, '../client');
  const frontend = spawn('npx', ['vite', '--port', String(FRONTEND_PORT)], {
    cwd: clientPath,
    stdio: 'pipe',
    shell: true,
  });
  processes.push(frontend);

  frontend.stdout?.on('data', (data: Buffer) => {
    console.log(`[Frontend] ${data.toString().trim()}`);
  });
  frontend.stderr?.on('data', (data: Buffer) => {
    console.error(`[Frontend] ${data.toString().trim()}`);
  });

  // Wait for both servers to be ready
  console.log('⏳ Waiting for backend to be ready...');
  await waitForServer(`http://localhost:${BACKEND_PORT}/api/health`);
  console.log('✅ Backend is ready!');

  console.log('⏳ Waiting for frontend to be ready...');
  await waitForServer(BASE_URL);
  console.log('✅ Frontend is ready!');

  // Store process references for teardown
  process.env.E2E_BACKEND_PID = String(backend.pid);
  process.env.E2E_FRONTEND_PID = String(frontend.pid);
}

export { processes };