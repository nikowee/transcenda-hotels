import { spawn } from 'child_process';
import path from 'path';

export default async function globalTeardown() {
  const rootDir = path.resolve(__dirname, '..');

  console.log('🛑 Stopping Docker containers...');

  await new Promise<void>((resolve, reject) => {
    const dockerDown = spawn('docker', ['compose', 'down'], {
      cwd: rootDir,
      stdio: 'pipe',
      shell: true,
    });

    dockerDown.stdout?.on('data', (data: Buffer) => {
      console.log(`[Docker] ${data.toString().trim()}`);
    });
    dockerDown.stderr?.on('data', (data: Buffer) => {
      console.error(`[Docker] ${data.toString().trim()}`);
    });

    dockerDown.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ Docker containers stopped');
        resolve();
      } else {
        console.warn(`⚠️ docker compose down exited with code ${code}`);
        resolve(); // Don't fail teardown
      }
    });
  });
}