import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from './setup.js';
import { resetRateLimits } from '../middleware/rateLimit.js';

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

  /**
   * Boundary and hostile-input cases. The length cap is the one that matters:
   * fuse.search is synchronous, its cost grows with the pattern, and this
   * route is unauthenticated — an uncapped 5,000-character query blocked the
   * event loop for 65 seconds, stalling every other request in the process.
   */
  describe('query boundaries', () => {
    it('answers a 5,000-character query in about the time a capped one takes', async function () {
      this.timeout(30_000);
      resetRateLimits();

      const started = Date.now();
      const response = await request(app)
        .get('/api/destinations/search')
        .query({ q: 'a'.repeat(5000) });
      const elapsed = Date.now() - started;

      expect(response.status).to.equal(200);
      // Generous against CI jitter but far below the 65s the uncapped path
      // took: the assertion is "the cap is applied", not a latency budget.
      expect(elapsed, `took ${elapsed}ms — is MAX_QUERY_LENGTH still applied?`).to.be.below(10_000);
    });

    it('still matches the longest real destination name in full', async function () {
      // ~2s: a pattern this long is genuinely expensive for Fuse even capped,
      // which is the residual cost the cap bounds rather than removes.
      this.timeout(30_000);
      resetRateLimits();
      // 115 characters — the longest term in the dataset, so the cap must sit
      // above it or a legitimate search silently stops matching.
      const longest =
        'St. Augustine Museum of Ligurian Architecture and Sculpture (Museo di Architettura e Scultura Ligure), Genoa, Italy';

      const response = await request(app).get('/api/destinations/search').query({ q: longest });

      expect(response.status).to.equal(200);
      expect(response.body[0]?.term).to.equal(longest);
    });

    it('survives regex metacharacters, unicode and control characters', async () => {
      const hostile = [
        '.*+?^${}()|[]\\',
        '‮​﻿',
        '😀🏨\u{1F1F8}\u{1F1EC}',
        '日本語漢字',
        "'; drop table bookings; --",
        'ȩ́̈',
      ];

      for (const q of hostile) {
        resetRateLimits();
        const response = await request(app).get('/api/destinations/search').query({ q });
        expect(response.status, `q=${JSON.stringify(q)}`).to.equal(200);
        expect(response.body, `q=${JSON.stringify(q)}`).to.be.an('array');
        expect(response.body.length, `q=${JSON.stringify(q)}`).to.be.at.most(5);
      }
    });

    it('treats a repeated ?q= as no query rather than crashing on the array', async () => {
      resetRateLimits();
      // Express parses ?q=x&q=y into an array, whose .trim() is not a function.
      const response = await request(app).get('/api/destinations/search?q=Singapore&q=Tokyo');

      expect(response.status).to.equal(200);
      expect(response.body).to.deep.equal([]);
    });
  });

  it('should return health status', async () => {
    const response = await request(app)
      .get('/api/health');

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('status', 'healthy');
    expect(response.body).to.have.property('project');
  });
});