const { getDb } = require('../db/init');

function auditLog(req, res, next) {
  const originalEnd = res.end;

  res.end = function (chunk, encoding) {
    // Fire-and-forget async audit insert
    const db = getDb();
    db.run(
      `INSERT INTO audit_log (api_key_id, endpoint, plate_queried, ip_address, response_code)
       VALUES (?, ?, ?, ?, ?)`,
      [
        req.apiKeyId || null,
        req.originalUrl,
        req.params.plateNumber || null,
        req.ip || req.connection?.remoteAddress || 'unknown',
        res.statusCode,
      ]
    ).catch(err => console.error('Audit log error:', err));

    originalEnd.call(this, chunk, encoding);
  };

  next();
}

async function getAuditLogs(limit = 100) {
  const db = getDb();
  const result = await db.exec(`
    SELECT
      al.id, al.timestamp,
      ak.description as api_key_name,
      al.endpoint, al.plate_queried,
      al.ip_address, al.response_code
    FROM audit_log al
    LEFT JOIN api_keys ak ON al.api_key_id = ak.id
    ORDER BY al.timestamp DESC
    LIMIT ?
  `, [limit]);

  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

module.exports = { auditLog, getAuditLogs };
