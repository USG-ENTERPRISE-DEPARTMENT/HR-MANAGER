const { prisma }               = require('../helpers/dbQueryHelper');
const asyncHandler             = require('../middleware/asyncHandler');
const respond                  = require('../helpers/respondHelper');
const { tmsg }                 = require('../helpers/messageStore');
const { logActivity, fromReq } = require('./auditController');
const { notifyUsersWithPermission } = require('../helpers/notificationHelper');
const crypto                   = require('crypto');
const { sendSchedulingInvite, sendInterviewConfirmation, buildIcs, sendCandidateStageEmail } = require('../helpers/emailHelper');

// ── Helpers ───────────────────────────────────────────────────────────────────

const { toBigInt, s } = require('../helpers/controllerHelpers');

// job_status enum: Prisma client value is 'On_hold' (DB stores "On hold"); the UI uses 'On Hold'.
// Normalise between the two so the client can keep using the spaced label everywhere.
function jobStatusToDb(v) {
  if (!v) return null;
  const k = String(v).toLowerCase().replace(/[\s_]+/g, ' ').trim();
  if (k === 'on hold') return 'On_hold';
  if (k === 'active')  return 'Active';
  if (k === 'closed')  return 'Closed';
  return null;
}
function jobStatusToUi(v) {
  return v === 'On_hold' ? 'On Hold' : (v ?? null);
}

// Resolve a stored value (name or email) to an actual email address
async function resolveEmail(nameOrEmail) {
  if (!nameOrEmail) return null;
  if (nameOrEmail.includes('@')) return nameOrEmail;
  try {
    // Full-name match needs CONCAT (no builder equivalent); parameterised tagged template keeps it
    // injection-safe and works on both MySQL and Postgres.
    const rows = await prisma.$queryRaw`
      SELECT work_email, email FROM employee
      WHERE CONCAT(firstName, ' ', lastName) = ${nameOrEmail} LIMIT 1`;
    const row = rows[0];
    return row?.work_email || row?.email || null;
  } catch { return null; }
}

