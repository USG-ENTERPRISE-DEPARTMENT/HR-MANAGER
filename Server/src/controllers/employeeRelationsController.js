const { prisma } = require('../helpers/dbQueryHelper');
const asyncHandler = require('../middleware/asyncHandler');
const respond = require('../helpers/respondHelper');
const { toBigInt, s } = require('../helpers/controllerHelpers');

// CodeListValue ids are integers; coerce (blank/invalid -> null).
const clvInt = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

async function clvMap(ids) {
  const unique = [...new Set(ids.map(clvInt).filter(v => v != null))];
  if (!unique.length) return {};
  const vals = await prisma.codeListValue.findMany({
    where: { id: { in: unique } }, select: { id: true, label: true },
  });
  return Object.fromEntries(vals.map(v => [v.id, v.label]));
}

async function empMap(bigIntIds) {
  const unique = [...new Set(bigIntIds.filter(Boolean))];
  if (!unique.length) return {};
  const emps = await prisma.employee.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, employee_id: true },
  });
  return Object.fromEntries(emps.map(e => [e.id.toString(), {
    id: e.id.toString(),
    name: `${e.firstName} ${e.lastName}`.trim(),
    employee_id: e.employee_id,
  }]));
}

// ─── SKILLS ───────────────────────────────────────────────────────────────────

// GET /employee-relations/skills — list every skill record across all employees,
// resolved with human-readable skill labels (from code list) and full employee names.
const getAllSkills = asyncHandler(async (req, res) => {
  const rows = await prisma.employeeskills.findMany({ orderBy: { id: 'desc' } });
  const [cm, em] = await Promise.all([
    clvMap(rows.map(r => r.skill_id)),
    empMap(rows.map(r => r.employee)),
  ]);
  respond.ok(res, 'Skills retrieved', rows.map(r => ({
    ...s(r),
    skill:    r.skill_id ? { id: r.skill_id, label: cm[r.skill_id] ?? null } : null,
    employee: em[r.employee.toString()] ?? null,
  })));
});

// POST /employee-relations/skills — attach a skill (from code list) to an employee with optional details.
const addSkill = asyncHandler(async (req, res) => {
  const { employee_id, skill_id, details } = req.body;
  const empId = toBigInt(employee_id);
  if (!empId)    return respond.badReq(res, 'Employee is required');
  if (!skill_id) return respond.badReq(res, 'Skill is required');
  const row = await prisma.employeeskills.create({
    data: { employee: empId, skill_id: clvInt(skill_id), details: details?.trim() || null },
  });
  respond.created(res, 'Skill added', s(row));
});

// PUT /employee-relations/skills/:id — update the skill type or details on an existing skill record.
const updateSkill = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { skill_id, details } = req.body;
  const row = await prisma.employeeskills.update({
    where: { id },
    data: { skill_id: clvInt(skill_id), details: details?.trim() || null },
  });
  respond.ok(res, 'Skill updated', s(row));
});

// DELETE /employee-relations/skills/:id — permanently remove an employee skill record.
const deleteSkill = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.employeeskills.delete({ where: { id } });
  respond.ok(res, 'Skill removed');
});

// ─── CERTIFICATIONS ───────────────────────────────────────────────────────────

// GET /employee-relations/certifications — list all employee certification records with labels and employee names.
const getAllCerts = asyncHandler(async (req, res) => {
  const rows = await prisma.employeecertifications.findMany({ orderBy: { id: 'desc' } });
  const [cm, em] = await Promise.all([
    clvMap(rows.map(r => r.certification_id)),
    empMap(rows.map(r => r.employee)),
  ]);
  respond.ok(res, 'Certifications retrieved', rows.map(r => ({
    ...s(r),
    certification: r.certification_id ? { id: r.certification_id, label: cm[r.certification_id] ?? null } : null,
    employee: em[r.employee.toString()] ?? null,
  })));
});

// POST /employee-relations/certifications — add a professional certification to an employee's profile.
const addCert = asyncHandler(async (req, res) => {
  const { employee_id, certification_id, institute, date_start, date_end } = req.body;
  const empId = toBigInt(employee_id);
  if (!empId)             return respond.badReq(res, 'Employee is required');
  if (!certification_id) return respond.badReq(res, 'Certification is required');
  const row = await prisma.employeecertifications.create({
    data: {
      employee: empId, certification_id: clvInt(certification_id),
      institute:  institute?.trim()  || null,
      date_start: date_start ? new Date(date_start) : null,
      date_end:   date_end   ? new Date(date_end)   : null,
    },
  });
  respond.created(res, 'Certification added', s(row));
});

// PUT /employee-relations/certifications/:id — update certification type, issuing institution, or date range.
const updateCert = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { certification_id, institute, date_start, date_end } = req.body;
  const row = await prisma.employeecertifications.update({
    where: { id },
    data: {
      certification_id: clvInt(certification_id),
      institute: institute?.trim() || null,
      date_start: date_start ? new Date(date_start) : null,
      date_end:   date_end   ? new Date(date_end)   : null,
    },
  });
  respond.ok(res, 'Certification updated', s(row));
});

