import './env.js';
import { before, after } from 'mocha';
import app from '../index.js';

before(() => {
  console.log('🧪 Starting backend tests...');
});

after(() => {
  console.log('✅ Backend tests complete');
});

export { app };