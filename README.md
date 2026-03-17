# FPS Plate Lookup API

A demonstration REST API for real-time license plate ticket lookups. Built for FPS as a proof-of-concept.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with auto-reload during development
npm run dev
```

Server runs at **http://localhost:3000**

## Demo Page

Open http://localhost:3000 in your browser for an interactive demo.

**Test plates:**
- `ABC-1234` — Boot eligible (3 unpaid tickets, $412.50 owed)
- `DEMO123` — Multiple tickets across municipalities
- `XYZ-5678` — Partial payment
- `DEF1234` — Fully paid
- `UNKNOWN` — No record

## API Endpoints

All endpoints require `X-API-Key` header.

**Demo key:** `fps-demo-key-2024`

### GET /api/v1/plates/:plateNumber

Quick lookup — returns ticket count and balance.

```bash
curl -H "X-API-Key: fps-demo-key-2024" \
  http://localhost:3000/api/v1/plates/ABC-1234
```

Response:
```json
{
  "plate": "ABC-1234",
  "state": "NY",
  "found": true,
  "tickets": 3,
  "unpaidTickets": 3,
  "totalOwed": 412.50,
  "formattedOwed": "$412.50",
  "status": "BOOT_ELIGIBLE",
  "flags": ["BOOT_LIST", "HIGH_BALANCE"]
}
```

### GET /api/v1/plates/:plateNumber/tickets

Full ticket history with details.

```bash
curl -H "X-API-Key: fps-demo-key-2024" \
  http://localhost:3000/api/v1/plates/ABC-1234/tickets
```

### GET /api/v1/health

Service health check (no auth required).

```bash
curl http://localhost:3000/api/v1/health
```

## Features Demonstrated

- **Authentication** — API key validation per request
- **Rate Limiting** — 30 lookups/minute per API key
- **Audit Logging** — All queries logged with timestamp, API key, plate
- **Plate Normalization** — "ABC-1234", "ABC 1234", "abc1234" all resolve the same
- **Status Flags** — BOOT_ELIGIBLE, TOW_LIST, HIGH_BALANCE

## Project Structure

```
fps-plate-api/
├── src/
│   ├── index.js           # Express server setup
│   ├── db/
│   │   └── init.js        # SQLite database + sample data
│   ├── middleware/
│   │   ├── auth.js        # API key validation
│   │   ├── rateLimiter.js # Rate limiting
│   │   └── auditLog.js    # Request logging
│   └── routes/
│       ├── plates.js      # Plate lookup endpoints
│       └── health.js      # Health check
└── public/
    └── index.html         # Demo UI
```

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** SQLite (sql.js for demo, would use actual SQL Server in production)
- **Security:** Helmet, CORS, express-rate-limit

## Production Considerations

For FPS production deployment:

1. **Database:** Replace sql.js with direct SQL Server connection (mssql package)
2. **Auth:** Hash API keys with bcrypt, add key rotation
3. **Hosting:** Azure App Services (fits existing Microsoft ecosystem)
4. **Caching:** Add Redis for high-frequency plates
5. **Monitoring:** Add APM (Application Insights)

## License

Proprietary — Built for FPS demonstration by RapidFire Agency

---

**RapidFire Agency**  
Andell Jean-Jacques  
ajeanjacques42@gmail.com  
(407) 765-5182
