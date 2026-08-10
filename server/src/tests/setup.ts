import { before, after } from 'mocha';
import app from '../index.ts';

// Log when tests start/end
before(() => {
  console.log('🧪 Starting backend tests...');
});

after(() => {
  console.log('✅ Backend tests complete');
});

// Export app for use in tests
export { app };