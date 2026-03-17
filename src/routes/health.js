const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

router.get('/', async (req, res) => {
  const db = getDb();
  let dbStatus = 'healthy';
  let ticketCount = 0;

  try {
    const result = await db.exec('SELECT COUNT(*) FROM tickets');
    ticketCount = result[0]?.values[0]?.[0] || 0;
  } catch (err) {
    dbStatus = 'error';
  }

  res.json({
    service: 'FPS Plate Lookup API',
    version: '1.0.0',
    status: 'operational',
    database: dbStatus,
    stats: { ticketsInSystem: ticketCount },
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
