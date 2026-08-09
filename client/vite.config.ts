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
    globals: true,          // Makes test functions available without imports
    environment: 'jsdom',   // Uses jsdom to simulate browser
    setupFiles: './src/tests/setup.ts',  // Runs this file before tests (testing utils)
    coverage: {
      provider: 'v8',       // Uses V8 for coverage (fast)
      reporter: ['text', 'json', 'html'],  // Output formats
      exclude: ['node_modules/', 'src/tests/', 'src/mocks/'],  // What to ignore
    },
    include: ['**/*.{test,spec}.{js,ts,jsx,tsx}'],  // Which files are tests
  }
})