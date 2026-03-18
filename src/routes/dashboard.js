const express = require('express');
const router = express.Router();
const { getDb } = require('../db/init');

// Shared filter helper — builds WHERE clause + params from query string
function buildFilterClause(query) {
  const conditions = [];
  const params = [];

  if (query.start_date) {
    conditions.push('t.issue_date >= ?');
    params.push(query.start_date);
  }
  if (query.end_date) {
    conditions.push('t.issue_date <= ?');
    params.push(query.end_date);
  }
  if (query.municipality_id) {
    conditions.push('t.municipality_id = ?');
    params.push(Number(query.municipality_id));
  }
  if (query.county) {
    conditions.push('m.county = ?');
    params.push(query.county);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params };
}

// GET /filters — municipality list + date range bounds
router.get('/filters', async (req, res) => {
  try {
    const db = getDb();

    const muniResult = await db.exec(
      `SELECT id, name, county FROM municipalities ORDER BY county, name`
    );
    const municipalities = muniResult.length
      ? muniResult[0].values.map(([id, name, county]) => ({ id, name, county }))
      : [];

    const dateResult = await db.exec(
      `SELECT MIN(issue_date) AS min_date, MAX(issue_date) AS max_date FROM tickets`
    );
    const minDate = dateResult[0]?.values[0]?.[0] || null;
    const maxDate = dateResult[0]?.values[0]?.[1] || null;

    res.json({ municipalities, date_range: { min: minDate, max: maxDate } });
  } catch (err) {
    console.error('Dashboard filters error:', err);
    res.status(500).json({ error: 'Failed to load filters' });
  }
});

// GET /summary — 4 KPI values
router.get('/summary', async (req, res) => {
  try {
    const db = getDb();
    const { where, params } = buildFilterClause(req.query);

    const sql = `
      SELECT
        COUNT(*) AS total_tickets,
        COALESCE(SUM(t.fine_amount + t.late_fee), 0) AS total_assessed,
        COALESCE(SUM(t.payment_amount), 0) AS total_collected,
        COALESCE(SUM(t.fine_amount + t.late_fee - t.payment_amount), 0) AS outstanding
      FROM tickets t
      JOIN municipalities m ON t.municipality_id = m.id
      ${where}
    `;

    const result = await db.exec(sql, params);
    const row = result[0]?.values[0];

    const totalTickets = row?.[0] || 0;
    const totalAssessed = row?.[1] || 0;
    const totalCollected = row?.[2] || 0;
    const outstanding = row?.[3] || 0;
    const collectionRate = totalAssessed > 0
      ? Math.round((totalCollected / totalAssessed) * 10000) / 100
      : 0;

    res.json({
      total_tickets: totalTickets,
      total_assessed: totalAssessed,
      total_collected: totalCollected,
      collection_rate: collectionRate,
      outstanding_balance: outstanding,
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// GET /volume-by-month — ticket count + revenue grouped by YYYY-MM
router.get('/volume-by-month', async (req, res) => {
  try {
    const db = getDb();
    const { where, params } = buildFilterClause(req.query);

    const sql = `
      SELECT
        substr(t.issue_date, 1, 7) AS month,
        COUNT(*) AS ticket_count,
        COALESCE(SUM(t.fine_amount + t.late_fee), 0) AS revenue
      FROM tickets t
      JOIN municipalities m ON t.municipality_id = m.id
      ${where}
      GROUP BY substr(t.issue_date, 1, 7)
      ORDER BY month
    `;

    const result = await db.exec(sql, params);
    const data = result.length
      ? result[0].values.map(([month, count, revenue]) => ({ month, ticket_count: count, revenue }))
      : [];

    res.json(data);
  } catch (err) {
    console.error('Dashboard volume-by-month error:', err);
    res.status(500).json({ error: 'Failed to load monthly volume' });
  }
});

// GET /by-municipality — top 10 municipalities by ticket volume
router.get('/by-municipality', async (req, res) => {
  try {
    const db = getDb();
    const { where, params } = buildFilterClause(req.query);

    const sql = `
      SELECT
        m.name,
        COUNT(*) AS ticket_count,
        COALESCE(SUM(t.fine_amount + t.late_fee), 0) AS total_assessed
      FROM tickets t
      JOIN municipalities m ON t.municipality_id = m.id
      ${where}
      GROUP BY m.id
      ORDER BY ticket_count DESC
      LIMIT 10
    `;

    const result = await db.exec(sql, params);
    const data = result.length
      ? result[0].values.map(([name, count, assessed]) => ({ name, ticket_count: count, total_assessed: assessed }))
      : [];

    res.json(data);
  } catch (err) {
    console.error('Dashboard by-municipality error:', err);
    res.status(500).json({ error: 'Failed to load municipality data' });
  }
});

// GET /by-violation — violation type distribution
router.get('/by-violation', async (req, res) => {
  try {
    const db = getDb();
    const { where, params } = buildFilterClause(req.query);

    const sql = `
      SELECT
        t.violation_desc,
        COUNT(*) AS ticket_count,
        COALESCE(SUM(t.fine_amount), 0) AS total_fines
      FROM tickets t
      JOIN municipalities m ON t.municipality_id = m.id
      ${where}
      GROUP BY t.violation_desc
      ORDER BY ticket_count DESC
    `;

    const result = await db.exec(sql, params);
    const data = result.length
      ? result[0].values.map(([description, count, fines]) => ({ description, ticket_count: count, total_fines: fines }))
      : [];

    res.json(data);
  } catch (err) {
    console.error('Dashboard by-violation error:', err);
    res.status(500).json({ error: 'Failed to load violation data' });
  }
});

// GET /by-status — status breakdown
router.get('/by-status', async (req, res) => {
  try {
    const db = getDb();
    const { where, params } = buildFilterClause(req.query);

    const sql = `
      SELECT
        t.status,
        COUNT(*) AS ticket_count,
        COALESCE(SUM(t.fine_amount + t.late_fee), 0) AS total_assessed,
        COALESCE(SUM(t.payment_amount), 0) AS total_collected
      FROM tickets t
      JOIN municipalities m ON t.municipality_id = m.id
      ${where}
      GROUP BY t.status
      ORDER BY ticket_count DESC
    `;

    const result = await db.exec(sql, params);
    const data = result.length
      ? result[0].values.map(([status, count, assessed, collected]) => ({
          status, ticket_count: count, total_assessed: assessed, total_collected: collected
        }))
      : [];

    res.json(data);
  } catch (err) {
    console.error('Dashboard by-status error:', err);
    res.status(500).json({ error: 'Failed to load status data' });
  }
});

module.exports = router;
