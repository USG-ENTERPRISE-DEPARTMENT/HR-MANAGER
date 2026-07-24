// ─────────────────────────────────────────────────────────────────────────────
// Mobile self-service routes — mounted at /v1/api/hr/me
//
// Auth is `x-api-key` + `x-employee-id` (see middleware/mobileAuth.js), NOT the JWT used by the web
// app. This router is mounted before the global `checkToken` in routes.js so no Bearer token is
// required or accepted here.
//
// Every handler lives in meController and forces the employee to the authenticated one. Routes that
// address a record by :id carry an ownership guard so a caller cannot act on someone else's record.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const swaggerUi = require('swagger-ui-express');

const { mobileAuth, rateLimit } = require('../middleware/mobileAuth');
const me = require('../controllers/meController');
const mobileApiSpec = require('../config/mobileApiSpec');

// Express routes the bare path `/me` into this sub-router as '/'. That is the web app's
// JWT-authenticated getMe endpoint, not a mobile route — hand it straight back to the parent router
// before any mobile auth runs, otherwise it would be rejected with 401 for lacking an API key.
router.use((req, res, next) => (req.path === '/' ? next('router') : next()));

// ── API documentation (public, no auth) ──────────────────────────────────────
// Mounted BEFORE rateLimit/mobileAuth so the mobile developer can read the docs without an HR
// account or a key. "Try it out" is disabled: the docs describe the API, they are not a console for
// calling it against live employee data from an unauthenticated page.
router.get('/docs/openapi.json', (_req, res) => res.json(mobileApiSpec));
router.use('/docs', swaggerUi.serveFiles(mobileApiSpec, {}), swaggerUi.setup(mobileApiSpec, {
  customSiteTitle: 'HR Mobile API',
  // The Swagger topbar only holds a logo and a spec-URL box; both are noise when this is embedded
  // in the Settings tab, so it is hidden.
  customCss: '.swagger-ui .topbar { display: none } .swagger-ui .info { margin: 20px 0 }',
  swaggerOptions: { supportedSubmitMethods: [], defaultModelsExpandDepth: -1, docExpansion: 'list' },
}));

// Order matters: rate limit before the key check so a flood of bad keys is also throttled.
router.use(rateLimit);
router.use(mobileAuth);

// ── Session / identity ───────────────────────────────────────────────────────
// Lets the app confirm the key + employee id are valid and show "logged in as".
//
// Deliberately NOT mounted at '/' — `router.use('/me', …)` in routes.js matches the bare path
// `/me` as well as `/me/...`, so a handler here would shadow the web app's JWT-authenticated
// `GET /me` (getMe). Verified against Express: a sub-router '/' route wins over a later
// `router.get('/me')` sibling. Keep this on an explicit sub-path.
router.get('/whoami', (req, res) =>
  res.json({ status: '200', message: 'Authenticated', data: req.self }));

// ── Profile ──────────────────────────────────────────────────────────────────
router.get('/profile', me.getProfile);
router.put('/profile', me.updateProfile);

// ── Leave ────────────────────────────────────────────────────────────────────
router.get   ('/leave',          me.getLeaves);
router.post  ('/leave',          me.applyLeave);
router.get   ('/leave/types',    me.getLeaveTypes);
router.get   ('/leave/balance',  me.getLeaveBalance);
router.put   ('/leave/:id',        me.leaveOwnership, me.updateLeave);
router.delete('/leave/:id',        me.leaveOwnership, me.deleteLeave);
router.post  ('/leave/:id/submit', me.leaveOwnership, me.submitLeave);
router.post  ('/leave/:id/cancel', me.leaveOwnership, me.cancelLeave);

// ── Payslips ─────────────────────────────────────────────────────────────────
router.get('/payslips',              me.getMyPayslips);
router.get('/payslips/:id/pdf',      me.downloadPayslip);
router.get('/tax-summary',           me.getMyTaxSummary);

// ── Attendance ───────────────────────────────────────────────────────────────
router.post('/attendance/punch',     me.punch);
router.get ('/attendance/today',     me.getToday);
router.get ('/attendance/timesheet', me.getTimesheet);

// ── Medical ──────────────────────────────────────────────────────────────────
router.get ('/medical/enquiry',   me.getMedicalEnquiry);
router.get ('/medical/staff',     me.getStaffMedical);
router.post('/medical/staff',     me.createStaffMedical);
router.post('/medical/staff/:id/submit', me.staffMedicalOwnership, me.submitStaffMedical);
router.get ('/medical/dependents', me.getDependentMedical);
router.post('/medical/dependents', me.createDependentMedical);
router.post('/medical/dependents/:id/submit', me.dependentMedicalOwnership, me.submitDependentMedical);

// ── Training ─────────────────────────────────────────────────────────────────
router.get ('/training/catalog',     me.getCatalog);
router.get ('/training/nominations', me.getNominations);
router.post('/training/nominations', me.createNomination);
router.post('/training/nominations/:id/submit', me.nominationOwnership, me.submitNomination);

// ── Performance ──────────────────────────────────────────────────────────────
router.get ('/reviews',              me.getMyReviews);
router.post('/reviews/:id/self',     me.submitSelfAssessment);
router.get ('/goals',                me.getGoals);
router.post('/goals',                me.createGoal);

// ── Documents ────────────────────────────────────────────────────────────────
router.get('/documents',          me.getMyDocuments);
router.get('/documents/shared',   me.getSharedDocuments);
router.get('/documents/company',  me.getCompanyDocs);

// ── Notifications ────────────────────────────────────────────────────────────
router.get('/notifications',              me.getNotifications);
router.get('/notifications/unread-count', me.unreadCount);
router.put('/notifications/read-all',     me.markAllRead);
router.put('/notifications/:id/read',     me.markRead);

// ── Supervisor approvals ─────────────────────────────────────────────────────
// Each action re-checks that the target employee reports to the caller.
router.get ('/approvals',            me.getApprovals);
router.get ('/approvals/subordinates', me.getSubordinates);
router.get ('/approvals/leave',      me.getSubordinateLeaves);
router.post('/approvals/leave/:id/approve',   me.requireLeaveSubordinate,    me.approveLeave);
router.post('/approvals/leave/:id/reject',    me.requireLeaveSubordinate,    me.rejectLeave);
router.post('/approvals/medical/:id/approve', me.requireMedicalSubordinate,  me.approveMedical);
router.post('/approvals/medical/:id/reject',  me.requireMedicalSubordinate,  me.rejectMedical);
router.post('/approvals/training/:id/approve', me.requireTrainingSubordinate, me.approveTraining);
router.post('/approvals/training/:id/reject',  me.requireTrainingSubordinate, me.rejectTraining);

// ── Catch-all ────────────────────────────────────────────────────────────────
// The bare `/me` path is already handed back to the parent router at the top of this file, so
// anything reaching here is a genuine mobile sub-path that matched nothing.
router.all('*', (req, res) =>
  res.status(404).json({ status: '404', message: 'Mobile API route not found' }));

module.exports = router;