// Build the recipient list for an interview, resolving names to emails
async function buildInterviewRecipients(interview, candidate, job) {
  const recipients = [];
  if (candidate?.email) {
    recipients.push({ to: candidate.email, name: `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim() });
  }
  if (job?.hiringManager) {
    const email = await resolveEmail(job.hiringManager);
    if (email) recipients.push({ to: email, name: job.hiringManager });
  }
  if (interview.interviewers) {
    for (const entry of interview.interviewers.split(',').map(x => x.trim()).filter(Boolean)) {
      const email = await resolveEmail(entry);
      if (email) recipients.push({ to: email, name: entry });
    }
  }
  return recipients;
}

// ── Seed default hiring pipeline stages if table is empty ────────────────────

(async () => {
  await prisma.hiringpipeline.deleteMany({ where: { type: 'Offer' } }).catch(() => {});

  const pipelineCount = await prisma.hiringpipeline.count().catch(() => 0);
  if (pipelineCount === 0) {
    await prisma.hiringpipeline.createMany({
      data: [
        { name: 'Short Listed', type: 'Short_Listed' },
        { name: 'Phone Screen', type: 'Phone_Screen' },
        { name: 'Assessment',   type: 'Assessment' },
        { name: 'Interview',    type: 'Interview' },
        { name: 'Hired',        type: 'Hired' },
        { name: 'Rejected',     type: 'Rejected' },
        { name: 'Archived',     type: 'Archived' },
      ],
    }).catch(() => {});
  }
})();

// ── Jobs ─────────────────────────────────────────────────────────────────────

// GET /recruitment/jobs — list all job postings, optionally filtered by ?status=.
const getJobs = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const where = {};
  if (status) where.status = jobStatusToDb(status) ?? undefined;

  const jobs = await prisma.job.findMany({
    where,
    orderBy: { id: 'desc' },
  });
  return respond.ok(res, 'Jobs', s(jobs).map(j => ({ ...j, status: jobStatusToUi(j.status) })));
});

// POST /recruitment/jobs — create a job posting; auto-fills companyName from payslip_settings so the
// public portal always shows the current company name without manual entry.
const createJob = asyncHandler(async (req, res) => {
  const {
    title, positionReason, shortDescription, description, requirements, benefits,
    department, employementType, hiringManager, salaryMin, salaryMax, showSalary,
    keywords, status, closingDate, display,
    code, showHiringManager, country, location, postalCode,
    experienceLevel, jobFunction, educationLevel, currency, attachment,
  } = req.body;

  // Auto-fill companyName from payslip_settings
  const psRow = await prisma.payslip_settings
    .findFirst({ select: { company_name: true } })
    .catch(() => null);
  const resolvedCompanyName = psRow?.company_name ?? null;

  const job = await prisma.job.create({
    data: {
      title:              title || '',
      positionReason:     positionReason || null,
      shortDescription:   shortDescription || null,
      description:        description || null,
      requirements:       requirements || null,
      benefits:           benefits || null,
      department:         department || null,
      employementType:    employementType || null,
      hiringManager:      hiringManager || null,
      salaryMin:          toBigInt(salaryMin),
      salaryMax:          toBigInt(salaryMax),
      showSalary:         showSalary || null,
      keywords:           keywords || null,
      status:             jobStatusToDb(status) || 'Active',
      closingDate:        closingDate ? new Date(closingDate) : null,
      display:            display || title || '',
      postedBy:           toBigInt(req.user?.id),
      code:               code || null,
      companyName:        resolvedCompanyName,
      showHiringManager:  showHiringManager || null,
      country:            country || null,
      location:           location || null,
      postalCode:         postalCode || null,
      experienceLevel:    experienceLevel || null,
      jobFunction:        jobFunction || null,
      educationLevel:     educationLevel || null,
      currency:           currency || null,
      attachment:         attachment || null,
    },
  });

  logActivity({ module: 'Recruitment', action: 'create_job', entityId: String(job.id), entityName: job.title, ...fromReq(req) });
  return respond.created(res, 'Job created', s(job));
});

// PUT /recruitment/jobs/:id — update a job posting; keeps companyName in sync with payslip_settings.
const updateJob = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const {
    title, positionReason, shortDescription, description, requirements, benefits,
    department, employementType, hiringManager, salaryMin, salaryMax, showSalary,
    keywords, status, closingDate, display,
    code, showHiringManager, country, location, postalCode,
    experienceLevel, jobFunction, educationLevel, currency, attachment,
  } = req.body;

  // Keep companyName in sync with payslip_settings
  const psRow = await prisma.payslip_settings
    .findFirst({ select: { company_name: true } })
    .catch(() => null);
  const resolvedCompanyName = psRow?.company_name ?? null;

  const job = await prisma.job.update({
    where: { id },
    data: {
      title:              title,
      positionReason:     positionReason || null,
      shortDescription:   shortDescription || null,
      description:        description || null,
      requirements:       requirements || null,
      benefits:           benefits || null,
      department:         department || null,
      employementType:    employementType || null,
      hiringManager:      hiringManager || null,
      salaryMin:          toBigInt(salaryMin),
      salaryMax:          toBigInt(salaryMax),
      showSalary:         showSalary || null,
      keywords:           keywords || null,
      status:             jobStatusToDb(status),
      closingDate:        closingDate ? new Date(closingDate) : null,
      display:            display || title || '',
      code:               code || null,
      companyName:        resolvedCompanyName,
      showHiringManager:  showHiringManager || null,
      country:            country || null,
      location:           location || null,
      postalCode:         postalCode || null,
      experienceLevel:    experienceLevel || null,
      jobFunction:        jobFunction || null,
      educationLevel:     educationLevel || null,
      currency:           currency || null,
      attachment:         attachment !== undefined ? (attachment || null) : undefined,
    },
  });

  logActivity({ module: 'Recruitment', action: 'update_job', entityId: String(id), entityName: job.title, ...fromReq(req) });
  return respond.ok(res, 'Job updated', s(job));
});

// DELETE /recruitment/jobs/:id — permanently remove a job posting.
const deleteJob = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  await prisma.job.delete({ where: { id } });
  logActivity({ module: 'Recruitment', action: 'delete_job', entityId: String(id), ...fromReq(req) });
  return respond.ok(res, 'Job deleted');
});

// ── Candidates ────────────────────────────────────────────────────────────────

// GET /recruitment/candidates — list candidates filterable by job, stage, or source.
const getCandidates = asyncHandler(async (req, res) => {
  const { job, stage, source } = req.query;
  const where = {};
  if (job)    where.jobId       = toBigInt(job);
  if (stage)  where.hiringStage = toBigInt(stage);
  if (source) where.source      = source;

  const candidates = await prisma.candidates.findMany({
    where,
    orderBy: { id: 'desc' },
  });

  return respond.ok(res, 'Candidates', s(candidates));
});

// GET /recruitment/candidates/:id — retrieve a single candidate with their applications, interviews, and full pipeline.
const getCandidateById = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const candidate = await prisma.candidates.findUnique({ where: { id } });
  if (!candidate) return respond.notFound(res, 'Candidate not found');

  const [applications, interviews, pipeline] = await Promise.all([
    prisma.applications.findMany({ where: { candidate: id }, orderBy: { id: 'desc' } }),
    prisma.interviews.findMany({ where: { candidate: id }, orderBy: { id: 'desc' } }),
    prisma.hiringpipeline.findMany({ orderBy: { id: 'asc' } }),
  ]);

  return respond.ok(res, 'Candidate', s({ ...candidate, applications, interviews, pipeline }));
});

// POST /recruitment/candidates — create a candidate profile; automatically creates an application record
// when a jobId is provided.
const createCandidate = asyncHandler(async (req, res) => {
  const {
    first_name, last_name, middle_name, email, mobile_phone, gender,
    marital_status, birthday, address1, address2, city, country,
    cv_title, totalYearsOfExperience, totalMonthsOfExperience,
    expectedSalary, source, jobId, notes, cv_file,
  } = req.body;

  const candidate = await prisma.candidates.create({
    data: {
      first_name:              first_name || '',
      last_name:               last_name  || '',
      middle_name:             middle_name || null,
      email:                   email || null,
      mobile_phone:            mobile_phone || null,
      gender:                  gender || null,
      marital_status:          marital_status || null,
      birthday:                birthday ? new Date(birthday) : null,
      address1:                address1 || null,
      address2:                address2 || null,
      city:                    city || null,
      country:                 country || null,
      cv_title:                cv_title || '',
      totalYearsOfExperience:  totalYearsOfExperience ? parseInt(totalYearsOfExperience) : null,
      totalMonthsOfExperience: totalMonthsOfExperience ? parseInt(totalMonthsOfExperience) : null,
      expectedSalary:          expectedSalary ? parseInt(expectedSalary) : null,
      source:                  source || 'Sourced',
      jobId:                   toBigInt(jobId),
      notes:                   notes || null,
      cv_file:                 cv_file || null,
      created:                 new Date(),
      updated:                 new Date(),
    },
  });

  // Auto-create an application record when a job is assigned
  if (candidate.jobId) {
    await prisma.applications.create({
      data: { job: candidate.jobId, candidate: candidate.id, created: new Date() },
    }).catch(() => {});
  }

  logActivity({ module: 'Recruitment', action: 'create_candidate', entityId: String(candidate.id), entityName: `${candidate.first_name} ${candidate.last_name}`, ...fromReq(req) });
  return respond.created(res, 'Candidate created', s(candidate));
});

// PUT /recruitment/candidates/:id — update candidate profile fields and optionally replace cv_file.
const updateCandidate = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const {
    first_name, last_name, middle_name, email, mobile_phone, gender,
    marital_status, birthday, address1, address2, city, country,
    cv_title, totalYearsOfExperience, totalMonthsOfExperience,
    expectedSalary, source, jobId, notes, cv_file,
  } = req.body;

  const candidate = await prisma.candidates.update({
    where: { id },
    data: {
      first_name:              first_name,
      last_name:               last_name,
      middle_name:             middle_name || null,
      email:                   email || null,
      mobile_phone:            mobile_phone || null,
      gender:                  gender || null,
      marital_status:          marital_status || null,
      birthday:                birthday ? new Date(birthday) : null,
      address1:                address1 || null,
      address2:                address2 || null,
      city:                    city || null,
      country:                 country || null,
      cv_title:                cv_title || '',
      totalYearsOfExperience:  totalYearsOfExperience ? parseInt(totalYearsOfExperience) : null,
      totalMonthsOfExperience: totalMonthsOfExperience ? parseInt(totalMonthsOfExperience) : null,
      expectedSalary:          expectedSalary ? parseInt(expectedSalary) : null,
      source:                  source || null,
      jobId:                   toBigInt(jobId),
      notes:                   notes || null,
      cv_file:                 cv_file !== undefined ? (cv_file || null) : undefined,
      updated:                 new Date(),
    },
  });

  logActivity({ module: 'Recruitment', action: 'update_candidate', entityId: String(id), entityName: `${candidate.first_name} ${candidate.last_name}`, ...fromReq(req) });
  return respond.ok(res, 'Candidate updated', s(candidate));
});

// DELETE /recruitment/candidates/:id — remove a candidate and cascade-delete their application records.
const deleteCandidate = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  await prisma.applications.deleteMany({ where: { candidate: id } });
  await prisma.candidates.delete({ where: { id } });
  logActivity({ module: 'Recruitment', action: 'delete_candidate', entityId: String(id), ...fromReq(req) });
  return respond.ok(res, 'Candidate deleted');
});

// PUT /recruitment/candidates/:id/stage — move a candidate to a new hiring pipeline stage and email them
// the stage transition notification. If the email send fails, the stage is reverted to prevent silent failures.
const moveCandidateStage = asyncHandler(async (req, res) => {
  const id      = toBigInt(req.params.id);
  const stageId = toBigInt(req.body.stageId);

  // Capture current stage so we can revert if the email fails
  const before = await prisma.candidates.findUnique({ where: { id }, select: { hiringStage: true } });
  const previousStageId = before?.hiringStage ?? null;

  const candidate = await prisma.candidates.update({
    where: { id },
    data:  { hiringStage: stageId, updated: new Date() },
  });

  // Send notification email — if it fails, revert the stage change
  if (candidate.email) {
    try {
      const [stage, job] = await Promise.all([
        prisma.hiringpipeline.findUnique({ where: { id: stageId } }).catch(() => null),
        candidate.jobId ? prisma.job.findUnique({ where: { id: candidate.jobId } }).catch(() => null) : Promise.resolve(null),
      ]);
      if (stage) {
        await sendCandidateStageEmail({
          to:            candidate.email,
          candidateName: `${candidate.first_name} ${candidate.last_name}`,
          stageName:     stage.name || stage.type,
          jobTitle:      job?.title || null,
        });
      }
    } catch {
      // Revert the stage to what it was before
      if (previousStageId !== null) {
        await prisma.candidates.update({
          where: { id },
          data:  { hiringStage: previousStageId, updated: new Date() },
        }).catch(() => {});
      }
      return res.status(502).json({
        status: '502',
        message: 'Stage reverted — the notification email failed to send. Check your email settings and try again.',
      });
    }
  }

  logActivity({ module: 'Recruitment', action: 'move_candidate_stage', entityId: String(id), details: { stageId: String(stageId) }, ...fromReq(req) });
  return respond.ok(res, 'Stage updated', s(candidate));
});

// ── Applications ──────────────────────────────────────────────────────────────

// GET /recruitment/applications — list applications, optionally filtered by ?job=.
const getApplications = asyncHandler(async (req, res) => {
  const { job } = req.query;
  const where = {};
  if (job) where.job = toBigInt(job);

  const applications = await prisma.applications.findMany({
    where,
    orderBy: { id: 'desc' },
  });
  return respond.ok(res, 'Applications', s(applications));
});

// POST /recruitment/applications — create an application linking a candidate to a job.
const createApplication = asyncHandler(async (req, res) => {
  const { job, candidate, notes, referredByEmail } = req.body;

  const application = await prisma.applications.create({
    data: {
      job:            toBigInt(job),
      candidate:      toBigInt(candidate),
      notes:          notes || null,
      referredByEmail: referredByEmail || null,
      created:        new Date(),
    },
  });

  logActivity({ module: 'Recruitment', action: 'create_application', entityId: String(application.id), ...fromReq(req) });
  return respond.created(res, 'Application created', s(application));
});

// DELETE /recruitment/applications/:id — remove a single application record.
const deleteApplication = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  await prisma.applications.delete({ where: { id } });
  logActivity({ module: 'Recruitment', action: 'delete_application', entityId: String(id), ...fromReq(req) });
  return respond.ok(res, 'Application deleted');
});

// ── Interviews ────────────────────────────────────────────────────────────────

// GET /recruitment/interviews — list interviews, optionally filtered by ?candidate= and/or ?job=.
const getInterviews = asyncHandler(async (req, res) => {
  const { candidate, job } = req.query;

  const where = {};
  if (candidate) where.candidate = toBigInt(candidate);
  if (job)       where.job       = toBigInt(job);

  const interviews = await prisma.interviews.findMany({ where, orderBy: { id: 'desc' } });
  return respond.ok(res, 'Interviews', s(interviews));
});

// POST /recruitment/interviews — schedule a new interview; stores available slots as JSON in schedule_options
// for the self-scheduling flow.
const createInterview = asyncHandler(async (req, res) => {
  const { job, candidate, level, scheduled, scheduled_end, location, notes, interviewers, status, schedule_options } = req.body;

  const interview = await prisma.interviews.create({
    data: {
      job:              toBigInt(job),
      candidate:        toBigInt(candidate),
      level:            level || null,
      scheduled:        scheduled ? new Date(scheduled) : null,
      location:         location || null,
      notes:            notes || null,
      interviewers:     interviewers || null,
      status:           status || 'Scheduled',
      schedule_options: schedule_options || null,
      scheduled_end:    scheduled_end ? new Date(scheduled_end) : null,
      created:          new Date(),
      updated:          new Date(),
    },
  });

  logActivity({ module: 'Recruitment', action: 'create_interview', entityId: String(interview.id), ...fromReq(req) });
  return respond.created(res, 'Interview created', s(interview));
});

// PUT /recruitment/interviews/:id — patch interview fields including outcome and interviewer feedback.
const updateInterview = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const { job, candidate, level, scheduled, scheduled_end, location, notes, interviewers, status, outcome, feedback, schedule_options } = req.body;

  const data = { updated: new Date() };
  if (job              !== undefined) data.job              = toBigInt(job);
  if (candidate        !== undefined) data.candidate        = toBigInt(candidate);
  if (level            !== undefined) data.level            = level || null;
  if (scheduled        !== undefined) data.scheduled        = scheduled ? new Date(scheduled) : null;
  if (location         !== undefined) data.location         = location || null;
  if (notes            !== undefined) data.notes            = notes || null;
  if (interviewers     !== undefined) data.interviewers     = interviewers || null;
  if (status           !== undefined) data.status           = status || null;
  if (outcome          !== undefined) data.outcome          = outcome || null;
  if (feedback         !== undefined) data.feedback         = feedback || null;
  if (schedule_options !== undefined) data.schedule_options = schedule_options || null;
  if (scheduled_end    !== undefined) data.scheduled_end    = scheduled_end ? new Date(scheduled_end) : null;

  const interview = await prisma.interviews.update({ where: { id }, data });

  logActivity({ module: 'Recruitment', action: 'update_interview', entityId: String(id), ...fromReq(req) });
  return respond.ok(res, 'Interview updated', s(interview));
});

// DELETE /recruitment/interviews/:id — permanently remove an interview record.
const deleteInterview = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  await prisma.interviews.delete({ where: { id } });
  logActivity({ module: 'Recruitment', action: 'delete_interview', entityId: String(id), ...fromReq(req) });
  return respond.ok(res, 'Interview deleted');
});

// ── Pipeline stages ───────────────────────────────────────────────────────────

// GET /recruitment/pipeline — list all hiring pipeline stages in their display order.
const getPipeline = asyncHandler(async (req, res) => {
  const stages = await prisma.hiringpipeline.findMany({ orderBy: { id: 'asc' } });
  return respond.ok(res, 'Pipeline', s(stages));
});

// ── Hire conversion ───────────────────────────────────────────────────────────

// POST /recruitment/candidates/:id/hire — convert a candidate into a new employee record; checks for email
// conflicts to prevent duplicate employee creation, marks candidate as 'Hired' in the pipeline, and
// links the new employee back to the candidate via hired_employee_id.
const hireCandidate = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  const candidate = await prisma.candidates.findUnique({ where: { id } });
  if (!candidate) return respond.notFound(res, 'Candidate not found');

  // Check unique constraint violations before creating the employee record
  if (candidate.email) {
    const conflict = await prisma.employee.findFirst({
      where: { OR: [{ email: candidate.email }, { work_email: candidate.email }, { personal_email: candidate.email }] },
    });
    if (conflict) {
      return respond.conflict(res, tmsg('recruitment.employee_email_exists', { email: candidate.email }));
    }
  }

  // Split full name parts
  const firstName  = candidate.first_name  || '';
  const lastName   = candidate.last_name   || '';
  const middleName = candidate.middle_name || null;

  const today = new Date();

  const employee = await prisma.employee.create({
    data: {
      firstName,
      lastName,
      middleName,
      email:            candidate.email || null,
      work_email:       candidate.email || null,
      mobilePhone:      candidate.mobile_phone || null,
      address1:         candidate.address1 || null,
      city:             candidate.city || null,
      country:          candidate.country || null,
      hireDate:         today,
      confirmationDate: today,
      approvalStatus:   'PENDING',
      lifecycleStatus:  'PENDING',
      posted_by:        toBigInt(req.user?.id),
    },
  });

  // Mark candidate as hired — find the "Hired" stage
  const hiredStage = await prisma.hiringpipeline.findFirst({
    where: { type: 'Hired' },
  });
  if (hiredStage) {
    await prisma.candidates.update({
      where: { id },
      data:  { hiringStage: hiredStage.id, updated: new Date() },
    });
  }

  // Record which employee record this candidate was converted to
  await prisma.candidates
    .updateMany({ where: { id }, data: { hired_employee_id: employee.id } })
    .catch(() => {});

  logActivity({ module: 'Recruitment', action: 'hire_candidate', entityId: String(employee.id), entityName: `${employee.firstName} ${employee.lastName}`, details: { candidateId: id.toString() }, ...fromReq(req) });
  await notifyUsersWithPermission('approve_employees', {
    message: `New hire ${employee.firstName} ${employee.lastName} awaits employee approval`,
    action: 'Employees', type: 'employees', fromUser: req.user?.id, employee: employee.id,
  }, req.user?.id);
  return respond.created(res, 'Employee record created', s({ employee }));
});

// ── Public (no-auth) endpoints ────────────────────────────────────────────────

// GET /public/recruitment/settings — return branding info (company name, logo, address, accent colour)
// for the public career portal, sourced from payslip_settings.
const getPublicSettings = asyncHandler(async (req, res) => {
  const row = await prisma.payslip_settings.findFirst({
    select: { company_name: true, company_logo_url: true, company_address: true, accent_color: true },
  });
  return respond.ok(res, 'Settings', s(row ?? {}));
});

// GET /public/recruitment/jobs — list Active job postings for the public career portal, with optional
// search/department/type filters applied in-memory.
const getPublicJobs = asyncHandler(async (req, res) => {
  const { search, department, type } = req.query;

  const jobs = await prisma.job.findMany({
    where: { status: 'Active' },
    orderBy: { id: 'desc' },
  });

  let result = jobs;
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(j =>
      j.title?.toLowerCase().includes(q) ||
      j.department?.toLowerCase().includes(q) ||
      j.keywords?.toLowerCase().includes(q)
    );
  }
  if (department) result = result.filter(j => j.department === department);
  if (type)       result = result.filter(j => j.employementType === type);

  return respond.ok(res, 'Jobs', s(result));
});

// GET /public/recruitment/jobs/:code — retrieve a single Active job by its code slug; falls back to numeric ID
// so existing numeric-URL links continue to work after a code is assigned.
const getPublicJobByCode = asyncHandler(async (req, res) => {
  const { code } = req.params;

  // Try code first, then numeric id as fallback
  let job = await prisma.job.findFirst({ where: { code, status: 'Active' } });
  if (!job) {
    const numId = toBigInt(code);
    if (numId) job = await prisma.job.findFirst({ where: { id: numId, status: 'Active' } });
  }
  if (!job) return respond.notFound(res, 'Job not found');
  return respond.ok(res, 'Job', s(job));
});

// POST /public/recruitment/jobs/:code/apply — public job application endpoint (no auth required);
// creates the candidate and application records. Blocks duplicate applications by the same email or phone for the same job.
const applyForJob = asyncHandler(async (req, res) => {
  const { code } = req.params;

  let job = await prisma.job.findFirst({ where: { code, status: 'Active' } });
  if (!job) {
    const numId = toBigInt(code);
    if (numId) job = await prisma.job.findFirst({ where: { id: numId, status: 'Active' } });
  }
  if (!job) return respond.notFound(res, 'Job not found');

  const { first_name, last_name, email, mobile_phone, cv_title, coverLetter } = req.body;
  if (!first_name || !last_name || !email) {
    return respond.badReq(res, 'First name, last name and email are required');
  }

  // Prevent duplicate applications: same (email OR phone) + same job
  const orConditions = [{ email, jobId: job.id }];
  if (mobile_phone) orConditions.push({ mobile_phone, jobId: job.id });
  const existing = await prisma.candidates.findFirst({ where: { OR: orConditions } });
  if (existing) {
    return respond.badReq(res, 'You have already applied for this position.');
  }

  const candidate = await prisma.candidates.create({
    data: {
      first_name,
      last_name,
      email:        email || null,
      mobile_phone: mobile_phone || null,
      cv_title:     cv_title || job.title,
      source:       'Applied',
      jobId:        job.id,
      notes:        coverLetter || null,
      cv_file:      req.file?.filename || null,
      created:      new Date(),
      updated:      new Date(),
    },
  });

  await prisma.applications.create({
    data: {
      job:       job.id,
      candidate: candidate.id,
      created:   new Date(),
    },
  });

  return respond.created(res, 'Application submitted successfully', s({ candidateId: candidate.id }));
});

// ── Self-scheduling ───────────────────────────────────────────────────────────

// POST /recruitment/interviews/:id/schedule-link — generate a time-limited (7-day) tokenised scheduling link
// and email it to the candidate so they can self-select an available interview slot.
const sendScheduleLink = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);

  const interview = await prisma.interviews.findUnique({ where: { id } });
  if (!interview) return respond.notFound(res, 'Interview not found');
  if (!interview.schedule_options) return respond.badReq(res, 'No scheduling slots defined for this interview');

  const candidate = interview.candidate
    ? await prisma.candidates.findUnique({ where: { id: interview.candidate } })
    : null;
  if (!candidate?.email) return respond.badReq(res, 'Candidate has no email address');

  const job = interview.job
    ? await prisma.job.findUnique({ where: { id: interview.job } })
    : null;

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.interviews.update({
    where: { id },
    data: { schedule_token: token, schedule_expires: expires },
  });

  // Public portals (interview scheduling) live at the ROOT path, not under the app's /xhrm base,
  // so candidates get a clean link that works without authentication. Strip any sub-path from
  // FRONTEND_URL down to the origin.
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3099';
  let origin = frontendUrl;
  try { origin = new URL(frontendUrl).origin; } catch { /* keep as-is if not a full URL */ }
  const link     = `${origin}/schedule/${token}`;
  const rawSlots = JSON.parse(interview.schedule_options || '[]');
  // Normalize to start strings for the email list
  const slots = rawSlots.map(s => (typeof s === 'string' ? s : s.start)).filter(Boolean);

  await sendSchedulingInvite({
    to: candidate.email,
    candidateName: `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim(),
    jobTitle: job?.title ?? 'Position',
    slots,
    link,
    expiresAt: expires,
  });

  await prisma.interviews
    .updateMany({ where: { id }, data: { schedule_link_sent_at: new Date() } })
    .catch(() => {});

  return respond.ok(res, 'Scheduling link sent');
});

