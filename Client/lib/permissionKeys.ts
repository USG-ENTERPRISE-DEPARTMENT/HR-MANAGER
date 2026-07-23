/**
 * PERMISSIONS
 *
 * String values must match `name` column in the backend permissions table exactly.
 * Usage:
 *   can(PERMISSIONS.VIEW_STUDENTS)
 *   canAny([PERMISSIONS.VIEW_FEES, PERMISSIONS.VIEW_FEE_STRUCTURE])
 */
export const PERMISSIONS = {
  // ── Users & Access ─────────────────────────────────────────
  VIEW_USERS:                         'view_users',
  CREATE_USERS:                       'create_users',
  EDIT_USERS:                         'edit_users',
  DEACTIVATE_USERS:                   'deactivate_users',
  ACTIVATE_USERS:                     'activate_users',
  CHANGE_USER_PASSWORD:               'change_user_password',
  MANAGE_ROLES:                       'manage_roles',

  // ── Employees ──────────────────────────────────────────────
  VIEW_EMPLOYEES:                     'view_employees',
  CREATE_EMPLOYEES:                   'create_employees',
  EDIT_EMPLOYEES:                     'edit_employees',
  APPROVE_EMPLOYEES:                  'approve_employees',
  CHANGE_EMPLOYEE_STATUS:             'change_employee_status',
  MANAGE_ONBOARDING:                  'manage_onboarding',
  VIEW_EMPLOYEE_TRANSFERS:            'view_employee_transfers',
  CREATE_EMPLOYEE_TRANSFERS:          'create_employee_transfers',
  APPROVE_EMPLOYEE_TRANSFERS:         'approve_employee_transfers',
  MANAGE_EMPLOYEE_TRANSFERS:          'manage_employee_transfers',

  // ── Employee Relations ─────────────────────────────────────
  MANAGE_SKILLS:                      'manage_skills',
  MANAGE_CERTIFICATIONS:              'manage_certifications',
  MANAGE_EDUCATION:                   'manage_education',
  MANAGE_LANGUAGES:                   'manage_languages',
  MANAGE_DEPENDENTS:                  'manage_dependents',
  MANAGE_EMERGENCY_CONTACTS:          'manage_emergency_contacts',

  // ── Company ────────────────────────────────────────────────
  VIEW_COMPANY_STRUCTURE:             'view_company_structure',
  CREATE_COMPANY_STRUCTURE:           'create_company_structure',
  EDIT_COMPANY_STRUCTURE:             'edit_company_structure',
  DELETE_COMPANY_STRUCTURE:           'delete_company_structure',

  // ── PC Codes (positions) ───────────────────────────────────
  VIEW_PC_CODE:                       'view_pc_code',
  CREATE_PC_CODE:                     'create_pc_code',
  EDIT_PC_CODE:                       'edit_pc_code',
  DELETE_PC_CODE:                     'delete_pc_code',
  ASSIGN_PC_CODE:                     'assign_pc_code',

  // ── Documents ──────────────────────────────────────────────
  VIEW_DOCUMENTS:                     'view_documents',
  CREATE_DOCUMENTS:                   'create_documents',
  EDIT_DOCUMENTS:                     'edit_documents',
  DELETE_DOCUMENTS:                   'delete_documents',

  // ── Leave ──────────────────────────────────────────────────
  // Leave is open to every user by default (incl. approving subordinates' leave) — no permission needed.
  // The HR "Leave Approval List" in Manage Leave is gated by VIEW_LEAVE_SETUP.

  // ── Leave Setup ────────────────────────────────────────────
  VIEW_LEAVE_SETUP:                   'view_leave_setup',
  MANAGE_LEAVE_TYPES:                 'manage_leave_types',
  MANAGE_LEAVE_PERIODS:               'manage_leave_periods',
  MANAGE_HOLIDAYS:                    'manage_holidays',
  MANAGE_WORK_WEEK:                   'manage_work_week',
  MANAGE_LEAVE_GROUPS:                'manage_leave_groups',
  MANAGE_LEAVE_RULES:                 'manage_leave_rules',
  MANAGE_LEAVE_APPROVALS:             'manage_leave_approvals',

  // ── Salary ─────────────────────────────────────────────────
  VIEW_SALARY_SETUP:                  'view_salary_setup',
  MANAGE_SALARY_COMPONENT_TYPES:      'manage_salary_component_types',
  MANAGE_SALARY_COMPONENTS:           'manage_salary_components',
  MANAGE_EMPLOYEE_SALARY_COMPONENTS:  'manage_employee_salary_components',
  MANAGE_NOTCH_SETUP:                 'manage_notch_setup',
  MANAGE_PAYMENT_TYPES:               'manage_payment_types',
  MANAGE_NOTCH_MOVEMENTS:             'manage_notch_movements',

  // ── Payroll ────────────────────────────────────────────────
  VIEW_PAYROLL:                       'view_payroll',
  MANAGE_PAYROLL_EMPLOYEES:           'manage_payroll_employees',
  PROCESS_PAYROLL:                    'process_payroll',
  APPROVE_PAYROLL:                    'approve_payroll',
  EXPORT_PAYROLL_REPORTS:             'export_payroll_reports',
  MANAGE_PAYROLL_COLUMNS:             'manage_payroll_columns',
  MANAGE_CALCULATION_GROUPS:          'manage_calculation_groups',
  MANAGE_REPORT_TEMPLATES:            'manage_report_templates',

  // ── Reports ────────────────────────────────────────────────
  GENERATE_REPORTS:                   'generate_reports',
  EXPORT_REPORTS:                     'export_reports',

  // ── System ─────────────────────────────────────────────────
  // App Settings page (App Setup + code lists)
  VIEW_APP_SETTINGS:                  'view_app_settings',
  MANAGE_APP_SETTINGS:                'manage_app_settings',
  // Settings page (controls, approvals, email, etc.)
  VIEW_SETTINGS:                      'view_settings',
  MANAGE_SETTINGS:                    'manage_settings',
  // Audit logs (view only)
  VIEW_AUDIT_LOGS:                    'view_audit_logs',


  // ── Dashboard ──────────────────────────────────────────────
  VIEW_DASHBOARD:            'view_dashboard',

  // ── Recruitment ────────────────────────────────────────────
  VIEW_RECRUITMENT:          'view_recruitment',
  MANAGE_JOBS:               'manage_jobs',
  MANAGE_CANDIDATES:         'manage_candidates',
  MANAGE_APPLICATIONS:       'manage_applications',
  MANAGE_INTERVIEWS:         'manage_interviews',

  // ── Performance ────────────────────────────────────────────
  VIEW_PERFORMANCE:          'view_performance',
  CREATE_PERFORMANCE:        'create_performance',
  DELETE_PERFORMANCE:        'delete_performance',
  REVIEW_PERFORMANCE:        'review_performance',

  // ── Medical ────────────────────────────────────────────────
  VIEW_MEDICAL:              'view_medical',
  CREATE_MEDICAL:            'create_medical',
  EDIT_MEDICAL:              'edit_medical',
  DELETE_MEDICAL:            'delete_medical',
  APPROVE_MEDICAL:           'approve_medical',
  MANAGE_MEDICAL_LIMITS:     'manage_medical_limits',
  MANAGE_HOSPITALS:          'manage_hospitals',
  RESET_MEDICAL_UTILIZATION: 'reset_medical_utilization',

  // ── Attendance ─────────────────────────────────────────────
  VIEW_ATTENDANCE:           'view_attendance',
  MANAGE_ATTENDANCE:         'manage_attendance',

  // ── Training ───────────────────────────────────────────────
  VIEW_TRAINING:             'view_training',
  CREATE_TRAINING:           'create_training',
  DELETE_TRAINING:           'delete_training',
  APPROVE_TRAINING:          'approve_training',

  // ── AI Assistant ───────────────────────────────────────────
  USE_AI_ASSISTANT:          'use_ai_assistant',
  VIEW_AI_INSIGHTS:          'view_ai_insights',
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// ─────────────────────────────────────────────────────────────
// NAV PERMISSION MAP
// Maps each sidebar route/section to the permission(s) required.
// canAccessNav returns true if the user has ANY of the listed permissions.
// Empty array = always visible to authenticated users.
// ─────────────────────────────────────────────────────────────
export const NAV_PERMISSIONS: Record<string, string[]> = {
  // ── Always visible ────────────────────────────────────────────
  Modules:            [],
  PersonalInfo:       [],
  StaffOrganogram:    [],
  PcCodeOrganogram:   [],
  Help:               [],

  // ── Must be assigned ──────────────────────────────────────────
  // Overview (Dashboard) is gated; users without it land on Modules instead.
  Dashboard:          ['view_dashboard'],

  // ── Main Menu ─────────────────────────────────────────────────
  Admin:              ['manage_app_settings', 'manage_settings', 'view_employees'],
  JobTitleSetups:     ['manage_app_settings'],
  QualificationSetups:['manage_app_settings'],
  LeavingSettings:    ['manage_app_settings'],
  AdminReports:       ['generate_reports'],
  CentralApproval:    ['approve_employees', 'approve_payroll', 'approve_medical', 'approve_employee_transfers'],
  UserReports:        [],  // Personal reports - open to all

  // ── Management ────────────────────────────────────────────────
  Employees:          ['view_employees'],
  SelfOnboarding:     ['manage_onboarding'],
  EmployeeTransfers: ['view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'],
  Organogram:         ['view_company_structure'],
  Company:            ['view_company_structure'],
  PcCodes:            ['view_pc_code'],
  Documents:          ['view_documents'],

  // Leave
  Leave:              ['view_leave_setup', 'manage_leave_types'],
  LeaveSetup:         ['view_leave_setup', 'manage_leave_types', 'manage_leave_periods', 'manage_holidays'],
  LeaveCalendar:      [],  // Personal calendar - open to all
  LeaveManagement:    [],  // Personal leave management - open to all

  // Payroll
  Payroll:            ['view_payroll', 'process_payroll', 'approve_payroll', 'manage_payroll_employees'],
  Salary:             ['view_salary_setup', 'manage_salary_component_types', 'manage_salary_components', 'manage_notch_setup'],

  // Medical
  Medical:            [],
  PersonalMedical:    [],
  AdminMedical:       ['view_medical'],


  // Training & Development
  AdminTraining:    ['view_training'],
  PersonalTraining: [],

  // Performance Management
  ManagePerformance: ['view_performance'],
  PersonalPerformance: [],

  // Recruitment
  Recruitment: ['view_recruitment'],

  // Documents
  PersonalDocuments:  [],  // Personal view - open to all

  // Attendance
  AdminAttendance:  ['view_attendance'],
  MyAttendance:     [],
  Attendance:       [],

  // Users & System
  Users:              ['view_users', 'manage_roles'],
  System:             ['view_app_settings'],
  Settings:           ['view_settings'],
  AuditLogs:          ['view_audit_logs'],

  // AI
  AiInsights:         ['view_ai_insights'],
};
