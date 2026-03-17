const { getDb } = require('../db/init');

async function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API key. Include X-API-Key header.',
    });
  }

  const db = getDb();
  const result = await db.exec(
    `SELECT id, municipality_id, description FROM api_keys WHERE key_hash = ? AND active = 1`,
    [apiKey]
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key.',
    });
  }

  const [id, municipalityId, description] = result[0].values[0];
  req.apiKeyId = id;
  req.apiKeyMunicipality = municipalityId;
  req.apiKeyDescription = description;

  next();
}

module.exports = { authenticate };
