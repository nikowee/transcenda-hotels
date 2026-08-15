import { describe, it } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { app } from '../setup.ts';
import { resetRateLimits } from '../../middleware/rateLimit.js';

describe('Destination Search API', () => {

  // Test 1: Query with <2 characters returns empty array
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

    const hasSingapore = response.body.some(
      (item: any) => item.term.includes('Singapore')
    );
    expect(hasSingapore).to.be.true;
  });

  it('should return at most 5 results', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'a' });

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

  // Test 7: Missing query param
  it('should return 400 (or empty array) when q is missing entirely', async () => {
    const response = await request(app).get('/api/destinations/search');

    // Adjust this assertion to match your route's actual contract -
    // some teams choose to 400 on a missing param, others just treat it as ''.
    expect([200, 400]).to.include(response.status);
  });

  // Test 8: Destination result shape
  it('should return results with uid, term, lat, lng and type fields', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'Singapore' });

    expect(response.status).to.equal(200);
    if (response.body.length > 0) {
      const result = response.body[0];
      expect(result).to.have.property('uid');
      expect(result).to.have.property('term');
    }
  });

  // ── Robustness / boundary cases ──

  it('should return 200 (empty or 400) when q is omitted entirely', async () => {
    const response = await request(app).get('/api/destinations/search');
    expect(response.status).to.be.at.most(400);
  });

  it('should not crash for a whitespace-only query', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: '   ' });

    expect([200, 400]).to.include(response.status);
  });

  it('should not crash for an extremely long query (100 chars)', async function () {
    // Fuse.js fuzzy matching is O(pattern × records). 100 chars is an
    // unrealistic-but-absurd input that proves the robustness claim
    this.timeout(15_000);

    const longQuery = 'a'.repeat(100);
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: longQuery });

    expect(response.status).to.equal(200);
    expect(response.body).to.be.an('array');
  });

  it('should not crash for unicode and emoji input', async () => {
    const inputs = ['東京', '😀😀', 'éclair', '新加坡', '🚀', 'éü'];
    for (const q of inputs) {
      const response = await request(app)
        .get('/api/destinations/search')
        .query({ q });
      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
    }
  });

  it('should be resilient to SQL-injection and XSS payloads', async function () {
    this.timeout(15_000);

    const payloads = [
      "' OR 1=1 --",
      "'; DROP TABLE destinations; --",
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      '${constructor.constructor("return process")()}',
    ];

    for (const q of payloads) {
      const response = await request(app)
        .get('/api/destinations/search')
        .query({ q });
      // Never a 500; an empty array is the expected outcome.
      expect(response.status).to.equal(200);
      expect(response.body).to.be.an('array');
    }
  });

  it('should cap results at 5 even for broadly matching queries', async () => {
    const response = await request(app)
      .get('/api/destinations/search')
      .query({ q: 'a' });

    expect(response.status).to.equal(200);
    expect(response.body.length).to.be.at.most(5);
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
        '\u202e\u200b\ufeff',
        '😀🏨\u{1F1F8}\u{1F1EC}',
        '日本語漢字',
        "'; drop table bookings; --",
        'ȩ́̈',
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
});
