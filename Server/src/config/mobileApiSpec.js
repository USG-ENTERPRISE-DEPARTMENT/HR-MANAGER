// ─────────────────────────────────────────────────────────────────────────────
// OpenAPI 3 description of the mobile self-service API (`/v1/api/hr/me/*`).
//
// Served publicly (no login) at /v1/api/hr/me/docs so the mobile developer can work without an HR
// account. Because it is public, this spec deliberately does NOT document:
//   • that `x-employee-id` is trusted without being bound to the key, or
//   • that employee ids are sequential and therefore enumerable.
// Those are real properties of the deployed system (see middleware/mobileAuth.js, which states them
// plainly for maintainers) but publishing them next to a live "Try it out" button would hand a
// working data-extraction recipe to anyone who can reach the server.
//
// "Try it out" is disabled in the UI for the same reason — the docs describe the API, they are not a
// console for calling it.
// ─────────────────────────────────────────────────────────────────────────────

const okEnvelope = (dataSchema, message = 'OK') => ({
  type: 'object',
  properties: {
    status:  { type: 'string', example: '200' },
    message: { type: 'string', example: message },
    data:    dataSchema,
  },
});

const errorEnvelope = (status, message) => ({
  description: message,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          status:  { type: 'string', example: status },
          message: { type: 'string', example: message },
        },
      },
    },
  },
});

// Ids are 64-bit integers server-side and are always serialised as strings — parsing them as JS
// numbers loses precision, so the spec is explicit about it everywhere.
const id = (example = '4471') => ({ type: 'string', example, description: '64-bit id, sent as a string' });

const COMMON_ERRORS = {
  400: errorEnvelope('400', 'Missing or invalid input (e.g. no x-employee-id header)'),
  401: errorEnvelope('401', 'Missing or invalid API key'),
  403: errorEnvelope('403', 'Employee record is not active, or not the supervisor for this request'),
  404: errorEnvelope('404', 'Record not found, or not owned by this employee'),
  429: errorEnvelope('429', 'Rate limited — 120 requests per minute per IP'),
};

/** Build one path entry, folding in the shared error responses. */
function op({ tag, summary, description, params = [], body = null, response, responses = {} }) {
  const o = {
    tags: [tag],
    summary,
    ...(description ? { description } : {}),
    ...(params.length ? { parameters: params } : {}),
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: okEnvelope(response ?? { type: 'object' }, summary) } },
      },
      ...COMMON_ERRORS,
      ...responses,
    },
  };
  if (body) {
    o.requestBody = {
      required: true,
      content: { 'application/json': { schema: body } },
    };
  }
  return o;
}

