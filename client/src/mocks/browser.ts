import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

// Set up the service worker with our handlers
export const worker = setupWorker(...handlers);