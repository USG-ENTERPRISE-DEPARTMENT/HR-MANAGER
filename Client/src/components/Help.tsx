import { useState, useMemo } from 'react';
import {
  Search, Users, CalendarCheck, Building2, Banknote, Stethoscope,
  ChevronRight, ArrowLeft, BookOpen, Lightbulb, AlertTriangle,
  CheckCircle2, Clock, FileText, ListChecks, Sparkles, X, BarChart2, Briefcase, UserCheck,
  ShieldAlert, Activity, KeyRound, UserCog, TrendingUp, Star, FolderOpen, Mail,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { inputClass } from './ui/FormField';
import { HairlineDecor } from './ui/HairlineDecor';

// ─── Data types ──────────────────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text';    body: string }
  | { type: 'tip';     body: string }
  | { type: 'warning'; body: string }
  | { type: 'steps';   heading?: string; steps: { label: string; detail?: string }[] }
  | { type: 'table';   headers: string[]; rows: string[][] };

type Article = {
  id: string;
  title: string;
  summary: string;
  icon: typeof FileText;
  content: ContentBlock[];
};

type HelpModule = {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  color: string;
  accentBg: string;
  articles: Article[];
};

// Theme-proof icon-chip background derived from the module colour —
// replaces the fixed light accentBg hexes so dark mode tints correctly.
const tint = (c: string) => `color-mix(in srgb, ${c} 14%, transparent)`;

// ─── Content ─────────────────────────────────────────────────────────────────

const MODULES: HelpModule[] = [
  // ── EMPLOYEES ──────────────────────────────────────────────────────────────
  {
    id: 'employees',
    title: 'Employees',
    description: 'Manage employee records, approvals, transfers, change history, lifecycle actions, onboarding, and AI insights.',
    icon: Users,
    color: '#2563eb',
    accentBg: '#eff6ff',
    articles: [
      {
        id: 'employees-overview',
        title: 'Employees Overview',
        summary: 'Understand the Employees menu, its four pages, and how employee records are used across the system.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Employees module is the foundation of the HR system. Every payroll run, leave balance, medical claim, performance review, and employee transfer traces back to an employee record. The Employees sidebar menu contains four pages.' },
          {
            type: 'table',
            headers: ['Page', 'What it manages'],
            rows: [
              ['Manage Employees', 'Your active workforce, employee relations, disciplinary records, approvals, lifecycle actions, and deactivated employees'],
              ['Self-Onboarding Setup', 'Configure the public intake form, share its link or QR code, review submissions, and convert them into employee records'],
              ['AI Insights', 'Review explainable attrition-risk scores derived from tenure, attendance, leave, performance, and disciplinary signals'],
              ['Employee Transfer', 'Create, approve, schedule, activate, review, and export auditable employee assignment changes'],
            ],
          },
          {
            type: 'table',
            headers: ['Who can do it', 'What they do (and what unlocks it)'],
            rows: [
              ['With employee permissions', 'Create, approve, and run the full lifecycle. Which tabs and buttons appear depends on the exact permissions assigned — e.g. view_employees to see the page, create_employees to add, edit_employees to edit, approve_employees to approve, change_employee_status for suspend/resign/terminate.'],
              ['An employee\'s supervisor',  'Sees their direct reports and approves their leave. This comes from the supervisor field on the employee record, not from a job title or role.'],
              ['Any signed-in user',        'Views their own profile, leave history, pay information, and documents under Personal Info — open to everyone with a login.'],
            ],
          },
          { type: 'warning', body: 'Access is permission-based, not role-based. The system shows each page and action according to the permissions assigned to the user (bundled into roles on the Users page). Labels like "HR admin" or "supervisor" describe a typical permission set, not a fixed access level — a user only sees what their permissions grant.' },
          { type: 'tip', body: 'An employee record must be APPROVED before the employee can be processed for payroll, have a leave balance, or be included in a performance cycle.' },
          { type: 'warning', body: 'Bank account and pay grade are required on the employee record before payroll can be run. Missing either will block payslip generation.' },
        ],
      },
      {
        id: 'add-employee',
        title: 'Adding a New Employee',
        summary: 'Create a new employee record using the five-section form.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Employee records are the foundation of the HR system. Every payroll run, leave balance, and document is tied to an employee record. The form is split into five sections you complete in order.' },
          {
            type: 'table',
            headers: ['Section', 'Key fields'],
            rows: [
              ['Personal',    'Title, first name, middle name, last name, gender, date of birth, place of birth, nationality, religion, marital status, address, work email, personal email, mobile'],
              ['Employment',  'Employee ID, job title, employment status, staff level, staff role, department, branch, unit, outlet, supervisor, hire date, confirmation date, national ID, passport, driver\'s licence'],
              ['Next of Kin', 'Full name, phone, email, address'],
              ['Financial',   'Bank account, pay grade, salary notch'],
              ['Documents',   'Upload supporting files at record creation (optional)'],
            ],
          },
          {
            type: 'steps', heading: 'How to add an employee',
            steps: [
              { label: 'Go to Employees from the sidebar and click "Add Employee".' },
              { label: 'Complete the Personal section and click Next.' },
              { label: 'Fill in Employment details — Employee ID, Job Title, Department, Hire Date are required.' },
              { label: 'Complete Next of Kin, Financial (bank account, pay grade), and optionally upload documents.' },
              { label: 'Click Save. The record is created with a PENDING status awaiting approval.' },
            ],
          },
          { type: 'tip', body: 'If auto-generate employee ID is enabled in Settings, the Employee ID field is filled automatically — you can still override it.' },
          { type: 'warning', body: 'Bank account and pay grade must be entered before payroll can be processed for this employee.' },
        ],
      },
      {
        id: 'self-onboarding',
        title: 'Self-Onboarding (Public Intake Form)',
        summary: 'Let new hires submit their own details through a shareable QR code or link, then convert each submission into an employee.',
        icon: UserCheck,
        content: [
          { type: 'text', body: 'Self-Onboarding (Employees → Self-Onboarding) lets you collect new-hire information without keying it in yourself. You decide which fields appear on a public form, share it as a QR code or link, and review what people submit. Submissions are draft intake records — they do not become employees until you convert them, so unverified public data never lands directly in the employee table. Access requires the "manage_onboarding" permission.' },
          {
            type: 'table',
            headers: ['Tab', 'What it does'],
            rows: [
              ['Form Builder', 'Tick which fields appear on the public form and mark which are required. Name and email are always included.'],
              ['Share Link',   'Show the QR code and link, print or download the QR, enable/disable the form, and regenerate the link.'],
              ['Submissions',  'See everyone who has filled the form — view details, convert to an employee, or discard.'],
            ],
          },
          {
            type: 'steps', heading: 'Building and sharing the form',
            steps: [
              { label: 'Go to Employees → Self-Onboarding → Form Builder.' },
              { label: 'Check the fields you want applicants to fill (Personal, Contact, Next of Kin, Identity Documents, and file uploads), mark any as Required, and click "Save Form".' },
              { label: 'Open the Share Link tab. Copy the link or let the new hire scan the QR code — Print or Download it for a noticeboard.' },
              { label: 'Use the enable/disable toggle to open or close the form, and "Regenerate Link" to invalidate the old URL if it leaks.' },
            ],
          },
          {
            type: 'steps', heading: 'Converting a submission',
            steps: [
              { label: 'Go to the Submissions tab. New entries show a "New" status badge.' },
              { label: 'Open the submission’s three-dot actions menu and choose View to review the details and uploaded files.' },
              { label: 'Click the convert (person+) icon to open the employee form pre-filled with the submission.' },
              { label: 'Complete the employment, financial, and supervisor details, then save — the employee is created as PENDING approval and the submission is marked Converted.' },
              { label: 'Use Delete from the actions menu to discard a submission you do not want to keep.' },
            ],
          },
          { type: 'tip', body: 'The link and QR code use the server\'s network (LAN) IP — not "localhost" — so a phone on the same network can open it. Make sure the device is on the same network and the host firewall allows the app\'s port.' },
          { type: 'warning', body: 'Employment and pay fields (job title, department, supervisor, pay grade, bank) are deliberately not on the public form — you set those during conversion before the record goes for approval.' },
        ],
      },
      {
        id: 'employee-ai-insights',
        title: 'Employee AI Insights',
        summary: 'Use explainable attrition-risk indicators as a prompt for proactive employee conversations.',
        icon: Sparkles,
        content: [
          { type: 'text', body: 'Employees → AI Insights provides an offline attrition-risk scorecard for authorised users. It groups employees into Low, Medium, or High risk and explains the signals contributing to each score.' },
          {
            type: 'steps', heading: 'Reviewing insights',
            steps: [
              { label: 'Open Employees → AI Insights. Access requires View AI Insights permission.' },
              { label: 'Review the employee count and High/Medium risk summary cards.' },
              { label: 'Select an employee row to see contributing factors and suggested next steps.' },
              { label: 'Use Recompute to refresh the scorecard from the latest available HR records.' },
            ],
          },
          { type: 'warning', body: 'These scores are heuristic decision-support indicators, not employment decisions. Validate the context, speak with the employee, and use normal HR review before taking any action.' },
        ],
      },
      {
        id: 'edit-employee',
        title: 'Editing Employee Details',
        summary: 'Edit personal and administrative fields while routing controlled employment changes through Employee Transfer.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Control Setup → Employee Form → Employee Transfers determines which fields must be changed through the formal transfer process. Fields switched off there remain editable as ordinary employee details. This separates personal or administrative corrections from assignment changes that need an effective date and transfer history.' },
          {
            type: 'steps', heading: 'How to edit an employee',
            steps: [
              { label: 'Find the employee in the Employees list.' },
              { label: 'Open the three-dot actions menu and select Edit.' },
              { label: 'Navigate between sections using the step tabs at the top.' },
              { label: 'Make your changes and click Save.' },
              { label: 'If approval on edit is enabled, the record returns to PENDING and approvers can review an old-value → new-value comparison before acting.' },
            ],
          },
          { type: 'tip', body: 'New employee approval and employee detail-change approval use the same configured Employee Approval Flow. They are not separate approval chains.' },
          { type: 'warning', body: 'Fields enabled for Employee Transfers should not be treated as ordinary edits for an approved active employee. Create a transfer so the proposal, approvals, effective date, and final sync remain auditable.' },
          { type: 'tip', body: 'Changes to pay grade take effect from the next payroll run and do not alter previously generated payslips.' },
        ],
      },
      {
        id: 'employee-profile',
        title: 'The Employee Profile',
        summary: 'The profile tabs provide a complete view of an employee record, including transfer history and change activity.',
        icon: Users,
        content: [
          { type: 'text', body: 'Open the three-dot actions menu on an employee row and choose View Details. The profile tabs organise all information about that employee; the exact tabs shown depend on permissions.' },
          {
            type: 'table',
            headers: ['Tab', 'What it shows'],
            rows: [
              ['Personal',       'Date of birth, place of birth, gender, nationality, religion, marital status, contact details (mobile, email, address), and identification documents (national ID, passport, driver\'s licence, SSN)'],
              ['Employment',     'Employee ID, job title, employment status, staff level, department, branch, unit, outlet, supervisor, hire date, confirmation date, bank account, pay grade, and salary notch'],
              ['Relationships',  'Next of kin details, plus tables for dependents and emergency contacts'],
              ['Documents',      'Clearance documents: Fit & Proper Form, Police Clearance, and Medical Clearance — with view and status indicators'],
              ['Qualifications', 'Skills, certifications, education history, and language proficiencies in one view'],
              ['Attendance',     'Daily attendance records for this employee — see the Attendance module for clock-in/out, timesheets, and statuses'],
              ['Leave',          'Full leave history — type, period, start, end, days taken, and approval status'],
              ['Transfers',      'Every transfer record for this employee, including proposed changes, effective date, approval progress, status, and PDF export'],
              ['Activity',       'Chronological audit log of every action taken on this employee — who did what and when'],
              ['Disciplinary',   'Disciplinary incidents logged against this employee — add, edit, and delete records from here'],
            ],
          },
          { type: 'tip', body: 'Use the breadcrumb at the top of the slide-over to confirm which employee you are viewing before taking any action.' },
        ],
      },
      {
        id: 'approve-employee',
        title: 'Approving or Rejecting a Record',
        summary: 'Review new employees and employee detail changes through one shared, configurable approval flow.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'New employee records and employee detail changes can both enter the same Employee Approval Flow configured under Settings → Controls → Approvals. Each stage may be assigned to a role or a specific user. With no configured stages, users with Approve Employees permission provide one-step approval.' },
          {
            type: 'table',
            headers: ['Request', 'What the approver reviews', 'Final result'],
            rows: [
              ['New employee', 'The complete employee record and required employment information', 'The employee becomes APPROVED and ACTIVE, then syncs to the configured external system'],
              ['Employee detail change', 'A clear field-by-field comparison showing the previous value and proposed value', 'The approved changes are recorded in history and the updated employee is synced'],
            ],
          },
          {
            type: 'steps', heading: 'How to approve or reject',
            steps: [
              { label: 'Open Central Approval, or open the PENDING employee from Manage Employees.' },
              { label: 'Review the employee details and, for an edit, the previous-value → new-value comparison.' },
              { label: 'Review the approval progress to confirm which configured stage is currently active.' },
              { label: 'Click Approve to complete your stage, or Reject and enter a reason. A rejection ends the entire employee request.' },
              { label: 'After an intermediate approval, the next configured approver is notified. Final approval activates or confirms the employee and triggers external sync.' },
            ],
          },
          { type: 'text', body: 'After approval, the system automatically attempts to sync the employee record to any configured external system (x100 for user creation). A second notification appears immediately after approval confirming whether the sync succeeded or failed.' },
          {
            type: 'table',
            headers: ['Sync outcome', 'What you see'],
            rows: [
              ['Success', 'A green "External system synced" notification with the response from the external system'],
              ['Failed',  'A red "External sync failed" notification with the error detail, and a "Sync Failed" badge on the employee row in the list'],
            ],
          },
          {
            type: 'steps', heading: 'How to retry a failed sync',
            steps: [
              { label: 'In the Employees list, find the employee — they will have a red "Sync Failed" badge on their row.' },
              { label: 'Open the three-dot actions menu and choose "Retry External Sync".' },
              { label: 'The system re-attempts the sync. A success or error notification will confirm the result.' },
            ],
          },
          { type: 'tip', body: 'If self-approval is disabled in Settings, the user who created the record cannot approve it — another authorised user must do so.' },
          { type: 'tip', body: 'When a request is rejected, its rejection reason remains visible in the employee details so the requester and reviewers can understand the outcome.' },
          { type: 'warning', body: 'Suspend, Resign, and Terminate actions are only available once a record has been approved. They are disabled on PENDING records.' },
        ],
      },
      {
        id: 'central-approval',
        title: 'Using Central Approval',
        summary: 'Review the latest actionable employee, transfer, payroll, leave, and medical requests in one queue.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Central Approval combines pending work from multiple modules into one table. Records are arranged latest first. Stage approvers see requests only when the current configured stage is assigned to their user account or role; broader approvers see the requests their permissions allow them to action.' },
          {
            type: 'table',
            headers: ['Module', 'What can appear'],
            rows: [
              ['Employee', 'New employee approval, employee detail-change approval, and permitted lifecycle requests'],
              ['Employee Transfer', 'Submitted transfers awaiting the current role or user stage'],
              ['Leave', 'Supervisor, financial, or Admin HR approval according to the leave status and allowance flow'],
              ['Payroll', 'Submitted payroll runs awaiting their configured approval stage'],
              ['Medical', 'Staff, dependent, and hospital requests awaiting their configured approval stage'],
            ],
          },
          {
            type: 'steps', heading: 'Reviewing a request',
            steps: [
              { label: 'Open Central Approval from the sidebar or from an approval notification.' },
              { label: 'Use search to find an employee, module, or request. The newest actionable records are shown first.' },
              { label: 'Open the record to review its details, reasons, allowance figures, proposed changes, and approval progress where applicable.' },
              { label: 'Approve the current stage or reject with a reason. Intermediate approval notifies the next stage; rejection ends the request according to that module’s rules.' },
            ],
          },
          { type: 'tip', body: 'A configured stage assignment grants authority for that stage even when the approver does not have access to the full originating module. In that case, Central Approval provides the review panel.' },
        ],
      },
      {
        id: 'employee-transfers',
        title: 'Employee Transfers',
        summary: 'Plan and approve effective-dated assignment changes without overwriting the employee record immediately.',
        icon: Briefcase,
        content: [
          { type: 'text', body: 'Employee Transfer is the controlled workflow for changing employment fields enabled under Settings → Controls → Employee Form → Employee Transfers. A transfer snapshots the current and proposed values, follows its approval stages, and changes the employee only when it becomes effective.' },
          {
            type: 'table',
            headers: ['Status', 'Meaning'],
            rows: [
              ['Draft', 'The proposal can still be edited and has not entered approval'],
              ['Pending Approval', 'The transfer is awaiting its current configured role or user stage'],
              ['Scheduled', 'All approvals are complete; the effective date is still in the future'],
              ['Effective', 'The proposed fields have been applied to the employee and the external employee sync API has been called'],
              ['Rejected', 'An approver rejected the proposal; the employee record was not changed'],
              ['Cancelled', 'An authorised user cancelled the transfer before it became effective'],
            ],
          },
          {
            type: 'steps', heading: 'Creating and processing a transfer',
            steps: [
              { label: 'Go to Employees → Employee Transfer and click New Transfer.' },
              { label: 'Select the employee, transfer type, effective date, proposed field values, supporting-document reference, and reason.' },
              { label: 'Save the draft, then open its three-dot actions menu and choose Submit for Approval.' },
              { label: 'Configured approvers act in order. Any rejection rejects the entire transfer.' },
              { label: 'After final approval, a future-dated transfer becomes Scheduled. When due, it becomes Effective and updates the employee.' },
            ],
          },
          { type: 'text', body: 'The transfer approval setup is under Settings → Controls → Approvals. Turn on "Use Employee Approval Flow" to inherit the same stages used by new employees and employee detail changes, or turn it off to maintain a separate transfer-specific flow. The selected flow is snapshotted at submission, so changing setup does not rewrite transfers already in progress.' },
          { type: 'tip', body: 'Use the row’s three-dot actions menu to view details, edit a draft, submit, reschedule, activate when due, cancel, or download the transfer as PDF. Every employee’s full transfer history is also available from the Transfers tab in their profile.' },
          { type: 'warning', body: 'Only one Draft, Pending Approval, or Scheduled transfer can be active for an employee at a time. This prevents overlapping proposals from applying conflicting changes.' },
        ],
      },
      {
        id: 'employee-lifecycle',
        title: 'Suspending, Resigning & Terminating',
        summary: 'Record suspensions, resignations, and terminations from the employee profile.',
        icon: AlertTriangle,
        content: [
          { type: 'text', body: 'Once an employee record is approved and active, authorised users can request lifecycle actions from the More (⋯) menu in the profile header. Suspension, resignation, and termination requests enter approval; the employee moves to the appropriate deactivated view only after approval.' },
          {
            type: 'table',
            headers: ['Action', 'Who it applies to', 'Where the employee appears after approval'],
            rows: [
              ['Suspend Employee',     'Active, approved employees only',              'Suspended Employees tab'],
              ['Initiate Resignation', 'Active, approved employees only',              'Terminated Employees tab (RESIGNED)'],
              ['Terminate Employee',   'Active or suspended, approved employees only', 'Terminated Employees tab (TERMINATED)'],
            ],
          },
          {
            type: 'steps', heading: 'How to take a lifecycle action',
            steps: [
              { label: 'Open the employee\'s profile slide-over.' },
              { label: 'Click the ⋯ (More) button in the top-right of the header.' },
              { label: 'Select the action — Suspend Employee, Initiate Resignation, or Terminate Employee.' },
              { label: 'A confirmation dialog opens. Enter the reason (required for suspend and terminate). For resignations you can also set an effective date.' },
              { label: 'Confirm to submit the lifecycle request for approval.' },
              { label: 'An authorised employee approver reviews it in Central Approval or the employee details view. Approval applies the new lifecycle status; rejection restores the employee’s approved state.' },
            ],
          },
          { type: 'warning', body: 'These actions are irreversible through the UI. If an employee was suspended in error, contact your system administrator.' },
        ],
      },
      {
        id: 'deactivated-employees',
        title: 'Viewing Deactivated Employees',
        summary: 'Find suspended, terminated, and resigned employees under the Deactivated dropdown.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Active employees are shown in the main Employees list. Deactivated employees are separated into two views accessed from the "Deactivated" dropdown button next to the search bar.' },
          {
            type: 'table',
            headers: ['View', 'Who appears here'],
            rows: [
              ['Suspended Employees',  'Employees whose lifecycle status is SUSPENDED'],
              ['Terminated Employees', 'Employees whose lifecycle status is TERMINATED or RESIGNED'],
            ],
          },
          { type: 'tip', body: 'The main Employees list excludes all SUSPENDED, TERMINATED, and RESIGNED employees, so the headcount shown reflects only your current active workforce.' },
        ],
      },
      {
        id: 'employee-relations',
        title: 'Employee Relations',
        summary: 'Record skills, education, certifications, languages, dependents, and emergency contacts from the tabs at the top of the Employees page.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'The tabs across the top of the Employees page (Skills, Certifications, Languages, Dependents, Emergency Contacts) are independent lists covering your entire workforce — not limited to one profile at a time.' },
          {
            type: 'table',
            headers: ['Tab', 'What it stores', 'Key fields'],
            rows: [
              ['Skills',              'Professional competencies',          'Employee, skill, details'],
              ['Certifications',      'Formal qualifications',              'Employee, certification, issuing institute, granted date, expiry date'],
              ['Languages',           'Language proficiencies',             'Employee, language, reading / speaking / writing / understanding levels'],
              ['Dependents',          'Family members on record',           'Employee, full name, gender, relationship, date of birth, place of birth, ID number'],
              ['Emergency Contacts',  'Emergency contact persons',          'Employee, contact name, relationship, home phone, work phone, mobile'],
            ],
          },
          {
            type: 'steps', heading: 'How to add an entry',
            steps: [
              { label: 'Go to Employees and click the relevant tab (e.g. Skills).' },
              { label: 'Click "Add" or the + button.' },
              { label: 'Select the employee from the dropdown, fill in the fields, and save.' },
              { label: 'The entry appears in the list immediately. Use the edit or delete icons to modify or remove it.' },
            ],
          },
          { type: 'tip', body: 'Education history is visible inside the employee\'s profile slide-over under the Qualifications tab, alongside their skills, certifications, and languages.' },
        ],
      },
      {
        id: 'employee-photo',
        title: 'Managing Employee Photos',
        summary: 'Upload or remove a profile photo from the employee slide-over.',
        icon: UserCheck,
        content: [
          {
            type: 'steps', heading: 'Uploading a photo',
            steps: [
              { label: 'Open the employee\'s profile slide-over.' },
              { label: 'Click the ⋯ (More) menu in the header and select "Upload Photo".' },
              { label: 'Choose an image file from your device. The system resizes it automatically.' },
              { label: 'The photo appears on the profile hero card immediately.' },
            ],
          },
          { type: 'tip', body: 'To remove a photo, open the same ⋯ menu and choose "Remove Photo". This option only appears when a photo is already set.' },
        ],
      },
      {
        id: 'activity-log',
        title: 'Employee Activity Log',
        summary: 'Every action taken on an employee is recorded and viewable in their Activity tab.',
        icon: Activity,
        content: [
          { type: 'text', body: 'The Activity tab in an employee\'s profile slide-over provides a full chronological audit trail — every create, edit, approval, rejection, suspension, reinstatement, termination, and resignation action is logged with who did it and when.' },
          {
            type: 'table',
            headers: ['Event', 'Triggered by'],
            rows: [
              ['Employee Created',        'Saving a new employee record'],
              ['Profile Updated',         'Editing and saving any field'],
              ['Employee Approved',       'Clicking the Approve button'],
              ['Application Rejected',    'Clicking the Reject button (with reason)'],
              ['Suspension Requested',    'Initiating a suspension (pending approval)'],
              ['Suspension Approved',     'Admin approving a suspension request'],
              ['Termination Requested',   'Initiating a termination (pending approval)'],
              ['Termination Approved',    'Admin approving a termination request'],
              ['Resignation Submitted',   'Initiating a resignation'],
              ['Resignation Approved',    'Admin approving a resignation'],
              ['Employee Reinstated',     'Reinstating a suspended employee to active'],
              ['Action Rejected',         'Admin rejecting a lifecycle request'],
            ],
          },
          {
            type: 'steps', heading: 'Viewing the activity log',
            steps: [
              { label: 'Open the employee\'s profile slide-over.' },
              { label: 'Click the "Activity" tab.' },
              { label: 'Use the search box to filter by keyword, or the dropdown to filter by event type.' },
              { label: 'Scroll through the timeline. Each entry shows the event type, the user who triggered it, the date/time, and any relevant details such as reason or effective date.' },
            ],
          },
          { type: 'tip', body: 'The activity log is read-only. Records cannot be edited or deleted — this is intentional for audit compliance.' },
        ],
      },
      {
        id: 'disciplinary-records',
        title: 'Disciplinary Records',
        summary: 'Log and track misconduct or performance incidents against employees over time.',
        icon: ShieldAlert,
        content: [
          { type: 'text', body: 'The Disciplinary module lets HR log incidents (verbal warnings, written warnings, gross misconduct, etc.) against employees. When a record is created, the employee is automatically notified by email. Records can be queried across all employees from the Employees → Disciplinary tab.' },
          {
            type: 'table',
            headers: ['Field', 'Description'],
            rows: [
              ['Incident Date',  'The date the incident occurred'],
              ['Incident Type',  'Category: Verbal Warning, Written Warning, Final Warning, Counselling, Suspension, Gross Misconduct, Performance Issue, Policy Violation, or Dismissal'],
              ['Severity',       'Low, Medium, High, or Critical'],
              ['Description',    'Detailed account of the incident (required)'],
              ['Action Taken',   'Disciplinary action applied'],
              ['Witnesses',      'Other employees present — selected from the employee list'],
              ['Status',         'Open, Under Review, Resolved, or Appealed'],
              ['Resolution',     'Outcome notes — visible when status is not Open'],
              ['Resolved Date',  'Date the matter was closed — visible when status is Resolved'],
            ],
          },
          {
            type: 'steps', heading: 'Adding a disciplinary record',
            steps: [
              { label: 'Open the employee\'s profile slide-over and go to the "Disciplinary" tab.' },
              { label: 'Click "Add Record".' },
              { label: 'Fill in the Incident Date, Type, Severity, and Description (required fields).' },
              { label: 'Optionally add Action Taken, Witnesses, and Status.' },
              { label: 'Click "Create Record". The employee receives an email notification immediately.' },
            ],
          },
          {
            type: 'steps', heading: 'Querying records across all employees',
            steps: [
              { label: 'Go to Employees from the sidebar.' },
              { label: 'Click the "Disciplinary" tab at the top.' },
              { label: 'Use the search bar and filter dropdowns (type, severity, status, date range) to narrow results.' },
              { label: 'Click the eye icon on any row to jump to that employee\'s profile.' },
            ],
          },
          { type: 'warning', body: 'Creating a disciplinary record sends an immediate email to the employee. Make sure all details are accurate before saving.' },
          { type: 'tip', body: 'Update the Status field to "Resolved" and enter a Resolved Date when the matter is closed — this keeps your disciplinary history accurate.' },
        ],
      },
      {
        id: 'reinstate-employee',
        title: 'Reinstating a Suspended Employee',
        summary: 'Bring a suspended employee back to active status from their profile.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'A suspended employee can be reinstated directly from their profile slide-over without going through an approval workflow. The employee receives an email notification on reinstatement.' },
          {
            type: 'steps', heading: 'How to reinstate',
            steps: [
              { label: 'Go to Employees and switch to the "Suspended Employees" view from the Deactivated dropdown.' },
              { label: 'Find the employee and click the eye icon to open their profile.' },
              { label: 'Click the ⋯ (More) menu in the header.' },
              { label: 'Click "Reinstate Employee". The button is only active for approved, suspended employees.' },
              { label: 'A success notification confirms the reinstatement. The employee status changes to ACTIVE and they move back to the main employee list.' },
            ],
          },
          { type: 'tip', body: 'If the Reinstate button appears greyed out, verify that the employee\'s approval status is APPROVED and their lifecycle status is SUSPENDED.' },
          { type: 'warning', body: 'Termination and resignation cannot be reversed through the system. Reinstatement only applies to suspensions.' },
        ],
      },
    ],
  },

  // ── LEAVE ──────────────────────────────────────────────────────────────────
  {
    id: 'leave',
    title: 'Leave',
    description: 'Configure leave policies, apply for leave, and manage approvals.',
    icon: CalendarCheck,
    color: '#059669',
    accentBg: '#f0fdf4',
    articles: [
      {
        id: 'leave-overview',
        title: 'Leave Overview',
        summary: 'Understand the Leave dropdown — Manage Leave, Leave Calendar, and Personal Leave — and how the approval workflow flows.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Leave module covers everything from configuring policy rules to submitting, approving, and tracking leave across the organisation. The "Leave" sidebar item is a dropdown with three pages.' },
          {
            type: 'table',
            headers: ['Page', 'Who uses it', 'Purpose'],
            rows: [
              ['Manage Leave',   'With leave-setup permissions', 'Configure leave types, leave periods, work week, public holidays, leave groups, and leave rules (overrides per group)'],
              ['Leave Calendar', 'All staff', 'Visualise approved and pending leave across the organisation on a monthly grid'],
              ['Personal Leave', 'All staff', 'Apply for leave, view entitlements, and (for supervisors) approve team leave from the Subordinate Leave tab'],
            ],
          },
          {
            type: 'table',
            headers: ['Key concept', 'What it means'],
            rows: [
              ['Leave Type',   'A category of leave (Annual, Sick, Maternity, etc.) with defined entitlement days, carry-forward rules, and accrual settings'],
              ['Leave Period', 'The date range for which balances are calculated. Only one period can be Active at a time.'],
              ['Leave Rule',   'An override applied to a specific combination of job title, department, or pay grade — used when groups have different entitlements'],
              ['Leave Group',  'An optional way to bundle employees for rule-targeting'],
            ],
          },
          {
            type: 'table',
            headers: ['Approval step', 'Status shown', 'Who acts'],
            rows: [
              ['1. Employee submits', 'Pending Approval, Pending Financial Approval, or Pending HR Approval', 'The configured supervisor option, allowance, and financial stages determine the first required approver'],
              ['2. Supervisor approves (when enabled)', 'Pending Financial Approval or Pending HR Approval', 'The employee’s supervisor acts first only when supervisor approval is enabled and a supervisor is assigned'],
              ['3. Finance approves (when required)', 'Pending Financial Approval', 'Configured role/user stages approve the allowance in order; a financial rejection rejects the entire leave'],
              ['4. Admin HR approves', 'Approved', 'Admin HR is always the final leave approver'],
              ['5. Allowance is scheduled', 'GL Scheduled', 'An eligible cleared allowance waits for the leave start date before GL posting'],
            ],
          },
          { type: 'tip', body: 'If there is no allowance, no matching financial stage, or no financial approver configured, finance is skipped and the request goes to Admin HR. Pending approvers are notified in-app when the request reaches their stage.' },
        ],
      },
      {
        id: 'leave-types',
        title: 'Setting Up Leave Types',
        summary: 'Create leave types such as Annual Leave, Sick Leave, and Maternity Leave.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Leave types define the rules for each category of leave — entitlement days, carry-forward behaviour, allowance eligibility, and more.' },
          {
            type: 'steps', heading: 'Creating a leave type',
            steps: [
              { label: 'Go to Leave → Manage Leave and open the "Leave Types" tab.' },
              { label: 'Click "Add Leave Type".' },
              { label: 'Enter a name, the days per leave period, and choose a colour for the calendar.' },
              { label: 'Configure carry-forward: set "Leave Carried Forward" to Yes, then set the percentage, maximum days, and availability window (how long the carry-forward can be used before expiry).' },
              { label: 'Toggle "Leave Accrue Enabled" if days should be earned gradually each month/quarter rather than granted all at once.' },
              { label: 'If this leave type pays an allowance, set "Leave Allowance" to Yes.' },
              { label: 'Assign the type to one or more Leave Groups if needed, then save.' },
            ],
          },
          { type: 'tip', body: 'Use the Accrual Rate hint text in the form to verify your rate spreads correctly across the year.' },
          { type: 'warning', body: 'Changing "Leaves Per Period" on an existing type does not retroactively adjust balances already computed for the active period.' },
        ],
      },
      {
        id: 'leave-periods',
        title: 'Managing Leave Periods',
        summary: 'Create annual or custom leave periods and activate carry-forward when switching years.',
        icon: Clock,
        content: [
          { type: 'text', body: 'A leave period defines the date range for which leave entitlements are calculated. Only one period can be Active at a time.' },
          {
            type: 'steps', heading: 'Creating a new period',
            steps: [
              { label: 'Go to Leave → Manage Leave → Leave Period.' },
              { label: 'Click "Add Leave Period", enter a name (e.g. "2026 Leave Year"), set the start and end dates, then save.' },
              { label: 'When you are ready to start the new year, click the ✓ icon next to the new period to activate it.' },
              { label: 'Activation automatically runs carry-forward for all employees from the previous period into the new one, then sets the new period as Active.' },
            ],
          },
          { type: 'tip', body: 'If you need to recalculate carry-forward after making changes, use the "Recalculate Carry-Forward" button on the period row.' },
          { type: 'warning', body: 'Switching back to an older period clears any carry-forward records that were written for the period you are activating, reverting to fresh base allocations. Only do this to correct data.' },
        ],
      },
      {
        id: 'holidays',
        title: 'Configuring Public Holidays',
        summary: 'Add public holidays so they are excluded when counting leave days.',
        icon: FileText,
        content: [
          {
            type: 'steps', heading: 'Adding a holiday',
            steps: [
              { label: 'Go to Leave → Manage Leave → Holidays.' },
              { label: 'Click "Add Holiday" and enter the holiday name and date.' },
              { label: 'Set the Day Type: Full Day (not counted as a leave day) or Half Day (counts as 0.5 leave days).' },
              { label: 'Save. The holiday is immediately applied to all future leave day calculations.' },
            ],
          },
          { type: 'tip', body: 'Holidays are applied globally. If your organisation observes different holidays across regions, contact your system administrator.' },
        ],
      },
      {
        id: 'leave-rules',
        title: 'Leave Rules — Overrides Per Group',
        summary: 'Set custom entitlements for specific job titles, departments, or pay grades.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Leave Rules let you override the default leave type settings for a specific combination of criteria. For example, management may get 25 annual leave days while other staff get 20.' },
          {
            type: 'steps', heading: 'Creating a leave rule',
            steps: [
              { label: 'Go to Leave → Manage Leave → Leave Rules.' },
              { label: 'Click "Add Rule".' },
              { label: 'Select the Leave Type you want to override.' },
              { label: 'Set one or more criteria: Job Title, Department, Employment Status, Leave Group, or Years of Experience.' },
              { label: 'Set the overriding values (days per year, carry-forward settings, etc.).' },
              { label: 'Save. The rule applies immediately during the next balance calculation for matching employees.' },
            ],
          },
          { type: 'tip', body: 'Rules are evaluated from most specific to least specific. The first matching rule wins.' },
        ],
      },
      {
        id: 'apply-leave',
        title: 'Applying for Leave',
        summary: 'Submit a leave request and track it through the approval workflow.',
        icon: CheckCircle2,
        content: [
          {
            type: 'steps', heading: 'How to apply for leave',
            steps: [
              { label: 'Go to Leave → Personal Leave from the sidebar.' },
              { label: 'Click "Apply Leave" in the top-right corner.' },
              { label: 'Select the leave type, start date, and end date. The form shows a live preview of how many working days your request spans and flags any public holidays.' },
              { label: 'Add any details or notes, then click "Review →" to see the day-by-day breakdown.' },
              { label: 'Confirm to submit the leave application.' },
            ],
          },
          { type: 'tip', body: 'If a supervisor applies on your behalf, they use the "Assign Leave" button in Personal Leave → Subordinate Leave.' },
          {
            type: 'table',
            headers: ['Status', 'Meaning'],
            rows: [
              ['Draft',               'Saved but not yet submitted for approval'],
              ['Pending Approval',    'Sent to your supervisor for first-level approval'],
              ['Pending Financial Approval', 'Allowance is waiting for its configured financial approver(s)'],
              ['Pending HR Approval', 'Passed the required supervisor and financial tiers and is waiting for Admin HR sign-off'],
              ['Approved',            'Fully approved — balance has been deducted'],
              ['GL Scheduled',        'HR approved the leave and its eligible allowance is waiting for the leave start date before GL posting'],
              ['Paid',                'The approved allowance was posted successfully'],
              ['Rejected',            'Declined at one of the approval tiers'],
              ['Cancelled',           'Approved leave that was later cancelled'],
            ],
          },
        ],
      },
      {
        id: 'approve-leave',
        title: 'Approving or Rejecting Leave',
        summary: 'Review and action leave requests from your team or the approval queue.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'When supervisor approval is enabled and the employee has a supervisor, the supervisor acts first. Requests with an allowance then pass through configured financial role/user stages. If supervisor approval is off, the employee has no supervisor, there is no allowance, or no financial stage applies, unnecessary tiers are skipped. Admin HR is always the final approver. A financial rejection rejects the entire leave.' },
          {
            type: 'steps', heading: 'Approving as a supervisor',
            steps: [
              { label: 'Go to Leave → Personal Leave → Subordinate Leave.' },
              { label: 'Find the leave request with status "Pending Approval".' },
              { label: 'Open the row’s three-dot actions menu and choose View to open the details slide-over.' },
              { label: 'Click "Approve" or "Reject" in the slide-over. If rejecting, enter a reason.' },
            ],
          },
          {
            type: 'steps', heading: 'Approving as HR / admin',
            steps: [
              { label: 'Go to Central Approval from the sidebar.' },
              { label: 'Requests showing "Pending HR Approval" are awaiting your action.' },
              { label: 'Open the detail slide-over and click "Approve" or "Reject".' },
            ],
          },
          { type: 'tip', body: 'Approve/Reject only appear inside the detail slide-over — not on the table rows. Supervisors act on "Pending Approval" items; HR acts on "Pending HR Approval" items.' },
          { type: 'tip', body: 'The allowance breakdown—basic salary, gross allowance, non-taxable basic, tax, and net payout—is shown to Admin HR in the Leave Approval List details. Supervisors review the leave request without this financial breakdown.' },
          { type: 'tip', body: 'The request details/reason and any rejection reason remain visible in leave details throughout the approval history.' },
        ],
      },
      {
        id: 'leave-entitlement',
        title: 'Understanding Leave Entitlement',
        summary: 'See your allocated, used, pending, and remaining leave days per leave type.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Leave Entitlement tab shows a card for every leave type you are entitled to in the current active period.' },
          {
            type: 'table',
            headers: ['Field', 'Description'],
            rows: [
              ['Allocated',       'Total days you are entitled to for the period (including carry-forward if applicable)'],
              ['Carry-Forward',   'Days rolled over from the previous period'],
              ['Used',            'Days from approved leave'],
              ['Pending',         'Days from leave applications still awaiting approval'],
              ['Remaining',       'Allocated − Used − Pending'],
            ],
          },
          { type: 'tip', body: 'Carry-forward days expire after the window set in the leave type (e.g. 1 month, 3 months). Once expired, remaining CF days are forfeited and your balance reverts to the base allocation.' },
        ],
      },
      {
        id: 'leave-calendar',
        title: 'Using the Leave Calendar',
        summary: 'Visualise team leave across the month to spot coverage gaps.',
        icon: CalendarCheck,
        content: [
          { type: 'text', body: 'The Leave Calendar shows all approved and pending leave across your organisation on a monthly grid. Each leave type is shown in its configured colour.' },
          {
            type: 'steps', heading: 'Navigating the calendar',
            steps: [
              { label: 'Go to Leave → Leave Calendar.' },
              { label: 'Use the ← → arrows to move between months.' },
              { label: 'Click any leave block to see the employee name, leave type, and duration.' },
              { label: 'Use the filter bar to narrow down by department or leave type.' },
            ],
          },
        ],
      },
    ],
  },

  // ── COMPANY ────────────────────────────────────────────────────────────────
  {
    id: 'company',
    title: 'Company',
    description: 'Manage your org structure — departments, branches, and the organogram.',
    icon: Building2,
    color: '#7c3aed',
    accentBg: '#f5f3ff',
    articles: [
      {
        id: 'company-overview',
        title: 'Company Overview',
        summary: 'Understand what the Company module manages and how the org structure is used across the rest of the system.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Company module manages your organisation\'s structure — the building blocks that are referenced throughout the system whenever employees are grouped, filtered, or assigned to a hierarchy.' },
          {
            type: 'table',
            headers: ['What it manages', 'Where it is used'],
            rows: [
              ['Departments',         'Employee profiles, leave rules, recruitment postings, and all report filters'],
              ['Branches',            'Employee profiles — the physical or geographic location of work'],
              ['Units & Outlets',     'Sub-groupings within a department or branch, for finer organisational segmentation'],
              ['Job Titles',          'Employee profiles, leave rules, recruitment postings, and organogram nodes'],
              ['Organogram',          'Live visual hierarchy of all employees based on supervisor relationships'],
            ],
          },
          { type: 'tip', body: 'The Organogram updates automatically — as you add employees and assign supervisors on their profiles, the chart reflects those changes in real time.' },
          { type: 'warning', body: 'Deleting a department, branch, or job title that is in use by one or more employees will be blocked until those employees are reassigned.' },
        ],
      },
      {
        id: 'departments',
        title: 'Managing Departments',
        summary: 'Create, rename, and delete departments used across the system.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Departments are used throughout the system to group employees, filter reports, and apply leave rules.' },
          {
            type: 'steps', heading: 'Adding a department',
            steps: [
              { label: 'Go to Company from the sidebar.' },
              { label: 'Open the "Departments" tab.' },
              { label: 'Click "Add Department" and enter the name and any parent department (for nested structures).' },
              { label: 'Save. The department is immediately available in employee profiles and leave rules.' },
            ],
          },
          { type: 'warning', body: 'Deleting a department that has employees assigned will block the deletion. Reassign employees first.' },
        ],
      },
      {
        id: 'organogram',
        title: 'Viewing the Organogram',
        summary: 'See a live visual tree of your organisation\'s hierarchy.',
        icon: Building2,
        content: [
          { type: 'text', body: 'The Organogram page renders a live org chart based on each employee\'s supervisor relationship. It updates automatically as you add or edit employees.' },
          {
            type: 'steps', heading: 'Using the organogram',
            steps: [
              { label: 'Go to Company → Organogram from the sidebar.' },
              { label: 'The chart starts from the top-most employees (those with no supervisor).' },
              { label: 'Click any node to expand or collapse that branch.' },
              { label: 'Use the search bar to jump to a specific employee.' },
            ],
          },
          { type: 'tip', body: 'Supervisors are assigned on each employee\'s record under the "Employment" section.' },
        ],
      },
    ],
  },

  // ── PAYROLL ────────────────────────────────────────────────────────────────
  {
    id: 'payroll',
    title: 'Payroll',
    description: 'Run payroll, manage salary components, and issue payslips.',
    icon: Banknote,
    color: '#d97706',
    accentBg: '#fffbeb',
    articles: [
      {
        id: 'payroll-overview',
        title: 'Payroll Overview',
        summary: 'Understand the full pay cycle — from configuring salary components through running, approving, and generating payslips.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Payroll module covers the complete employee pay cycle. It is split across two sidebar items — Salary (setup and configuration) and Payroll (running and approving pay runs).' },
          {
            type: 'table',
            headers: ['Area', 'What it covers'],
            rows: [
              ['Salary → Components', 'Define earnings and deductions (allowances, PAYE, pension, etc.) that appear on every payslip'],
              ['Salary → Pay Grades & Notches', 'Set salary bands and the pay point (notch); the notch amount is the employee\'s basic pay'],
              ['Salary → Component Assignment', 'Assign components to a paygrade or notch — every employee on it automatically inherits them'],
              ['Salary → Exceptions', 'Per-employee overrides — change an amount, exclude a component, or add an extra one'],
              ['Payroll → Payroll Runs', 'Create, review, and submit payroll batches; also Payroll Employees, Payroll Columns, Deduction Groups, Calculation Rules, and Report Templates tabs'],
              ['Payslips', 'Generated automatically when a run is approved — open the run to download per-employee, or employees download their own under User Reports → My Payslips'],
            ],
          },
          {
            type: 'table',
            headers: ['Run status', 'Meaning'],
            rows: [
              ['Draft',              'Being prepared — figures can still be adjusted'],
              ['Pending Approval',   'Submitted for review — locked until approved or rejected'],
              ['Approved',           'Finalised — payslips are generated and available for download'],
              ['Rejected',           'Sent back to the preparer with a reason; can be corrected and resubmitted'],
            ],
          },
          {
            type: 'table',
            headers: ['Who uses it', 'What they do'],
            rows: [
              ['With payroll permissions',  'Configure components, run payroll, generate payslips — gated by the salary/payroll permissions assigned (e.g. process_payroll, manage_payroll_columns).'],
              ['With Approve Payroll',      'Review and authorise submitted runs — only users granted the approve_payroll permission see the approve/reject actions.'],
              ['All employees',        'Download their own payslips under User Reports → My Payslips'],
            ],
          },
          { type: 'warning', body: 'Every active employee must have a pay grade and a bank account on their record before payroll can be processed. Missing either will block payslip generation for that employee.' },
        ],
      },
      {
        id: 'salary-components',
        title: 'Setting Up Salary Components',
        summary: 'Configure allowances, deductions, and PAYE tax to build employee pay structures.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Salary components are the building blocks of payroll. Each component is either an Earning (adds to gross) or a Deduction (reduces net pay).' },
          {
            type: 'steps', heading: 'Creating a salary component',
            steps: [
              { label: 'Go to Salary from the sidebar.' },
              { label: 'Open the "Components" tab and click "Add Component".' },
              { label: 'Enter the name, type (Earning or Deduction), and whether it is taxable.' },
              { label: 'Save. The component can then be assigned to a paygrade or notch in the Component Assignment tab.' },
            ],
          },
          { type: 'tip', body: 'One component can be marked "Grade-Linked" (Basic Salary). It automatically receives each employee\'s notch amount as their basic pay — you never assign it manually.' },
          { type: 'tip', body: 'Taxable earnings are included in the PAYE calculation. Non-taxable earnings (e.g. transport allowance up to a threshold) are excluded.' },
        ],
      },
      {
        id: 'component-assignment',
        title: 'Assigning Components (Paygrades, Notches & Exceptions)',
        summary: 'Assign components at the paygrade or notch level; employees inherit them automatically, with per-employee exceptions.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Components are no longer attached to employees one by one. Instead you assign them to a paygrade or a notch, and every employee on that paygrade/notch inherits them automatically. This keeps pay structures consistent and easy to maintain.' },
          {
            type: 'steps', heading: 'Assigning a component to a paygrade or notch',
            steps: [
              { label: 'Go to Salary → Component Assignment.' },
              { label: 'Choose the target type — Paygrade or Notch — then pick the specific paygrade/notch.' },
              { label: 'Click "Assign Component", select the component, and enter the amount (and working days if used).' },
              { label: 'Save. Every employee on that paygrade/notch now inherits this component.' },
            ],
          },
          {
            type: 'table',
            headers: ['Rule', 'How it works'],
            rows: [
              ['Inheritance',   'An employee gets the union of their paygrade\'s components and their notch\'s components'],
              ['Notch wins',    'If the same component is set on both the paygrade and the notch, the notch\'s amount applies'],
              ['Basic pay',     'Comes from the notch amount via the Grade-Linked component — you do not assign it here'],
            ],
          },
          {
            type: 'steps', heading: 'Per-employee exceptions',
            steps: [
              { label: 'Go to Salary → Exceptions and choose the employee(s) and the component.' },
              { label: 'Override the amount (a different value for this employee only), or…' },
              { label: 'Tick "Exclude this component" to remove an inherited component for that employee, or…' },
              { label: 'Add a component the employee\'s grade/notch does not include.' },
            ],
          },
          { type: 'tip', body: 'Exceptions always win over inherited paygrade/notch values. Use them sparingly — for genuine one-off deviations.' },
        ],
      },
      {
        id: 'notch-setup',
        title: 'Pay Grades and Notches',
        summary: 'Understand how pay grades and notch levels determine an employee\'s salary.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'A Pay Grade groups employees at a similar level. Within each grade, Notches represent salary steps — an employee moves up a notch over time or through promotion.' },
          {
            type: 'table',
            headers: ['Concept', 'Description'],
            rows: [
              ['Pay Grade',  'Broad salary band (e.g. Grade 7, Manager Level)'],
              ['Notch',      'A specific salary point within a grade (e.g. Notch 3 = $2,500/month)'],
              ['Movement',   'Automated or manual step from one notch to the next'],
            ],
          },
          {
            type: 'steps', heading: 'Assigning a notch to an employee',
            steps: [
              { label: 'Edit the employee and open the "Financial" section.' },
              { label: 'Select the correct Pay Grade and Notch.' },
              { label: 'Save. The selected notch\'s basic salary is used in the next payroll run.' },
            ],
          },
        ],
      },
      {
        id: 'run-payroll',
        title: 'Running Payroll',
        summary: 'Process a payroll batch for all active employees in a pay period.',
        icon: CheckCircle2,
        content: [
          {
            type: 'steps', heading: 'How to run payroll',
            steps: [
              { label: 'Go to Payroll from the sidebar.' },
              { label: 'Click "New Payroll Run" and select the pay period (e.g. May 2026).' },
              { label: 'The system calculates gross pay, all components, tax, and net pay for every active employee.' },
              { label: 'Review the payroll summary. Use the search and filters to check individual employee lines.' },
              { label: 'Click "Submit for Approval" when satisfied. A payroll approver will review and authorise the run.' },
            ],
          },
          { type: 'warning', body: 'Ensure all employee pay grades and bank accounts are up to date before running payroll. Missing bank accounts will block the payslip payment.' },
          { type: 'tip', body: 'You can re-open and edit a payroll run that is still in Draft status. Once submitted for approval it is locked.' },
        ],
      },
      {
        id: 'approve-payroll',
        title: 'Approving Payroll',
        summary: 'Review and authorise a submitted payroll run before it is finalised.',
        icon: CheckCircle2,
        content: [
          {
            type: 'steps', heading: 'Approving a payroll run',
            steps: [
              { label: 'Go to Central Approval from the sidebar, or go directly to Payroll.' },
              { label: 'Find the payroll run with status "Pending Approval".' },
              { label: 'Review the figures. Open individual payslips from the detail panel if needed.' },
              { label: 'Click "Approve" to finalise. Payslips are generated and the run is locked.' },
              { label: 'Click "Reject" (with a reason) to send the run back to the preparer.' },
            ],
          },
          { type: 'tip', body: 'You need the "Approve Payroll" permission to see the approve/reject actions.' },
        ],
      },
      {
        id: 'payslips',
        title: 'Viewing and Downloading Payslips',
        summary: 'Access individual payslips for any approved payroll run.',
        icon: FileText,
        content: [
          {
            type: 'steps', heading: 'Accessing payslips',
            steps: [
              { label: 'Go to Payroll and open the approved payroll run.' },
              { label: 'Find the employee row and click the payslip icon.' },
              { label: 'The payslip opens as a formatted document.' },
              { label: 'Click "Download PDF" to save a copy.' },
            ],
          },
          { type: 'tip', body: 'Employees can view their own payslips under User Reports → My Payslips without needing any special permission.' },
        ],
      },
    ],
  },

  // ── MEDICAL ────────────────────────────────────────────────────────────────
  {
    id: 'medical',
    title: 'Medical',
    description: 'Submit and manage medical claims for staff and their dependents.',
    icon: Stethoscope,
    color: '#dc2626',
    accentBg: '#fef2f2',
    articles: [
      {
        id: 'medical-overview',
        title: 'Medical Overview',
        summary: 'Understand how medical claims work — from annual plan limits set by pay grade through employee submission and admin approval.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Medical module lets employees submit healthcare expense claims against an annual allowance. The allowance is determined by the employee\'s pay grade through a Medical Plan configured by HR. The module is split into two areas.' },
          {
            type: 'table',
            headers: ['Area', 'Who uses it', 'Purpose'],
            rows: [
              ['Personal Medical', 'All employees', 'Submit and track your own and dependent medical claims (My Medicals, Dependent Medical Request) and check your balance (My Medical Enquiry)'],
              ['Manage Medical',   'With medical permissions', 'Review/approve claims (Staff Medical, Dependent Medical), set per-grade limits (Medical Limits Setup), manage Registered Hospitals, and start a new medical year to reset utilization (Staff Medical Enquiry)'],
            ],
          },
          {
            type: 'table',
            headers: ['Key concept', 'What it means'],
            rows: [
              ['Medical Plan',       'A benefit configuration assigned to a pay grade — defines the annual staff and dependent claim limits'],
              ['Staff claim',        'An expense claim submitted by an employee for their own healthcare costs'],
              ['Dependent claim',    'A claim submitted on behalf of a registered dependent (spouse, child, etc.)'],
              ['Annual limit',       'The maximum claimable amount for the year; tracked separately for staff and dependents'],
            ],
          },
          {
            type: 'table',
            headers: ['Claim status', 'Meaning'],
            rows: [
              ['Pending',  'Submitted and awaiting HR review'],
              ['Approved', 'Accepted — amount is deducted from the employee\'s annual balance'],
              ['Rejected', 'Declined with a reason — does not affect the balance'],
            ],
          },
          { type: 'tip', body: 'Before submitting claims for dependents, register them on your employee profile under Relations → Dependents. Unregistered dependents cannot be selected on a claim.' },
          { type: 'warning', body: 'Always attach a receipt or invoice when submitting a claim. Claims without a supporting document are typically rejected.' },
        ],
      },
      {
        id: 'submit-medical',
        title: 'Submitting a Medical Claim',
        summary: 'Log a medical expense for yourself or a registered dependent.',
        icon: FileText,
        content: [
          {
            type: 'steps', heading: 'How to submit a claim',
            steps: [
              { label: 'Go to Medical → Personal Medical from the sidebar.' },
              { label: 'For your own expense use the "My Medicals" tab; for a dependent use the "Dependent Medical Request" tab.' },
              { label: 'Click Add, then (for a dependent) select the registered dependent.' },
              { label: 'Enter the date of service, description, and amount.' },
              { label: 'Upload the receipt or invoice (PDF or image).' },
              { label: 'Save as Draft, then click Submit to send it for approval.' },
            ],
          },
          { type: 'tip', body: 'Register dependents on your employee profile under Relations → Dependents before submitting claims on their behalf.' },
          { type: 'warning', body: 'Claims without a supporting document may be rejected. Always upload proof of payment.' },
        ],
      },
      {
        id: 'medical-plans',
        title: 'Medical Plans and Limits',
        summary: 'Understand how annual medical limits are configured per pay grade.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Each pay grade can be assigned a medical plan that defines the maximum amount claimable per year for staff and dependents.' },
          {
            type: 'table',
            headers: ['Setting', 'Description'],
            rows: [
              ['Annual Staff Limit',    'Maximum medical claim amount for the employee per year'],
              ['Annual Dependent Limit','Maximum for all dependents combined per year'],
              ['Carry-Over',           'Whether unused allowance rolls into the next year'],
            ],
          },
          { type: 'tip', body: 'To view your current balance, go to Personal Medical → My Medical Enquiry. It shows how much you have used and how much remains.' },
        ],
      },
      {
        id: 'admin-medical',
        title: 'Admin: Reviewing Medical Claims',
        summary: 'Review, approve, or reject staff and dependent medical claims.',
        icon: CheckCircle2,
        content: [
          {
            type: 'steps', heading: 'Reviewing claims as an admin',
            steps: [
              { label: 'Go to Medical → Manage Medical from the sidebar.' },
              { label: 'The "Staff Medical" tab shows all submitted employee claims.' },
              { label: 'Open a claim’s three-dot actions menu and choose View to see the amount, date, description, and supporting document.' },
              { label: 'Click "Approve" to accept the claim, or "Reject" with a reason to decline it.' },
              { label: 'Approved claims reduce the employee\'s remaining annual medical balance.' },
            ],
          },
          { type: 'tip', body: 'Use the "Dependent Medical" tab to view and action claims submitted for employee family members, and "Staff Medical Enquiry" to look up any employee\'s balance.' },
        ],
      },
      {
        id: 'medical-year-reset',
        title: 'Starting a New Medical Year',
        summary: 'Reset every employee\'s medical utilization back to zero at year-end while keeping a snapshot of the closing year.',
        icon: Clock,
        content: [
          { type: 'text', body: 'Medical utilization is the total of an employee\'s approved claims counted against their annual limit. At the end of the medical year, HR can reset everyone\'s utilization back to zero so the new year starts fresh — without deleting any records.' },
          { type: 'text', body: 'This is non-destructive: all past claims, costs, and accounting (GL) postings stay exactly as they are. The reset simply sets a cut-off point so that, going forward, only claims approved on or after that point count toward the new year\'s balance. Per-grade medical limits are not changed.' },
          {
            type: 'steps', heading: 'How to start a new medical year',
            steps: [
              { label: 'Go to Medical → Manage Medical → Staff Medical Enquiry.' },
              { label: 'Click "Start New Medical Year" (top-right of the table).' },
              { label: 'Confirm the closing year label (e.g. 2025) — this names the snapshot that is saved.' },
              { label: 'Click Reset Utilization. Every active employee\'s balance returns to zero for the new year.' },
            ],
          },
          {
            type: 'table',
            headers: ['What happens', 'Detail'],
            rows: [
              ['Closing snapshot saved', 'Each employee\'s final staff/dependent/total utilization and balance for the year is stored and can be reviewed later via the History button'],
              ['Utilization reset',      'Everyone\'s used amount returns to 0; the new year accumulates from the next approved claim'],
              ['Records preserved',      'No claims, costs, or GL postings are deleted — only the counting start point moves'],
              ['Limits unchanged',       'Per-grade annual medical limits stay the same'],
            ],
          },
          { type: 'tip', body: 'Use the "History" button on the Staff Medical Enquiry tab to view past closing snapshots, filtered by year.' },
          { type: 'warning', body: 'This action affects all employees and requires the "Reset Medical Utilization" permission. A medical year that has already been closed cannot be closed again with the same label.' },
        ],
      },
    ],
  },

  // ── USERS ──────────────────────────────────────────────────────────────────
  {
    id: 'users',
    title: 'Users',
    description: 'Create system accounts, assign roles, and control what each user can see and do.',
    icon: UserCog,
    color: '#7c3aed',
    accentBg: '#f5f3ff',
    articles: [
      {
        id: 'users-overview',
        title: 'Users vs Employees',
        summary: 'Understand the difference between an employee record and a system user account.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'An employee record holds HR data (personal info, salary, leave, etc.). A user account is a login credential that grants access to the system. The two are separate but can be linked: when you create a user and link it to an employee record, that person can log in and see their own profile, apply for leave, and access reports.' },
          {
            type: 'table',
            headers: ['Concept', 'What it is'],
            rows: [
              ['Employee',   'An HR record — stores personal, employment, and financial data. Does not grant system access by itself.'],
              ['User',       'A system login — email + password + role. Can be linked to an employee record.'],
              ['Role',       'A set of permissions that determines what tabs and actions the user can see.'],
              ['Linked user','A user whose account is connected to an employee record — they can view their own Personal Info page.'],
            ],
          },
          { type: 'tip', body: 'An employee can exist without a user account (e.g., a legacy record). A user can exist without an employee record (e.g., a system administrator).' },
        ],
      },
      {
        id: 'create-user',
        title: 'Creating a User Account',
        summary: 'Add a new login account and link it to an employee if applicable.',
        icon: FileText,
        content: [
          {
            type: 'steps', heading: 'How to create a user',
            steps: [
              { label: 'Go to Users from the sidebar.' },
              { label: 'Click "Add User".' },
              { label: 'Enter the user\'s name, email address, and a temporary password.' },
              { label: 'Select a Role from the dropdown to define their access level.' },
              { label: 'Optionally link the account to an employee record using the employee search field. This gives the user access to their Personal Info page.' },
              { label: 'Click Save. The user can now log in with the email and password you set.' },
            ],
          },
          { type: 'warning', body: 'Passwords set during user creation are temporary. Ask the user to change their password on first login.' },
          { type: 'tip', body: 'If you link a user to an employee record, they will see their own profile data, leave history, and pay information under "Personal Info" in the sidebar.' },
        ],
      },
      {
        id: 'roles-permissions',
        title: 'Roles & Permissions',
        summary: 'Control which modules and actions each user can access using roles.',
        icon: KeyRound,
        content: [
          { type: 'text', body: 'Every user is assigned a role. The role determines which sidebar items are visible and which actions the user can perform. Roles are created and edited on the Users page under the "Roles" tab — managing roles requires the "manage_roles" permission.' },
          { type: 'text', body: 'Permissions work in two tiers. A "view" permission (e.g. view_employees, view_payroll) lets a user open a page and see its data, but with no action buttons. Separate action permissions (create, edit, delete, approve, or a manage_ permission) each unlock a specific button and the matching API action. So a user with only view_payroll sees payroll read-only; add approve_payroll and the Approve button appears.' },
          { type: 'tip', body: 'Hover over any permission in the role or user permission selector to see a tooltip explaining exactly what that permission allows.' },
          { type: 'text', body: 'Roles are fully customisable — there are no fixed access levels. Each role is just a bundle of permissions you choose. The examples below are common setups, but you can create any role with any combination of permissions.' },
          {
            type: 'table',
            headers: ['Example role', 'A typical permission bundle'],
            rows: [
              ['Super admin',  'Every permission — sees and does everything.'],
              ['HR manager',   'Employee, leave, payroll, and report permissions; typically not user/role administration.'],
              ['Supervisor',   'Mostly self-service. Approving their team\'s leave needs no special permission — it comes from being set as an employee\'s supervisor.'],
              ['Employee',     'No management permissions — only Personal Info, applying for leave, and submitting medical claims, which are open to every signed-in user.'],
            ],
          },
          {
            type: 'steps', heading: 'Creating or editing a role',
            steps: [
              { label: 'Go to Users from the sidebar and open the "Roles" tab.' },
              { label: 'Click "Add Role", or open an existing role’s three-dot actions menu and choose Edit.' },
              { label: 'Tick the permissions to grant, grouped by module (view permissions control page visibility; action permissions unlock buttons).' },
              { label: 'Save. Changes take effect on the next page load for affected users.' },
            ],
          },
          { type: 'tip', body: 'Use the view icon on a role to see exactly which permissions it grants. Instead of deleting a role, you can deactivate it — deactivated roles strip their permissions from assigned users until reactivated.' },
          { type: 'warning', body: 'Removing a permission from a role affects all users who hold that role simultaneously. Review affected users before saving.' },
        ],
      },
      {
        id: 'approval-setup',
        title: 'Configuring Approval Flows',
        summary: 'Set ordered role or user approval stages from Settings → Controls → Approvals.',
        icon: ShieldAlert,
        content: [
          { type: 'text', body: 'Users with settings access configure workflow behaviour under Settings → Controls → Approvals. Stages run from top to bottom and may target an entire role or one specific user. Requests snapshot their stages when submitted, so later configuration changes affect new requests without rewriting approvals already in progress.' },
          {
            type: 'table',
            headers: ['Workflow', 'Configuration behaviour'],
            rows: [
              ['Employee Approval', 'One shared stage chain controls both new employee approval and employee detail-change approval'],
              ['Employee Transfer Approval', 'Use a transfer-specific chain, or enable "Use Employee Approval Flow" to inherit the employee stages'],
              ['Payroll Approval', 'Submitted payroll runs pass through the configured ordered stages before finalisation'],
              ['Medical Approval', 'Staff, dependent, and hospital requests follow the configured medical stages'],
              ['Leave Approval', 'Optional supervisor approval is followed by applicable financial stages, then mandatory final Admin HR approval'],
              ['Training Approval', 'Choose direct HR routing or supervisor-first routing according to the training setup'],
            ],
          },
          { type: 'tip', body: 'With no stages configured, the workflow falls back to its existing approval permission. For employee transfers, an inherited Employee Approval Flow with no stages falls back to Approve Employee Transfers permission.' },
          { type: 'warning', body: 'Before assigning a role or specific user to a stage, confirm at least one active user can receive and action it. Self-approval controls still apply where provided.' },
        ],
      },
      {
        id: 'edit-user',
        title: 'Editing and Deactivating Users',
        summary: 'Update user details, reset passwords, or deactivate accounts that are no longer needed.',
        icon: UserCheck,
        content: [
          {
            type: 'steps', heading: 'Editing a user',
            steps: [
              { label: 'Go to Users from the sidebar.' },
              { label: 'Find the user, open the three-dot actions menu, and choose Edit.' },
              { label: 'Update their name, email, role, or linked employee record.' },
              { label: 'To reset their password, enter a new value in the Password field and save.' },
              { label: 'Click Save to apply changes.' },
            ],
          },
          { type: 'tip', body: 'Changing a user\'s role takes effect immediately — they will see updated navigation on their next page load.' },
          { type: 'warning', body: 'Deactivating a user prevents login but retains their history and any approvals they made — data is preserved.' },
        ],
      },
    ],
  },

  // ── RECRUITMENT ────────────────────────────────────────────────────────────
  {
    id: 'recruitment',
    title: 'Recruitment',
    description: 'Manage job postings, candidates, applications, and interviews through the full hiring pipeline.',
    icon: Briefcase,
    color: '#0d9488',
    accentBg: '#f0fdfa',
    articles: [
      {
        id: 'recruitment-overview',
        title: 'Recruitment Overview',
        summary: 'Understand the four tabs — Jobs, Candidates, Applications, and Interviews — and how they connect.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Recruitment module covers the full hiring lifecycle: publishing job postings, collecting and tracking candidates, reviewing applications, and conducting interviews through configurable pipeline stages.' },
          {
            type: 'table',
            headers: ['Tab', 'What it manages'],
            rows: [
              ['Jobs',         'Create and manage job postings — details, salary range, status, and closing date'],
              ['Candidates',   'Add and track candidates; move them through the hiring pipeline'],
              ['Applications', 'View applications linked to candidates — cover letter and CV'],
              ['Interviews',   'Schedule, track, and record outcomes for candidate interviews'],
            ],
          },
          { type: 'tip', body: 'Pipeline stages (Short Listed → Phone Screen → Assessment → Interview → Hired) are shared across all candidates. Changing a candidate\'s stage sends them an automatic email notification.' },
        ],
      },
      {
        id: 'job-postings',
        title: 'Creating and Managing Job Postings',
        summary: 'Create, edit, duplicate, and close job postings with full details.',
        icon: FileText,
        content: [
          {
            type: 'steps', heading: 'Creating a job posting',
            steps: [
              { label: 'Go to Recruitment → Jobs.' },
              { label: 'Click "Add Job" in the top-right corner.' },
              { label: 'Fill in the title, job code, department, employment type, experience level, job function, and education level.' },
              { label: 'Select a hiring manager from the active employee list.' },
              { label: 'Set the salary range (minimum and maximum) and currency. Toggle "Show Salary" if you want it visible to applicants.' },
              { label: 'Add keywords, a description, requirements, and benefits.' },
              { label: 'Set the status: Active (accepting applications), On Hold, or Closed.' },
              { label: 'Set a closing date and save.' },
            ],
          },
          {
            type: 'table',
            headers: ['Action', 'How'],
            rows: [
              ['Edit',      'Click the pencil icon on the job row'],
              ['Delete',    'Click the bin icon — only possible if no candidates are linked'],
              ['Duplicate', 'Click the copy icon — creates a copy with status "On Hold" and a "(Copy)" suffix'],
              ['View',      'Click the eye icon to see the full job details and candidate count'],
            ],
          },
          { type: 'tip', body: 'Set a job to "Closed" rather than deleting it. That preserves all linked candidates and application history.' },
        ],
      },
      {
        id: 'candidates',
        title: 'Adding and Managing Candidates',
        summary: 'Manually add candidates, edit their profiles, and track their progress.',
        icon: Users,
        content: [
          {
            type: 'steps', heading: 'Adding a candidate manually',
            steps: [
              { label: 'Go to Recruitment → Candidates and click "Add Candidate".' },
              { label: 'Enter first name, last name, email, phone, and personal details (gender, date of birth, address).' },
              { label: 'Set the CV title, years/months of experience, and expected salary.' },
              { label: 'Choose a source (Sourced or Applied) and optionally link to a job posting.' },
              { label: 'Add any notes and upload their CV file if available.' },
              { label: 'Save. The candidate appears in the list immediately.' },
            ],
          },
          { type: 'tip', body: 'Candidates who apply through the public job portal are added automatically with source "Applied" and their cover letter stored as notes.' },
          {
            type: 'steps', heading: 'Viewing a candidate profile',
            steps: [
              { label: 'Click the eye icon on any candidate row.' },
              { label: 'The slide-over shows the candidate\'s profile, pipeline stage pills, and four tabs: Profile, Applications, Interviews, and Notes.' },
              { label: 'Click "View CV" in the header to open the candidate\'s CV in a full-screen modal.' },
              { label: 'Click any pipeline stage pill to move the candidate to that stage. Each move sends an email notification to the candidate.' },
            ],
          },
          { type: 'warning', body: 'Moving a candidate\'s pipeline stage always sends an email notification. Use stage changes intentionally.' },
        ],
      },
      {
        id: 'pipeline-stages',
        title: 'Using Pipeline Stages',
        summary: 'Move candidates through predefined hiring stages from Short Listed to Hired.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Pipeline stages track where each candidate is in the hiring process. The default stages are: Short Listed, Phone Screen, Assessment, Interview, Hired, Rejected, and Archived.' },
          {
            type: 'table',
            headers: ['Stage', 'Meaning'],
            rows: [
              ['Short Listed',  'Candidate has been selected for further review'],
              ['Phone Screen',  'Initial screening call scheduled or completed'],
              ['Assessment',    'Candidate is completing a skill or aptitude assessment'],
              ['Interview',     'Formal interview round in progress'],
              ['Hired',         'Candidate has accepted — ready to convert to an employee record'],
              ['Rejected',      'Candidate was not selected at some stage'],
              ['Archived',      'Application put on hold for future consideration'],
            ],
          },
          { type: 'tip', body: 'You can move a candidate\'s stage from their profile slide-over (Candidates tab) or directly from the Interview Details slide-over in the Interviews tab. Both trigger the stage-change email.' },
          { type: 'warning', body: 'Once a candidate reaches the Hired stage, pipeline stage pills are locked and no further moves can be made from either the candidate profile or interview details.' },
        ],
      },
      {
        id: 'applications-tab',
        title: 'Reviewing Applications',
        summary: 'View an applicant\'s cover letter and CV from the Applications tab.',
        icon: FileText,
        content: [
          { type: 'text', body: 'The Applications tab lists every job application on file — linking a candidate to the job they applied for. Applications are created automatically when a candidate is linked to a job (manually or via the public portal).' },
          {
            type: 'steps', heading: 'Viewing an application',
            steps: [
              { label: 'Go to Recruitment → Applications.' },
              { label: 'Find the application row. The Cover Letter column shows a preview of the applicant\'s message.' },
              { label: 'Click the eye icon to open the Application Details modal.' },
              { label: 'The modal shows the candidate name, job title, full cover letter text, and an inline CV preview.' },
              { label: 'Click "Open Full Screen" above the CV to view it in a full-screen modal.' },
            ],
          },
          { type: 'tip', body: 'If no CV is on file, the CV section shows "No CV on file." Ask the candidate to send their CV so it can be uploaded to their candidate profile.' },
        ],
      },
      {
        id: 'scheduling-interviews',
        title: 'Scheduling Interviews',
        summary: 'Schedule one or multiple interviews at once, with optional self-scheduling slots.',
        icon: CalendarCheck,
        content: [
          {
            type: 'steps', heading: 'Scheduling an interview',
            steps: [
              { label: 'Go to Recruitment → Interviews and click "Schedule Interview".' },
              { label: 'Select a job posting first. The candidate list is then filtered to show only candidates who applied for that job and do not yet have an interview.' },
              { label: 'Select one or more candidates. Selecting multiple creates a separate interview record for each.' },
              { label: 'Set the interview round/level (e.g. "Round 1"), status, date, start time, and end time.' },
              { label: 'Add a location or video link and select interviewers from the active employee list.' },
              { label: 'Optionally add available time slots under "Available Slots for Self-Scheduling" if you want the candidate to choose their own time.' },
              { label: 'Click Save.' },
            ],
          },
          { type: 'tip', body: 'The interview list on the Interviews tab groups records by candidate. Click the candidate row header to collapse or expand their interview history.' },
        ],
      },
      {
        id: 'self-scheduling',
        title: 'Self-Scheduling: Letting Candidates Choose a Slot',
        summary: 'Add available time slots and send the candidate a link to pick their preferred time.',
        icon: Clock,
        content: [
          { type: 'text', body: 'If you have not fixed an interview time yet, you can offer the candidate a set of available slots and let them choose. Once they confirm, a calendar invite is sent automatically to all parties.' },
          {
            type: 'steps', heading: 'Setting up self-scheduling',
            steps: [
              { label: 'When creating or editing an interview, scroll to "Available Slots for Self-Scheduling".' },
              { label: 'Click "Add Slot" for each available time. Each slot has a date, start time, and end time.' },
              { label: 'Save the interview.' },
              { label: 'Open the interview details (eye icon) and click "Send Scheduling Link" in the footer.' },
              { label: 'The candidate receives an email with a link listing the available slots. They click to confirm their preferred time.' },
              { label: 'Once the candidate confirms, a calendar invite (.ics) is automatically emailed to the candidate, the hiring manager, and all interviewers.' },
            ],
          },
          { type: 'warning', body: '"Send Scheduling Link" only appears when slots have been added and the candidate has not yet confirmed a time. Once they pick a slot the button is replaced by "Send Interview Invite".' },
        ],
      },
      {
        id: 'interview-invite',
        title: 'Sending an Interview Invite',
        summary: 'Email the confirmed interview date and a calendar invite to all parties.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'When an interview date is set directly (not via self-scheduling), use "Send Interview Invite" to notify everyone. This sends an email with the interview details and a downloadable calendar (.ics) attachment to the candidate, the hiring manager, and all listed interviewers.' },
          {
            type: 'steps', heading: 'Sending the invite',
            steps: [
              { label: 'Set the interview date and time (either directly on the interview form, or via self-scheduling confirmation).' },
              { label: 'Open the interview details by clicking the eye icon on the interview row.' },
              { label: 'Click "Send Interview Invite" in the footer.' },
              { label: 'All parties receive an email with the date, time, location, and a calendar (.ics) file.' },
            ],
          },
          { type: 'tip', body: 'For interviewers to receive the invite, their name must be selected in the Interviewers field on the interview form and their employee profile must have a work email address.' },
          { type: 'warning', body: 'Both "Send Scheduling Link" and "Send Interview Invite" send emails immediately. The amber mail note in the footer tells you who will receive the email before you click.' },
        ],
      },
      {
        id: 'interview-outcome',
        title: 'Recording an Interview Outcome',
        summary: 'Mark an interview as completed, record the outcome and feedback, and advance the candidate.',
        icon: CheckCircle2,
        content: [
          {
            type: 'steps', heading: 'Recording the outcome',
            steps: [
              { label: 'Open the interview details by clicking the eye icon.' },
              { label: 'Scroll to "Record Outcome".' },
              { label: 'Set the Interview Status: Completed, Cancelled, or No Show.' },
              { label: 'If Completed, select the Outcome: Passed, Failed, or Pending Decision.' },
              { label: 'Add feedback or notes in the text area.' },
              { label: 'Click "Save Outcome".' },
            ],
          },
          { type: 'text', body: 'After saving, a "What\'s next?" panel appears with contextual actions based on the outcome:' },
          {
            type: 'table',
            headers: ['Outcome', 'Available actions'],
            rows: [
              ['Passed',          'Move to next pipeline stage, or Schedule Next Round'],
              ['Failed / No Show','Mark as Rejected (moves the candidate to the Rejected stage)'],
              ['Pending Decision','No immediate action — revisit when the decision is made'],
              ['Cancelled',       'Edit the interview to reschedule or send a new scheduling link'],
            ],
          },
          { type: 'tip', body: 'Clicking "Move to [Stage]" or "Mark as Rejected" sends a pipeline stage notification email to the candidate.' },
          { type: 'warning', body: 'Once the candidate\'s pipeline stage is set to Hired, the Record Outcome section is locked and no further changes can be made from the interview details.' },
        ],
      },
      {
        id: 'convert-to-employee',
        title: 'Converting a Hired Candidate to an Employee',
        summary: 'Create a draft employee record from a candidate once they reach the Hired stage.',
        icon: UserCheck,
        content: [
          { type: 'text', body: 'When a candidate is moved to the Hired stage, their profile shows a "Convert to Employee" button. Clicking it creates a draft employee record pre-filled with the candidate\'s name and email, ready for HR to complete and approve.' },
          {
            type: 'steps', heading: 'Converting a candidate',
            steps: [
              { label: 'Move the candidate to the Hired pipeline stage (from their profile or the interview details).' },
              { label: 'Open the candidate profile (eye icon from the Candidates tab).' },
              { label: 'Click "Convert to Employee" in the footer.' },
              { label: 'A draft employee record is created with status PENDING.' },
              { label: 'Go to Employees and locate the new PENDING record.' },
              { label: 'Fill in all required fields: hire date, department, job title, gender, date of birth, work email, and employment status.' },
              { label: 'Click "Approve" to activate the employee.' },
            ],
          },
          { type: 'warning', body: 'If the candidate\'s email address already exists in the employee table, the conversion is blocked and an error is shown. This prevents duplicate employee records.' },
          { type: 'tip', body: 'Once converted, the candidate profile footer shows "Employee record created" instead of the button, and the same message appears in the interview details "What\'s next?" panel.' },
        ],
      },
    ],
  },

  // ── PERFORMANCE ────────────────────────────────────────────────────────────
  {
    id: 'performance',
    title: 'Performance',
    description: 'Run performance cycles, score goals, and complete multi-stage reviews from self-assessment through HR sign-off.',
    icon: TrendingUp,
    color: '#6366f1',
    accentBg: '#eef2ff',
    articles: [
      {
        id: 'performance-overview',
        title: 'Performance Overview',
        summary: 'Understand the three-stage review cycle and who acts at each stage.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Performance module runs structured review cycles that capture goal achievement and competency ratings across three stages: employee self-assessment, supervisor review, and HR sign-off. Each stage builds on the previous one so the final score reflects all perspectives.' },
          {
            type: 'table',
            headers: ['Who', 'Where they work', 'What they do'],
            rows: [
              ['With performance permissions', 'Performance → Manage Performance', 'Create cycles, assign employees, create and link goals, manage competencies, view all reviews'],
              ['Any employee', 'Performance → Personal Performance',     'Complete self-assessment — score each goal and record actual results'],
              ['A supervisor',  'Performance → Personal Performance → My Team', 'Score each goal for their direct reports (My Team appears when you supervise someone) and submit a supervisor review'],
              ['With review_performance', 'Performance → Personal Performance → My Team or Manage Performance', 'Score each goal for final sign-off and complete the review'],
            ],
          },
          {
            type: 'table',
            headers: ['Stage', 'Status after completing'],
            rows: [
              ['Employee self-assessment', 'Self Assessment'],
              ['Supervisor review',        'Supervisor Review'],
              ['HR sign-off',              'Completed'],
            ],
          },
          { type: 'tip', body: 'The review detail slide-over shows a five-step progress bar at the top so everyone can see exactly where a review stands at a glance.' },
        ],
      },
      {
        id: 'performance-cycles',
        title: 'Setting Up a Performance Cycle',
        summary: 'Create a cycle, set review deadlines, and activate it to open reviews for employees.',
        icon: FileText,
        content: [
          { type: 'text', body: 'A performance cycle defines the review period and the deadlines for each stage. Cycles start in Draft status so you can configure them before any employee sees them. Activating a cycle creates "Not Started" review records for every assigned employee and sends email notifications.' },
          {
            type: 'steps', heading: 'Creating a cycle',
            steps: [
              { label: 'Go to Performance → Manage Performance and open the "Cycles" tab.' },
              { label: 'Click "New Cycle".' },
              { label: 'Enter a name (e.g. "2026 Annual Review"), select a type (Annual, Semi-Annual, Quarterly, or Probation), and set the period start and end dates.' },
              { label: 'Set the three stage deadlines: Self Due (employee deadline), Supervisor Due, and HR Due.' },
              { label: 'Optionally add notes, then save. The cycle is created in Draft status.' },
              { label: 'Add employees to the cycle (see next article) and create goals before activating.' },
              { label: 'When ready, click "Activate" on the cycle card. Employees receive email notifications and their reviews become visible.' },
            ],
          },
          {
            type: 'table',
            headers: ['Cycle status', 'Meaning'],
            rows: [
              ['Draft',  'Being configured — employees cannot see reviews yet'],
              ['Active', 'Open — employees can view and complete their reviews'],
              ['Closed', 'Locked — no further changes; use for archiving completed cycles'],
            ],
          },
          { type: 'warning', body: 'Once a cycle is Activated it cannot be reverted to Draft. Add all employees and goals before activating.' },
          { type: 'tip', body: 'Use the "Close Cycle" button on an Active cycle card to archive it once all reviews are completed.' },
        ],
      },
      {
        id: 'adding-employees-cycle',
        title: 'Adding Employees to a Cycle',
        summary: 'Assign specific employees to a cycle so their reviews are created.',
        icon: Users,
        content: [
          { type: 'text', body: 'Only employees explicitly added to a cycle will have a review record created. Each review is automatically linked to the employee\'s current supervisor.' },
          {
            type: 'steps', heading: 'Adding employees',
            steps: [
              { label: 'Open the cycle card and click "Add Employees".' },
              { label: 'Use the search box to find employees by name.' },
              { label: 'Use the Department filter to show only employees from a specific department.' },
              { label: 'Click "Add All from [Department]" to select the whole department at once, or tick individual employees.' },
              { label: 'Click "Add X Employees" to save. Each employee gets a "Not Started" review record.' },
            ],
          },
          { type: 'tip', body: 'Employees already added to the cycle are hidden from the selection list — the system prevents duplicates automatically.' },
          { type: 'warning', body: 'Employees can only be removed from a cycle while it is still in Draft status. Once activated, review records are locked in place.' },
        ],
      },
      {
        id: 'creating-goals',
        title: 'Creating and Managing Goals',
        summary: 'Define measurable goals with weights and link them to a performance cycle.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Goals define what the employee is expected to achieve. Each goal has a weight (the maximum points it is worth) and a measurable target. HR creates goals and links them to a cycle; employees then score themselves against each goal during self-assessment.' },
          {
            type: 'steps', heading: 'Creating a goal',
            steps: [
              { label: 'Go to Manage Performance → Goals tab.' },
              { label: 'Click "Add Goal".' },
              { label: 'Select the employee the goal belongs to.' },
              { label: 'Enter a title (e.g. "Increase customer satisfaction score") and description.' },
              { label: 'Set the Weight (maximum points — any number from 0 to 100). This determines how much this goal counts in the final score.' },
              { label: 'Enter the measurable Target (e.g. "Score ≥ 90% in Q3 survey").' },
              { label: 'Optionally set a due date, link to a cycle, and add a progress note.' },
              { label: 'Save. The goal is linked to the employee and cycle and will appear in their review.' },
            ],
          },
          {
            type: 'table',
            headers: ['Field', 'Description'],
            rows: [
              ['Weight',      'Maximum points for this goal. Determines its share in the overall score.'],
              ['Target',      'Quantifiable success criterion (e.g. "Complete 5 client projects by Q3")'],
              ['Actual Result','What the employee actually achieved — filled in during self-assessment'],
              ['Due Date',    'Optional goal-level deadline, shown on the review card alongside the cycle deadline'],
            ],
          },
          { type: 'tip', body: 'Goal weights do not need to sum to 100. The system calculates a weighted average automatically regardless of the total.' },
          { type: 'warning', body: 'Goals with a weight of 0 are excluded from the score calculation. Use weight 0 only for informational goals that you do not want scored.' },
        ],
      },
      {
        id: 'self-assessment',
        title: 'Stage 1 — Employee Self-Assessment',
        summary: 'Score each goal and record your actual results before submitting.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'The self-assessment is the first stage of the review. The employee scores each goal (0 to the goal\'s maximum weight) and records what they actually achieved. The system automatically calculates a star rating from these scores — no manual star entry is needed.' },
          {
            type: 'steps', heading: 'Completing self-assessment',
            steps: [
              { label: 'Go to Performance → Personal Performance → My Review.' },
              { label: 'Click the eye icon on your review to open the detail panel.' },
              { label: 'Expand Stage 1 — Self Assessment.' },
              { label: 'For each goal, enter your score in the "Your Score" field (0 to the goal\'s max points).' },
              { label: 'Fill in the "Actual Result" field — describe what you concretely achieved against the target.' },
              { label: 'Optionally add a comment and attach a supporting document as evidence.' },
              { label: 'Write your overall self-assessment comments in the Comments field.' },
              { label: 'Click "Save Draft" at any time to save progress without submitting.' },
              { label: 'When complete, click "Submit Self Assessment". A confirmation dialog appears — confirm to lock the stage and notify your supervisor.' },
            ],
          },
          { type: 'tip', body: 'Your self score is shown as coloured stars above the goal list and updates in real time as you enter scores — you can see your rating before submitting.' },
          { type: 'warning', body: 'Submission is irreversible. Once submitted, Stage 1 is locked and your supervisor is notified to begin their review.' },
        ],
      },
      {
        id: 'supervisor-review',
        title: 'Stage 2 — Supervisor Review',
        summary: 'Score each goal from the supervisor\'s perspective and submit to HR.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'After the employee submits their self-assessment, the supervisor reviews it and independently scores each goal. The supervisor can see the employee\'s actual results and their self-scores before entering their own assessment.' },
          {
            type: 'steps', heading: 'Completing the supervisor review',
            steps: [
              { label: 'Go to Performance → Personal Performance → My Team.' },
              { label: 'Find the team member\'s review (status: "Self Assessment") and click the eye icon.' },
              { label: 'Expand Stage 1 to read the employee\'s actual results and self-scores.' },
              { label: 'Expand Stage 2 — Supervisor Review.' },
              { label: 'For each goal, enter your "Supervisor Score" (0 to the goal\'s max points).' },
              { label: 'Add Supervisor Comments, Strengths, and Areas for Improvement.' },
              { label: 'Click "Save Draft" to save without submitting, or "Submit to HR" when complete.' },
              { label: 'A confirmation dialog appears — confirm to lock Stage 2 and notify HR.' },
            ],
          },
          { type: 'tip', body: 'The supervisor score is shown as coloured stars above Stage 2 and is separate from the employee\'s self score. Both scores are visible to HR in Stage 3.' },
          { type: 'warning', body: 'The My Team tab only appears if you have at least one direct report assigned to your review cycle.' },
        ],
      },
      {
        id: 'hr-signoff',
        title: 'Stage 3 — HR Sign-off',
        summary: 'Score each goal as HR, view the overall rating, and complete the review.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'HR completes the final stage after the supervisor review. HR can see both the employee self-scores and the supervisor scores for each goal before entering their own. The overall score is automatically calculated as the average of all three stage scores.' },
          {
            type: 'steps', heading: 'Completing HR sign-off',
            steps: [
              { label: 'Open the review from Manage Performance → Reviews, or from My Team if you are linked as a supervisor.' },
              { label: 'Expand Stage 3 — HR Final Sign-off (unlocked once the supervisor has submitted).' },
              { label: 'For each goal in Stage 1, enter your "HR Score" (0 to the goal\'s max points).' },
              { label: 'Review the HR Score stars and the Overall Score stars (auto-calculated from all three stages).' },
              { label: 'Add HR Comments and a Development Plan for the employee.' },
              { label: 'Click "Save Draft" to save without completing, or "Complete Review" when done.' },
              { label: 'Confirm in the dialog. The review status changes to Completed and the employee is notified.' },
            ],
          },
          { type: 'tip', body: 'The Overall Score is the average of the self score, supervisor score, and HR score — all weighted by goal scores. You cannot manually override it.' },
        ],
      },
      {
        id: 'understanding-scores',
        title: 'Understanding the Score System',
        summary: 'How goal weights, individual scores, and star colours are calculated.',
        icon: Star,
        content: [
          { type: 'text', body: 'The performance scoring system is fully numeric and transparent. There are no subjective dropdown labels — every score derives from the numbers you enter.' },
          {
            type: 'table',
            headers: ['Concept', 'How it works'],
            rows: [
              ['Goal Weight',    'Maximum points for a goal. Set by HR when creating the goal. Can be any number from 0 to 100.'],
              ['Goal Score',     'Points awarded by the rater (0 to the goal weight). Employee, supervisor, and HR each enter their own score per goal.'],
              ['Stage Score',    'Σ(goal scores) ÷ Σ(goal weights) × 5. Normalized to a 1–5 star scale. Calculated automatically.'],
              ['Overall Score',  'Average of the three stage scores (self + supervisor + HR). Shown in Stage 3.'],
            ],
          },
          {
            type: 'table',
            headers: ['Star range', 'Colour', 'Meaning'],
            rows: [
              ['0 – 1.99',   'Red',   'Below expectations'],
              ['2.0 – 3.5',  'Amber', 'Meets expectations'],
              ['3.51 – 5.0', 'Green', 'Exceeds / outstanding'],
            ],
          },
          { type: 'tip', body: 'Example: A goal with weight 40. Employee scores 38 → stage score = (38÷40)×5 = 4.75 → green stars. Employee scores 10 → (10÷40)×5 = 1.25 → red stars.' },
          { type: 'warning', body: 'If a review has no goals with a weight greater than 0, the score section is hidden entirely. Goals must have a weight set before scores appear.' },
        ],
      },
      {
        id: 'competency-ratings',
        title: 'Competency Ratings',
        summary: 'Rate employees across behavioural competencies — separate from goal scores.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Alongside goal scores, the review includes competency ratings — behavioural skills such as teamwork, communication, and leadership. These are grouped by category and each rated 1–5 by the employee, supervisor, and HR independently.' },
          {
            type: 'steps', heading: 'Adding a competency',
            steps: [
              { label: 'Go to Manage Performance → Competencies tab.' },
              { label: 'Click "Add Competency".' },
              { label: 'Enter a name (e.g. "Team Work"), a category (e.g. "Communication"), and an optional description.' },
              { label: 'Save. The competency is now included on every review automatically.' },
            ],
          },
          {
            type: 'table',
            headers: ['Rating', 'Label'],
            rows: [
              ['1 – 1.5', 'Below Expectations'],
              ['2 – 2.5', 'Needs Improvement'],
              ['3 – 3.5', 'Meets Expectations'],
              ['4 – 4.5', 'Exceeds Expectations'],
              ['5',       'Outstanding'],
            ],
          },
          { type: 'tip', body: 'Competency ratings are informational and do not affect the goal-based stage score. They provide qualitative context alongside the numeric scores.' },
        ],
      },
    ],
  },

  // ── REPORTS ────────────────────────────────────────────────────────────────
  {
    id: 'reports',
    title: 'Reports',
    description: 'Generate, export, and print company-wide and personal reports.',
    icon: BarChart2,
    color: '#0891b2',
    accentBg: '#ecfeff',
    articles: [
      {
        id: 'reports-overview',
        title: 'Reports Overview',
        summary: 'Understand the difference between Admin Reports and User Reports, and who can access each.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The system has two reporting areas. Admin Reports give a company-wide view to anyone granted the generate_reports permission, while User Reports let every signed-in user access their own personal records.' },
          {
            type: 'table',
            headers: ['Report area', 'Who it is for', 'Where to find it'],
            rows: [
              ['Admin Reports', 'Users with the generate_reports permission (export needs export_reports)', 'Sidebar → Admin Reports'],
              ['User Reports (My Reports)', 'Every signed-in user — their own records', 'Sidebar → User Reports'],
            ],
          },
          { type: 'tip', body: 'Access to Admin Reports is controlled by the "Generate Reports" permission; "Export Reports" additionally unlocks the Excel/PDF export buttons. If you cannot see the page, ask your administrator.' },
        ],
      },

      // ── Admin Reports ──
      {
        id: 'employee-details-report',
        title: 'Admin: Employee Details Report',
        summary: 'Export a full list of all employees and their personal, contact, and job information.',
        icon: FileText,
        content: [
          { type: 'text', body: 'The Employee Details Report compiles every active employee\'s profile data into a single exportable table — useful for audits, payroll reconciliation, and HR reviews.' },
          {
            type: 'steps', heading: 'Generating the report',
            steps: [
              { label: 'Go to Admin Reports from the sidebar.' },
              { label: 'Find the "Employee Details Report" card.' },
              { label: 'Click "Export CSV" to download a spreadsheet, or "Print" to open a print-ready view.' },
            ],
          },
          {
            type: 'table',
            headers: ['Column included', 'Description'],
            rows: [
              ['Name',            'Full employee name'],
              ['Employee ID',     'Unique staff identifier'],
              ['Department',      'Assigned department'],
              ['Job Title',       'Current job title'],
              ['Pay Grade',       'Assigned salary grade'],
              ['Hire Date',       'Date the employee joined'],
              ['Employment Status','Active, On Leave, etc.'],
              ['Contact Info',    'Email and phone number'],
            ],
          },
          { type: 'tip', body: 'Use filters in the downloaded spreadsheet to sort by department or date range.' },
        ],
      },
      {
        id: 'payroll-summary-report',
        title: 'Admin: Payroll Summary',
        summary: 'View a company-wide breakdown of gross pay, deductions, tax, and net pay for any payroll run.',
        icon: FileText,
        content: [
          { type: 'text', body: 'The Payroll Summary report gives a line-by-line view of every employee\'s earnings and deductions for a completed payroll run. It is the primary tool for verifying a run before funds are disbursed.' },
          {
            type: 'steps', heading: 'Accessing the report',
            steps: [
              { label: 'Go to Admin Reports.' },
              { label: 'Click "Export CSV" or "Print" on the Payroll Summary card.' },
              { label: 'In the dialog, select the payroll run you want to report on.' },
              { label: 'The report downloads with one row per employee showing gross, components, tax, and net pay.' },
            ],
          },
          { type: 'tip', body: 'Only Completed or Approved payroll runs appear in the selector. Draft runs are excluded.' },
        ],
      },
      {
        id: 'payslip-report',
        title: 'Admin: Payslip Report (Bulk Download)',
        summary: 'Download payslips for one or all employees from any completed payroll run.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Use this report to bulk-download PDF payslips for distribution to employees after a payroll run is approved.' },
          {
            type: 'steps', heading: 'Bulk-downloading payslips',
            steps: [
              { label: 'Go to Admin Reports and click "Generate" on the Payslip Report card.' },
              { label: 'Select a completed or approved payroll run from the dropdown.' },
              { label: 'Choose "All Employees" or select a specific employee.' },
              { label: 'Click "Download". The browser will save one PDF per employee.' },
            ],
          },
          { type: 'warning', body: 'Downloading all payslips triggers a separate file download per employee. Make sure your browser allows multiple file downloads before proceeding.' },
          { type: 'tip', body: 'Individual employees can download their own payslips under User Reports → My Payslips without needing admin access.' },
        ],
      },
      {
        id: 'leave-utilisation-report',
        title: 'Admin: Leave Utilisation Report',
        summary: 'See leave balances, days taken, and pending requests for every employee.',
        icon: CalendarCheck,
        content: [
          { type: 'text', body: 'The Leave Utilisation report gives HR a full picture of how leave entitlement is being used across the organisation. It is useful for planning, compliance, and spotting patterns.' },
          {
            type: 'steps', heading: 'Generating the report',
            steps: [
              { label: 'Go to Admin Reports.' },
              { label: 'Click "Export CSV" or "Print" on the Leave Utilization card.' },
              { label: 'The report shows one row per employee per leave type, with columns for allocated, used, pending, carried-forward, and remaining days.' },
            ],
          },
          {
            type: 'table',
            headers: ['Column', 'Meaning'],
            rows: [
              ['Allocated',       'Total days for the active leave period'],
              ['Carry-Forward',   'Days rolled over from the prior period'],
              ['Used',            'Days from approved leave applications'],
              ['Pending',         'Days from applications still awaiting approval'],
              ['Remaining',       'Net balance available'],
            ],
          },
        ],
      },
      {
        id: 'headcount-report',
        title: 'Admin: Department Headcount Report',
        summary: 'See how many employees are in each department across the organisation.',
        icon: Users,
        content: [
          { type: 'text', body: 'The Headcount report gives a snapshot of employee distribution by department. It is useful for workforce planning and management reporting.' },
          {
            type: 'steps', heading: 'Viewing the report',
            steps: [
              { label: 'Go to Admin Reports.' },
              { label: 'Click "Export CSV" or "Print" on the Department Headcount card.' },
              { label: 'The report lists each department with the total number of active employees.' },
            ],
          },
          { type: 'tip', body: 'For a visual hierarchy view of departments, see the Organogram under Company.' },
        ],
      },
      {
        id: 'medical-utilisation-report',
        title: 'Admin: Medical Utilisation Report',
        summary: 'View medical claim usage and remaining balances for all employees, grouped by pay grade.',
        icon: Stethoscope,
        content: [
          { type: 'text', body: 'This report lets HR see how much of the medical allowance each employee and pay grade has consumed. It helps with budget monitoring and plan renewals.' },
          {
            type: 'steps', heading: 'Opening the report',
            steps: [
              { label: 'Go to Admin Reports and click "View Report" on the Medical Utilisation card.' },
              { label: 'A modal opens showing each employee with their plan limit, amount used, and balance remaining.' },
              { label: 'Use "Export CSV" or "Print" inside the modal to save the data.' },
            ],
          },
          {
            type: 'table',
            headers: ['Column', 'Description'],
            rows: [
              ['Employee',        'Staff name and ID'],
              ['Pay Grade',       'Assigned salary grade (determines the plan)'],
              ['Annual Limit',    'Maximum claimable for the year'],
              ['Amount Used',     'Total approved claims so far'],
              ['Remaining',       'Balance available for further claims'],
            ],
          },
        ],
      },
      {
        id: 'performance-report',
        title: 'Admin: Performance Report',
        summary: 'Compile performance review outcomes, goal scores, and ratings across employees.',
        icon: TrendingUp,
        content: [
          { type: 'text', body: 'The Performance Report gives HR a company-wide view of review outcomes — overall scores, goal achievement, and competency ratings — across performance cycles. It is exportable for moderation meetings and record-keeping.' },
          {
            type: 'steps', heading: 'Opening the report',
            steps: [
              { label: 'Go to Admin Reports and open the Performance Report card.' },
              { label: 'Filter by cycle, department, or status to scope the results.' },
              { label: 'Click "Export Excel" or "PDF" to download the report.' },
            ],
          },
          { type: 'tip', body: 'Scores populate as reviews move through the cycle (self-assessment → supervisor → HR sign-off). Reviews that are not yet completed show their current stage.' },
        ],
      },

      // ── User Reports ──
      {
        id: 'my-payslips',
        title: 'My Reports: Downloading Your Payslips',
        summary: 'Download PDF payslips for any payroll run you were included in.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Every employee can download their own payslips at any time — no admin permission is required.' },
          {
            type: 'steps', heading: 'How to download a payslip',
            steps: [
              { label: 'Go to User Reports (My Reports) from the sidebar.' },
              { label: 'Click "View Payslips" on the My Payslips card.' },
              { label: 'A list of your payroll runs appears. Use the search bar to find a specific month.' },
              { label: 'Click the download icon next to the run to save the PDF to your device.' },
            ],
          },
          { type: 'tip', body: 'Only payroll runs with status "Completed" or "Approved" appear in the list. Draft runs are not available yet.' },
          { type: 'warning', body: 'If your payslip is missing, check with HR that your employee record has been linked to your user account.' },
        ],
      },
      {
        id: 'my-performance-report',
        title: 'My Reports: Performance Report',
        summary: 'Export a report of your own performance reviews, goal scores, and ratings.',
        icon: TrendingUp,
        content: [
          { type: 'text', body: 'The Performance Report compiles your own performance reviews — goal scores, competency ratings, and the overall outcome for each cycle — into an exportable report you can keep for your records.' },
          {
            type: 'steps', heading: 'Generating your performance report',
            steps: [
              { label: 'Go to User Reports (My Reports) from the sidebar.' },
              { label: 'Open the My Performance Report card.' },
              { label: 'Filter by cycle or status if you only want certain reviews.' },
              { label: 'Click "Export Excel" or "PDF" to download the report.' },
            ],
          },
          { type: 'tip', body: 'If you have no completed reviews yet, the report will be empty — scores appear once your reviews progress through the cycle.' },
        ],
      },
      {
        id: 'my-leave-statement',
        title: 'My Reports: Leave Statement',
        summary: 'Get a full history of your leave applications and current balances.',
        icon: CalendarCheck,
        content: [
          { type: 'text', body: 'The Leave Statement lists every leave application you have submitted — approved, pending, rejected, or cancelled — along with your current balance for each leave type.' },
          {
            type: 'steps', heading: 'Generating your leave statement',
            steps: [
              { label: 'Go to User Reports.' },
              { label: 'Click "Export CSV" or "Print" on the My Leave Statement card.' },
              { label: 'The statement shows one row per leave application and a balance summary at the top.' },
            ],
          },
          { type: 'tip', body: 'For a real-time view of your current balances, use the Leave Entitlement tab under Personal Leave.' },
        ],
      },
      {
        id: 'my-medical-statement',
        title: 'My Reports: Medical Statement',
        summary: 'View your medical plan limit, amount used, balance remaining, and full claim history.',
        icon: Stethoscope,
        content: [
          { type: 'text', body: 'The Medical Statement gives you a complete picture of your medical benefit usage — at a glance and in detail.' },
          {
            type: 'steps', heading: 'Viewing your medical statement',
            steps: [
              { label: 'Go to User Reports.' },
              { label: 'Click "View Statement" on the My Medical Statement card.' },
              { label: 'The modal shows your annual limit, total used, and remaining balance at the top.' },
              { label: 'Scroll down to see a full table of every claim — date, description, amount, and status.' },
              { label: 'Click "Export CSV" or "Print" inside the modal to save the records.' },
            ],
          },
          { type: 'tip', body: 'Claims for your dependents are listed separately. Toggle between "Staff" and "Dependents" in the view to see both.' },
        ],
      },
    ],
  },

  // ── DOCUMENTS ──────────────────────────────────────────────────────────────
  {
    id: 'documents',
    title: 'Documents',
    description: 'Upload and share company-wide documents, manage employee personal documents, and track expiry notifications.',
    icon: FolderOpen,
    color: '#0ea5e9',
    accentBg: '#f0f9ff',
    articles: [
      {
        id: 'documents-overview',
        title: 'Documents Overview',
        summary: 'Understand the two tabs — Company Documents and Employee Documents — and what each one manages.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Documents module is split into two tabs that serve different purposes. Company Documents are files shared across the organisation (policies, handbooks, forms). Employee Documents are personal identity and compliance records tied to individual employees (passports, National IDs, tax certificates).' },
          {
            type: 'table',
            headers: ['Tab', 'What it stores', 'Who manages it'],
            rows: [
              ['Company Documents', 'Organisation-wide files shared with all staff, specific departments, or named employees', 'With document permissions'],
              ['Employee Documents', 'Personal identity and compliance documents for individual employees, with expiry tracking', 'With document permissions'],
            ],
          },
          {
            type: 'table',
            headers: ['Feature', 'Company Documents', 'Employee Documents'],
            rows: [
              ['Sharing control',        '✓ Share with all / departments / employees', '— (per employee)'],
              ['Expiry / Valid Until',   '✓ Valid Until date',                         '✓ Expiry Date'],
              ['Expiry email alerts',    '—',                                           '✓ Notify Expired button'],
              ['File attachment',        '✓',                                           '✓'],
              ['Filter by type',         '—',                                           '✓ Document Type filter'],
            ],
          },
          { type: 'tip', body: 'Both tabs share the same search bar at the top. Switching tabs clears the search and any active filters automatically.' },
          { type: 'tip', body: 'Whether employees can download document files is controlled globally in Settings → Controls → Documents. By default downloads are disabled — employees can only view files in the browser.' },
        ],
      },
      {
        id: 'company-documents',
        title: 'Company Documents',
        summary: 'Upload organisation-wide documents and control exactly who can see them.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Company Documents are files the organisation needs to distribute to staff — employee handbooks, HR policies, compliance forms, and similar. Each document can be restricted to specific departments or employees, or opened to everyone.' },
          {
            type: 'steps', heading: 'Adding a company document',
            steps: [
              { label: 'Go to Documents → Company Documents tab and click "Add New".' },
              { label: 'Enter the document Name (required).' },
              { label: 'Optionally add a Details description and a Valid Until date.' },
              { label: 'Choose who can see it — toggle "Share with all employees" on for everyone, or leave it off to target specific departments or employees.' },
              { label: 'Upload the file using the Attachment field.' },
              { label: 'Click "Save Document". The document appears in the list immediately.' },
            ],
          },
          {
            type: 'table',
            headers: ['Column in the list', 'What it shows'],
            rows: [
              ['Name',        'The document title'],
              ['Shared With', '"All" if shared with everyone; otherwise the department or employee names'],
              ['Details',     'Brief description, truncated if long'],
              ['Valid Until',  'The expiry date of the document, or — if not set'],
            ],
          },
          {
            type: 'steps', heading: 'Editing or deleting a document',
            steps: [
              { label: 'Find the document row and click the pencil icon to edit, or the bin icon to delete.' },
              { label: 'Deletion is a soft-delete — the document is archived and removed from all employee views immediately.' },
            ],
          },
          { type: 'tip', body: 'Use the "Valid Until" field for documents that are reviewed annually (e.g. a leave policy). It helps HR know when to upload a newer version.' },
        ],
      },
      {
        id: 'sharing-documents',
        title: 'Sharing Company Documents',
        summary: 'Control visibility using the "Share with all", department, and employee options.',
        icon: Users,
        content: [
          { type: 'text', body: 'Every company document has a sharing scope that determines which employees can see it in their Personal Info → Documents view. The scope is set when creating or editing a document.' },
          {
            type: 'table',
            headers: ['Option', 'Who sees the document'],
            rows: [
              ['Share with all employees (toggle on)', 'Every active employee in the system, regardless of department'],
              ['Share with Departments',               'Only employees whose department matches one of the selected departments'],
              ['Share with Employees',                 'Only the specific employees you pick from the searchable list'],
              ['None selected',                        'Only users with document permissions who manage the Documents page — not visible to employees'],
            ],
          },
          { type: 'tip', body: 'You can combine department and employee sharing — for example, share with the Finance department AND a named employee from another department.' },
          { type: 'warning', body: 'Turning on "Share with all employees" overrides any department or employee selections. The individual fields are hidden when the toggle is on.' },
        ],
      },
      {
        id: 'employee-documents',
        title: 'Employee Documents',
        summary: 'Add and manage personal identity and compliance documents for individual employees.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Employee Documents store personal records linked to a specific employee — passports, National IDs, driver\'s licences, SSNIT cards, and tax certificates. Each record tracks the issue date, expiry date, and an optional file attachment.' },
          {
            type: 'steps', heading: 'Adding an employee document',
            steps: [
              { label: 'Go to Documents → Employee Documents tab and click "Add New".' },
              { label: 'Use the Employee search field to find and select the employee. Only approved, active employees appear in the list.' },
              { label: 'Select the Document Type from the dropdown: National ID, Passport, Driver\'s License, Tax Certificate, or SSNIT Card.' },
              { label: 'Enter the Expiry Date (when the document expires) and Date of Issue.' },
              { label: 'Add Place of Issue and any relevant Details.' },
              { label: 'Upload the document file (PDF or image, max 5 MB).' },
              { label: 'Click "Save Document".' },
            ],
          },
          {
            type: 'table',
            headers: ['Column in the list', 'What it shows'],
            rows: [
              ['Employee',      'Full name of the employee the document belongs to'],
              ['Document Type', 'National ID, Passport, Driver\'s License, Tax Certificate, or SSNIT Card'],
              ['Date of Issue', 'When the document was originally issued'],
              ['Expiry Date',   'When it expires — shown in red if already past. An "Email Sent" badge appears if a notification has been sent.'],
              ['Place of Issue','Where the document was issued (e.g. Accra)'],
            ],
          },
          { type: 'tip', body: 'Use the Filter button to narrow the list by document type. The filter bar appears below the toolbar when active.' },
          { type: 'warning', body: 'Only employees with an APPROVED status appear in the employee search field. Pending or inactive employees are excluded.' },
        ],
      },
      {
        id: 'expiry-notifications',
        title: 'Document Expiry & Email Notifications',
        summary: 'Send automatic email alerts to employees when their documents have expired.',
        icon: Mail,
        content: [
          { type: 'text', body: 'The "Notify Expired" button scans all active employee documents whose expiry date has passed and sends an email to each affected employee\'s work address. The system only sends one email per document — once a notification has been sent it will not be sent again unless the document record is updated.' },
          {
            type: 'steps', heading: 'Sending expiry notifications',
            steps: [
              { label: 'Go to Documents → Employee Documents tab.' },
              { label: 'Click the "Notify Expired" button (mail icon) in the toolbar.' },
              { label: 'The system finds all documents with an expiry date on or before today that have not yet been notified.' },
              { label: 'An email is sent to the work email address on each employee\'s profile for every matching document.' },
              { label: 'A confirmation toast appears showing how many notifications were sent out of how many expired documents were found.' },
              { label: 'Each notified row shows a blue "Email Sent" badge in the Expiry Date column.' },
            ],
          },
          {
            type: 'table',
            headers: ['What you see', 'Meaning'],
            rows: [
              ['Expiry date in red',           'The document has already passed its expiry date'],
              ['"Email Sent" badge (blue)',     'An expiry notification email has been sent to the employee for this document'],
              ['No badge, date not red',        'Document is still valid — no notification needed'],
              ['No badge, date red',            'Document is expired but has not yet been notified — click "Notify Expired" to send'],
            ],
          },
          { type: 'tip', body: 'Notifications are one-per-document — the badge prevents duplicate emails from being sent if you click "Notify Expired" again in the future.' },
          { type: 'warning', body: 'If an employee\'s profile does not have a work email address set, the notification is skipped for their documents. The badge will still be set so they are not contacted in future runs. Check employee profiles to ensure work emails are up to date.' },
        ],
      },
      {
        id: 'viewing-documents',
        title: 'Viewing and Downloading Attachments',
        summary: 'Open attached files directly in the browser or download them.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'Any document that has a file attachment can be viewed inline or downloaded from the document row.' },
          {
            type: 'steps', heading: 'Viewing a document',
            steps: [
              { label: 'Find the document row in either Company Documents or Employee Documents.' },
              { label: 'Click the eye icon on the far right of the row.' },
              { label: 'A document viewer opens. PDFs render inline; images are displayed at full size.' },
              { label: 'Click "Download" in the viewer header to save a copy to your device.' },
            ],
          },
          { type: 'tip', body: 'If no file was attached when the document was created, the eye icon will open the viewer but show a "No file attached" message. Edit the document to upload a file.' },
        ],
      },
      {
        id: 'document-download-setting',
        title: 'Controlling Employee Document Downloads',
        summary: 'Use the Settings toggle to allow or restrict employees from downloading documents in their Personal Documents view.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'By default employees can only view documents in the browser — they cannot download the file. The "Allow Document Downloads" setting in Settings → Controls switches the download button on or off for all employees simultaneously.' },
          {
            type: 'table',
            headers: ['Setting state', 'What the employee sees in Personal Documents'],
            rows: [
              ['Off (default)', 'Eye icon to open the inline viewer. No download button is shown in the viewer.'],
              ['On',            'Eye icon to view inline, plus a Download button in the viewer header that saves the file to their device.'],
            ],
          },
          {
            type: 'steps', heading: 'Enabling or disabling employee downloads',
            steps: [
              { label: 'Go to Settings from the sidebar.' },
              { label: 'Open the Controls sub-tab.' },
              { label: 'Scroll to the Documents section.' },
              { label: 'Toggle "Allow Document Downloads" on or off.' },
              { label: 'The setting saves immediately — no page reload is needed.' },
            ],
          },
          { type: 'tip', body: 'This setting only affects the employee-facing Personal Documents page. Anyone with access to the admin Documents page can always download regardless of this setting.' },
          { type: 'warning', body: 'This is a global setting — it applies to every employee at once. There is no per-document or per-employee download control.' },
        ],
      },
    ],
  },

  // ── TRAINING ───────────────────────────────────────────────────────────────
  {
    id: 'training',
    title: 'Training',
    description: 'Course catalog with date slots and seat limits, self-nominations, and the training approval workflow.',
    icon: Star,
    color: '#7c3aed',
    accentBg: '#f5f3ff',
    articles: [
      {
        id: 'training-overview',
        title: 'Training Overview',
        summary: 'The course catalog, nominations, and how the approval workflow moves a request to Approved.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Training module manages a catalog of courses and the nominations that put employees on them. Employees nominate themselves from the catalog (or for external trainings), supervisors nominate their direct reports, and HR gives final approval.' },
          {
            type: 'table',
            headers: ['Screen', 'Who uses it', 'Purpose'],
            rows: [
              ['Manage Training',   'With training permissions', 'Approve nominations, manage the course catalog, and configure the approval flow'],
              ['Personal Training', 'All staff',   'Browse the catalog, nominate yourself, track your trainings, and manage subordinate nominations'],
            ],
          },
          {
            type: 'table',
            headers: ['Status', 'What it means'],
            rows: [
              ['Draft',                       'Saved but not submitted — only visible to you, still editable and deletable'],
              ['Pending Supervisor Approval', 'Submitted and waiting in your supervisor\'s queue'],
              ['Pending HR Approval',         'Cleared the supervisor stage — waiting in the HR approval queue'],
              ['Approved',                    'Confirmed — a seat is consumed if the course has a seat limit'],
              ['Rejected',                    'Declined with a reason — you may re-apply for the same training and date'],
              ['Completed / No Show',         'Marked by HR after the training date — Completed can carry a score and certificate'],
            ],
          },
          { type: 'tip', body: 'Supervisor and Admin nominations skip the supervisor stage and go straight to Pending HR Approval.' },
        ],
      },
      {
        id: 'training-catalog',
        title: 'Course Catalog, Date Slots & Seats',
        summary: 'Create courses, schedule date slots with venues, and cap attendance with seat limits.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Each catalog course has a code, name, category, type, provider, cost, and an optional description. Courses can define date slots — scheduled runs with a start date, end date, and venue — and each slot can carry its own maximum number of seats.' },
          {
            type: 'steps', heading: 'Creating a course with slots',
            steps: [
              { label: 'Go to Manage Training → Training Catalog and click "Add Course".' },
              { label: 'Fill in the code, name, category, and type (required).' },
              { label: 'Click "Add Slot" for each scheduled run — every slot needs a start date and a venue, and optionally an end date and Max Seats.' },
              { label: 'Save. Active courses appear immediately in everyone\'s Browse Catalog.' },
            ],
          },
          {
            type: 'table',
            headers: ['Seat rule', 'Behaviour'],
            rows: [
              ['Per-slot Max Seats',    'Caps approved nominations for that specific date — shown as "N seats left" on the course card and slot list'],
              ['Course-level Max Seats','Used as the cap when a course has no date slots'],
              ['Blank',                 'Unlimited seats'],
            ],
          },
          { type: 'text', body: 'Seats are consumed by approved nominations only. When a date is full, new applications for it are blocked immediately, and HR cannot approve beyond the cap — the first approvals win.' },
          { type: 'warning', body: 'Pending applications do not reserve seats. Ten people can apply for five seats; the cap is enforced as HR approves.' },
        ],
      },
      {
        id: 'training-nominating',
        title: 'Nominating Yourself or a Subordinate',
        summary: 'Apply from Browse Catalog or the My Training tab, and assign training to direct reports.',
        icon: UserCheck,
        content: [
          {
            type: 'steps', heading: 'Nominating yourself',
            steps: [
              { label: 'Go to Personal Training → Browse Catalog, open a course, and click "Nominate for Myself" — or click "Add Training" on the Personal Training tab for an external course.' },
              { label: 'If the course has date slots, pick one — the dates and venue fill in automatically and full slots are disabled.' },
              { label: 'Save as Draft, review, then click Submit to send it for approval.' },
            ],
          },
          {
            type: 'steps', heading: 'Nominating a direct report',
            steps: [
              { label: 'Go to Personal Training → Subordinate Training and click "Assign Training".' },
              { label: 'Pick the direct report, the course (or enter an external training), and the slot or dates.' },
              { label: 'Save — the nomination goes straight to Pending HR Approval.' },
            ],
          },
          { type: 'warning', body: 'You cannot apply for the same training on the same start date twice. Rejected and No Show nominations do not block a re-application.' },
          { type: 'tip', body: 'Drafts are private — admins and supervisors never see your nomination until you submit it.' },
        ],
      },
      {
        id: 'training-approvals',
        title: 'Approving Training Nominations',
        summary: 'Work the supervisor and HR approval queues and record completion outcomes.',
        icon: CheckCircle2,
        content: [
          { type: 'text', body: 'Approvals happen in the detail slide-over — open a nomination with the eye icon to act on it. Supervisors approve their team\'s requests from the Subordinate Training tab; HR works the Training Approval List, which shows every submitted nomination across the organisation.' },
          {
            type: 'steps', heading: 'HR approval',
            steps: [
              { label: 'Go to Manage Training → Training Approval List and filter by Pending HR Approval.' },
              { label: 'Open the nomination and review the course, date, cost, and seat availability.' },
              { label: 'Approve, or Reject with a reason. Approving a full date is blocked automatically.' },
              { label: 'After the training, mark it Completed (with optional score and certificate) or No Show.' },
            ],
          },
          { type: 'tip', body: 'Access to the approval list is controlled by screen assignment — anyone who can open it sees and can action the full queue.' },
        ],
      },
    ],
  },

  // ── ATTENDANCE ─────────────────────────────────────────────────────────────
  {
    id: 'attendance',
    title: 'Attendance',
    description: 'Clock in/out, biometric device sync, kiosk punching, timesheets, and absence tracking.',
    icon: Clock,
    color: '#0d9488',
    accentBg: '#f0fdfa',
    articles: [
      {
        id: 'attendance-overview',
        title: 'Attendance Overview',
        summary: 'How attendance is captured, how daily records are built, and what each screen is for.',
        icon: BookOpen,
        content: [
          { type: 'text', body: 'The Attendance module tracks when employees start and finish work each day. Every punch — from the web, a biometric device, the kiosk, or a manual HR entry — is recorded in a raw punch trail, and the system pairs them into one daily record per employee using the first punch as clock-in and the last punch as clock-out.' },
          {
            type: 'table',
            headers: ['Capture method', 'How it works'],
            rows: [
              ['Web clock in/out', 'Employees punch from My Attendance in the app. GPS coordinates and IP address are captured with each punch.'],
              ['Biometric devices', 'Fingerprint/face devices push punches to the device-sync API, or HR imports the device\'s punch log as a CSV file.'],
              ['Kiosk',            'A shared tablet at the office entrance where staff enter their staff ID (or scan a badge) to punch, optionally with a photo.'],
              ['Manual entry',     'HR records or corrects attendance on an employee\'s behalf — every manual change is audit-logged.'],
            ],
          },
          {
            type: 'table',
            headers: ['Screen', 'Who uses it'],
            rows: [
              ['My Attendance',     'All employees — clock in/out and view their own monthly timesheet; supervisors also monitor their team under Subordinate Attendance'],
              ['Manage Attendance', 'With attendance permissions — daily logs, corrections, imports, reports, and attendance policy settings'],
              ['Kiosk page',        'Shared device at a fixed location — no login required, secured by an unguessable link'],
            ],
          },
          { type: 'tip', body: 'Daily statuses respect the Work Week and Holidays configured under Manage Leave, and employees on approved leave are automatically shown as On Leave — never Absent.' },
        ],
      },
      {
        id: 'clocking-in-out',
        title: 'Clocking In and Out',
        summary: 'Punch from the My Attendance screen and understand how multiple punches are handled.',
        icon: Clock,
        content: [
          {
            type: 'steps', heading: 'How to clock in or out',
            steps: [
              { label: 'Go to Attendance → My Attendance from the sidebar.' },
              { label: 'The Clock In/Out tab shows a live clock with one large button.' },
              { label: 'Click "Clock In" when you start work and confirm the time in the dialog. Your browser may ask for location permission — and if HR has enabled "Require Location", the punch is refused until you allow it. With "Require Photo" enabled, a webcam shot is captured as you confirm.' },
              { label: 'Click "Clock Out" when you finish and confirm. Today\'s in/out times and status are shown below the button.' },
            ],
          },
          { type: 'text', body: 'Web and kiosk clocking is once per day: one clock-in and one clock-out, each confirmed before it is recorded. After clocking out, the button is replaced with a "done for today" summary. Punches from biometric devices still use first-in / last-out pairing, since devices send every scan.' },
          { type: 'warning', body: 'Employees on approved leave cannot clock in — the clock screen shows an on-leave notice instead of the button, and the kiosk rejects their staff ID for the day.' },
          { type: 'tip', body: 'Forgot to clock out? Ask HR to correct the record from Manage Attendance. Corrections always require a reason and are audit-logged.' },
          { type: 'warning', body: 'Punches within 60 seconds of your previous punch are rejected to prevent accidental double-clicks.' },
        ],
      },
      {
        id: 'attendance-statuses',
        title: 'Understanding Day Statuses',
        summary: 'What Present, Late, Half Day, Incomplete, Absent, and the other statuses mean.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Each daily record is given one status, derived from the punches, the work-week configuration, the holiday calendar, approved leave, and the attendance settings. Statuses are re-evaluated automatically every time a punch arrives or a record is corrected.' },
          {
            type: 'table',
            headers: ['Status', 'When it applies'],
            rows: [
              ['Holiday',    'The date is in the holiday calendar — regardless of any punches'],
              ['Weekend',    'The day is a Non-working Day in the Work Week configuration'],
              ['On Leave',   'The employee has approved leave covering this date'],
              ['Absent',     'No punch was recorded on a working day (set by the nightly auto-absent job)'],
              ['Incomplete', 'The employee clocked in but has not clocked out yet'],
              ['Half Day',   'The work week marks the day as Half Day, or worked time is below the half-day threshold'],
              ['Late',       'Clock-in was after the work start time plus the grace period'],
              ['Present',    'Clocked in on time (or within grace) and clocked out — a normal full day'],
            ],
          },
          { type: 'text', body: 'Alongside the status, four durations are computed for every completed day: worked minutes (out minus in), late minutes (how far after the official start the clock-in was, even within grace), early-leave minutes (clocking out before the official end), and overtime minutes (time worked past the official end).' },
          { type: 'tip', body: 'Late minutes are always recorded even when the status is Present — an 08:40 arrival with a 15-minute grace from 08:30 shows Present with 10 late minutes.' },
        ],
      },
      {
        id: 'attendance-timesheets',
        title: 'Monthly Timesheets',
        summary: 'Review a full month of attendance with totals for hours worked, lateness, and overtime.',
        icon: CalendarCheck,
        content: [
          { type: 'text', body: 'The timesheet shows one row per calendar day with the status, in/out times, worked hours, late minutes, and overtime. Days without records are filled in automatically as Weekend, Holiday, On Leave, or Absent so the month reads completely.' },
          {
            type: 'table',
            headers: ['Totals card', 'What it counts'],
            rows: [
              ['Present Days', 'Days with status Present, Late, or Half Day'],
              ['Absent Days',  'Working days with no punches'],
              ['Late Days',    'Days where the status is Late'],
              ['Hours Worked', 'Sum of worked time across the month'],
              ['Overtime',     'Sum of time worked past the official end time'],
            ],
          },
          {
            type: 'steps', heading: 'Viewing a timesheet',
            steps: [
              { label: 'Employees: go to My Attendance → My Timesheet and pick a month.' },
              { label: 'HR: go to Manage Attendance → Timesheets, select an employee and a month.' },
            ],
          },
          { type: 'tip', body: 'Future days in the current month show no status — only past working days without punches are treated as Absent.' },
        ],
      },
      {
        id: 'attendance-daily-log',
        title: 'Daily Log, Corrections & Voiding',
        summary: 'Filter the organisation-wide log, correct records with an audit trail, and void bad entries.',
        icon: FileText,
        content: [
          { type: 'text', body: 'Manage Attendance → Daily Log lists every attendance record in a date range, filterable by employee, department, and status. Clicking the eye icon opens a detail panel showing the full punch trail, capture sources, IP addresses, GPS location (with a map link), photos, and the correction history.' },
          {
            type: 'steps', heading: 'Recording attendance manually',
            steps: [
              { label: 'Click "Manual Entry" in the Daily Log toolbar.' },
              { label: 'Select the employee and date, enter the clock-in time (clock-out is optional), and add a note.' },
              { label: 'Save — the record is created with source "manual" and the action is audit-logged.' },
            ],
          },
          {
            type: 'steps', heading: 'Correcting or voiding a record',
            steps: [
              { label: 'Click the pencil icon on the row (or "Correct" in the detail panel) to adjust the times — enter a correction reason.' },
              { label: 'Click the bin icon to void a record entirely. Voiding is also audit-logged.' },
              { label: 'The status and hour calculations update automatically after every correction.' },
            ],
          },
          { type: 'warning', body: 'A manual entry is rejected when the employee already has a record on that date — edit the existing record instead. This prevents duplicate days.' },
          { type: 'tip', body: 'Use Export in the toolbar to download the filtered log as a CSV that opens directly in Excel.' },
        ],
      },
      {
        id: 'attendance-devices',
        title: 'Biometric Devices & CSV Import',
        summary: 'Connect fingerprint/face devices through the sync API or import their punch logs as CSV.',
        icon: Activity,
        content: [
          { type: 'text', body: 'There are two ways to bring device punches into the system. An integration built on the device vendor\'s SDK can push punches directly to the device-sync API, or HR can export the device\'s punch log and upload it on the Imports tab.' },
          {
            type: 'table',
            headers: ['Method', 'How it works'],
            rows: [
              ['Device-sync API', 'POST /v1/api/hr/public/attendance/device-sync with the x-api-key header from Settings. Body: device_id and a punches array of { employee_no, time }.'],
              ['CSV import',      'Manage Attendance → Imports → Upload CSV. Columns: employee_no, date, time (or employee_no, datetime). Save Excel sheets as CSV first.'],
            ],
          },
          { type: 'text', body: 'Employees are matched by their staff number (Employee ID). Leading zeros are ignored, and a purely numeric ID also matches the numeric tail of a staff number when it is unambiguous — so a device that stores "4" matches EMP-00004. Rows that match no employee are reported, never guessed.' },
          {
            type: 'table',
            headers: ['Batch column', 'Meaning'],
            rows: [
              ['Inserted',   'New punches recorded and folded into daily records'],
              ['Duplicates', 'Punches already received before — safe to re-send or re-upload the same file'],
              ['Failed',     'Rows with unknown employee numbers or unreadable times — details in the Errors column'],
            ],
          },
          { type: 'tip', body: 'Re-importing the same file is harmless — every punch has a fingerprint, so duplicates are detected and skipped automatically.' },
          { type: 'warning', body: 'Keep the device API key secret. If it leaks, regenerate it from Settings → Controls → Attendance — the old key stops working immediately.' },
        ],
      },
      {
        id: 'attendance-kiosk',
        title: 'Kiosk Mode',
        summary: 'Set up a shared tablet where staff punch in and out with their staff ID or badge.',
        icon: UserCheck,
        content: [
          { type: 'text', body: 'Kiosk mode turns any tablet or PC browser into a punch station. The kiosk page needs no login — it is secured by an unguessable link that only works while kiosk mode is enabled.' },
          {
            type: 'steps', heading: 'Setting up the kiosk',
            steps: [
              { label: 'Go to Settings → Controls → Attendance → Kiosk Mode.' },
              { label: 'Set Kiosk Enabled to "Enabled" — this takes effect immediately.' },
              { label: 'Copy the kiosk URL and open it on the shared device, ideally in full-screen/kiosk browser mode.' },
              { label: 'Optionally enable "Require Photo" to capture a webcam picture with every punch.' },
            ],
          },
          {
            type: 'steps', heading: 'How staff punch at the kiosk',
            steps: [
              { label: 'Type a staff ID on the keypad, use the device keyboard for IDs with letters (e.g. EMP-00004), or scan a badge with a USB scanner.' },
              { label: 'Numeric shortcuts work too — typing just "4" finds EMP-00004 when no other staff number ends in 4.' },
              { label: 'Confirm the name and photo shown, then tap Clock In or Clock Out.' },
              { label: 'The screen resets automatically for the next person.' },
            ],
          },
          { type: 'tip', body: 'Lost or shared link? Click "New Link" in Settings to invalidate the old kiosk URL instantly.' },
          { type: 'warning', body: 'Anyone with the link can open the kiosk page while it is enabled. Enable "Require Photo" to deter staff punching for absent colleagues.' },
        ],
      },
      {
        id: 'attendance-settings',
        title: 'Attendance Settings & Automation',
        summary: 'Configure work hours, grace period, auto-absent marking, and the daily email digest.',
        icon: ListChecks,
        content: [
          { type: 'text', body: 'Attendance policy lives with the rest of the system controls under Settings → Controls → Attendance.' },
          {
            type: 'table',
            headers: ['Setting', 'What it controls'],
            rows: [
              ['Work Start / End Time',  'The official day used to compute lateness, early leave, and overtime'],
              ['Grace Period',           'Minutes after the start time during which a clock-in is not marked Late'],
              ['Half-Day Threshold',     'Days with fewer worked minutes than this are marked Half Day'],
              ['Auto-mark Absentees',    'Employees with no punch are marked Absent once their shift\'s closing time passes (night workers the next morning), skipping weekends, holidays, and approved leave'],
              ['Night Shift Hours',      'Start and closing times for night workers — assign who is on the night shift under Manage Attendance → Night Shift; shifts crossing midnight count toward the day they started'],
              ['Device API Key',         'Authenticates biometric device integrations — regenerate to revoke access'],
              ['Kiosk Enabled / Photo',  'Turns the kiosk link on or off and controls photo capture'],
              ['Web Punch: Require Location', 'Blocks clocking from the app until the browser shares location — punches without coordinates are rejected'],
              ['Web Punch: Require Photo',    'Captures a webcam photo with every in-app clock in/out, like the kiosk'],
              ['Daily Email Digest',     'Emails yesterday\'s attendance summary to the listed recipients at 08:00'],
            ],
          },
          { type: 'text', body: 'Changing the schedule settings affects how future punches are evaluated. To re-evaluate days that were already recorded under the old settings, ask your administrator to run a recompute over the affected date range.' },
          { type: 'tip', body: 'The email digest uses the SMTP configuration from Settings → Email — make sure email is enabled and tested there first.' },
        ],
      },
    ],
  },
];