// DELETE /employee-relations/certifications/:id — permanently remove a certification record.
const deleteCert = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.employeecertifications.delete({ where: { id } });
  respond.ok(res, 'Certification removed');
});

// ─── EDUCATION ────────────────────────────────────────────────────────────────

// GET /employee-relations/education — list all education history records with institution type labels and employee names.
const getAllEducation = asyncHandler(async (req, res) => {
  const rows = await prisma.employeeeducations.findMany({ orderBy: { id: 'desc' } });
  const [cm, em] = await Promise.all([
    clvMap(rows.map(r => r.education_id)),
    empMap(rows.map(r => r.employee)),
  ]);
  respond.ok(res, 'Education retrieved', rows.map(r => ({
    ...s(r),
    institutionType: r.education_id ? { id: r.education_id, label: cm[r.education_id] ?? null } : null,
    employee: em[r.employee.toString()] ?? null,
  })));
});

// POST /employee-relations/education — add an education history entry (school, type, dates) to an employee.
const addEducation = asyncHandler(async (req, res) => {
  const { employee_id, education_id, institute, date_start, date_end } = req.body;
  const empId = toBigInt(employee_id);
  if (!empId) return respond.badReq(res, 'Employee is required');
  const row = await prisma.employeeeducations.create({
    data: {
      employee: empId,
      education_id: clvInt(education_id),
      institute:  institute?.trim()  || null,
      date_start: date_start ? new Date(date_start) : null,
      date_end:   date_end   ? new Date(date_end)   : null,
    },
  });
  respond.created(res, 'Education record added', s(row));
});

// PUT /employee-relations/education/:id — update institution type, school name, or enrolment dates.
const updateEducation = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { education_id, institute, date_start, date_end } = req.body;
  const row = await prisma.employeeeducations.update({
    where: { id },
    data: {
      education_id: clvInt(education_id),
      institute:  institute?.trim()  || null,
      date_start: date_start ? new Date(date_start) : null,
      date_end:   date_end   ? new Date(date_end)   : null,
    },
  });
  respond.ok(res, 'Education record updated', s(row));
});

// DELETE /employee-relations/education/:id — permanently remove an education history record.
const deleteEducation = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.employeeeducations.delete({ where: { id } });
  respond.ok(res, 'Education record removed');
});

// ─── LANGUAGES ────────────────────────────────────────────────────────────────

// GET /employee-relations/languages — list all language proficiency records with language labels and employee names.
const getAllLanguages = asyncHandler(async (req, res) => {
  const rows = await prisma.employeelanguages.findMany({ orderBy: { id: 'desc' } });
  const [cm, em] = await Promise.all([
    clvMap(rows.map(r => r.language_id)),
    empMap(rows.map(r => r.employee)),
  ]);
  respond.ok(res, 'Languages retrieved', rows.map(r => ({
    ...s(r),
    language: r.language_id ? { id: r.language_id, label: cm[r.language_id] ?? null } : null,
    employee: em[r.employee.toString()] ?? null,
  })));
});

// POST /employee-relations/languages — add a language with proficiency ratings (reading/speaking/writing/understanding).
const addLanguage = asyncHandler(async (req, res) => {
  const { employee_id, language_id, reading, speaking, writing, understanding } = req.body;
  const empId = toBigInt(employee_id);
  if (!empId)      return respond.badReq(res, 'Employee is required');
  if (!language_id) return respond.badReq(res, 'Language is required');
  const row = await prisma.employeelanguages.create({
    data: {
      employee: empId, language_id: clvInt(language_id),
      reading:       reading       || null,
      speaking:      speaking      || null,
      writing:       writing       || null,
      understanding: understanding || null,
    },
  });
  respond.created(res, 'Language added', s(row));
});

// PUT /employee-relations/languages/:id — update the language or any proficiency rating on an existing record.
const updateLanguage = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { language_id, reading, speaking, writing, understanding } = req.body;
  const row = await prisma.employeelanguages.update({
    where: { id },
    data: {
      language_id: clvInt(language_id),
      reading:       reading       || null,
      speaking:      speaking      || null,
      writing:       writing       || null,
      understanding: understanding || null,
    },
  });
  respond.ok(res, 'Language updated', s(row));
});

// DELETE /employee-relations/languages/:id — permanently remove a language proficiency record.
const deleteLanguage = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.employeelanguages.delete({ where: { id } });
  respond.ok(res, 'Language removed');
});

// ─── DEPENDENTS ───────────────────────────────────────────────────────────────

// GET /employee-relations/dependents — list all employee dependents with resolved relationship/gender labels and employee names.
const getAllDependents = asyncHandler(async (req, res) => {
  const rows = await prisma.employeedependents.findMany({ orderBy: { id: 'desc' } });
  const em = await empMap(rows.map(r => r.employee));
  const allClvIds = [
    ...rows.map(r => r.relationship).filter(Boolean),
    ...rows.map(r => r.gender).filter(Boolean),
  ];
  const cm = await clvMap(allClvIds);
  respond.ok(res, 'Dependents retrieved', rows.map(r => ({
    ...s(r),
    employee:          em[r.employee.toString()] ?? null,
    relationshipLabel: r.relationship ? (cm[r.relationship] ?? r.relationship) : null,
    genderLabel:       r.gender       ? (cm[r.gender]       ?? r.gender)       : null,
  })));
});