// GET /public/schedule/:token — public endpoint (no auth) that returns interview slot options for the
// candidate self-scheduling page; validates token and expiry before returning.
const getSchedulePage = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const interview = await prisma.interviews.findFirst({ where: { schedule_token: token } });
  if (!interview) return res.status(404).json({ status: '404', message: 'Link not found or invalid' });

  if (interview.schedule_expires && new Date(interview.schedule_expires) < new Date()) {
    return res.status(410).json({ status: '410', message: 'This scheduling link has expired' });
  }

  const candidate = interview.candidate
    ? await prisma.candidates.findUnique({ where: { id: interview.candidate } })
    : null;
  const job = interview.job
    ? await prisma.job.findUnique({ where: { id: interview.job } })
    : null;

  const slots = JSON.parse(interview.schedule_options || '[]');

  return respond.ok(res, 'Schedule page', s({
    interview: { level: interview.level, location: interview.location },
    job:       { title: job?.title ?? null },
    candidate: { first_name: candidate?.first_name ?? null },
    slots,
    alreadyBooked: !!interview.scheduled,
  }));
});

// POST /public/schedule/:token — candidate confirms their chosen slot; books the interview, builds an ICS
// calendar attachment, and sends confirmation emails to the candidate, hiring manager, and all interviewers.
const confirmSchedule = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { slot }  = req.body;

  if (!slot) return respond.badReq(res, 'No slot provided');

  const interview = await prisma.interviews.findFirst({ where: { schedule_token: token } });
  if (!interview) return res.status(404).json({ status: '404', message: 'Link not found or invalid' });

  if (interview.schedule_expires && new Date(interview.schedule_expires) < new Date()) {
    return res.status(410).json({ status: '410', message: 'This scheduling link has expired' });
  }

  if (interview.scheduled) return respond.badReq(res, 'Interview already confirmed');

  const slots = JSON.parse(interview.schedule_options || '[]');
  // Normalize to handle both old string format and new { start, end } object format
  const slotStarts = slots.map(s => (typeof s === 'string' ? s : s.start)).filter(Boolean);
  if (!slotStarts.includes(slot)) return respond.badReq(res, 'Invalid slot selected');

  const matchedSlot = slots.find(s => (typeof s === 'string' ? s : s.start) === slot);
  const slotEndTime = matchedSlot && typeof matchedSlot === 'object' && matchedSlot.end
    ? new Date(matchedSlot.end)
    : null;

  await prisma.interviews.update({
    where: { id: interview.id },
    data: {
      scheduled:       new Date(slot),
      status:          'Scheduled',
      scheduleUpdated: 1,
      updated:         new Date(),
      ...(slotEndTime ? { scheduled_end: slotEndTime } : {}),
    },
  });

  const candidate = interview.candidate
    ? await prisma.candidates.findUnique({ where: { id: interview.candidate } })
    : null;
  const job = interview.job
    ? await prisma.job.findUnique({ where: { id: interview.job } })
    : null;

  const slotDate = new Date(slot);
  const slotEnd  = slotEndTime ?? (interview.scheduled_end ? new Date(interview.scheduled_end) : new Date(slotDate.getTime() + 60 * 60 * 1000));

  const hmEmail = job?.hiringManager ? await resolveEmail(job.hiringManager) : null;
  const icsContent = buildIcs({
    uid:            `interview-${s(interview.id)}-${Date.now()}`,
    summary:        `Interview: ${job?.title ?? 'Position'}${interview.level ? ` - ${interview.level}` : ''}`,
    dtstart:        slotDate,
    dtend:          slotEnd,
    location:       interview.location ?? '',
    organizerEmail: hmEmail,
    attendeeEmail:  candidate?.email ?? null,
  });

  const recipients = await buildInterviewRecipients(interview, candidate, job);

  await Promise.allSettled(
    recipients.map(({ to, name }) =>
      sendInterviewConfirmation({
        to,
        name,
        jobTitle:     job?.title ?? 'Position',
        level:        interview.level ?? '',
        datetime:     slotDate.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        location:     interview.location ?? '',
        interviewers: interview.interviewers ?? '',
        icsContent,
      })
    )
  );

  return respond.ok(res, 'Interview confirmed');
});

