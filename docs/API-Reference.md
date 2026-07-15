---
title: API Reference
nav_order: 9
description: Complete API reference for the Transcenda Hotels backend, including endpoints, request/response examples, and error codes.
---

# 📡 API Reference

This page documents all REST API endpoints exposed by the Transcenda Hotels backend.

---

## Base URL

| Environment | URL |
|-------------|-----|
| **Local Development** | `http://localhost:5000` |
| **Docker** | `http://localhost:5000` (mapped from container) |

All endpoints are prefixed with `/api`.

---

## Endpoints Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check / liveness probe |
| `GET` | `/api/destinations/search` | Fuzzy destination autocomplete search |

---

## `GET /api/health`

Health check endpoint for verifying the backend is running and responsive.

### Request

```
GET /api/health
```

No query parameters or request body required.

### Response `200 OK`

```json
{
  "status": "healthy",
  "project": "Transcenda Hotels Gateway Operational"
}
```

### Example

```bash
curl http://localhost:5000/api/health
```

---

## `GET /api/destinations/search`

Fuzzy destination search using Fuse.js. Powers the autocomplete dropdown in the landing page search form.

### Request

```
GET /api/destinations/search?q=<query>
```

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | `string` | ✅ Yes | Search query (minimum 2 characters) |

### Response `200 OK`

Returns an array of matching destinations (max 5 results):

```json
[
  {
    "term": "Rome, Italy",
    "uid": "A6Dz",
    "lat": 41.895466,
    "lng": 12.482324,
    "type": "city",
    "state": "Lazio"
  },
  {
    "term": "Bali, Indonesia",
    "uid": "WP3Z",
    "lat": -8.409518,
    "lng": 115.18898,
    "type": "island",
    "state": "Bali"
  }
]
```

### Response `200 OK` (empty — query too short)

```json
[]
```

Returned when `q` is missing, empty, or fewer than 2 characters.

### Response `500 Internal Server Error`

```json
{
  "error": "Internal server data compilation error"
}
```

### Examples

```bash
# Search for "Rome"
curl "http://localhost:5000/api/destinations/search?q=Rom"

# Search for "Bali"
curl "http://localhost:5000/api/destinations/search?q=Bali"

# Query too short — returns empty array
curl "http://localhost:5000/api/destinations/search?q=R"
```

### Notes

- The search uses **fuzzy matching** with a threshold of `0.3`, so it tolerates typos and partial matches.
- Results are limited to the **top 5** matches to keep the network payload small.
- The destination data is loaded from `server/src/data/destinations.json` at server startup.

---

## Error Codes

| Status Code | Meaning |
|-------------|---------|
| `200` | Success — request processed normally |
| `500` | Internal server error — check server logs for details |

---

> 📖 See [Architecture](architecture) for system design details, or [Environment Variables](environment-variables) for configuration.