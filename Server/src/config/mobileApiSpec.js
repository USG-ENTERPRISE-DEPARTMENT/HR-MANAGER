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

/** Build one path entry, folding in the shared error responses.
 *  `multipart: true` renders the request body as multipart/form-data (so Swagger shows file pickers)
 *  instead of application/json. */
function op({ tag, summary, description, params = [], body = null, multipart = false, response, responses = {} }) {
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
      content: { [multipart ? 'multipart/form-data' : 'application/json']: { schema: body } },
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
        required: ['leave_type', 'date_start', 'date_end'],
        properties: {
          leave_type:   { ...id('1'), description: 'From GET /leave/types' },
          leave_period: { ...id('2'), nullable: true, description: 'Optional — defaults to the currently active leave period. Omit unless applying against a specific past period.' },
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
      // Body for POST /training/nominations. `employee` is NOT listed: on the mobile /me/* path the
      // server forces it to the authenticated employee, so the app must not send it. `nomination_type`
      // is likewise omitted — self-nominations default to 'Self'. The record is created as a Draft;
      // call /training/nominations/{id}/submit to send it for approval.
      //
      // Two ways to nominate:
      //   • From the catalog — send `training_catalog_id` (from /training/catalog) and `start_date`.
      //     Name, provider, category, type, cost and currency are back-filled from the catalog entry.
      //   • Ad-hoc external course — send `training_name` and `start_date`, plus whatever else applies.
      // `training_name` is required by the server in BOTH cases, so send it either way.
      TrainingNomination: {
        type: 'object',
        required: ['training_name', 'start_date'],
        properties: {
          training_catalog_id: { ...id('12'), nullable: true, description: 'Catalog course id from /training/catalog. When set, the fields below are back-filled from the course and may be omitted.' },
          training_name:       { type: 'string', example: 'Advanced Excel for Finance', description: 'Course title. Required even when `training_catalog_id` is supplied.' },
          provider:            { type: 'string', nullable: true, example: 'Ghana Institute of Management' },
          category:            { type: 'string', nullable: true, example: 'Technical' },
          type:                { type: 'string', nullable: true, example: 'External', description: 'e.g. Internal / External / Online' },
          start_date:          { type: 'string', format: 'date', example: '2026-09-14' },
          end_date:            { type: 'string', format: 'date', nullable: true, example: '2026-09-18' },
          venue:               { type: 'string', nullable: true, example: 'Accra Training Centre' },
          cost:                { type: 'number', nullable: true, example: 1500.00 },
          currency:            { type: 'string', nullable: true, example: 'GHS' },
          notes:               { type: 'string', nullable: true, example: 'Relevant to my current reporting duties.' },
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
          attachments:     {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            description: 'Up to 3 supporting files (receipts/reports). PDF or image; 20 MB each. Optional.',
          },
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
          attachments:     {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            description: 'Up to 3 supporting files (receipts/reports). PDF or image; 20 MB each. Optional.',
          },
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
    { name: 'Payroll',       description: 'Payroll run lookup by GL reference. Unlike every other tag here, this is NOT self-scoped — it returns a whole payroll run. All calls are logged.' },
    { name: 'Core Banking',  description: 'Server-to-server callbacks from the core banking system. Authenticated with the API key ALONE — no x-employee-id, because the caller is a system rather than a person.' },
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
        description: 'Multipart form. Creates the claim as a Draft for the authenticated employee. Do not send `employee` — it is set from the auth headers. Attach up to 3 supporting files under `attachments`. Call `/medical/staff/{id}/submit` afterwards to send it for approval.',
        multipart: true, body: { $ref: '#/components/schemas/StaffMedicalClaim' }, response: { type: 'object' },
      }),
    },
    '/medical/staff/{id}': {
      put: op({
        tag: 'Medical', summary: 'Edit an own draft staff medical claim',
        description: 'Multipart form. Only claims still in `Draft` may be edited — once submitted the claim belongs to the approval flow and returns `400`. Approval fields (`status`, `rejection_reason`) are ignored: approving or rejecting a claim is done by staff with the medical permissions on the Manage Medical page, never from self-service.',
        multipart: true, params: [pathId], body: { $ref: '#/components/schemas/StaffMedicalClaim' }, response: { type: 'object' },
      }),
      delete: op({ tag: 'Medical', summary: 'Delete an own draft staff medical claim', description: 'Only claims still in `Draft` may be deleted.', params: [pathId], response: { type: 'object' } }),
    },
    '/medical/staff/{id}/submit':      { post: op({ tag: 'Medical', summary: 'Submit a staff medical claim', params: [pathId], response: { type: 'object' } }) },
    '/medical/dependents': {
      get:  op({ tag: 'Medical', summary: 'List own dependent medical claims', response: { type: 'array', items: { type: 'object' } } }),
      post: op({
        tag: 'Medical', summary: 'Create a dependent medical claim',
        description: 'Multipart form. Creates the claim as a Draft for one of the employee\'s registered dependants. Do not send `employee`. Attach up to 3 supporting files under `attachments`. Call `/medical/dependents/{id}/submit` afterwards to send it for approval.',
        multipart: true, body: { $ref: '#/components/schemas/DependentMedicalClaim' }, response: { type: 'object' },
      }),
    },
    '/medical/dependents/{id}': {
      put: op({
        tag: 'Medical', summary: 'Edit an own draft dependent medical claim',
        description: 'Multipart form. Only claims still in `Draft` may be edited — once submitted the claim belongs to the approval flow and returns `400`. Approval fields (`status`, `rejection_reason`) are ignored: approving or rejecting a claim is done by staff with the medical permissions on the Manage Medical page, never from self-service.',
        multipart: true, params: [pathId], body: { $ref: '#/components/schemas/DependentMedicalClaim' }, response: { type: 'object' },
      }),
      delete: op({ tag: 'Medical', summary: 'Delete an own draft dependent medical claim', description: 'Only claims still in `Draft` may be deleted.', params: [pathId], response: { type: 'object' } }),
    },
    '/medical/dependents/{id}/submit': { post: op({ tag: 'Medical', summary: 'Submit a dependent medical claim', params: [pathId], response: { type: 'object' } }) },

    '/training/catalog':     { get: op({ tag: 'Training', summary: 'List available courses', description: 'Includes remaining seats per course and start date.', response: { type: 'array', items: { type: 'object' } } }) },
    '/training/nominations': {
      get:  op({ tag: 'Training', summary: 'List own nominations', response: { type: 'array', items: { type: 'object' } } }),
      post: op({
        tag: 'Training', summary: 'Nominate self for a course',
        description: 'Creates the nomination as a Draft for the authenticated employee. Do not send `employee` — it is set from the auth headers. Either link a catalog course with `training_catalog_id` or describe an external one; `training_name` and `start_date` are always required. Rejected with `400` if the employee already has a nomination for the same course and start date, or if the course has no seats left. Call `/training/nominations/{id}/submit` afterwards to send it for approval.',
        body: { $ref: '#/components/schemas/TrainingNomination' }, response: { type: 'object' },
      }),
    },
    '/training/nominations/{id}': {
      put: op({
        tag: 'Training', summary: 'Edit an own draft nomination',
        description: 'Only nominations still in `Draft` may be edited — once submitted the nomination is in the approval flow and returns `400`. Rejected with `400` if the edit would duplicate another nomination for the same course and start date.',
        params: [pathId], body: { $ref: '#/components/schemas/TrainingNomination' }, response: { type: 'object' },
      }),
      delete: op({ tag: 'Training', summary: 'Delete an own draft nomination', description: 'Only nominations still in `Draft` may be deleted.', params: [pathId], response: { type: 'object' } }),
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
    '/documents/{filename}': {
      get: {
        tags: ['Documents'],
        summary: 'Fetch an attachment or document file',
        description:
          'Streams the stored file. Pass the filename exactly as it appears in a record — e.g. a medical ' +
          'claim\'s `attachment1`, or `filename` on a document listing. Served inline for viewing; add ' +
          '`?download=1` to force a download. Returns 404 if the file is missing from storage.',
        parameters: [
          { name: 'filename', in: 'path', required: true, schema: { type: 'string' },
            example: 'da7a4a950ffc8e62882cbb989568dc8613c1a6b47729875974ada1a12044166a.png' },
          { name: 'download', in: 'query', required: false, schema: { type: 'string', enum: ['1'] },
            description: 'Set to 1 to force a download instead of inline display.' },
        ],
        responses: {
          200: { description: 'The file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
          404: { description: 'Document not found' },
        },
      },
    },

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

// ── Payroll lookup by GL reference ───────────────────────────────────────────
// `security` is overridden to the API key alone: the caller is the core banking system, which has no
// employee identity to send. The base path still applies.
//
// Written longhand rather than via op(): that helper folds in COMMON_ERRORS, whose 403 and 404 text
// describes self-scoped record access ("not owned by this employee"), which would misdescribe this
// endpoint's failure modes.
spec.paths['/payroll/runs/by-reference/{reference}'] = {
  get: {
    tags: ['Payroll'],
    summary: 'Get a payroll run by its GL reference number',
    description: [
      '⚠️ **Not self-scoped.** Every other endpoint in this API returns only the calling employee\'s own',
      'records. This one returns an **entire payroll run** — every employee in it, with their salary',
      'figures and bank accounts. Any caller holding a valid API key and the run\'s GL reference can',
      'read it.',
      '',
      'Returns a single payroll run matched on `payrollruns.document_ref` — the reference returned by',
      'the GL when the run was posted. Each employee is a separate object carrying the payroll columns',
      'flagged for posting (`posting_column = \'Yes\'`), with their GL account, branch and currency, plus',
      'derived `earnings`, `deductions` and `netPay`.',
      '',
      'The figures mirror what was actually sent to the GL: the same posting-column filter and the same',
      '`earnings - deductions` net pay that the posting synthesizes. Zero-amount cells are omitted, as',
      'they are never posted either.',
      '',
      '### Authentication',
      '',
      '`x-api-key` only — **no `x-employee-id` is required**, since the caller is a system rather than a',
      'person. The same 120 req/min rate limit as the rest of this API applies. **Every call is logged**:',
      'the reference requested, the outcome, the source IP and user agent are written to',
      '`payroll_api_access_log`, including calls that are refused.',
      '',
      '### Reachability',
      '',
      'Only runs that actually posted to the GL have a `document_ref`. Runs still in Draft, Processing,',
      'Approved or GL Failed — and runs finalized while payroll GL posting was switched off — have no',
      'reference and return `404`.',
      '',
      'A freshly posted run is `Bank Pending` (journal accepted, awaiting the core banking approval',
      'flow); it becomes `Completed` once confirmed via the confirmation callback, or `Rejected` via',
      'the rejection callback. All three are reachable here and keep their reference.',
    ].join('\n'),
    security: [{ ApiKeyAuth: [] }],
    parameters: [{
      name: 'reference', in: 'path', required: true,
      schema: { type: 'string', example: 'PR1263886414' },
      description: 'GL document reference stored on the run (`payrollruns.document_ref`).',
    }],
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: okEnvelope({
              type: 'object',
              properties: {
                id:            id('126'),
                name:          { type: 'string', example: 'PAYROLL FOR AUG 2026 - SNR MGT' },
                status:        { type: 'string', enum: ['Bank Pending', 'Completed', 'Rejected'], example: 'Bank Pending', description: '`Bank Pending` = posted, awaiting core banking approval. `Completed` = confirmed paid. `Rejected` = the bank refused it.' },
                document_ref:  { type: 'string', example: 'PR1263886414' },
                reference:     { type: 'string', example: 'PR1263886414', description: 'Echo of the reference that was looked up.' },
                employeeCount: { type: 'integer', example: 2 },
                totals: {
                  type: 'object',
                  description: 'Sum across every employee in the run.',
                  properties: {
                    earnings:   { type: 'number', example: 473111.44 },
                    deductions: { type: 'number', example: 175702.81 },
                    netPay:     { type: 'number', example: 297408.63 },
                  },
                },
                columnSummary: {
                  type: 'array',
                  description:
                    'Run-level total per posting column — the same rows as `employees[].columns`, '
                    + 'aggregated. Use this to reconcile the run against the GL journal without walking '
                    + 'every employee. **One row per column name.** Note that several columns may share '
                    + 'one GL account (e.g. Clothing, Overtime and Steward Allowance), so `glAccount` is '
                    + 'not unique across rows — sum by `glAccount` yourself if you need per-account '
                    + 'totals. Payments are listed before deductions, largest first. Sums to '
                    + '`totals.earnings` + `totals.deductions`; the balancing cash leg is `netPay`.',
                  items: {
                    type: 'object',
                    properties: {
                      name:          { type: 'string', example: 'Salary Basic' },
                      type:          { type: 'string', enum: ['Payment', 'Deduction'], example: 'Payment' },
                      glAccount:     { type: 'string', nullable: true, example: '012098776665', description: 'Null when the column had no GL account and the posting fell back to the env-level default.' },
                      glAccounts:    { type: 'array', items: { type: 'string', nullable: true }, example: ['012098776665'], description: 'Every distinct GL account this column posted to in the run. Normally one entry; more than one means the column posted to different accounts across employees.' },
                      currency:      { type: 'string', example: 'Cedis' },
                      employeeCount: { type: 'integer', example: 2, description: 'How many employees had a non-zero amount in this column.' },
                      amount:        { type: 'number', example: 347940.30, description: 'Total across every employee for this column.' },
                    },
                  },
                },
                netPay: {
                  type: 'object',
                  description:
                    'The cash leg of the journal, reported separately because it is derived '
                    + '(earnings - deductions per employee) rather than read from a payroll column. '
                    + 'Each line credits the employee\'s own bank account, so there is no single '
                    + '`glAccount`. Employees whose net is zero or negative are excluded, matching the '
                    + 'posting.',
                  properties: {
                    name:          { type: 'string', example: 'Net Pay' },
                    type:          { type: 'string', example: 'Credit' },
                    glAccount:     { type: 'string', nullable: true, example: null },
                    employeeCount: { type: 'integer', example: 2 },
                    amount:        { type: 'number', example: 297408.63 },
                  },
                },
                employees: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      employeeId:   id('45'),
                      employeeCode: { type: 'string', example: 'P1991001', description: 'Staff-facing code (employee.employee_id) — this is what the GL receives as employeeCode.' },
                      name:         { type: 'string', example: 'EMMANUEL BORBOR' },
                      bankAccount:  { type: 'string', nullable: true, example: '0212300317101' },
                      currency:     { type: 'string', example: 'Cedis' },
                      branch:       { type: 'string', example: '000' },
                      columns: {
                        type: 'array',
                        description: 'Posting columns for this employee, in payroll column order.',
                        items: {
                          type: 'object',
                          properties: {
                            name:      { type: 'string', example: 'Salary Basic' },
                            amount:    { type: 'number', example: 173970.15 },
                            type:      { type: 'string', enum: ['Payment', 'Deduction'], example: 'Payment' },
                            glAccount: { type: 'string', nullable: true, example: '012098776665', description: 'Null when the column had no GL account and the posting fell back to the env-level default.' },
                            branch:    { type: 'string', example: '000' },
                            currency:  { type: 'string', example: 'Cedis' },
                          },
                        },
                      },
                      earnings:   { type: 'number', example: 206564.83, description: 'Sum of Payment columns.' },
                      deductions: { type: 'number', example: 79816.32, description: 'Sum of Deduction columns.' },
                      netPay:     { type: 'number', example: 126748.51, description: 'earnings - deductions. Derived, not a stored column.' },
                    },
                  },
                },
              },
            }, 'Payroll run retrieved'),
          },
        },
      },
      400: errorEnvelope('400', 'Reference number is required'),
      401: errorEnvelope('401', 'Missing or invalid API key'),
      404: errorEnvelope('404', 'No payroll run found for that reference number'),
      429: errorEnvelope('429', 'Rate limited — 120 requests per minute per IP'),
    },
  },
};

