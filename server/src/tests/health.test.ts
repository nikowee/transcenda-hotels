import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from './setup.ts';

describe('Health Check API', () => {
  it('should return health status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('status', 'healthy');
    expect(response.body).to.have.property('project');
  });
});
