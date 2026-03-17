const express = require('express');
const router = express.Router();
const path = require('path');
const { getDb } = require('../db/init');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin.html'));
});

router.get('/tables', async (req, res) => {
  const db = getDb();
  const tables = await db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );

  if (!tables.length) return res.json([]);

  const result = [];
  for (const [name] of tables[0].values) {
    const countResult = await db.exec(`SELECT COUNT(*) FROM "${name}"`);
    const count = countResult[0]?.values[0]?.[0] || 0;

    const infoResult = await db.exec(`PRAGMA table_info("${name}")`);
    const columns = infoResult[0]?.values.map(row => ({
      name: row[1],
      type: row[2],
      notnull: row[3] === 1,
      defaultValue: row[4],
      pk: row[5] === 1,
    })) || [];

    result.push({ name, rowCount: count, columns });
  }

  res.json(result);
});

router.get('/tables/:tableName', async (req, res) => {
  const db = getDb();
  const { tableName } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const check = await db.exec(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  if (!check.length || !check[0].values.length) {
    return res.status(404).json({ error: 'Table not found' });
  }

  const countResult = await db.exec(`SELECT COUNT(*) FROM "${tableName}"`);
  const totalRows = countResult[0]?.values[0]?.[0] || 0;

  const result = await db.exec(
    `SELECT * FROM "${tableName}" LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  if (!result.length) {
    return res.json({ table: tableName, columns: [], rows: [], totalRows, limit, offset });
  }

  res.json({
    table: tableName,
    columns: result[0].columns,
    rows: result[0].values,
    totalRows,
    limit,
    offset,
  });
});

router.post('/query', async (req, res) => {
  const db = getDb();
  const { sql } = req.body;

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'Missing sql field' });
  }

  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('PRAGMA')) {
    return res.status(403).json({ error: 'Only SELECT and PRAGMA queries are allowed' });
  }

  try {
    const start = Date.now();
    const result = await db.exec(sql);
    const duration = Date.now() - start;

    if (!result.length) {
      return res.json({ columns: [], rows: [], duration, rowCount: 0 });
    }

    res.json({
      columns: result[0].columns,
      rows: result[0].values,
      duration,
      rowCount: result[0].values.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