const pathId = {
  name: 'id', in: 'path', required: true, schema: { type: 'string' },
  description: 'Record id (must belong to the authenticated employee)',
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'HR Mobile Self-Service API',
    version: '1.0.0',
    description: [
      'Endpoints for the staff mobile app: an employee\'s own profile, leave, payslips, attendance,',
      'medical claims, training, documents and notifications, plus approvals for their direct reports.',
      '',
      '## Authentication',
      '',
      'Every request must send **both** headers:',
      '',
      '| Header | Value |',
      '|---|---|',
      '| `x-api-key` | Issued from *Settings → Mobile API* in the web app |',
      '| `x-employee-id` | The employee this request is for — either the numeric id (`12`) or the employee code (`EMP-2026-0012`) |',
      '',
      'There is no login call and no bearer token — the key authenticates the app itself.',
      '',
      '## Conventions',
      '',
      '- All ids are **strings** in JSON (they are 64-bit integers server-side). Do not parse them as JS numbers.',
      '- Dates are `YYYY-MM-DD`.',
      '- Every response is wrapped: `{ "status": "200", "message": "...", "data": ... }`.',
      '- Listing endpoints always return only the authenticated employee\'s own records; query parameters cannot widen them.',
      '- Rate limit: **120 requests per minute per IP**. Exceeding it returns `429` with a `Retry-After` header.',
    ].join('\n'),
  },
  servers: [{ url: '/v1/api/hr/me', description: 'Mobile self-service base path' }],
  security: [{ ApiKeyAuth: [], EmployeeId: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth:  { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Key from Settings → Mobile API' },
      EmployeeId:  { type: 'apiKey', in: 'header', name: 'x-employee-id', description: 'Employee this request is for. Accepts the numeric id (12) or the employee code (EMP-2026-0012).' },
    },
    schemas: {
      Identity: {
        type: 'object',
        properties: {
          id: id(), code: { type: 'string', example: 'EMP-00004' },
          name: { type: 'string', example: 'Henry Amoh' },
          supervisorId: { ...id('2'), nullable: true },
        },
      },
      Leave: {
        type: 'object',
        properties: {
          id: id('1784846878958'), employee: id(),
          leave_type: id('1'), leave_type_name: { type: 'string', example: 'Annual Leave' },
          leave_period: id('2'), period_name: { type: 'string', example: '2026 Leave Period' },
          date_start: { type: 'string', format: 'date', example: '2026-08-03' },
          date_end:   { type: 'string', format: 'date', example: '2026-08-07' },
          status: { type: 'string', example: 'Draft', enum: ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Cancelled'] },
          details: { type: 'string', example: 'Family visit' },
          day_count: { type: 'integer', example: 5 },
        },
      },
      LeaveApplication: {
        type: 'object',
        required: ['leave_type', 'leave_period', 'date_start', 'date_end'],
        properties: {
          leave_type:   { ...id('1'), description: 'From GET /leave/types' },
          leave_period: { ...id('2'), description: 'The active leave period' },
          date_start:   { type: 'string', format: 'date', example: '2026-08-03' },
          date_end:     { type: 'string', format: 'date', example: '2026-08-07' },
          details:      { type: 'string', example: 'Family visit' },
          req_allowance: { type: 'string', enum: ['Yes', 'No'], example: 'No' },
        },
      },
      PayslipRuns: {
        type: 'object',
        properties: {
          employeeId: id(),
          runs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                run_id: id('3'), name: { type: 'string', example: 'July 2026 Payroll' },
                date_start: { type: 'string', format: 'date' },
                date_end:   { type: 'string', format: 'date' },
                status: { type: 'string', example: 'Completed' },
              },
            },
          },
        },
      },
      AttendanceRecord: {
        type: 'object',
        properties: {
          id: id('91'), employee: id(),
          date: { type: 'string', format: 'date', example: '2026-07-23' },
          in_time:  { type: 'string', nullable: true, example: '08:02' },
          out_time: { type: 'string', nullable: true, example: '17:10' },
          status: { type: 'string', example: 'Present' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: id('55'), title: { type: 'string', example: 'Leave approved' },
          message: { type: 'string', example: 'Your leave request was approved.' },
          status: { type: 'string', enum: ['Unread', 'Read'], example: 'Unread' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Subordinate: {
        type: 'object',
        properties: {
          id: id('5'), name: { type: 'string', example: 'Enock Ansah' },
          employee_code: { type: 'string', example: 'EMP-00005' },
        },
      },
      // Body for POST /medical/staff. `employee` is NOT listed: on the mobile /me/* path the server
      // forces it to the authenticated employee, so the app must not send it. The record is created
      // as a Draft — call /medical/staff/{id}/submit to send it for approval.
      StaffMedicalClaim: {
        type: 'object',
        required: ['admission_date', 'illness_type', 'cost'],
        properties: {
          admission_date:  { type: 'string', format: 'date', example: '2026-07-20', description: 'Date admitted / treated' },
          discharged_date: { type: 'string', format: 'date', nullable: true, example: '2026-07-22' },
          admission_type:  { type: 'string', example: 'Outpatient' },
          illness_type:    { type: 'string', example: 'Malaria', description: 'Nature of the illness/treatment' },
          medication:      { type: 'string', example: 'Artemether-lumefantrine' },
          hospital:        { type: 'string', example: 'City General Hospital' },
          physician:       { type: 'string', nullable: true, example: 'Dr. Kamara' },
          cost:            { type: 'number', example: 250.00, description: 'Amount claimed' },
          mode_of_payment: { type: 'string', nullable: true, example: 'Cash' },
          attachment1:     { type: 'string', nullable: true, description: 'Uploaded receipt/report reference', example: null },
        },
      },
      // Body for POST /medical/dependents. As above, `employee` is server-set and must not be sent.
      DependentMedicalClaim: {
        type: 'object',
        required: ['dependent_id', 'date_attended', 'illness_type', 'cost'],
        properties: {
          dependent_id:    { ...id('7'), description: 'Registered dependant id (from the employee\'s dependants)' },
          relationship:    { type: 'string', example: 'Child' },
          dob:             { type: 'string', format: 'date', nullable: true, example: '2015-04-10' },
          date_attended:   { type: 'string', format: 'date', example: '2026-07-20' },
          date_discharged: { type: 'string', format: 'date', nullable: true, example: '2026-07-21' },
          admission_type:  { type: 'string', example: 'Outpatient' },
          illness_type:    { type: 'string', example: 'Tonsillitis' },
          medication:      { type: 'string', example: 'Amoxicillin' },
          hospital:        { type: 'string', example: 'City General Hospital' },
          physician:       { type: 'string', nullable: true, example: 'Dr. Bangura' },
          cost:            { type: 'number', example: 120.00 },
          mode_of_payment: { type: 'string', nullable: true, example: 'Cash' },
          attachment1:     { type: 'string', nullable: true, example: null },
        },
      },
    },
  },
  tags: [
    { name: 'Identity',      description: 'Verify credentials' },
    { name: 'Profile',       description: 'The employee\'s own record' },
    { name: 'Leave',         description: 'Apply for and manage own leave' },
    { name: 'Payslips',      description: 'Own payslips and tax summary' },
    { name: 'Attendance',    description: 'Clock in/out and own timesheet' },
    { name: 'Medical',       description: 'Own and dependent medical claims' },
    { name: 'Training',      description: 'Course catalog and own nominations' },
    { name: 'Performance',   description: 'Own reviews and goals' },
    { name: 'Documents',     description: 'Personal, shared and company documents' },
    { name: 'Notifications', description: 'In-app notification feed' },
    { name: 'Approvals',     description: 'Supervisor actions for direct reports' },
  ],
  paths: {
    '/whoami': {
      get: op({
        tag: 'Identity', summary: 'Verify key and employee id',
        description: 'Cheap call to confirm the headers are valid and show "signed in as" in the app.',
        response: { $ref: '#/components/schemas/Identity' },
      }),
    },

    '/profile': {
      get: op({ tag: 'Profile', summary: 'Get own profile', response: { type: 'object' } }),
      put: op({
        tag: 'Profile', summary: 'Update own contact details',
        description: 'Only `phone`, `personal_email`, `address`, `residential_address`, `city` and `country` are accepted. Any other field is ignored — pay grade, job title, department and status are HR-controlled.',
        body: {
          type: 'object',
          properties: {
            phone: { type: 'string', example: '+233201234567' },
            personal_email: { type: 'string', example: 'me@example.com' },
            address: { type: 'string' }, residential_address: { type: 'string' },
            city: { type: 'string' }, country: { type: 'string' },
          },
        },
        response: { type: 'object' },
      }),
    },

    '/leave': {
      get: op({
        tag: 'Leave', summary: 'List own leave requests',
        params: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Filter by status' },
          { name: 'date_start', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'date_end',   in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        response: { type: 'array', items: { $ref: '#/components/schemas/Leave' } },
      }),
      post: op({
        tag: 'Leave', summary: 'Apply for leave',
        description: 'Creates the request as a Draft. Call `/leave/{id}/submit` to send it for approval.',
        body: { $ref: '#/components/schemas/LeaveApplication' },
        response: { $ref: '#/components/schemas/Leave' },
      }),
    },
    '/leave/types':   { get: op({ tag: 'Leave', summary: 'List available leave types', response: { type: 'array', items: { type: 'object' } } }) },
    '/leave/balance': { get: op({ tag: 'Leave', summary: 'Get own leave balance', description: 'Entitlement, days taken and remaining for each leave type.', response: { type: 'object' } }) },
    '/leave/{id}': {
      put:    op({ tag: 'Leave', summary: 'Edit an own draft leave request', params: [pathId], body: { $ref: '#/components/schemas/LeaveApplication' }, response: { $ref: '#/components/schemas/Leave' } }),
      delete: op({ tag: 'Leave', summary: 'Delete an own draft leave request', params: [pathId], response: { type: 'object' } }),
    },
    '/leave/{id}/submit': { post: op({ tag: 'Leave', summary: 'Submit a leave request for approval', params: [pathId], response: { type: 'object' } }) },
    '/leave/{id}/cancel': { post: op({ tag: 'Leave', summary: 'Cancel a leave request', params: [pathId], response: { type: 'object' } }) },

    '/payslips':          { get: op({ tag: 'Payslips', summary: 'List own payslips', description: 'Completed and approved payroll runs that include this employee.', response: { $ref: '#/components/schemas/PayslipRuns' } }) },
    '/payslips/{id}/pdf': {
      get: {
        tags: ['Payslips'], summary: 'Download a payslip PDF',
        description: 'Returns `application/pdf`. `{id}` is the payroll run id from `GET /payslips`.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Payroll run id' }],
        responses: {
          200: { description: 'PDF file', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
          ...COMMON_ERRORS,
        },
      },
    },
    '/tax-summary': {
      get: op({
        tag: 'Payslips', summary: 'Annual earnings and tax summary',
        params: [{ name: 'year', in: 'query', schema: { type: 'string', example: '2026' }, description: 'Defaults to the most recent year with data' }],
        response: { type: 'object' },
      }),
    },

    '/attendance/punch': {
      post: op({
        tag: 'Attendance', summary: 'Clock in or out',
        description: 'Direction is inferred from the employee\'s last punch. Punches within 60 seconds of the previous one are rejected.',
        response: { type: 'object' },
      }),
    },
    '/attendance/today':     { get: op({ tag: 'Attendance', summary: 'Today\'s attendance record', response: { $ref: '#/components/schemas/AttendanceRecord' } }) },
    '/attendance/timesheet': {
      get: op({
        tag: 'Attendance', summary: 'Own timesheet',
        params: [
          { name: 'month', in: 'query', schema: { type: 'string', example: '2026-07' }, description: 'YYYY-MM; defaults to the current month' },
          { name: 'date_from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Overrides month. Range cannot exceed one year.' },
          { name: 'date_to',   in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        response: { type: 'array', items: { $ref: '#/components/schemas/AttendanceRecord' } },
      }),
    },

    '/medical/enquiry':    { get: op({ tag: 'Medical', summary: 'Own medical limit and utilisation', description: 'Entitlement, amount used and remaining balance.', response: { type: 'object' } }) },
    '/medical/staff': {
      get:  op({ tag: 'Medical', summary: 'List own staff medical claims', response: { type: 'array', items: { type: 'object' } } }),
      post: op({
        tag: 'Medical', summary: 'Create a staff medical claim',
        description: 'Creates the claim as a Draft for the authenticated employee. Do not send `employee` — it is set from the auth headers. Call `/medical/staff/{id}/submit` afterwards to send it for approval.',
        body: { $ref: '#/components/schemas/StaffMedicalClaim' }, response: { type: 'object' },
      }),
    },
    '/medical/staff/{id}/submit':      { post: op({ tag: 'Medical', summary: 'Submit a staff medical claim', params: [pathId], response: { type: 'object' } }) },
    '/medical/dependents': {
      get:  op({ tag: 'Medical', summary: 'List own dependent medical claims', response: { type: 'array', items: { type: 'object' } } }),
      post: op({
        tag: 'Medical', summary: 'Create a dependent medical claim',
        description: 'Creates the claim as a Draft for one of the employee\'s registered dependants. Do not send `employee`. Call `/medical/dependents/{id}/submit` afterwards to send it for approval.',
        body: { $ref: '#/components/schemas/DependentMedicalClaim' }, response: { type: 'object' },
      }),
    },
    '/medical/dependents/{id}/submit': { post: op({ tag: 'Medical', summary: 'Submit a dependent medical claim', params: [pathId], response: { type: 'object' } }) },

    '/training/catalog':     { get: op({ tag: 'Training', summary: 'List available courses', description: 'Includes remaining seats per course and start date.', response: { type: 'array', items: { type: 'object' } } }) },
    '/training/nominations': {
      get:  op({ tag: 'Training', summary: 'List own nominations', response: { type: 'array', items: { type: 'object' } } }),
      post: op({ tag: 'Training', summary: 'Nominate self for a course', body: { type: 'object' }, response: { type: 'object' } }),
    },
    '/training/nominations/{id}/submit': { post: op({ tag: 'Training', summary: 'Submit a nomination for approval', params: [pathId], response: { type: 'object' } }) },

    '/reviews':             { get: op({ tag: 'Performance', summary: 'List own performance reviews', response: { type: 'array', items: { type: 'object' } } }) },
    '/reviews/{id}/self':   { post: op({ tag: 'Performance', summary: 'Submit self-assessment', params: [pathId], body: { type: 'object' }, response: { type: 'object' } }) },
    '/goals': {
      get:  op({ tag: 'Performance', summary: 'List own goals', response: { type: 'array', items: { type: 'object' } } }),
      post: op({ tag: 'Performance', summary: 'Create a goal', body: { type: 'object' }, response: { type: 'object' } }),
    },

    '/documents':         { get: op({ tag: 'Documents', summary: 'Own personal documents', response: { type: 'array', items: { type: 'object' } } }) },
    '/documents/shared':  { get: op({ tag: 'Documents', summary: 'Documents shared with this employee', response: { type: 'array', items: { type: 'object' } } }) },
    '/documents/company': { get: op({ tag: 'Documents', summary: 'Company-wide documents', response: { type: 'array', items: { type: 'object' } } }) },

    '/notifications':              { get: op({ tag: 'Notifications', summary: 'Latest notifications', description: 'Newest 50, with an unread count.', response: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Notification' } }, unreadCount: { type: 'integer', example: 3 } } } }) },
    '/notifications/unread-count': { get: op({ tag: 'Notifications', summary: 'Unread badge count', description: 'Cheap enough to poll for a badge.', response: { type: 'object', properties: { count: { type: 'integer', example: 3 } } } }) },
    '/notifications/read-all':     { put: op({ tag: 'Notifications', summary: 'Mark all as read', response: { type: 'object' } }) },
    '/notifications/{id}/read':    { put: op({ tag: 'Notifications', summary: 'Mark one as read', params: [pathId], response: { type: 'object' } }) },

    '/approvals':               { get: op({ tag: 'Approvals', summary: 'Pending approval queue', description: 'Requests from direct reports awaiting this supervisor.', response: { type: 'object' } }) },
    '/approvals/subordinates':  { get: op({ tag: 'Approvals', summary: 'List direct reports', response: { type: 'array', items: { $ref: '#/components/schemas/Subordinate' } } }) },
    '/approvals/leave':         { get: op({ tag: 'Approvals', summary: 'Subordinates\' leave requests', response: { type: 'array', items: { $ref: '#/components/schemas/Leave' } } }) },
  },
};

// Approve/reject pairs are identical in shape across the three modules — generate them rather than
// repeating twelve near-identical blocks.
for (const [module, label] of [['leave', 'leave request'], ['medical', 'medical claim'], ['training', 'training nomination']]) {
  for (const action of ['approve', 'reject']) {
    spec.paths[`/approvals/${module}/{id}/${action}`] = {
      post: op({
        tag: 'Approvals',
        summary: `${action === 'approve' ? 'Approve' : 'Reject'} a subordinate's ${label}`,
        description: 'Only the employee\'s direct supervisor may act. Anyone else receives `403`.',
        params: [pathId],
        body: { type: 'object', properties: { comment: { type: 'string', example: 'Approved — enjoy your break.' } } },
        response: { type: 'object' },
      }),
    };
  }
}

module.exports = spec;
