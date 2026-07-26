import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from './setup.js';

describe('Destination Search API', () => {
  
  it('should return empty array for query with less than 2 characters', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 's' });

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array').that.is.empty;
  });

  it('should handle typos and return Singapore for "sinagpore"', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'sinagpore' });

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array');
    
    // Should contain Singapore in the results
    const singaporeResult = response.body.find(
      (item: any) => item.term.includes('Singapore')
    );
    expect(singaporeResult).to.exist;
    expect(singaporeResult.term).to.include('Singapore');
  });

  it('should return exact match for "Singapore"', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'Singapore' });

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array');
    
    // Should have at least one result with "Singapore"
    const hasSingapore = response.body.some(
      (item: any) => item.term.includes('Singapore')
    );
    expect(hasSingapore).to.be.true;
  });

  it('should return at most 5 results', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'a' });  // 'a' is common, should return many results

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array');
    expect(response.body.length).to.be.at.most(5);
  });

  it('should return empty array for unknown query', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'xyzabc123' });

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array').that.is.empty;
  });

  it('should be case-insensitive', async () => {
    const lowerResponse = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'singapore' });

    const upperResponse = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'SINGAPORE' });

    expect(lowerResponse.body.length).to.equal(upperResponse.body.length);
  });

  it('should return health status', async () => {
    const response = await request(app)
      .get('/api/health');

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('status', 'healthy');
    expect(response.body).to.have.property('project');
  });
});