// POST /employee-relations/dependents — add a dependent (child, spouse, etc.) linked to an employee.
const addDependent = asyncHandler(async (req, res) => {
  const { employee_id, name, gender, place_of_birth, relationship, dob, id_number } = req.body;
  const empId = toBigInt(employee_id);
  if (!empId)       return respond.badReq(res, 'Employee is required');
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  const row = await prisma.employeedependents.create({
    data: {
      employee: empId,
      name:           name.trim(),
      gender:         gender          || null,
      place_of_birth: place_of_birth?.trim() || null,
      relationship:   relationship    || null,
      dob:            dob ? new Date(dob) : null,
      id_number:      id_number?.trim() || null,
    },
  });
  respond.created(res, 'Dependent added', s(row));
});

// PUT /employee-relations/dependents/:id — update a dependent's personal details (name, DOB, relationship, ID number).
const updateDependent = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { name, gender, place_of_birth, relationship, dob, id_number } = req.body;
  const row = await prisma.employeedependents.update({
    where: { id },
    data: {
      name:           name?.trim() || undefined,
      gender:         gender          || null,
      place_of_birth: place_of_birth?.trim() || null,
      relationship:   relationship    || null,
      dob:            dob ? new Date(dob) : null,
      id_number:      id_number?.trim() || null,
    },
  });
  respond.ok(res, 'Dependent updated', s(row));
});

// DELETE /employee-relations/dependents/:id — permanently remove a dependent record.
const deleteDependent = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.employeedependents.delete({ where: { id } });
  respond.ok(res, 'Dependent removed');
});

// ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────────

// GET /employee-relations/emergency-contacts — list all emergency contact records with relationship labels and employee names.
const getAllEmergencyContacts = asyncHandler(async (req, res) => {
  const rows = await prisma.emergencycontacts.findMany({ orderBy: { id: 'desc' } });
  const [cm, em] = await Promise.all([
    clvMap(rows.map(r => r.relationship)),
    empMap(rows.map(r => r.employee)),
  ]);
  respond.ok(res, 'Emergency contacts retrieved', rows.map(r => ({
    ...s(r),
    relationshipLabel: r.relationship ? (cm[r.relationship] ?? r.relationship) : null,
    employee: em[r.employee.toString()] ?? null,
  })));
});

// POST /employee-relations/emergency-contacts — add an emergency contact (name, relationship, phone numbers) to an employee.
const addEmergencyContact = asyncHandler(async (req, res) => {
  const { employee_id, name, relationship, home_phone, work_phone, mobile_phone } = req.body;
  const empId = toBigInt(employee_id);
  if (!empId)        return respond.badReq(res, 'Employee is required');
  if (!name?.trim()) return respond.badReq(res, 'Name is required');
  const row = await prisma.emergencycontacts.create({
    data: {
      employee: empId,
      name:         name.trim(),
      relationship: relationship   || null,
      home_phone:   home_phone?.trim()   || null,
      work_phone:   work_phone?.trim()   || null,
      mobile_phone: mobile_phone?.trim() || null,
    },
  });
  respond.created(res, 'Emergency contact added', s(row));
});

// PUT /employee-relations/emergency-contacts/:id — update name, relationship, or phone numbers for an emergency contact.
const updateEmergencyContact = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  const { name, relationship, home_phone, work_phone, mobile_phone } = req.body;
  const row = await prisma.emergencycontacts.update({
    where: { id },
    data: {
      name:         name?.trim()         || undefined,
      relationship: relationship         || null,
      home_phone:   home_phone?.trim()   || null,
      work_phone:   work_phone?.trim()   || null,
      mobile_phone: mobile_phone?.trim() || null,
    },
  });
  respond.ok(res, 'Emergency contact updated', s(row));
});

// DELETE /employee-relations/emergency-contacts/:id — permanently remove an emergency contact record.
const deleteEmergencyContact = asyncHandler(async (req, res) => {
  const id = toBigInt(req.params.id);
  if (!id) return respond.badReq(res, 'Invalid ID');
  await prisma.emergencycontacts.delete({ where: { id } });
  respond.ok(res, 'Emergency contact removed');
});

module.exports = {
  getAllSkills, addSkill, updateSkill, deleteSkill,
  getAllCerts, addCert, updateCert, deleteCert,
  getAllEducation, addEducation, updateEducation, deleteEducation,
  getAllLanguages, addLanguage, updateLanguage, deleteLanguage,
  getAllDependents, addDependent, updateDependent, deleteDependent,
  getAllEmergencyContacts, addEmergencyContact, updateEmergencyContact, deleteEmergencyContact,
};