// POST /recruitment/interviews/:id/invite — manually send an ICS calendar invite to the candidate,
// hiring manager, and all interviewers for an already-scheduled interview.
const sendInterviewInvite = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);

  const row = await prisma.interviews.findUnique({ where: { id } });
  if (!row) return respond.notFound(res, 'Interview not found');
  if (!row.scheduled) return respond.badReq(res, 'No interview date set. Set a date on the interview before sending an invite.');

  const candidate = row.candidate
    ? await prisma.candidates.findUnique({ where: { id: row.candidate } })
    : null;
  const job = row.job
    ? await prisma.job.findUnique({ where: { id: row.job } })
    : null;

  const slotDate = new Date(row.scheduled);
  const slotEnd  = row.scheduled_end
    ? new Date(row.scheduled_end)
    : new Date(slotDate.getTime() + 60 * 60 * 1000);

  const hmEmail = job?.hiringManager ? await resolveEmail(job.hiringManager) : null;
  const icsContent = buildIcs({
    uid:            `interview-${s(row.id)}-${Date.now()}`,
    summary:        `Interview: ${job?.title ?? 'Position'}${row.level ? ` - ${row.level}` : ''}`,
    dtstart:        slotDate,
    dtend:          slotEnd,
    location:       row.location ?? '',
    organizerEmail: hmEmail,
    attendeeEmail:  candidate?.email ?? null,
  });

  const recipients = await buildInterviewRecipients(row, candidate, job);

  if (recipients.length === 0) {
    return respond.badReq(res, 'No recipients found. Add an email to the candidate or interviewers.');
  }

  await Promise.allSettled(
    recipients.map(({ to, name }) =>
      sendInterviewConfirmation({
        to, name,
        jobTitle:     job?.title ?? 'Position',
        level:        row.level ?? '',
        datetime:     slotDate.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        location:     row.location ?? '',
        interviewers: row.interviewers ?? '',
        icsContent,
      })
    )
  );

  await prisma.interviews
    .updateMany({ where: { id }, data: { invite_sent_at: new Date() } })
    .catch(() => {});

  logActivity({ module: 'Recruitment', action: 'send_interview_invite', entityId: String(id), ...fromReq(req) });
  return respond.ok(res, 'Interview invite sent');
});

module.exports = {
  getJobs, createJob, updateJob, deleteJob,
  getCandidates, getCandidateById, createCandidate, updateCandidate, deleteCandidate, moveCandidateStage,
  getApplications, createApplication, deleteApplication,
  getInterviews, createInterview, updateInterview, deleteInterview,
  getPipeline,
  hireCandidate,
  getPublicSettings, getPublicJobs, getPublicJobByCode, applyForJob,
  sendScheduleLink, getSchedulePage, confirmSchedule, sendInterviewInvite,
};
