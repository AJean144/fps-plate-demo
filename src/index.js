const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');

const { initDatabase } = require('./db/init');
const { authenticate } = require('./middleware/auth');
const { apiLimiter, strictLimiter } = require('./middleware/rateLimiter');
const { auditLog, getAuditLogs } = require('./middleware/auditLog');

const platesRouter = require('./routes/plates');
const healthRouter = require('./routes/health');
const adminRouter = require('./routes/admin');
const dashboardRouter = require('./routes/dashboard');

// Load OpenAPI spec
const specFile = fs.readFileSync(path.join(__dirname, '..', 'docs', 'openapi.yaml'), 'utf8');
const swaggerSpec = YAML.parse(specFile);

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());

// Serve parking-ticket-assist static assets (hero image, etc.)
app.use(express.static(path.join(__dirname, '..', 'public', 'parking-ticket-assist')));

// ── Public-facing site ──
// Root: Parking Ticket Assist homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'parking-ticket-assist', 'index.html'));
});

// Parking Ticket Assist search flow
app.get('/parking-ticket-assist/search.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'parking-ticket-assist', 'search.html'));
});

// ── API Demo & Docs ──
// Plate lookup demo
app.get('/api/demo', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Custom documentation page
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'docs.html'));
});

// Swagger UI (interactive API explorer)
app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'FPS Plate Lookup API - Swagger',
}));

// Serve raw OpenAPI spec
app.get('/api/v1/openapi.yaml', (req, res) => {
  res.type('text/yaml').send(specFile);
});
app.get('/api/v1/openapi.json', (req, res) => {
  res.json(swaggerSpec);
});

// ── API Endpoints ──
// Health check (no auth required)
app.use('/api/v1/health', healthRouter);

// Plate lookup routes (auth + rate limiting + audit logging)
app.use('/api/v1/plates',
  authenticate,
  strictLimiter,
  auditLog,
  platesRouter
);

// Dashboard API + page
app.use('/api/dashboard', dashboardRouter);
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// Database explorer & admin
app.use('/api/admin', adminRouter);

// Admin endpoint: view audit logs
app.get('/api/v1/admin/logs', async (req, res) => {
  const logs = await getAuditLogs(50);
  res.json({
    count: logs.length,
    logs: logs,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.path} does not exist.`,
    docs: '/docs',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred.',
  });
});

// Initialize database and start server
async function start() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   FPS Plate Lookup API v1.0.0                                ║
║                                                              ║
║   Server:            http://localhost:${PORT}                  ║
║   Parking Ticket:    http://localhost:${PORT}/                 ║
║   API Demo:          http://localhost:${PORT}/api/demo         ║
║   API Docs:          http://localhost:${PORT}/docs              ║
║   Dashboard:         http://localhost:${PORT}/dashboard          ║
║   Swagger:           http://localhost:${PORT}/swagger           ║
║   Health:            http://localhost:${PORT}/api/v1/health    ║
║                                                              ║
║   Demo API Key:      fps-demo-key-2024                       ║
║   Test plates:       KAB-3291, KSS-7744, DEMO-123           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
