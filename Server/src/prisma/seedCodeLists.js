/**
 * prisma/seedCodeLists.js
 *
 * Seeds all CodeList entries and their CodeListValues used by the HR system.
 * Safe to re-run — uses upsert throughout so existing data is preserved.
 *
 * Code lists seeded:
 *   COMPS  — Company structure types
 *   TIT    — Employee titles
 *   GEN    — Gender options
 *   NAT    — Nationalities
 *   REG    — Religions
 *   EMPS   — Employment statuses
 *   JOBT   — Job titles
 *   STAFL  — Staff levels
 *   STAFR  — Staff roles / categories
 *   CT     — Countries
 *   SKL    — Skills
 *   CERT   — Certifications
 *   INST   — Institutions / training providers
 *   LANG   — Languages
 *   REL    — Relationship types (dependents / emergency contacts)
 *   CUR    — Currencies
 *
 * Run with:
 *   node Server/src/prisma/seedCodeLists.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Helper ────────────────────────────────────────────────────────────────────

async function seedList({ code, name, description = null, values }) {
  // Upsert the list itself
  const list = await prisma.codeList.upsert({
    where:  { code },
    update: { name, description },
    create: { code, name, description, isActive: true },
  });

  // Upsert each value by [codeListId + code]
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    await prisma.codeListValue.upsert({
      where:  { codeListId_code: { codeListId: list.id, code: v.code } },
      update: { label: v.label, description: v.description ?? null, sortOrder: i + 1 },
      create: {
        codeListId:  list.id,
        code:        v.code,
        label:       v.label,
        description: v.description ?? null,
        sortOrder:   i + 1,
        isActive:    true,
      },
    });
  }

  console.log(`   ✔ ${code} — ${name} (${values.length} values)`);
  return list;
}

// ── Data ──────────────────────────────────────────────────────────────────────

const CODE_LISTS = [

  // ── Company Structure Types ────────────────────────────────────────────────
  {
    code: 'COMPS',
    name: 'Company Structure Types',
    description: 'Types of organisational units in the company hierarchy',
    values: [
      { code: 'HEAD_OFFICE', label: 'Head Office' },
      { code: 'BRANCH',      label: 'Branch' },
      { code: 'DEPARTMENT',  label: 'Department' },
      { code: 'UNIT',        label: 'Unit' },
      { code: 'OUTLET',      label: 'Outlet' },
      { code: 'OTHER',       label: 'Other' },
    ],
  },

  
  // ── Marital Status ───────────────────────────────────────────────────────────
  {
    code: 'TIT',
    name: 'Titles',
    description: 'Employee titles',
    values: [
      { code: 'MR',   label: 'Mr' },
      { code: 'MRS',  label: 'Mrs' },
      { code: 'MS',   label: 'Ms' }
    ],
  },
  {
    code: 'MARS',
    name: 'Marital Status',
    description: 'Employee marital statuses',
    values: [
      { code: 'MARRIED',   label: 'Married' },
      { code: 'SINGLE',    label: 'Single' },
      { code: 'DIVORCED',  label: 'Divorced' }
    ],
  },
  // ── Gender ─────────────────────────────────────────────────────────────────
  {
    code: 'GEN',
    name: 'Gender',
    description: 'Gender options for employee profiles',
    values: [
      { code: 'MALE',       label: 'Male' },
      { code: 'FEMALE',     label: 'Female' },
      { code: 'NON_BINARY', label: 'Non-binary' },
      { code: 'PREFER_NOT', label: 'Prefer not to say' },
    ],
  },

  // ── Nationalities ──────────────────────────────────────────────────────────
  {
    code: 'NAT',
    name: 'Nationalities',
    description: 'Employee nationalities',
    values: [
      // West Africa
      { code: 'SL',  label: 'Sierra Leonean' },
      { code: 'NG',  label: 'Nigerian' },
      { code: 'GH',  label: 'Ghanaian' },
      { code: 'LR',  label: 'Liberian' },
      { code: 'GN',  label: 'Guinean' },
      { code: 'GM',  label: 'Gambian' },
      { code: 'SN',  label: 'Senegalese' },
      { code: 'ML',  label: 'Malian' },
      { code: 'CI',  label: 'Ivorian' },
      { code: 'BF',  label: 'Burkinabé' },
      { code: 'TG',  label: 'Togolese' },
      { code: 'BJ',  label: 'Beninese' },
      { code: 'NE',  label: 'Nigerien' },
      // Central / East / Southern Africa
      { code: 'CM',  label: 'Cameroonian' },
      { code: 'KE',  label: 'Kenyan' },
      { code: 'TZ',  label: 'Tanzanian' },
      { code: 'UG',  label: 'Ugandan' },
      { code: 'ET',  label: 'Ethiopian' },
      { code: 'ZA',  label: 'South African' },
      { code: 'ZW',  label: 'Zimbabwean' },
      { code: 'ZM',  label: 'Zambian' },
      { code: 'MW',  label: 'Malawian' },
      { code: 'MZ',  label: 'Mozambican' },
      { code: 'RW',  label: 'Rwandan' },
      // North Africa
      { code: 'EG',  label: 'Egyptian' },
      { code: 'MA',  label: 'Moroccan' },
      { code: 'DZ',  label: 'Algerian' },
      // Europe / Americas / Asia (common expats)
      { code: 'GB',  label: 'British' },
      { code: 'US',  label: 'American' },
      { code: 'CA',  label: 'Canadian' },
      { code: 'FR',  label: 'French' },
      { code: 'DE',  label: 'German' },
      { code: 'IN',  label: 'Indian' },
      { code: 'CN',  label: 'Chinese' },
      { code: 'LB',  label: 'Lebanese' },
      { code: 'SY',  label: 'Syrian' },
      { code: 'OTHER', label: 'Other' },
    ],
  },

  // ── Religion ───────────────────────────────────────────────────────────────
  {
    code: 'REG',
    name: 'Religion',
    description: 'Employee religious affiliation',
    values: [
      { code: 'CHRISTIANITY', label: 'Christianity' },
      { code: 'ISLAM',        label: 'Islam' },
      { code: 'TRADITIONAL',  label: 'Traditional / Indigenous' },
      { code: 'HINDUISM',     label: 'Hinduism' },
      { code: 'BUDDHISM',     label: 'Buddhism' },
      { code: 'NONE',         label: 'None / Agnostic' },
      { code: 'OTHER',        label: 'Other' },
    ],
  },

  // ── Employment Status ──────────────────────────────────────────────────────
  {
    code: 'EMPS',
    name: 'Employment Status',
    description: 'Nature of an employee\'s employment engagement',
    values: [
      { code: 'PERMANENT',    label: 'Permanent' },
      { code: 'CONTRACT',     label: 'Contract' },
      { code: 'PROBATIONARY', label: 'Probationary' },
      { code: 'PART_TIME',    label: 'Part-time' },
      { code: 'INTERN',       label: 'Intern' },
      { code: 'CASUAL',       label: 'Casual' },
      { code: 'CONSULTANT',   label: 'Consultant' },
      { code: 'SECONDMENT',   label: 'Secondment' },
      { code: 'VOLUNTEER',    label: 'Volunteer' },
    ],
  },

  // ── Job Titles ─────────────────────────────────────────────────────────────
  {
    code: 'JOBT',
    name: 'Job Titles',
    description: 'Standard job titles used across the organisation',
    values: [
      // Executive
      { code: 'CEO',          label: 'Chief Executive Officer' },
      { code: 'CFO',          label: 'Chief Financial Officer' },
      { code: 'COO',          label: 'Chief Operating Officer' },
      { code: 'CTO',          label: 'Chief Technology Officer' },
      { code: 'CSO',          label: 'Chief Strategy Officer' },
      { code: 'MD',           label: 'Managing Director' },
      { code: 'ED',           label: 'Executive Director' },
      // Management
      { code: 'GM',           label: 'General Manager' },
      { code: 'DGM',          label: 'Deputy General Manager' },
      { code: 'HEAD_HR',      label: 'Head of Human Resources' },
      { code: 'HEAD_FIN',     label: 'Head of Finance' },
      { code: 'HEAD_IT',      label: 'Head of IT' },
      { code: 'HEAD_OPS',     label: 'Head of Operations' },
      { code: 'HEAD_SALES',   label: 'Head of Sales & Marketing' },
      { code: 'HEAD_LEGAL',   label: 'Head of Legal & Compliance' },
      { code: 'DEPT_MGR',     label: 'Department Manager' },
      { code: 'UNIT_MGR',     label: 'Unit Manager' },
      { code: 'BRANCH_MGR',   label: 'Branch Manager' },
      // HR
      { code: 'HR_MGR',       label: 'HR Manager' },
      { code: 'HR_OFF',       label: 'HR Officer' },
      { code: 'HR_ASST',      label: 'HR Assistant' },
      { code: 'RECR_OFF',     label: 'Recruitment Officer' },
      { code: 'TRNG_OFF',     label: 'Training & Development Officer' },
      // Finance
      { code: 'ACCT',         label: 'Accountant' },
      { code: 'SR_ACCT',      label: 'Senior Accountant' },
      { code: 'ACCT_ASST',    label: 'Accounts Assistant' },
      { code: 'AUDITOR',      label: 'Internal Auditor' },
      { code: 'FIN_ANALYST',  label: 'Financial Analyst' },
      { code: 'PAYROLL_OFF',  label: 'Payroll Officer' },
      // IT
      { code: 'SW_ENG',       label: 'Software Engineer' },
      { code: 'SR_SW_ENG',    label: 'Senior Software Engineer' },
      { code: 'SYS_ADMIN',    label: 'Systems Administrator' },
      { code: 'IT_OFF',       label: 'IT Officer' },
      { code: 'IT_SUPP',      label: 'IT Support Technician' },
      // Operations & Admin
      { code: 'OPS_MGR',      label: 'Operations Manager' },
      { code: 'OPS_OFF',      label: 'Operations Officer' },
      { code: 'ADMIN_OFF',    label: 'Administrative Officer' },
      { code: 'EXEC_ASST',    label: 'Executive Assistant' },
      { code: 'SECRETARY',    label: 'Secretary' },
      { code: 'RECEPT',       label: 'Receptionist' },
      // Legal & Compliance
      { code: 'LEGAL_OFF',    label: 'Legal Officer' },
      { code: 'COMP_OFF',     label: 'Compliance Officer' },
      { code: 'RISK_OFF',     label: 'Risk Officer' },
      // Sales & Marketing
      { code: 'SALES_OFF',    label: 'Sales Officer' },
      { code: 'SALES_REP',    label: 'Sales Representative' },
      { code: 'MKT_OFF',      label: 'Marketing Officer' },
      { code: 'BIZ_DEV',      label: 'Business Development Officer' },
      // Support
      { code: 'DRIVER',       label: 'Driver' },
      { code: 'SECURITY',     label: 'Security Officer' },
      { code: 'CLEANER',      label: 'Cleaner / Janitor' },
      { code: 'MESSENGER',    label: 'Messenger' },
    ],
  },

  // ── Staff Levels ───────────────────────────────────────────────────────────
  {
    code: 'STAFL',
    name: 'Staff Levels',
    description: 'Hierarchical level of staff within the organisation',
    values: [
      { code: 'BOARD',        label: 'Board Level' },
      { code: 'EXECUTIVE',    label: 'Executive' },
      { code: 'SR_MGMT',      label: 'Senior Management' },
      { code: 'MGMT',         label: 'Management' },
      { code: 'SR_STAFF',     label: 'Senior Staff' },
      { code: 'STAFF',        label: 'Staff' },
      { code: 'JR_STAFF',     label: 'Junior Staff' },
      { code: 'INTERN',       label: 'Intern / Trainee' },
      { code: 'SUPPORT',      label: 'Support Staff' },
    ],
  },

  // ── Staff Roles / Categories ────────────────────────────────────────────────
  {
    code: 'STAFR',
    name: 'Staff Roles',
    description: 'Functional category or department role of staff',
    values: [
      { code: 'EXECUTIVE',    label: 'Executive' },
      { code: 'ADMIN',        label: 'Administration' },
      { code: 'FINANCE',      label: 'Finance & Accounting' },
      { code: 'HR',           label: 'Human Resources' },
      { code: 'IT',           label: 'Information Technology' },
      { code: 'OPERATIONS',   label: 'Operations' },
      { code: 'SALES_MKT',    label: 'Sales & Marketing' },
      { code: 'LEGAL_COMP',   label: 'Legal & Compliance' },
      { code: 'AUDIT',        label: 'Audit & Risk' },
      { code: 'CUSTOMER_SVC', label: 'Customer Service' },
      { code: 'TECHNICAL',    label: 'Technical / Engineering' },
      { code: 'STRATEGY',     label: 'Strategy & Business Development' },
      { code: 'SUPPORT',      label: 'Support Services' },
    ],
  },

  // ── Countries ──────────────────────────────────────────────────────────────
  {
    code: 'CT',
    name: 'Countries',
    description: 'Country list for employee and recruitment forms',
    values: [
      // Africa — West
      { code: 'SL',  label: 'Sierra Leone' },
      { code: 'NG',  label: 'Nigeria' },
      { code: 'GH',  label: 'Ghana' },
      { code: 'LR',  label: 'Liberia' },
      { code: 'GN',  label: 'Guinea' },
      { code: 'GW',  label: 'Guinea-Bissau' },
      { code: 'GM',  label: 'Gambia' },
      { code: 'SN',  label: 'Senegal' },
      { code: 'ML',  label: 'Mali' },
      { code: 'CI',  label: 'Côte d\'Ivoire' },
      { code: 'BF',  label: 'Burkina Faso' },
      { code: 'TG',  label: 'Togo' },
      { code: 'BJ',  label: 'Benin' },
      { code: 'NE',  label: 'Niger' },
      { code: 'MR',  label: 'Mauritania' },
      { code: 'CV',  label: 'Cape Verde' },
      // Africa — Central
      { code: 'CM',  label: 'Cameroon' },
      { code: 'GA',  label: 'Gabon' },
      { code: 'CG',  label: 'Congo' },
      { code: 'CD',  label: 'DR Congo' },
      { code: 'CF',  label: 'Central African Republic' },
      { code: 'TD',  label: 'Chad' },
      { code: 'GQ',  label: 'Equatorial Guinea' },
      { code: 'ST',  label: 'São Tomé & Príncipe' },
      // Africa — East
      { code: 'KE',  label: 'Kenya' },
      { code: 'TZ',  label: 'Tanzania' },
      { code: 'UG',  label: 'Uganda' },
      { code: 'RW',  label: 'Rwanda' },
      { code: 'BI',  label: 'Burundi' },
      { code: 'ET',  label: 'Ethiopia' },
      { code: 'SO',  label: 'Somalia' },
      { code: 'ER',  label: 'Eritrea' },
      { code: 'DJ',  label: 'Djibouti' },
      { code: 'SS',  label: 'South Sudan' },
      { code: 'SD',  label: 'Sudan' },
      // Africa — Southern
      { code: 'ZA',  label: 'South Africa' },
      { code: 'ZW',  label: 'Zimbabwe' },
      { code: 'ZM',  label: 'Zambia' },
      { code: 'MW',  label: 'Malawi' },
      { code: 'MZ',  label: 'Mozambique' },
      { code: 'AO',  label: 'Angola' },
      { code: 'NA',  label: 'Namibia' },
      { code: 'BW',  label: 'Botswana' },
      { code: 'SZ',  label: 'Eswatini' },
      { code: 'LS',  label: 'Lesotho' },
      { code: 'MG',  label: 'Madagascar' },
      { code: 'MU',  label: 'Mauritius' },
      // Africa — North
      { code: 'EG',  label: 'Egypt' },
      { code: 'LY',  label: 'Libya' },
      { code: 'TN',  label: 'Tunisia' },
      { code: 'DZ',  label: 'Algeria' },
      { code: 'MA',  label: 'Morocco' },
      // Europe
      { code: 'GB',  label: 'United Kingdom' },
      { code: 'FR',  label: 'France' },
      { code: 'DE',  label: 'Germany' },
      { code: 'IT',  label: 'Italy' },
      { code: 'ES',  label: 'Spain' },
      { code: 'PT',  label: 'Portugal' },
      { code: 'NL',  label: 'Netherlands' },
      { code: 'BE',  label: 'Belgium' },
      { code: 'SE',  label: 'Sweden' },
      { code: 'NO',  label: 'Norway' },
      { code: 'DK',  label: 'Denmark' },
      { code: 'IE',  label: 'Ireland' },
      { code: 'CH',  label: 'Switzerland' },
      // Americas
      { code: 'US',  label: 'United States' },
      { code: 'CA',  label: 'Canada' },
      { code: 'BR',  label: 'Brazil' },
      { code: 'MX',  label: 'Mexico' },
      { code: 'JM',  label: 'Jamaica' },
      { code: 'TT',  label: 'Trinidad & Tobago' },
      // Asia & Middle East
      { code: 'IN',  label: 'India' },
      { code: 'PK',  label: 'Pakistan' },
      { code: 'BD',  label: 'Bangladesh' },
      { code: 'CN',  label: 'China' },
      { code: 'JP',  label: 'Japan' },
      { code: 'KR',  label: 'South Korea' },
      { code: 'LB',  label: 'Lebanon' },
      { code: 'SY',  label: 'Syria' },
      { code: 'SA',  label: 'Saudi Arabia' },
      { code: 'AE',  label: 'United Arab Emirates' },
      { code: 'IL',  label: 'Israel' },
      { code: 'TR',  label: 'Turkey' },
      { code: 'OTHER', label: 'Other' },
    ],
  },

  // ── Skills ─────────────────────────────────────────────────────────────────
  {
    code: 'SKL',
    name: 'Skills',
    description: 'Professional skills and competencies for employee profiles',
    values: [
      // Management & Leadership
      { code: 'LEADERSHIP',     label: 'Leadership' },
      { code: 'PROJ_MGMT',      label: 'Project Management' },
      { code: 'STRATEGIC_PLAN', label: 'Strategic Planning' },
      { code: 'TEAM_MGMT',      label: 'Team Management' },
      { code: 'CHANGE_MGMT',    label: 'Change Management' },
      { code: 'NEGOTIATION',    label: 'Negotiation' },
      // Finance & Accounting
      { code: 'ACCOUNTING',     label: 'Accounting' },
      { code: 'FINANCIAL_ANAL', label: 'Financial Analysis' },
      { code: 'BUDGETING',      label: 'Budgeting' },
      { code: 'AUDITING',       label: 'Auditing' },
      { code: 'TAXATION',       label: 'Taxation' },
      // HR
      { code: 'RECRUITMENT',    label: 'Recruitment' },
      { code: 'PERF_MGMT',      label: 'Performance Management' },
      { code: 'COMPENSATION',   label: 'Compensation & Benefits' },
      { code: 'TRAINING',       label: 'Training & Development' },
      { code: 'LABOUR_RELATIONS', label: 'Labour Relations' },
      // IT
      { code: 'SOFTWARE_DEV',   label: 'Software Development' },
      { code: 'DATABASE_ADMIN', label: 'Database Administration' },
      { code: 'NETWORKING',     label: 'Networking & Infrastructure' },
      { code: 'CYBERSECURITY',  label: 'Cybersecurity' },
      { code: 'DATA_ANALYSIS',  label: 'Data Analysis' },
      { code: 'EXCEL',          label: 'Microsoft Excel' },
      // Legal & Compliance
      { code: 'CONTRACT_LAW',   label: 'Contract Law' },
      { code: 'COMPLIANCE',     label: 'Regulatory Compliance' },
      { code: 'RISK_MGMT',      label: 'Risk Management' },
      // Communication
      { code: 'COMM_WRITTEN',   label: 'Written Communication' },
      { code: 'COMM_VERBAL',    label: 'Verbal Communication' },
      { code: 'PRESENTATION',   label: 'Presentation' },
      { code: 'PUBLIC_SPEAK',   label: 'Public Speaking' },
      // Customer / Operations
      { code: 'CUSTOMER_SVC',   label: 'Customer Service' },
      { code: 'SALES',          label: 'Sales' },
      { code: 'MARKETING',      label: 'Marketing' },
      { code: 'SUPPLY_CHAIN',   label: 'Supply Chain Management' },
      { code: 'PROCUREMENT',    label: 'Procurement' },
    ],
  },

  // ── Certifications ─────────────────────────────────────────────────────────
  {
    code: 'CERT',
    name: 'Certifications',
    description: 'Professional certifications held by employees',
    values: [
      { code: 'ACCA',       label: 'ACCA' },
      { code: 'ICASL',      label: 'ICASL' },
      { code: 'CIMA',       label: 'CIMA' },
      { code: 'CPA',        label: 'CPA' },
      { code: 'CIPD',       label: 'CIPD' },
      { code: 'SHRM_CP',    label: 'SHRM-CP' },
      { code: 'SHRM_SCP',   label: 'SHRM-SCP' },
      { code: 'PMP',        label: 'PMP (Project Management Professional)' },
      { code: 'PRINCE2',    label: 'PRINCE2' },
      { code: 'ISO_27001',  label: 'ISO 27001 Lead Auditor' },
      { code: 'CIA',        label: 'CIA (Certified Internal Auditor)' },
      { code: 'CISA',       label: 'CISA' },
      { code: 'CISSP',      label: 'CISSP' },
      { code: 'AWS_CP',     label: 'AWS Certified Cloud Practitioner' },
      { code: 'AZURE_FUND', label: 'Microsoft Azure Fundamentals' },
      { code: 'ITIL',       label: 'ITIL Foundation' },
      { code: 'SIX_SIGMA',  label: 'Six Sigma (Green / Black Belt)' },
      { code: 'CFA',        label: 'CFA' },
      { code: 'NEBOSH',     label: 'NEBOSH' },
      { code: 'IOSH',       label: 'IOSH Managing Safely' },
      { code: 'OTHER',      label: 'Other' },
    ],
  },

  // ── Institutions / Training Providers ──────────────────────────────────────
  {
    code: 'INST',
    name: 'Institutions',
    description: 'Educational institutions and training providers',
    values: [
      // Sierra Leone
      { code: 'USL',         label: 'University of Sierra Leone' },
      { code: 'NJALA',       label: 'Njala University' },
      { code: 'UNIMAK',      label: 'University of Makeni' },
      { code: 'SALONE_UNI',  label: 'Fourah Bay College' },
      { code: 'IPAM',        label: 'IPAM (Institute of Public Administration and Management)' },
      { code: 'EMIS',        label: 'Ernest Bai Koroma Management Institute' },
      { code: 'TUSL',        label: 'Technical University of Sierra Leone' },
      // Regional
      { code: 'UG',          label: 'University of Ghana' },
      { code: 'UI',          label: 'University of Ibadan' },
      { code: 'UL',          label: 'University of Liberia' },
      { code: 'ABV',         label: 'Ahmadu Bello University' },
      { code: 'KNUST',       label: 'Kwame Nkrumah University of Science and Technology' },
      // International
      { code: 'HARVARD',     label: 'Harvard University' },
      { code: 'OXFORD',      label: 'University of Oxford' },
      { code: 'CAMBRIDGE',   label: 'University of Cambridge' },
      { code: 'LSE',         label: 'London School of Economics' },
      { code: 'SOAS',        label: 'SOAS University of London' },
      { code: 'UCL',         label: 'University College London' },
      // Professional bodies / training
      { code: 'ACCA_INST',   label: 'ACCA' },
      { code: 'CIPD_INST',   label: 'CIPD' },
      { code: 'PMI',         label: 'Project Management Institute' },
      { code: 'ONLINE',      label: 'Online / e-Learning' },
      { code: 'IN_HOUSE',    label: 'In-house Training' },
      { code: 'OTHER',       label: 'Other' },
    ],
  },

  // ── Languages ──────────────────────────────────────────────────────────────
  {
    code: 'LANG',
    name: 'Languages',
    description: 'Languages spoken by employees',
    values: [
      { code: 'EN',    label: 'English' },
      { code: 'FR',    label: 'French' },
      { code: 'AR',    label: 'Arabic' },
      { code: 'KRI',   label: 'Krio' },
      { code: 'TEM',   label: 'Temne' },
      { code: 'MEN',   label: 'Mende' },
      { code: 'LIM',   label: 'Limba' },
      { code: 'KON',   label: 'Kono' },
      { code: 'SUS',   label: 'Susu' },
      { code: 'FUL',   label: 'Fula / Fulani' },
      { code: 'MAN',   label: 'Mandingo' },
      { code: 'WOL',   label: 'Wolof' },
      { code: 'HAU',   label: 'Hausa' },
      { code: 'YOR',   label: 'Yoruba' },
      { code: 'IBO',   label: 'Igbo' },
      { code: 'TWI',   label: 'Twi / Akan' },
      { code: 'PT',    label: 'Portuguese' },
      { code: 'ES',    label: 'Spanish' },
      { code: 'DE',    label: 'German' },
      { code: 'ZH',    label: 'Chinese (Mandarin)' },
      { code: 'HI',    label: 'Hindi' },
      { code: 'OTHER', label: 'Other' },
    ],
  },

  // ── Relationship Types ─────────────────────────────────────────────────────
  {
    code: 'REL',
    name: 'Relationship Types',
    description: 'Relationship type for dependants and emergency contacts',
    values: [
      { code: 'SPOUSE',      label: 'Spouse' },
      { code: 'CHILD',       label: 'Child' },
      { code: 'PARENT',      label: 'Parent' },
      { code: 'SIBLING',     label: 'Sibling' },
      { code: 'GRANDPARENT', label: 'Grandparent' },
      { code: 'GRANDCHILD',  label: 'Grandchild' },
      { code: 'UNCLE_AUNT',  label: 'Uncle / Aunt' },
      { code: 'NEPHEW_NIECE',label: 'Nephew / Niece' },
      { code: 'COUSIN',      label: 'Cousin' },
      { code: 'PARTNER',     label: 'Domestic Partner' },
      { code: 'FRIEND',      label: 'Friend' },
      { code: 'COLLEAGUE',   label: 'Colleague' },
      { code: 'IN_LAW',      label: 'In-law' },
      { code: 'GUARDIAN',    label: 'Guardian' },
      { code: 'OTHER',       label: 'Other' },
    ],
  },

  // ── Currencies ─────────────────────────────────────────────────────────────
  {
    code: 'CUR',
    name: 'Currencies',
    description: 'Currencies used in salary, payroll and claims',
    values: [
      { code: 'SLE', label: 'SLE – Sierra Leonean Leone' },
      { code: 'USD', label: 'USD – US Dollar' },
      { code: 'GBP', label: 'GBP – British Pound' },
      { code: 'EUR', label: 'EUR – Euro' },
      { code: 'NGN', label: 'NGN – Nigerian Naira' },
      { code: 'GHS', label: 'GHS – Ghanaian Cedi' },
      { code: 'GMD', label: 'GMD – Gambian Dalasi' },
      { code: 'LRD', label: 'LRD – Liberian Dollar' },
      { code: 'GNF', label: 'GNF – Guinean Franc' },
      { code: 'XOF', label: 'XOF – CFA Franc BCEAO' },
      { code: 'ZAR', label: 'ZAR – South African Rand' },
      { code: 'KES', label: 'KES – Kenyan Shilling' },
      { code: 'AED', label: 'AED – UAE Dirham' },
      { code: 'CAD', label: 'CAD – Canadian Dollar' },
    ],
  },

];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding code lists...\n');

  for (const list of CODE_LISTS) {
    await seedList(list);
  }

  const totalValues = CODE_LISTS.reduce((sum, l) => sum + l.values.length, 0);
  console.log(`\n✅ Code list seed complete!`);
  console.log(`   ${CODE_LISTS.length} lists · ${totalValues} values — all upserted (existing values untouched)`);
}

main()
  .catch(e => {
    console.error('❌ seedCodeLists failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
