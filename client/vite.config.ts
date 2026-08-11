// vitest/config's defineConfig, not vite's: its UserConfig includes the `test`
// key below, which plain vite rejects at type level (the one error that kept
// `tsc -b` from ever being a zero-error gate).
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss()
  ],
  server: {
    host: '0.0.0.0', // Exposes the server to Docker container network
    port: 3000
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    testTimeout: 10000, // was defaulting to 5000
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/tests/', 'src/mocks/'],
    },
    include: ['**/*.{test,spec}.{js,ts,jsx,tsx}'],
  }
})