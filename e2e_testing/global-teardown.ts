import { type ChildProcess } from 'child_process';

export default async function globalTeardown() {
  console.log('🛑 Shutting down servers...');

  // Kill backend process
  if (process.env.E2E_BACKEND_PID) {
    try {
      process.kill(Number(process.env.E2E_BACKEND_PID), 'SIGTERM');
    } catch {
      // Process may already be dead
    }
  }

  // Kill frontend process
  if (process.env.E2E_FRONTEND_PID) {
    try {
      process.kill(Number(process.env.E2E_FRONTEND_PID), 'SIGTERM');
    } catch {
      // Process may already be dead
    }
  }

  // Wait a moment for processes to clean up
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log('✅ Servers shut down');
}