// ─── Search logic ─────────────────────────────────────────────────────────────

function searchArticles(query: string): { module: HelpModule; article: Article }[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results: { module: HelpModule; article: Article }[] = [];
  for (const mod of MODULES) {
    for (const art of mod.articles) {
      const haystack = [
        art.title,
        art.summary,
        ...art.content.flatMap(c => {
          if (c.type === 'text' || c.type === 'tip' || c.type === 'warning') return [c.body];
          if (c.type === 'steps') return [c.heading ?? '', ...c.steps.flatMap(s => [s.label, s.detail ?? ''])];
          if (c.type === 'table') return [...c.headers, ...c.rows.flat()];
          return [];
        }),
      ].join(' ').toLowerCase();
      if (haystack.includes(q)) results.push({ module: mod, article: art });
    }
  }
  return results;
}

// ─── Render article content ───────────────────────────────────────────────────

function ArticleContent({ content, accent }: { content: ContentBlock[]; accent: string }) {
  return (
    <div className="space-y-6">
      {content.map((block, i) => {
        if (block.type === 'text') return (
          <p key={i} className="text-[14px] leading-relaxed text-[var(--text-secondary)]">{block.body}</p>
        );

        if (block.type === 'tip') return (
          <div key={i} className="flex gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
            <Lightbulb size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[13px] leading-relaxed text-blue-700">{block.body}</p>
          </div>
        );

        if (block.type === 'warning') return (
          <div key={i} className="flex gap-3 p-4 rounded-xl bg-amber-50 border border-amber-100">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[13px] leading-relaxed text-amber-700">{block.body}</p>
          </div>
        );

        if (block.type === 'steps') return (
          <div key={i} className="space-y-3">
            {block.heading && <p className="text-[13px] font-semibold text-[var(--text-primary)] uppercase tracking-wide">{block.heading}</p>}
            <ol className="space-y-2">
              {block.steps.map((step, si) => (
                <li key={si} className="flex gap-3 items-start">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white mt-0.5"
                    style={{ background: 'var(--accent)' }}>
                    {si + 1}
                  </span>
                  <div>
                    <span className="text-[13px] text-[var(--text-primary)]">{step.label}</span>
                    {step.detail && <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{step.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        );

        if (block.type === 'table') return (
          <div key={i} className="relative overflow-hidden rounded-xl border border-[var(--border)]">
            <HairlineDecor color={accent} corner="br" />
            <div className="relative overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {block.headers.map(h => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} className="tr">
                    {row.map((cell, ci) => (
                      <td key={ci} className={`td ${ci === 0 ? 'font-medium text-[var(--text-primary)]' : ''}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        );

        return null;
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type View =
  | { type: 'home' }
  | { type: 'module'; moduleId: string }
  | { type: 'article'; moduleId: string; articleId: string };

export function Help() {
  const [view, setView]           = useState<View>({ type: 'home' });
  const [query, setQuery]         = useState('');

  const activeModule = MODULES.find(m => view.type !== 'home' && m.id === view.moduleId);
  const activeArticle = activeModule?.articles.find(a => view.type === 'article' && a.id === view.articleId);
  const searchResults = useMemo(() => searchArticles(query), [query]);

  const goHome   = () => { setView({ type: 'home' }); setQuery(''); };
  const goModule = (moduleId: string) => setView({ type: 'module', moduleId });
  const goArticle = (moduleId: string, articleId: string) => setView({ type: 'article', moduleId, articleId });

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[var(--bg)]">

      {/* ── Top bar ── */}
      <div className="shrink-0 bg-[var(--surface)] border-b border-[var(--border)] px-4 sm:px-8 py-4">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">

          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            <button onClick={goHome} className="hover:text-[var(--accent)] transition-colors font-medium">Help Center</button>
            {activeModule && (
              <>
                <ChevronRight size={12} />
                <button onClick={() => goModule(activeModule.id)} className="hover:text-[var(--accent)] transition-colors">{activeModule.title}</button>
              </>
            )}
            {activeArticle && (
              <>
                <ChevronRight size={12} />
                <span className="text-[var(--text-secondary)] truncate max-w-[220px]">{activeArticle.title}</span>
              </>
            )}
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search for anything — leave setup, running payroll, adding employees…"
              className={`${inputClass} !pl-10 !pr-10 w-full shadow-sm`}
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left nav (shown when a module is selected, hidden on home) */}
        <AnimatePresence>
          {view.type !== 'home' && !query && activeModule && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 240, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="hidden lg:flex flex-col border-r border-[var(--border)] bg-[var(--surface)] shrink-0 overflow-hidden"
            >
              <div className="p-4 overflow-y-auto flex-1">
                {/* Back to all modules */}
                <button onClick={goHome} className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4 transition-colors">
                  <ArrowLeft size={12} /> All modules
                </button>

                {/* Module title */}
                <div className="flex items-center gap-2 mb-4 px-1">
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: tint(activeModule.color) }}>
                    <activeModule.icon size={13} style={{ color: activeModule.color }} />
                  </div>
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">{activeModule.title}</span>
                </div>

                {/* Article list */}
                <nav className="space-y-0.5">
                  {activeModule.articles.map(art => {
                    const isActive = view.type === 'article' && view.articleId === art.id;
                    return (
                      <button
                        key={art.id}
                        onClick={() => goArticle(activeModule.id, art.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg text-[12px] transition-all"
                        style={{
                          background: isActive ? tint(activeModule.color) : 'transparent',
                          color:      isActive ? activeModule.color : 'var(--text-secondary)',
                          fontWeight: isActive ? 600 : 400,
                        }}
                      >
                        {art.title}
                      </button>
                    );
                  })}
                </nav>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 sm:px-8 py-8">

            {/* ── SEARCH RESULTS ── */}
            {query && (
              <div>
                <p className="text-[13px] text-[var(--text-muted)] mb-5">
                  {searchResults.length === 0
                    ? 'No results found.'
                    : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${query}"`}
                </p>
                <div className="space-y-3">
                  {searchResults.map(({ module: mod, article }) => (
                    <button
                      key={article.id}
                      onClick={() => { goArticle(mod.id, article.id); setQuery(''); }}
                      className="relative overflow-hidden w-full text-left bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)] hover:shadow-md transition-all group"
                    >
                      <HairlineDecor color={mod.color} />
                      <div className="relative flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: tint(mod.color) }}>
                          <mod.icon size={13} style={{ color: mod.color }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{article.title}</p>
                          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{mod.title}</p>
                          <p className="text-[12px] text-[var(--text-secondary)] mt-1 line-clamp-2">{article.summary}</p>
                        </div>
                        <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0 mt-0.5 group-hover:text-[var(--accent)] transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── HOME: module cards ── */}
            {!query && view.type === 'home' && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                {/* Hero */}
                <div className="text-center mb-10">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] text-[12px] font-semibold mb-4">
                    <Sparkles size={12} /> Help Center
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] font-display">How can we help you?</h1>
                  <p className="text-[14px] text-[var(--text-muted)] mt-2">Browse by module or search for a specific task.</p>
                </div>

                {/* Module cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {MODULES.map((mod, i) => (
                    <motion.button
                      key={mod.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      onClick={() => goModule(mod.id)}
                      className="relative overflow-hidden text-left bg-[var(--surface)] border border-[var(--border)] rounded-[14px] p-5 transition-all hover:-translate-y-0.5 hover:shadow-md group"
                    >
                      {/* Tinted wash + hairline corner arcs (matches Attendance report cards) */}
                      <div aria-hidden className="pointer-events-none absolute inset-0">
                        <span className="absolute inset-0" style={{ background: `linear-gradient(225deg, color-mix(in srgb, ${mod.color} 7%, transparent), transparent 45%)` }} />
                        <svg className="absolute -top-10 -right-10 h-28 w-28" viewBox="0 0 96 96">
                          <circle cx="48" cy="48" r="34" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${mod.color} 22%, transparent)` }} />
                          <circle cx="48" cy="48" r="42" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${mod.color} 14%, transparent)` }} />
                        </svg>
                      </div>
                      <div className="relative">
                        <div className="flex items-center justify-between mb-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] shrink-0" style={{ background: `color-mix(in srgb, ${mod.color} 12%, transparent)` }}>
                            <mod.icon size={18} style={{ color: mod.color }} />
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)] font-medium">{mod.articles.length} articles</span>
                        </div>
                        <h3 className="text-[15px] font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{mod.title}</h3>
                        <p className="text-[12px] text-[var(--text-muted)] mt-1 leading-relaxed">{mod.description}</p>
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {mod.articles.slice(0, 3).map(a => (
                            <span key={a.id} className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface-hover)]">
                              {a.title}
                            </span>
                          ))}
                          {mod.articles.length > 3 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full text-[var(--text-muted)]">+{mod.articles.length - 3} more</span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── MODULE: article list ── */}
            {!query && view.type === 'module' && activeModule && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                {/* Module header */}
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={goHome} className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] transition-colors">
                    <ArrowLeft size={16} className="text-[var(--text-muted)]" />
                  </button>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: tint(activeModule.color) }}>
                    <activeModule.icon size={20} style={{ color: activeModule.color }} />
                  </div>
                  <div>
                    <h2 className="text-[18px] font-bold text-[var(--text-primary)]">{activeModule.title}</h2>
                    <p className="text-[12px] text-[var(--text-muted)]">{activeModule.articles.length} articles</p>
                  </div>
                </div>

                {/* Article list */}
                <div className="space-y-2">
                  {activeModule.articles.map((art, i) => (
                    <motion.button
                      key={art.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => goArticle(activeModule.id, art.id)}
                      className="relative overflow-hidden w-full text-left bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)] hover:shadow-sm transition-all group flex items-center gap-4"
                    >
                      <HairlineDecor color={activeModule.color} />
                      <div className="relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: tint(activeModule.color) }}>
                        <BookOpen size={14} style={{ color: activeModule.color }} />
                      </div>
                      <div className="relative flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{art.title}</p>
                        <p className="text-[12px] text-[var(--text-muted)] mt-0.5 truncate">{art.summary}</p>
                      </div>
                      <ChevronRight size={14} className="relative text-[var(--text-muted)] shrink-0 group-hover:text-[var(--accent)] transition-colors" />
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── ARTICLE VIEW ── */}
            {!query && view.type === 'article' && activeModule && activeArticle && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                {/* Article header */}
                <div className="mb-6">
                  <button
                    onClick={() => goModule(activeModule.id)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors mb-4"
                  >
                    <ArrowLeft size={12} /> Back to {activeModule.title}
                  </button>

                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: tint(activeModule.color) }}>
                      <BookOpen size={18} style={{ color: activeModule.color }} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: activeModule.color }}>{activeModule.title}</p>
                      <h2 className="text-[20px] font-bold text-[var(--text-primary)] leading-snug">{activeArticle.title}</h2>
                      <p className="text-[13px] text-[var(--text-muted)] mt-1.5">{activeArticle.summary}</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[var(--border)] pt-6">
                  <ArticleContent content={activeArticle.content} accent={activeModule.color} />
                </div>

                {/* Next / prev article navigation */}
                {(() => {
                  const articles = activeModule.articles;
                  const idx = articles.findIndex(a => a.id === activeArticle.id);
                  const prev = articles[idx - 1];
                  const next = articles[idx + 1];
                  if (!prev && !next) return null;
                  return (
                    <div className="flex gap-3 mt-10 pt-6 border-t border-[var(--border)]">
                      {prev && (
                        <button
                          onClick={() => goArticle(activeModule.id, prev.id)}
                          className="relative overflow-hidden flex-1 text-left bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)] transition-all group"
                        >
                          <HairlineDecor color={activeModule.color} />
                          <p className="relative text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">← Previous</p>
                          <p className="relative text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{prev.title}</p>
                        </button>
                      )}
                      {next && (
                        <button
                          onClick={() => goArticle(activeModule.id, next.id)}
                          className="relative overflow-hidden flex-1 text-right bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-[var(--accent)] transition-all group"
                        >
                          <HairlineDecor color={activeModule.color} />
                          <p className="relative text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Next →</p>
                          <p className="relative text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{next.title}</p>
                        </button>
                      )}
                    </div>
                  );
                })()}
              </motion.div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