// ── Core banking: payroll rejection callback ─────────────────────────────────
// Written longhand rather than via op(): `security` is overridden to the API key alone (this caller
// has no employee identity), and the error set differs from the self-scoped /me/* defaults.
spec.paths['/payroll/runs/rejection'] = {
  post: {
    tags: ['Core Banking'],
    summary: 'Reject a finalized payroll run',
    description: [
      'Called by the **core banking system** when a payroll batch it received is rejected during',
      'its own approval flow. The run is set to `Rejected` in HR-MANAGER with the supplied reason,',
      'so payroll staff can see the payment did not go through and act on it.',
      '',
      '### Authentication',
      '',
      'The `x-api-key` header **only** — do not send `x-employee-id`. The caller is a system, not an',
      'employee. The same 120 requests/minute per IP rate limit applies.',
      '',
      '### Identifying the run',
      '',
      '`reference` is the GL document reference returned when the batch was posted (the value in',
      '`documentRef` / `referenceNo`). It is the identifier both systems share.',
      '',
      '`employeeId` is **optional and informational**. A rejection applies to the whole batch, but',
      'the bank often knows which line caused it; when supplied it is recorded in the rejection',
      'reason and the audit trail. It is never used to decide which run to reject. Accepts either',
      'the staff code (`P1991001`) or the numeric employee id.',
      '',
      '### Repeat delivery',
      '',
      'Safe to retry. A run that is already `Rejected` returns `200` and is left unchanged, so a',
      'duplicate callback does not read as a failure.',
    ].join('\n'),
    security: [{ ApiKeyAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['reference', 'reason'],
            properties: {
              reference:  { type: 'string', example: 'PR1263886414', description: 'GL document reference of the posted payroll batch.' },
              reason:     { type: 'string', example: 'Insufficient funds in the settlement account', description: 'Why the batch was rejected. Shown to payroll staff.' },
              employeeId: { type: 'string', nullable: true, example: 'P1991001', description: 'Optional. The employee whose line triggered the rejection — recorded for context only.' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Run rejected (or was already rejected)',
        content: {
          'application/json': {
            schema: okEnvelope({
              type: 'object',
              properties: {
                id:               id('126'),
                name:             { type: 'string', example: 'PAYROLL FOR AUG 2026 - SNR MGT' },
                reference:        { type: 'string', example: 'PR1263886414' },
                status:           { type: 'string', example: 'Rejected' },
                rejection_reason: { type: 'string', example: 'Rejected by core banking for EMMANUEL BORBOR (P1991001): Insufficient funds' },
              },
            }, 'Payroll run rejected'),
          },
        },
      },
      400: errorEnvelope('400', 'reference or reason missing, or the run is not in a Bank Pending or Completed state'),
      401: errorEnvelope('401', 'Missing or invalid API key'),
      404: errorEnvelope('404', 'No payroll run found for that reference'),
      429: errorEnvelope('429', 'Rate limited — 120 requests per minute per IP'),
    },
  },
};

// ── Core banking: payroll confirmation callback ──────────────────────────────
// The counterpart to the rejection callback above. Written longhand for the same reason: op() folds
// in COMMON_ERRORS, whose 403/404 text describes self-scoped record access.
spec.paths['/payroll/runs/confirmation'] = {
  post: {
    tags: ['Core Banking'],
    summary: 'Confirm a payroll run was paid',
    description: [
      'Reports that the core banking system approved and paid a posted payroll batch.',
      '',
      'When HR finalizes a run its journal is posted to the general ledger and the run moves to',
      '`Bank Pending` — **not** paid. The core banking system then runs its own approval flow. This',
      'endpoint is how that flow reports success, moving the run to `Completed`.',
      '',
      'Without this call a successful payment produces no signal at all, and a run the bank never',
      'approved is indistinguishable from one that was paid. Implementing it is what makes the',
      'payroll status in HR trustworthy.',
      '',
      '### Authentication',
      '',
      'The `x-api-key` header **only** — do not send `x-employee-id`. The caller is a system, not an',
      'employee. The same 120 requests/minute per IP rate limit applies.',
      '',
      '### Identifying the run',
      '',
      '`reference` is the GL document reference returned when the batch was posted (the value in',
      '`documentRef` / `referenceNo`). It is the identifier both systems share.',
      '',
      '`note` is **optional and informational** — anything worth recording alongside the',
      'confirmation. It is stored in the audit trail and never affects which run is confirmed.',
      '',
      '### Repeat delivery',
      '',
      'Safe to retry. A run that is already `Completed` returns `200` and is left unchanged, so a',
      'duplicate callback does not read as a failure.',
      '',
      '### When it is refused',
      '',
      'Only a run in `Bank Pending` can be confirmed. A `Rejected` run returns `400` rather than',
      'being flipped back: once a batch is rejected its reference leaves the approval queue, so a',
      'later confirmation means the two systems disagree and that should surface, not be hidden.',
    ].join('\n'),
    security: [{ ApiKeyAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['reference'],
            properties: {
              reference: { type: 'string', example: 'PR1263886414', description: 'GL document reference of the posted payroll batch.' },
              note:      { type: 'string', nullable: true, example: 'Settled in batch 4471', description: 'Optional. Recorded in the audit trail for context.' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Run confirmed (or was already confirmed)',
        content: {
          'application/json': {
            schema: okEnvelope({
              type: 'object',
              properties: {
                id:                id('126'),
                name:              { type: 'string', example: 'PAYROLL FOR AUG 2026 - SNR MGT' },
                reference:         { type: 'string', example: 'PR1263886414' },
                status:            { type: 'string', example: 'Completed' },
                bank_confirmed_at: { type: 'string', nullable: true, example: '2026-08-13T11:41:36.000Z', description: 'When the confirmation was recorded.' },
              },
            }, 'Payroll run confirmed'),
          },
        },
      },
      400: errorEnvelope('400', 'reference missing, or the run is not in a Bank Pending state'),
      401: errorEnvelope('401', 'Missing or invalid API key'),
      404: errorEnvelope('404', 'No payroll run found for that reference'),
      429: errorEnvelope('429', 'Rate limited — 120 requests per minute per IP'),
    },
  },
};

module.exports = spec;
