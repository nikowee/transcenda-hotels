import { describe, it, afterEach } from 'mocha';
import { expect } from 'chai';
import nock from 'nock';
import { searchHotels, fetchHotelById } from '../../services/ascendaServices.ts';

// These tests call the service functions directly (no supertest/app involved),
// so they isolate the merge/sort/transform logic in ascendaServices.ts 

const API_BASE = 'https://hotelapi.loyalty.dev/api';

afterEach(() => {
  nock.cleanAll();
});

describe('ascendaServices - searchHotels', () => {
  it('should merge price and detail data, sorted by searchRank ascending', async () => {
    nock(API_BASE)
      .get('/hotels/prices')
      .query(true)
      .reply(200, {
        completed: true,
        hotels: [
          { id: 'h2', price: 200, searchRank: 2 },
          { id: 'h1', price: 100, searchRank: 1 },
        ],
      });

    nock(API_BASE)
      .get('/hotels')
      .query(true)
      .reply(200, [
        { id: 'h1', name: 'Hotel One', rating: 4, address: 'A', latitude: 1, longitude: 1, description: 'Desc', categories: {}, amenities: {}, image_details: { prefix: 'p', suffix: '.jpg', count: 0 } },
        { id: 'h2', name: 'Hotel Two', rating: 3, address: 'B', latitude: 2, longitude: 2, description: 'Desc2', categories: {}, amenities: {}, image_details: { prefix: 'p', suffix: '.jpg', count: 0 } },
      ]);

    const result = await searchHotels({
      destination_id: 'RsBU',
      checkin: '2026-08-15',
      checkout: '2026-08-20',
      guests: '2',
    });

    expect(result).to.have.lengthOf(2);
    expect(result[0]!.id).to.equal('h1'); // lower searchRank sorts first
    expect(result[1]!.id).to.equal('h2');
  });

  it('should skip hotels that have a price entry but no matching static details', async () => {
    nock(API_BASE)
      .get('/hotels/prices')
      .query(true)
      .reply(200, {
        completed: true,
        hotels: [{ id: 'ghost-hotel', price: 100, searchRank: 1 }],
      });

    nock(API_BASE).get('/hotels').query(true).reply(200, []);

    const result = await searchHotels({
      destination_id: 'RsBU',
      checkin: '2026-08-15',
      checkout: '2026-08-20',
      guests: '2',
    });

    expect(result).to.have.lengthOf(0);
  });

  it('should generate correct image URLs from prefix/suffix/count', async () => {
    nock(API_BASE)
      .get('/hotels/prices')
      .query(true)
      .reply(200, { completed: true, hotels: [{ id: 'h1', price: 100, searchRank: 1 }] });

    nock(API_BASE)
      .get('/hotels')
      .query(true)
      .reply(200, [
        {
          id: 'h1', name: 'Hotel One', rating: 4, address: 'A', latitude: 1, longitude: 1,
          description: 'Desc', categories: {}, amenities: {},
          image_details: { prefix: 'https://img.test/', suffix: '.jpg', count: 3 },
        },
      ]);

    const [hotel] = await searchHotels({
      destination_id: 'RsBU', checkin: '2026-08-15', checkout: '2026-08-20', guests: '2',
    });

    expect(hotel).to.exist;
    expect(hotel!.images).to.deep.equal([
      'https://img.test/1.jpg',
      'https://img.test/2.jpg',
      'https://img.test/3.jpg',
    ]);
  });

  it('should flatten category objects into an array of category names', async () => {
    nock(API_BASE)
      .get('/hotels/prices')
      .query(true)
      .reply(200, { completed: true, hotels: [{ id: 'h1', price: 100, searchRank: 1 }] });

    nock(API_BASE)
      .get('/hotels')
      .query(true)
      .reply(200, [
        {
          id: 'h1', name: 'Hotel One', rating: 4, address: 'A', latitude: 1, longitude: 1,
          description: 'Desc',
          categories: { luxury: { name: 'Luxury' }, city: { name: 'City' } },
          amenities: {},
          image_details: { prefix: 'p', suffix: '.jpg', count: 0 },
        },
      ]);

    const [hotel] = await searchHotels({
      destination_id: 'RsBU', checkin: '2026-08-15', checkout: '2026-08-20', guests: '2',
    });

    expect(hotel).to.exist;
    expect(hotel!.categories).to.include.members(['Luxury', 'City']);
  });

  it('should reject when the Ascenda prices endpoint errors', async () => {
    nock(API_BASE).get('/hotels/prices').query(true).replyWithError('network down');

    try {
      await searchHotels({ destination_id: 'RsBU', checkin: '2026-08-15', checkout: '2026-08-20', guests: '2' });
      expect.fail('expected searchHotels to throw');
    } catch (err) {
      expect(err).to.exist;
    }
  });
});

describe('ascendaServices - fetchHotelById', () => {
  it('should return hotel details for a valid id', async () => {
    nock(API_BASE).get('/hotels/hotel-1').reply(200, {
      id: 'hotel-1', name: 'Test Hotel', rating: 4, address: 'X', latitude: 1, longitude: 1,
      description: 'Desc', categories: {}, amenities: {}, image_details: { prefix: 'p', suffix: '.jpg', count: 0 },
    });

    const result = await fetchHotelById('hotel-1');
    expect(result.name).to.equal('Test Hotel');
  });

  it('should throw a friendly error when the upstream call fails', async () => {
    nock(API_BASE).get('/hotels/bad-id').replyWithError('boom');

    try {
      await fetchHotelById('bad-id');
      expect.fail('expected fetchHotelById to throw');
    } catch (err: any) {
      expect(err.message).to.equal('Failed to fetch hotel details');
    }
  });
});
