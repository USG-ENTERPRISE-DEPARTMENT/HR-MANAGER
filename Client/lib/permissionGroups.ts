// Single source of truth for how permissions are grouped and coloured in the
// access UIs. Both the Users page (roles/permissions tabs) and the user/role
// creation form render from this list, so a permission only needs adding here.
//
// `color.active` is the group's accent hex; the other shades are used by the
// chip styling in the creation form.

export interface PermissionGroupColor {
  active: string;
  light: string;
  text: string;
  border: string;
}

export interface PermissionGroup {
  label: string;
  color: PermissionGroupColor;
  perms: string[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: 'Dashboard',
    color: { active: '#0d9488', light: '#f0fdfa', text: '#115e59', border: '#5eead4' },
    perms: ['view_dashboard'],
  },
  {
    label: 'Users & Access',
    color: { active: '#2563eb', light: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    perms: ['view_users', 'create_users', 'edit_users', 'deactivate_users', 'activate_users', 'change_user_password', 'manage_roles'],
  },
  {
    label: 'Employees',
    color: { active: '#059669', light: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
    perms: ['view_employees', 'create_employees', 'edit_employees', 'approve_employees', 'change_employee_status', 'manage_onboarding', 'view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'],
  },
  {
    label: 'Employee Relations',
    color: { active: '#0891b2', light: '#ecfeff', text: '#0e7490', border: '#a5f3fc' },
    perms: ['manage_skills', 'manage_certifications', 'manage_education', 'manage_languages', 'manage_dependents', 'manage_emergency_contacts'],
  },
  {
    label: 'Company',
    color: { active: '#64748b', light: '#f8fafc', text: '#475569', border: '#cbd5e1' },
    perms: ['view_company_structure', 'create_company_structure', 'edit_company_structure', 'delete_company_structure'],
  },
  {
    label: 'PC Codes',
    color: { active: '#0891b2', light: '#ecfeff', text: '#155e75', border: '#67e8f9' },
    perms: ['view_pc_code', 'create_pc_code', 'edit_pc_code', 'delete_pc_code', 'assign_pc_code'],
  },
  {
    label: 'Documents',
    color: { active: '#c2410c', light: '#fff7ed', text: '#9a3412', border: '#fed7aa' },
    perms: ['view_documents', 'create_documents', 'edit_documents', 'delete_documents'],
  },
  {
    label: 'Leave Setup',
    color: { active: '#0f766e', light: '#f0fdfa', text: '#134e4a', border: '#99f6e4' },
    perms: ['view_leave_setup', 'manage_leave_types', 'manage_leave_periods', 'manage_holidays', 'manage_work_week', 'manage_leave_groups', 'manage_leave_rules', 'manage_leave_approvals'],
  },
  {
    label: 'Salary',
    color: { active: '#b45309', light: '#fefce8', text: '#92400e', border: '#fde68a' },
    perms: ['view_salary_setup', 'manage_salary_component_types', 'manage_salary_components', 'manage_employee_salary_components', 'manage_notch_setup', 'manage_payment_types', 'manage_notch_movements'],
  },
  {
    label: 'Payroll',
    color: { active: '#d97706', light: '#fffbeb', text: '#b45309', border: '#fde68a' },
    perms: ['view_payroll', 'manage_payroll_employees', 'process_payroll', 'approve_payroll', 'export_payroll_reports', 'manage_payroll_columns', 'manage_calculation_groups', 'manage_report_templates'],
  },
  {
    label: 'Reports',
    color: { active: '#0284c7', light: '#f0f9ff', text: '#0369a1', border: '#bae6fd' },
    perms: ['generate_reports', 'export_reports'],
  },
  {
    label: 'System',
    color: { active: '#475569', light: '#f8fafc', text: '#334155', border: '#e2e8f0' },
    perms: ['view_app_settings', 'manage_app_settings', 'view_settings', 'manage_settings', 'view_audit_logs'],
  },
  {
    label: 'Recruitment',
    color: { active: '#7c3aed', light: '#f5f3ff', text: '#5b21b6', border: '#c4b5fd' },
    perms: ['view_recruitment', 'manage_jobs', 'manage_candidates', 'manage_applications', 'manage_interviews'],
  },
  {
    label: 'Performance',
    color: { active: '#0891b2', light: '#ecfeff', text: '#155e75', border: '#67e8f9' },
    perms: ['view_performance', 'create_performance', 'delete_performance', 'review_performance'],
  },
  {
    label: 'Medical',
    color: { active: '#dc2626', light: '#fef2f2', text: '#991b1b', border: '#fca5a5' },
    perms: ['view_medical', 'create_medical', 'edit_medical', 'delete_medical', 'approve_medical', 'manage_medical_limits', 'manage_hospitals', 'reset_medical_utilization'],
  },
  {
    label: 'Attendance',
    color: { active: '#0d9488', light: '#f0fdfa', text: '#115e59', border: '#5eead4' },
    perms: ['view_attendance', 'manage_attendance'],
  },
  {
    label: 'Training',
    color: { active: '#d97706', light: '#fffbeb', text: '#92400e', border: '#fcd34d' },
    perms: ['view_training', 'create_training', 'delete_training', 'approve_training'],
  },
  {
    label: 'AI Assistant',
    color: { active: '#7c3aed', light: '#f5f3ff', text: '#5b21b6', border: '#c4b5fd' },
    perms: ['use_ai_assistant', 'view_ai_insights'],
  },
];

/** Human-readable label for a permission key (e.g. create_users → Create Users). */
export const formatPermission = (p: string): string =>
  p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  view_dashboard: 'Open the dashboard and view its workforce summaries and metrics.',
  manage_roles: 'Create and edit roles, assign permissions, and activate or deactivate roles.',
  deactivate_users: 'Deactivate user accounts and prevent those users from signing in.',
  activate_users: 'Reactivate deactivated user accounts and restore their sign-in access.',
  change_user_password: 'Reset or change another user’s account password.',
  approve_employees: 'Approve or reject new employee records and pending employee-detail changes.',
  change_employee_status: 'Suspend, terminate, reinstate, or process other employee lifecycle status changes.',
  manage_onboarding: 'Configure self-onboarding forms and review or convert onboarding submissions.',
  view_employee_transfers: 'Open Employee Transfers and view transfer records and their progress.',
  create_employee_transfers: 'Create, edit, and submit employee transfer requests.',
  approve_employee_transfers: 'Approve or reject employee transfer requests assigned for approval.',
  manage_employee_transfers: 'Configure transfer approvals and manage, reschedule, cancel, or activate transfers.',
  view_leave_setup: 'Open Leave Setup and view leave configuration and approval records.',
  view_salary_setup: 'Open Salary Setup and view salary configuration.',
  view_payroll: 'Open Payroll and view payroll employees, runs, and results.',
  process_payroll: 'Create, calculate, and submit payroll runs for processing.',
  approve_payroll: 'Approve or reject payroll runs awaiting authorization.',
  export_payroll_reports: 'Download or export payroll reports and payroll results.',
  generate_reports: 'Open Admin Reports and generate organization-wide reports.',
  export_reports: 'Download or export generated administrative reports.',
  view_app_settings: 'Open the application setup area and view system configuration.',
  manage_app_settings: 'Change application setup, code lists, integrations, and system configuration.',
  view_settings: 'Open Settings and view the available configuration controls.',
  manage_settings: 'Change global settings and control-setup configuration.',
  view_audit_logs: 'Open and review the system audit trail and recorded user activity.',
  review_performance: 'Review, score, approve, or complete employee performance evaluations.',
  reset_medical_utilization: 'Close a medical year and reset employee medical-benefit utilization.',
  manage_attendance: 'Manage attendance records, corrections, imports, policies, and reports.',
  use_ai_assistant: 'Open and use the AI assistant features.',
  view_ai_insights: 'View AI-generated workforce insights and analysis.',
};

/** Short business explanation shown when a permission is hovered in the User module. */
export function describePermission(permission: string): string {
  const explicit = PERMISSION_DESCRIPTIONS[permission];
  if (explicit) return explicit;

  const [verb, ...parts] = permission.split('_');
  const subject = parts.join(' ').replace(/\bgl\b/gi, 'GL');
  const descriptions: Record<string, string> = {
    view: `Open and view ${subject}.`,
    create: `Create new ${subject} records.`,
    edit: `Edit existing ${subject} records.`,
    delete: `Delete ${subject} records.`,
    approve: `Approve or reject ${subject} requests.`,
    manage: `Configure and manage ${subject}.`,
    generate: `Generate ${subject}.`,
    export: `Download or export ${subject}.`,
    process: `Process ${subject}.`,
    review: `Review and action ${subject}.`,
    reset: `Reset ${subject}.`,
    use: `Access and use ${subject}.`,
    change: `Change ${subject}.`,
    activate: `Activate ${subject}.`,
    deactivate: `Deactivate ${subject}.`,
  };
  return descriptions[verb] || `Allows the user to ${formatPermission(permission).toLowerCase()}.`;
}
