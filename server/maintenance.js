// Maintenance mode for the production cutover window (see the runbook).
//
// Enabled with MAINTENANCE_MODE=true (default: off). While enabled:
//   * safe (read-only) requests continue to work — the storefront stays browsable
//   * state-changing API requests (POST/PUT/PATCH/DELETE) get HTTP 503 with a
//     clear temporary-maintenance message, so no write can land on the wrong
//     database mid-cutover
//   * /api/health keeps working (it is registered before this middleware)
//
// The flag is read per request, so it can be toggled without a restart.
function maintenanceMode(req, res, next) {
  if (process.env.MAINTENANCE_MODE !== 'true') return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.status(503).json({
    error: 'The store is briefly undergoing scheduled maintenance. Please try again in a few minutes.',
    maintenance: true,
  });
}

module.exports = { maintenanceMode };
