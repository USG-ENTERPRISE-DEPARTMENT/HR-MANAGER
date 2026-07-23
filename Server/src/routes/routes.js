const express = require("express");
const router = express.Router();
const { checkToken, handleRefreshToken } = require("../middleware/authMiddleware");
const { registerUser, loginUser, logoutUser, getAllUsers, getUserById, updateUser, changePassword, deactivateUser, activateUser,updateUserStatus,getMe,updateUserTheme } = require("../controllers/userController.js");
const { assignRoleToUser, revokeRoleFromUser, assignPermissionToUser, revokePermissionFromUser, getAllRoles, getAllPermissions, getUserAccess, addRole, deleteRole, updateRole, updateRoleStatus } = require('../controllers/rolePermissionController');
const roleGuard       = require('../middleware/roleGuard');
const permissionGuard = require('../middleware/permissionGuard');


/* controllers */
const { uploadDocument, downloadDocument, getMySharedDocs, getMyPersonalDocs, getDocumentSettings, updateDocumentSettings, getCompanyDocs, createCompanyDoc, updateCompanyDoc, deleteCompanyDoc, getEmployeeDocs, createEmployeeDoc, updateEmployeeDoc, deleteEmployeeDoc, notifyExpiredDocs } = require('../controllers/documentController');
const { upload, csvUpload } = require('../middleware/upload');

const {
  getAllEmployees,
  getEmployeeApprovals,
  getEmployeeApprovalFlow,
  saveEmployeeApprovalFlow,
  getActiveEmployees,
  getStaffOrganogram,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  approveEmployee,
  rejectEmployee,
  changeEmployeeStatus,
  initiateResignation,
  getAllPaygrades,
  getAllNotches,
  syncEmployee,
  getEmployeePositionImpact,
  getEmployeeActivity,
} = require('../controllers/employeeController.js');

const {
  getAllSkills, addSkill, updateSkill, deleteSkill,
  getAllCerts, addCert, updateCert, deleteCert,
  getAllEducation, addEducation, updateEducation, deleteEducation,
  getAllLanguages, addLanguage, updateLanguage, deleteLanguage,
  getAllDependents, addDependent, updateDependent, deleteDependent,
  getAllEmergencyContacts, addEmergencyContact, updateEmergencyContact, deleteEmergencyContact,
} = require('../controllers/employeeRelationsController');

const {
  getDisciplinaryMeta, getAllDisciplinary, createDisciplinary, updateDisciplinary, deleteDisciplinary,
} = require('../controllers/disciplinaryController');

const {
  getAllCompanyStructures,
  getStructureTypes,
  getCompanyStructureById,
  createCompanyStructure,
  updateCompanyStructure,
  deleteCompanyStructure,
} = require('../controllers/companyStructureController.js');

const {
  getAllPcCodes,
  getPcCodeOrganogram,
  getPcCodeById,
  createPcCode,
  updatePcCode,
  reparentPcCode,
  setPcCodeActive,
  assignEmployee: assignPcCodeEmployee,
  vacatePcCode,
} = require('../controllers/pcCodeController.js');

const salary = require('../controllers/salaryController.js');
const { getPaygrades, createPaygrade, updatePaygrade, deletePaygrade } = salary;

const calc = require('../controllers/calculationController.js');

const {
    getCodeListValues,
    getActiveValuesByCode,
    createCodeListValue,
    updateCodeListValue,
    deactivateCodeListValue,
    getAllCodeLists,
    getCodeListById,
    createCodeList,
    updateCodeList,
    activateCodeListValue
  } = require("../controllers/systemController.js")

const med      = require('../controllers/medicalController');
const leave    = require('../controllers/leaveController');
const transfer = require('../controllers/employeeTransferController');
const appCfg   = require('../controllers/settingsController');
const apiInteg = require('../controllers/apiIntegrationController');

// ─────────────────────────────────────────────
// Public routes (no auth required)
// ─────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'HR management API is running' });
});

router.post('/login', loginUser);
// Logout authenticates via the httpOnly refresh cookie (not the Bearer token), so it must sit BEFORE the
// global checkToken — a user whose access token has already expired must still be able to log out.
router.post('/logout', logoutUser);
router.get('/user/refresh-token', handleRefreshToken);

// Module visibility — public read so the pre-render fetch in main.tsx never
// causes a 401 → refresh → logout chain on page reload.
router.get('/settings/modules', appCfg.getModuleSettings);

// Specific document routes must come BEFORE the /:filename wildcard (with inline auth)
router.get   ('/documents/company',     checkToken, getCompanyDocs);
router.post  ('/documents/company',     checkToken, permissionGuard('create_documents'), createCompanyDoc);
router.put   ('/documents/company/:id', checkToken, permissionGuard('edit_documents'),   updateCompanyDoc);
router.delete('/documents/company/:id', checkToken, permissionGuard('delete_documents'), deleteCompanyDoc);
router.get   ('/documents/my-shared',              checkToken, getMySharedDocs);
router.get   ('/documents/my-personal',            checkToken, getMyPersonalDocs);
router.get   ('/documents/settings',               checkToken, getDocumentSettings);
router.put   ('/documents/settings',               checkToken, permissionGuard('manage_settings'), updateDocumentSettings);
router.get   ('/documents/employee',               checkToken, getEmployeeDocs);
router.post  ('/documents/employee',               checkToken, permissionGuard('create_documents'), createEmployeeDoc);
router.post  ('/documents/employee/notify-expired',checkToken, permissionGuard('edit_documents'),   notifyExpiredDocs);
router.put   ('/documents/employee/:id',           checkToken, permissionGuard('edit_documents'),   updateEmployeeDoc);
router.delete('/documents/employee/:id',           checkToken, permissionGuard('delete_documents'), deleteEmployeeDoc);

// Public wildcard — filenames are unguessable SHA-256 hashes, must be last
router.get('/documents/:filename', downloadDocument);

// Public careers portal (no auth)
const pub = require('../controllers/recruitmentController');
router.get ('/public/settings',                    pub.getPublicSettings);
router.get ('/public/jobs',                        pub.getPublicJobs);
router.get ('/public/jobs/:code',                  pub.getPublicJobByCode);
router.post('/public/jobs/:code/apply',            upload.single('cv'), pub.applyForJob);
// Public self-scheduling portal (no auth)
router.get ('/public/schedule/:token',             pub.getSchedulePage);
router.post('/public/schedule/:token/confirm',     pub.confirmSchedule);

// Public self-onboarding portal (no auth)
const onboarding = require('../controllers/onboardingController');
router.get ('/public/onboarding/:token',           onboarding.publicGetForm);
router.post('/public/onboarding/:token/apply',     upload.any(), onboarding.publicSubmit);

// Public attendance — biometric device push (x-api-key) + kiosk (token)
const attendance = require('../controllers/attendanceController');
router.post('/public/attendance/device-sync',                  attendance.deviceSync);
router.get ('/public/attendance/kiosk/:token/meta',            attendance.kioskMeta);
router.get ('/public/attendance/kiosk/:token/lookup/:staffId', attendance.kioskLookup);
router.post('/public/attendance/kiosk/:token/punch',           attendance.kioskPunch);

// ─────────────────────────────────────────────
// All routes below require a valid token
// ─────────────────────────────────────────────
router.use(checkToken);


// ─────────────────────────────────────────────
// User management — static routes first
// ─────────────────────────────────────────────
router.post('/user/register', permissionGuard('create_users'), registerUser);
router.put('/user/theme', updateUserTheme);   // any authenticated user saves their own UI theme
router.get('/users',     getAllUsers);   // ← renamed from GET / to avoid conflict with health check

router.get   ('/system/code-lists/:code/values/all',                  getCodeListValues);
router.post  ('/system/code-lists/:code/values',                      permissionGuard('manage_app_settings'), createCodeListValue);
router.put   ('/system/code-lists/:valueId/:id',                        permissionGuard('manage_app_settings'), updateCodeListValue);
router.put   ('/system/code-lists/:id/values/:valueId/deactivate',    permissionGuard('manage_app_settings'), deactivateCodeListValue);
router.put   ('/system/code-lists/:id/values/:valueId/activate',      permissionGuard('manage_app_settings'), activateCodeListValue);
router.get   ('/system/code-lists',                                   getAllCodeLists);
router.get   ('/system/code-lists/:id',                               getCodeListById);
router.post  ('/system/code-lists',                                   permissionGuard('manage_app_settings'), createCodeList);
router.put   ('/system/code-lists/:id',                               permissionGuard('manage_app_settings'), updateCodeList);
router.get   ('/system/code-lists/:code/values',                     getActiveValuesByCode);   // reference — no guard

// ─────────────────────────────────────────────
// Role management
// ─────────────────────────────────────────────
router.get('/roles',           permissionGuard.any('view_users','manage_roles'), getAllRoles);
router.post('/roles',          permissionGuard('manage_roles'), addRole);
router.post('/roles/assign',   roleGuard('admin','super-admin'), assignRoleToUser);
router.delete('/roles/revoke', roleGuard('admin','super-admin'), revokeRoleFromUser);
router.put('/roles/:id',       permissionGuard('manage_roles'), updateRole);
router.put('/roles/:id/status', permissionGuard('manage_roles'), updateRoleStatus);
router.delete('/roles/:id',    roleGuard('super-admin'), deleteRole); 

// ─────────────────────────────────────────────
// Permission management
// ─────────────────────────────────────────────
router.get('/permissions',           permissionGuard.any('view_users','manage_roles'), getAllPermissions);
router.post('/permissions/assign',   roleGuard('admin','super-admin'), assignPermissionToUser);
router.delete('/permissions/revoke', roleGuard('admin','super-admin'), revokePermissionFromUser);


// Document upload (needs auth — keep here)
router.post('/employees/documents/upload', upload.single('file'), uploadDocument);

// ─────────────────────────────────────────────
// Employee routes  (static before /:id)
// ─────────────────────────────────────────────
router.get   ('/employee-transfers/approval-flow', permissionGuard.any('manage_settings', 'view_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'), transfer.getApprovalFlow);
router.put   ('/employee-transfers/approval-flow', permissionGuard.any('manage_settings', 'manage_employee_transfers'), transfer.saveApprovalFlow);
router.get   ('/employee-transfers/approval-settings', permissionGuard.any('manage_settings', 'view_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'), transfer.getApprovalSettings);
router.put   ('/employee-transfers/approval-settings', permissionGuard.any('manage_settings', 'manage_employee_transfers'), transfer.saveApprovalSettings);
router.get   ('/employee-transfers/approvals',     transfer.listApprovals);
router.get   ('/employee-transfers',               permissionGuard.any('view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'), transfer.listTransfers);
router.post  ('/employee-transfers',               permissionGuard('create_employee_transfers'), transfer.createTransfer);
router.get   ('/employee-transfers/:id',           permissionGuard.any('view_employee_transfers', 'create_employee_transfers', 'approve_employee_transfers', 'manage_employee_transfers'), transfer.getTransfer);
router.put   ('/employee-transfers/:id',           permissionGuard.any('create_employee_transfers', 'manage_employee_transfers'), transfer.updateTransfer);
router.post  ('/employee-transfers/:id/submit',    permissionGuard.any('create_employee_transfers', 'manage_employee_transfers'), transfer.submitTransfer);
router.post  ('/employee-transfers/:id/approve',   transfer.approveTransfer);
router.post  ('/employee-transfers/:id/reject',    transfer.rejectTransfer);
router.post  ('/employee-transfers/:id/cancel',    permissionGuard('manage_employee_transfers'), transfer.cancelTransfer);
router.put   ('/employee-transfers/:id/reschedule',permissionGuard('manage_employee_transfers'), transfer.rescheduleTransfer);
router.post  ('/employee-transfers/:id/activate',  permissionGuard('manage_employee_transfers'), transfer.activateTransfer);

router.get   ('/employees/active',         getActiveEmployees);
router.get   ('/employees/organogram',     getStaffOrganogram);
router.get   ('/employees/paygrades',      getAllPaygrades);
router.get   ('/employees/notches',        getAllNotches);
router.get   ('/employees/approvals',      getEmployeeApprovals);
router.get   ('/employees/approval-flow',  permissionGuard('manage_settings'), getEmployeeApprovalFlow);
router.put   ('/employees/approval-flow',  permissionGuard('manage_settings'), saveEmployeeApprovalFlow);
router.get   ('/employees',                getAllEmployees);
router.post  ('/employees',                permissionGuard('create_employees'),       createEmployee);
router.get   ('/employees/:id',            getEmployeeById);
// PUT /employees/:id is shared with self-service (Personal Info profile image) — not guarded
router.put   ('/employees/:id',            updateEmployee);
router.put   ('/employees/:id/approve',    approveEmployee);
router.put   ('/employees/:id/reject',     rejectEmployee);
router.put   ('/employees/:id/status',     permissionGuard('change_employee_status'),  changeEmployeeStatus);
router.post  ('/employees/:id/resign',     permissionGuard('change_employee_status'),  initiateResignation);
router.post  ('/employees/:id/sync',       permissionGuard('edit_employees'),          syncEmployee);
router.get   ('/employees/:id/position-impact', getEmployeePositionImpact);
router.get   ('/employees/:id/activity',        getEmployeeActivity);

// ─────────────────────────────────────────────
// Self-Onboarding (admin — manage_onboarding)
// ─────────────────────────────────────────────
router.get   ('/onboarding/config',                 permissionGuard('manage_onboarding'), onboarding.getConfig);
router.put   ('/onboarding/config',                 permissionGuard('manage_onboarding'), onboarding.saveConfig);
router.post  ('/onboarding/token/regenerate',       permissionGuard('manage_onboarding'), onboarding.regenerateToken);
router.get   ('/onboarding/submissions',            permissionGuard('manage_onboarding'), onboarding.listSubmissions);
router.post  ('/onboarding/submissions/:id/convert',permissionGuard('manage_onboarding'), onboarding.convertSubmission);
router.delete('/onboarding/submissions/:id',        permissionGuard('manage_onboarding'), onboarding.deleteSubmission);

router.get   ('/disciplinary/meta',  getDisciplinaryMeta);
router.get   ('/disciplinary',       getAllDisciplinary);
router.post  ('/disciplinary',       createDisciplinary);
router.put   ('/disciplinary/:id',   updateDisciplinary);
router.delete('/disciplinary/:id',   deleteDisciplinary);

// ─────────────────────────────────────────────
// Relational / HR tab routes
// ─────────────────────────────────────────────
router.get   ('/skills',                 getAllSkills);
router.post  ('/skills',                 permissionGuard('manage_skills'), addSkill);
router.put   ('/skills/:id',             permissionGuard('manage_skills'), updateSkill);
router.delete('/skills/:id',             permissionGuard('manage_skills'), deleteSkill);

router.get   ('/certifications',         getAllCerts);
router.post  ('/certifications',         permissionGuard('manage_certifications'), addCert);
router.put   ('/certifications/:id',     permissionGuard('manage_certifications'), updateCert);
router.delete('/certifications/:id',     permissionGuard('manage_certifications'), deleteCert);

router.get   ('/education',              getAllEducation);
router.post  ('/education',              permissionGuard('manage_education'), addEducation);
router.put   ('/education/:id',          permissionGuard('manage_education'), updateEducation);
router.delete('/education/:id',          permissionGuard('manage_education'), deleteEducation);

router.get   ('/languages',              getAllLanguages);
router.post  ('/languages',              permissionGuard('manage_languages'), addLanguage);
router.put   ('/languages/:id',          permissionGuard('manage_languages'), updateLanguage);
router.delete('/languages/:id',          permissionGuard('manage_languages'), deleteLanguage);

router.get   ('/dependents',             getAllDependents);
router.post  ('/dependents',             permissionGuard('manage_dependents'), addDependent);
router.put   ('/dependents/:id',         permissionGuard('manage_dependents'), updateDependent);
router.delete('/dependents/:id',         permissionGuard('manage_dependents'), deleteDependent);

router.get   ('/emergency-contacts',     getAllEmergencyContacts);
router.post  ('/emergency-contacts',     permissionGuard('manage_emergency_contacts'), addEmergencyContact);
router.put   ('/emergency-contacts/:id', permissionGuard('manage_emergency_contacts'), updateEmergencyContact);
router.delete('/emergency-contacts/:id', permissionGuard('manage_emergency_contacts'), deleteEmergencyContact);

// ─────────────────────────────────────────────
// Company structure routes
// ─────────────────────────────────────────────
router.get   ('/company/structures/types',  getStructureTypes);
router.get   ('/company/structures',        getAllCompanyStructures);
router.post  ('/company/structures',        permissionGuard('create_company_structure'), createCompanyStructure);
router.get   ('/company/structures/:id',    getCompanyStructureById);
router.put   ('/company/structures/:id',    permissionGuard('edit_company_structure'),   updateCompanyStructure);
router.delete('/company/structures/:id',    permissionGuard('delete_company_structure'), deleteCompanyStructure);

// ─── PC Codes (positions) ─────────────────────
// NOTE: /organogram is declared before /:id so the param route doesn't capture it.
router.get   ('/pc-codes/organogram',       getPcCodeOrganogram);
router.get   ('/pc-codes',                  getAllPcCodes);
router.post  ('/pc-codes',                  permissionGuard('create_pc_code'), createPcCode);
router.get   ('/pc-codes/:id',              getPcCodeById);
router.put   ('/pc-codes/:id',              permissionGuard('edit_pc_code'),   updatePcCode);
router.put   ('/pc-codes/:id/reparent',     permissionGuard('edit_pc_code'),   reparentPcCode);
router.put   ('/pc-codes/:id/active',       permissionGuard('delete_pc_code'), setPcCodeActive);
router.post  ('/pc-codes/:id/assign',       permissionGuard('assign_pc_code'), assignPcCodeEmployee);
router.post  ('/pc-codes/:id/vacate',       permissionGuard('assign_pc_code'), vacatePcCode);

// ─────────────────────────────────────────────
// Dynamic user routes — must come after all static routes
// ─────────────────────────────────────────────
// Salary setup routes
router.get   ('/salary/refs',                         salary.getSalaryRefs);
router.get   ('/salary/paygrades',                    getPaygrades);
router.post  ('/salary/paygrades',                    permissionGuard('manage_notch_setup'),                createPaygrade);
router.put   ('/salary/paygrades/:id',                permissionGuard('manage_notch_setup'),                updatePaygrade);
router.delete('/salary/paygrades/:id',                permissionGuard('manage_notch_setup'),                deletePaygrade);
router.get   ('/salary/component-types',              salary.getSalaryComponentTypes);
router.post  ('/salary/component-types',              permissionGuard('manage_salary_component_types'),     salary.createSalaryComponentType);
router.put   ('/salary/component-types/:id',          permissionGuard('manage_salary_component_types'),     salary.updateSalaryComponentType);
router.delete('/salary/component-types/:id',          permissionGuard('manage_salary_component_types'),     salary.deleteSalaryComponentType);
router.get   ('/salary/components',                   salary.getSalaryComponents);
router.post  ('/salary/components',                   permissionGuard('manage_salary_components'),          salary.createSalaryComponent);
router.put   ('/salary/components/:id',               permissionGuard('manage_salary_components'),          salary.updateSalaryComponent);
router.delete('/salary/components/:id',               permissionGuard('manage_salary_components'),          salary.deleteSalaryComponent);
router.get   ('/salary/employee-components',          salary.getEmployeeSalaryComponents);
router.get   ('/salary/history/:employeeId',          salary.getEmployeeSalaryHistory);
router.post  ('/salary/employee-components',          permissionGuard('manage_employee_salary_components'), salary.createEmployeeSalaryComponent);
router.put   ('/salary/employee-components/:id',      permissionGuard('manage_employee_salary_components'), salary.updateEmployeeSalaryComponent);
router.delete('/salary/employee-components/:id',      permissionGuard('manage_employee_salary_components'), salary.deleteEmployeeSalaryComponent);
router.get   ('/salary/paygrade-components',          salary.getPaygradeComponents);
router.post  ('/salary/paygrade-components',          permissionGuard('manage_notch_setup'),                salary.createPaygradeComponent);
router.put   ('/salary/paygrade-components/:id',      permissionGuard('manage_notch_setup'),                salary.updatePaygradeComponent);
router.delete('/salary/paygrade-components/:id',      permissionGuard('manage_notch_setup'),                salary.deletePaygradeComponent);
router.get   ('/salary/notch-components',             salary.getNotchComponents);
router.post  ('/salary/notch-components',             permissionGuard('manage_notch_setup'),                salary.createNotchComponent);
router.put   ('/salary/notch-components/:id',         permissionGuard('manage_notch_setup'),                salary.updateNotchComponent);
router.delete('/salary/notch-components/:id',         permissionGuard('manage_notch_setup'),                salary.deleteNotchComponent);
router.get   ('/salary/notches',                      salary.getNotches);
router.post  ('/salary/notches',                      permissionGuard('manage_notch_setup'),                salary.createNotch);
router.put   ('/salary/notches/:id',                  permissionGuard('manage_notch_setup'),                salary.updateNotch);
router.delete('/salary/notches/:id',                  permissionGuard('manage_notch_setup'),                salary.deleteNotch);
router.get   ('/salary/payment-types',                salary.getPaymentTypes);
router.post  ('/salary/payment-types',                permissionGuard('manage_payment_types'),              salary.createPaymentType);
router.put   ('/salary/payment-types/:id',            permissionGuard('manage_payment_types'),              salary.updatePaymentType);
router.delete('/salary/payment-types/:id',            permissionGuard('manage_payment_types'),              salary.deletePaymentType);
router.get   ('/salary/notch-movements',              salary.getNotchMovements);
router.post  ('/salary/notch-movements',              permissionGuard('manage_notch_movements'),            salary.createNotchMovement);

// ─────────────────────────────────────────────
// Payroll calculation routes
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Payroll runs (processing)
// ─────────────────────────────────────────────
const run = require('../controllers/payrollRunController');
const { getAuditLogs, getAuditModules } = require('../controllers/auditController');
router.get   ('/payroll/runs',                    run.getPayrollRuns);
router.post  ('/payroll/runs',                    permissionGuard('process_payroll'), run.createPayrollRun);
router.put   ('/payroll/runs/:id',                permissionGuard('process_payroll'), run.updatePayrollRun);
router.delete('/payroll/runs/:id',                permissionGuard('process_payroll'), run.deletePayrollRun);
router.post  ('/payroll/runs/:id/generate',       permissionGuard('process_payroll'), run.generatePayroll);
router.post  ('/payroll/runs/:id/finalize',       permissionGuard('approve_payroll'), run.finalizePayroll);
router.post  ('/payroll/runs/:id/retry-gl',       permissionGuard('approve_payroll'), run.retryGLPosting);
router.post  ('/payroll/runs/:id/submit',         permissionGuard('process_payroll'), run.submitPayroll);
// approve/reject are authorised inside the controller: a blanket `approve_payroll` holder OR the run's
// current-stage assigned approver may act (stage assignment grants authority for that run).
router.post  ('/payroll/runs/:id/approve',        run.approvePayroll);
router.post  ('/payroll/runs/:id/reject',         run.rejectPayroll);
router.get   ('/payroll/runs/:id/audit',          run.getPayrollAudit);
router.get   ('/payroll/runs/:id/stages',         run.getRunStages);
router.get   ('/payroll/approval-flow',           run.getApprovalFlow);
router.put   ('/payroll/approval-flow',           permissionGuard('process_payroll'), run.saveApprovalFlow);
router.get   ('/payroll/runs/:id/data',           run.getPayrollData);
router.get   ('/payroll/runs/:id/debug',          run.debugPayrollRun);
router.put   ('/payroll/runs/:id/data/:itemId',   permissionGuard('process_payroll'), run.updatePayrollDataItem);

// ─────────────────────────────────────────────
// App settings (email, etc.)
// ─────────────────────────────────────────────
router.put ('/settings/modules',           permissionGuard('manage_settings'), appCfg.saveModuleSettings);
router.get ('/settings/app-setup',         appCfg.getAppSetup);
router.put ('/settings/app-setup',         permissionGuard('manage_app_settings'), appCfg.saveAppSetup);
router.get ('/settings/controls',          appCfg.getControlSettings);
router.put ('/settings/controls',          permissionGuard('manage_settings'), appCfg.saveControlSettings);
router.get ('/settings/notifications',     appCfg.getNotificationSettings);
router.put ('/settings/notifications',     permissionGuard('manage_settings'), appCfg.saveNotificationSettings);
router.get   ('/settings/messages',        appCfg.getMessages);
router.put   ('/settings/messages',        permissionGuard('manage_settings'), appCfg.saveMessage);
router.delete('/settings/messages',        permissionGuard('manage_settings'), appCfg.resetMessage);

// In-app notifications (bell) — each user sees only their own; no permission guard
const notif = require('../controllers/notificationController');
router.get   ('/notifications',          notif.list);
router.put   ('/notifications/read-all', notif.markAllRead);
router.put   ('/notifications/:id/read', notif.markRead);
router.delete('/notifications/clear',    notif.clearAll);
router.delete('/notifications/:id',      notif.remove);
router.get ('/settings/email',             appCfg.getEmailSettings);
router.put ('/settings/email',             permissionGuard('manage_settings'), appCfg.updateEmailSettings);
router.post('/settings/email/test',        permissionGuard('manage_settings'), appCfg.sendTestEmail);
router.get ('/settings/api-integrations',  apiInteg.getApiIntegrations);
router.put ('/settings/api-integrations',  permissionGuard('manage_settings'), apiInteg.updateApiIntegrations);

// ─────────────────────────────────────────────
// Audit logs
// ─────────────────────────────────────────────
router.get('/audit-logs',         getAuditLogs);
router.get('/audit-logs/modules', getAuditModules);

router.get   ('/payroll/columns',                             calc.getPayrollColumns);
router.post  ('/payroll/columns',                             permissionGuard('manage_payroll_columns'), calc.createPayrollColumn);
router.patch ('/payroll/columns/reorder',                     permissionGuard('manage_payroll_columns'), calc.reorderPayrollColumns);
router.put   ('/payroll/columns/:id',                         permissionGuard('manage_payroll_columns'), calc.updatePayrollColumn);
router.delete('/payroll/columns/:id',                         permissionGuard('manage_payroll_columns'), calc.deletePayrollColumn);
router.get   ('/payroll/pay-frequencies',                     calc.getPayFrequencies);
router.post  ('/payroll/pay-frequencies',                     permissionGuard('manage_payroll_employees'), calc.createPayFrequency);
router.put   ('/payroll/pay-frequencies/:id',                 permissionGuard('manage_payroll_employees'), calc.updatePayFrequency);
router.delete('/payroll/pay-frequencies/:id',                 permissionGuard('manage_payroll_employees'), calc.deletePayFrequency);
router.get   ('/payroll/employees',                           calc.getPayrollEmployees);
router.post  ('/payroll/employees',                           permissionGuard('manage_payroll_employees'), calc.createPayrollEmployee);
router.put   ('/payroll/employees/:id',                       permissionGuard('manage_payroll_employees'), calc.updatePayrollEmployee);
router.delete('/payroll/employees/:id',                       permissionGuard('manage_payroll_employees'), calc.deletePayrollEmployee);
router.get   ('/payroll/calc-groups',                         calc.getCalcGroups);
router.post  ('/payroll/calc-groups',                         permissionGuard('manage_calculation_groups'), calc.createCalcGroup);
router.put   ('/payroll/calc-groups/:id',                     permissionGuard('manage_calculation_groups'), calc.updateCalcGroup);
router.delete('/payroll/calc-groups/:id',                     permissionGuard('manage_calculation_groups'), calc.deleteCalcGroup);
router.get   ('/payroll/saved-calculations',                  calc.getSavedCalculations);
router.get   ('/payroll/saved-calculations/:id',              calc.getSavedCalculationById);
router.post  ('/payroll/saved-calculations',                  permissionGuard('manage_calculation_groups'), calc.createSavedCalculation);
router.put   ('/payroll/saved-calculations/:id',              permissionGuard('manage_calculation_groups'), calc.updateSavedCalculation);
router.delete('/payroll/saved-calculations/:id',              permissionGuard('manage_calculation_groups'), calc.deleteSavedCalculation);
router.get   ('/payroll/payslip-templates',                   calc.getPayslipTemplates);
router.post  ('/payroll/payslip-templates',                   permissionGuard('manage_report_templates'), calc.createPayslipTemplate);
router.put   ('/payroll/payslip-templates/:id',               permissionGuard('manage_report_templates'), calc.updatePayslipTemplate);
router.delete('/payroll/payslip-templates/:id',               permissionGuard('manage_report_templates'), calc.deletePayslipTemplate);
const payslip = require('../controllers/payslipController');
router.get   ('/payroll/my-payslips',                         payslip.getMyPayslips);
router.get   ('/payroll/my-tax-summary',                      payslip.getMyTaxSummary);
router.get   ('/payroll/runs/:id/employees/:empId/payslip.pdf', payslip.downloadPayslip);

// ─────────────────────────────────────────────
// Medical routes
// ─────────────────────────────────────────────
router.get   ('/medical/staff',                             med.getStaffMedical);
router.post  ('/medical/staff',                             med.createStaffMedical);
router.put   ('/medical/staff/:id',                         med.updateStaffMedical);
router.delete('/medical/staff/:id',                         med.deleteStaffMedical);
router.post  ('/medical/staff/:id/submit',                  med.submitStaffMedical);
// approve/reject are authorised inside the controller (blanket approve_medical OR current-stage approver).
router.post  ('/medical/staff/:id/approve',                 med.approveStaffMedical);
router.post  ('/medical/staff/:id/reject',                  med.rejectStaffMedical);
router.post  ('/medical/staff/:id/finalize',                permissionGuard('approve_medical'), med.finalizeStaffMedical);
router.post  ('/medical/staff/:id/retry-gl',               permissionGuard('approve_medical'), med.retryStaffMedicalGL);

router.get   ('/medical/dependents-requests',               med.getDependentMedical);
router.post  ('/medical/dependents-requests',               med.createDependentMedical);
router.put   ('/medical/dependents-requests/:id',           med.updateDependentMedical);
router.delete('/medical/dependents-requests/:id',           med.deleteDependentMedical);
router.post  ('/medical/dependents-requests/:id/submit',    med.submitDependentMedical);
router.post  ('/medical/dependents-requests/:id/approve',   med.approveDependentMedical);
router.post  ('/medical/dependents-requests/:id/reject',    med.rejectDependentMedical);
router.post  ('/medical/dependents-requests/:id/finalize',  permissionGuard('approve_medical'), med.finalizeDependentMedical);
router.post  ('/medical/dependents-requests/:id/retry-gl', permissionGuard('approve_medical'), med.retryDependentMedicalGL);

router.get   ('/medical/limits',                   med.getMedicalLimits);
router.post  ('/medical/limits',                   permissionGuard('manage_medical_limits'), med.createMedicalLimit);
router.put   ('/medical/limits/:id',               permissionGuard('manage_medical_limits'), med.updateMedicalLimit);
router.delete('/medical/limits/:id',               permissionGuard('manage_medical_limits'), med.deleteMedicalLimit);

router.get   ('/medical/utilization/history',       med.getUtilizationHistory);
router.post  ('/medical/utilization/reset',         permissionGuard('reset_medical_utilization'), med.resetMedicalUtilization);
router.get   ('/medical/enquiry/:id',               med.getMedicalEnquiryByEmployee);
router.get   ('/medical/enquiry',                  med.getMedicalEnquiry);
router.get   ('/medical/my-enquiry',               med.getMyMedicalEnquiry);

router.get   ('/medical/settings',                 med.getMedicalSettings);
router.put   ('/medical/settings',                 med.updateMedicalSettings);
router.get   ('/medical/gl-settings',              med.getMedicalGLSettings);
router.put   ('/medical/gl-settings',              med.updateMedicalGLSettings);

router.get   ('/medical/hospitals',                med.getHospitals);
router.post  ('/medical/hospitals',                permissionGuard('manage_hospitals'), med.createHospital);
router.put   ('/medical/hospitals/:id',            permissionGuard('manage_hospitals'), med.updateHospital);
router.delete('/medical/hospitals/:id',            permissionGuard('manage_hospitals'), med.deleteHospital);

router.get   ('/medical/claims',                   med.getHospitalClaims);
router.post  ('/medical/claims',                   permissionGuard('create_medical'),  med.createHospitalClaim);
router.put   ('/medical/claims/:id',               permissionGuard('edit_medical'),    med.updateHospitalClaim);
router.delete('/medical/claims/:id',               permissionGuard('delete_medical'),  med.deleteHospitalClaim);
router.post  ('/medical/claims/:id/submit',        permissionGuard('create_medical'),  med.submitHospitalClaim);
router.post  ('/medical/claims/:id/approve',       med.approveHospitalClaim);
router.post  ('/medical/claims/:id/retry-gl',     permissionGuard('approve_medical'), med.retryHospitalClaimGL);
router.post  ('/medical/claims/:id/reject',        med.rejectHospitalClaim);

// Multi-stage medical approval config + per-record stage progress
router.get   ('/medical/approval-flow',            med.getMedicalApprovalFlow);
router.put   ('/medical/approval-flow',            permissionGuard('approve_medical'), med.saveMedicalApprovalFlow);
router.get   ('/medical/requests/:type/:id/stages', med.getMedicalStages);


// ─────────────────────────────────────────────
// Leave Setup
// ─────────────────────────────────────────────
router.get   ('/leave/types',                        leave.getLeaveTypes);
router.post  ('/leave/types',                        permissionGuard('manage_leave_types'),   leave.createLeaveType);
router.put   ('/leave/types/:id',                    permissionGuard('manage_leave_types'),   leave.updateLeaveType);
router.delete('/leave/types/:id',                    permissionGuard('manage_leave_types'),   leave.deleteLeaveType);

router.get   ('/leave/periods',                      leave.getLeavePeriods);
router.post  ('/leave/periods',                      permissionGuard('manage_leave_periods'), leave.createLeavePeriod);
router.put   ('/leave/periods/:id',                  permissionGuard('manage_leave_periods'), leave.updateLeavePeriod);
router.delete('/leave/periods/:id',                  permissionGuard('manage_leave_periods'), leave.deleteLeavePeriod);
router.post  ('/leave/periods/:id/activate',                  permissionGuard('manage_leave_periods'), leave.activateLeavePeriod);
router.post  ('/leave/periods/:id/recalculate-carryforward',  permissionGuard('manage_leave_periods'), leave.recalculateCarryForward);

router.get   ('/leave/holidays',                     leave.getHolidays);
router.post  ('/leave/holidays',                     permissionGuard('manage_holidays'),      leave.createHoliday);
router.put   ('/leave/holidays/:id',                 permissionGuard('manage_holidays'),      leave.updateHoliday);
router.delete('/leave/holidays/:id',                 permissionGuard('manage_holidays'),      leave.deleteHoliday);

router.get   ('/leave/workweek',                     leave.getWorkWeek);
router.put   ('/leave/workweek',                     permissionGuard('manage_work_week'),     leave.updateWorkWeek);

router.get   ('/leave/groups',                       leave.getLeaveGroups);
router.post  ('/leave/groups',                       permissionGuard('manage_leave_groups'),  leave.createLeaveGroup);
router.put   ('/leave/groups/:id',                   permissionGuard('manage_leave_groups'),  leave.updateLeaveGroup);
router.delete('/leave/groups/:id',                   permissionGuard('manage_leave_groups'),  leave.deleteLeaveGroup);
router.get   ('/leave/groups/:id/employees',         leave.getLeaveGroupEmployees);
router.post  ('/leave/groups/:id/employees',         permissionGuard('manage_leave_groups'),  leave.addLeaveGroupEmployee);
router.delete('/leave/groups/:id/employees/:eid',    permissionGuard('manage_leave_groups'),  leave.removeLeaveGroupEmployee);
router.get   ('/leave/groups/:id/paygrades',         leave.getLeaveGroupPaygrades);
router.post  ('/leave/groups/:id/paygrades',         permissionGuard('manage_leave_groups'),  leave.addLeaveGroupPaygrade);
router.delete('/leave/groups/:id/paygrades/:pgId',   permissionGuard('manage_leave_groups'),  leave.removeLeaveGroupPaygrade);

router.get   ('/leave/allowance-settings',            leave.getLeaveAllowanceSettings);
router.put   ('/leave/allowance-settings',            permissionGuard('manage_settings'), leave.updateLeaveAllowanceSettings);

router.get   ('/leave/approval-settings',             leave.getApprovalFlowSettings);
router.put   ('/leave/approval-settings',             permissionGuard('manage_settings'), leave.updateApprovalFlowSettings);

// Multi-stage, amount-range financial approval flow (replaces the old single threshold)
router.get   ('/leave/approval-flow',                 leave.getLeaveApprovalFlow);
router.put   ('/leave/approval-flow',                 permissionGuard('manage_settings'), leave.saveLeaveApprovalFlow);

router.get   ('/leave/calendar-settings',             leave.getCalendarSettings);
router.put   ('/leave/calendar-settings',             permissionGuard('manage_settings'), leave.updateCalendarSettings);

// Static before parameterised :id — must come before /leave/leaves/:id block
router.get   ('/leave/central-approval',              leave.getLeaveCentralApproval);
router.get   ('/leave/calendar',                      leave.getCalendarLeaves);

router.get   ('/leave/rules',                        leave.getLeaveRules);
router.post  ('/leave/rules',                        permissionGuard('manage_leave_rules'),   leave.createLeaveRule);
router.put   ('/leave/rules/:id',                    permissionGuard('manage_leave_rules'),   leave.updateLeaveRule);
router.delete('/leave/rules/:id',                    permissionGuard('manage_leave_rules'),   leave.deleteLeaveRule);

// ─────────────────────────────────────────────
// Leave Management — static sub-paths BEFORE :id
// ─────────────────────────────────────────────
// Leave approval is open to all by default (self-service supervisor approval) — no permission guards
router.get   ('/leave/subordinates',                 leave.getSubordinateEmployees);
router.get   ('/leave/leaves/subordinates',          leave.getSubordinateLeaves);
router.get   ('/leave/leaves/all',                   leave.getAllEmployeeLeaves);
router.get   ('/leave/balance/:employeeId',          leave.getLeaveBalance);

router.get   ('/leave/leaves',                       leave.getLeaves);
// Self-service leave actions (own application) — screen access is the gate, no permission guard
router.post  ('/leave/leaves',                       leave.applyLeave);
router.put   ('/leave/leaves/:id',                   leave.updateLeave);
router.delete('/leave/leaves/:id',                   leave.deleteLeave);
router.post  ('/leave/leaves/:id/submit',            leave.submitLeave);
router.post  ('/leave/leaves/:id/approve',           leave.approveLeave);
router.post  ('/leave/leaves/:id/reject',            leave.rejectLeave);
router.post  ('/leave/leaves/:id/cancel',            leave.cancelLeave);
router.post  ('/leave/leaves/:id/finalize',          leave.finalizeLeave);
router.post  ('/leave/leaves/:id/approve-allowance', leave.approveAllowanceLeave);
router.post  ('/leave/leaves/:id/reject-allowance',  leave.rejectAllowanceLeave);
router.get   ('/leave/leaves/:id/stages',            leave.getLeaveStages);
router.post  ('/leave/leaves/:id/retry-gl',          leave.retryLeaveGL);

// ─────────────────────────────────────────────
// Recruitment
// ─────────────────────────────────────────────
const recruitment = require('../controllers/recruitmentController');
router.get   ('/recruitment/pipeline',              recruitment.getPipeline);
router.get   ('/recruitment/jobs',                  recruitment.getJobs);
router.post  ('/recruitment/jobs',                  permissionGuard('manage_jobs'), recruitment.createJob);
router.put   ('/recruitment/jobs/:id',              permissionGuard('manage_jobs'), recruitment.updateJob);
router.delete('/recruitment/jobs/:id',              permissionGuard('manage_jobs'), recruitment.deleteJob);

router.get   ('/recruitment/candidates',            recruitment.getCandidates);
router.get   ('/recruitment/candidates/:id',        recruitment.getCandidateById);
router.post  ('/recruitment/candidates',            permissionGuard('manage_candidates'), recruitment.createCandidate);
router.put   ('/recruitment/candidates/:id',        permissionGuard('manage_candidates'), recruitment.updateCandidate);
router.delete('/recruitment/candidates/:id',        permissionGuard('manage_candidates'), recruitment.deleteCandidate);
router.put   ('/recruitment/candidates/:id/stage',  permissionGuard.any('manage_candidates','manage_interviews'), recruitment.moveCandidateStage);
router.post  ('/recruitment/candidates/:id/hire',   permissionGuard('manage_candidates'), recruitment.hireCandidate);

router.get   ('/recruitment/applications',          recruitment.getApplications);
router.post  ('/recruitment/applications',          permissionGuard('manage_applications'), recruitment.createApplication);
router.delete('/recruitment/applications/:id',      permissionGuard('manage_applications'), recruitment.deleteApplication);

router.get   ('/recruitment/interviews',                              recruitment.getInterviews);
router.post  ('/recruitment/interviews',                              permissionGuard('manage_interviews'), recruitment.createInterview);
router.put   ('/recruitment/interviews/:id',                          permissionGuard('manage_interviews'), recruitment.updateInterview);
router.delete('/recruitment/interviews/:id',                          permissionGuard('manage_interviews'), recruitment.deleteInterview);
router.post  ('/recruitment/interviews/:id/send-schedule-link',       permissionGuard('manage_interviews'), recruitment.sendScheduleLink);
router.post  ('/recruitment/interviews/:id/send-invite',              permissionGuard('manage_interviews'), recruitment.sendInterviewInvite);

// ─────────────────────────────────────────────
// Performance Management
// ─────────────────────────────────────────────
const perf = require('../controllers/performanceController');
router.get   ('/performance/meta',                           perf.getPerformanceMeta);
router.get   ('/performance/cycles',                         perf.getAllCycles);
router.get   ('/performance/cycles/:id',                     perf.getCycleById);
router.post  ('/performance/cycles',                         permissionGuard('create_performance'), perf.createCycle);
router.put   ('/performance/cycles/:id',                     permissionGuard('create_performance'),   perf.updateCycle);
router.delete('/performance/cycles/:id',                     permissionGuard('delete_performance'), perf.deleteCycle);
router.post  ('/performance/cycles/:id/employees',           permissionGuard('create_performance'),   perf.addEmployeesToCycle);
router.delete('/performance/cycles/:id/employees/:employeeId', permissionGuard('create_performance'), perf.removeEmployeeFromCycle);
router.post  ('/performance/cycles/:id/activate',            permissionGuard('create_performance'),   perf.activateCycle);
router.post  ('/performance/cycles/:id/close',               permissionGuard('create_performance'),   perf.closeCycle);

router.get   ('/performance/reviews/my',                     perf.getMyReviews);
router.get   ('/performance/reviews/team',                   perf.getTeamReviews);
router.get   ('/performance/reviews',                        perf.getAllReviews);
router.get   ('/performance/reviews/:id',                    perf.getReviewById);
router.put   ('/performance/reviews/:id',                    perf.updateReview);
router.post  ('/performance/reviews/:id/self',               perf.submitSelfAssessment);
router.post  ('/performance/reviews/:id/supervisor',         perf.submitSupervisorReview);
router.post  ('/performance/reviews/:id/hr',                 permissionGuard('review_performance'), perf.submitHRReview);
router.post  ('/performance/reviews/:id/ratings',            perf.saveCompRatings);

router.get   ('/performance/goals',                          perf.getGoals);
router.post  ('/performance/goals',                          perf.createGoal);
router.put   ('/performance/goals/:id',                      perf.updateGoal);
router.delete('/performance/goals/:id',                      perf.deleteGoal);
router.post  ('/performance/goals/:id/document',             upload.single('file'), perf.uploadGoalDocument);

router.get   ('/performance/competencies',                   perf.getCompetencies);
router.post  ('/performance/competencies',                   permissionGuard('create_performance'), perf.createCompetency);
router.put   ('/performance/competencies/:id',               permissionGuard('create_performance'),   perf.updateCompetency);

// ─────────────────────────────────────────────
// Training & Development
// ─────────────────────────────────────────────
const training = require('../controllers/trainingController');

router.get   ('/training/catalog',                             training.getCatalog);
router.post  ('/training/catalog',                             permissionGuard('create_training'), training.createCatalog);
router.put   ('/training/catalog/:id',                         permissionGuard('create_training'),   training.updateCatalog);
router.delete('/training/catalog/:id',                         permissionGuard('delete_training'), training.deleteCatalog);
router.get   ('/training/catalog/:id/slots',                   training.getCatalogSlots);
router.post  ('/training/catalog/:id/slots',                   permissionGuard('create_training'), training.saveCatalogSlots);

router.get   ('/training/settings',                            roleGuard('admin','super-admin'), training.getTrainingSettings);
router.put   ('/training/settings',                            roleGuard('admin','super-admin'), training.saveTrainingSettings);
router.get   ('/training/subordinates',                        training.getSubordinates);

router.get   ('/training/nominations',                         training.getNominations);
router.get   ('/training/nominations/subordinate',             training.getSubordinateNominations);
router.post  ('/training/nominations',                         training.createNomination);
router.put   ('/training/nominations/:id',                     training.updateNomination);
router.delete('/training/nominations/:id',                     training.deleteNomination);
router.post  ('/training/nominations/:id/submit',              training.submitNomination);
router.post  ('/training/nominations/:id/approve',             permissionGuard('approve_training'), training.approveNomination);
router.post  ('/training/nominations/:id/reject',              permissionGuard('approve_training'), training.rejectNomination);
router.post  ('/training/nominations/:id/complete',            permissionGuard('approve_training'), training.completeNomination);
router.post  ('/training/nominations/:id/no-show',             permissionGuard('approve_training'), training.noShowNomination);
router.post  ('/training/nominations/:id/supervisor-approve',  training.supervisorApproveNomination);
router.post  ('/training/nominations/:id/supervisor-reject',   training.supervisorRejectNomination);

// ─────────────────────────────────────────────
// Dashboard & Reports
// ─────────────────────────────────────────────
const dashboard = require('../controllers/dashboardController');
router.get('/dashboard/summary', dashboard.getDashboardSummary);
router.get('/dashboard/module-stats', dashboard.getModuleStats);

// ── Offline AI assistant ──────────────────────────────────────
const ai = require('../controllers/aiController');
router.get ('/ai/health',               ai.health);
router.get ('/ai/config',               permissionGuard.any('manage_app_settings', 'view_app_settings'), ai.getConfig);
router.put ('/ai/config',               permissionGuard('manage_app_settings'), ai.updateConfig);
router.post('/ai/reindex',              permissionGuard('manage_app_settings'), ai.reindex);
router.get   ('/ai/knowledge',          permissionGuard('manage_app_settings'), ai.listKnowledge);
router.post  ('/ai/knowledge',          permissionGuard('manage_app_settings'), ai.createKnowledge);
router.put   ('/ai/knowledge/:id',      permissionGuard('manage_app_settings'), ai.updateKnowledge);
router.delete('/ai/knowledge/:id',      permissionGuard('manage_app_settings'), ai.deleteKnowledge);
router.post('/ai/chat',                 permissionGuard('use_ai_assistant'), ai.chat);
// In-form AI aids: available to any authenticated user editing the form; the controller still
// gates on the master AI enable + per-feature toggle (drafting / ocr).
router.post('/ai/draft',                ai.draft);
router.post('/ai/ocr',                  upload.single('file'), ai.ocr);
router.get ('/ai/insights/attrition',   permissionGuard('view_ai_insights'), ai.attritionInsights);

const report = require('../controllers/reportController');
router.post('/reports/table.pdf', report.tablePdf);

// ─────────────────────────────────────────────
// Attendance — static routes before /attendance/:id
// ─────────────────────────────────────────────
router.post  ('/attendance/punch',                    attendance.punch);
router.get   ('/attendance/punch-policy',             attendance.getPunchPolicy);
router.get   ('/attendance/night-shift',              attendance.getNightShift);
router.post  ('/attendance/night-shift',              permissionGuard('manage_attendance'), attendance.addNightShift);
router.delete('/attendance/night-shift/:employee',    permissionGuard('manage_attendance'), attendance.removeNightShift);
router.get   ('/attendance/today',                    attendance.getToday);
router.get   ('/attendance/subordinates',             attendance.getSubordinateLog);
router.get   ('/attendance/timesheet',                attendance.getTimesheet);
router.get   ('/attendance/summary',                  attendance.getSummary);
router.get   ('/attendance/punches',                  attendance.getPunches);
router.post  ('/attendance/manual',                   permissionGuard('manage_attendance'), attendance.manualEntry);
router.post  ('/attendance/import',                   permissionGuard('manage_attendance'), csvUpload.single('file'), attendance.importCsv);
router.get   ('/attendance/import/batches',           attendance.getImportBatches);
router.get   ('/attendance/export',                   attendance.exportCsv);
router.post  ('/attendance/recompute',                attendance.recompute);
router.get   ('/attendance/settings',                 attendance.getSettings);
router.put   ('/attendance/settings',                 permissionGuard('manage_attendance'), attendance.updateSettings);
router.post  ('/attendance/settings/regenerate-key',  permissionGuard('manage_attendance'), attendance.regenerateKey);
router.get   ('/attendance',                          attendance.getDailyLog);
router.get   ('/attendance/:id/photos',               attendance.getRecordPhotos);
router.put   ('/attendance/:id',                      permissionGuard('manage_attendance'), attendance.updateRecord);
router.delete('/attendance/:id',                      permissionGuard('manage_attendance'), attendance.deleteRecord);

// Specific routes MUST be declared before the dynamic `/:id` routes, otherwise Express
// matches e.g. GET /me as /:id with id="me" (wrong controller).
router.get('/me',            checkToken, getMe);
router.get('/:id/access',          roleGuard('admin','super-admin'), getUserAccess);
router.get('/:id',                 getUserById);
router.put('/:id',                 permissionGuard('edit_users'),       updateUser);
router.put('/:id/change-password', changePassword);
router.put('/:id/deactivate',      permissionGuard('deactivate_users'), deactivateUser);
router.put('/:id/activate',        permissionGuard('activate_users'),   activateUser);
router.put('/user/:id/status', permissionGuard.any('deactivate_users','activate_users'), updateUserStatus);

// ─────────────────────────────────────────────
// Catch-all
// ─────────────────────────────────────────────
router.all('*', (req, res) => {
  res.status(404).json({ status: '404', message: 'Route not found' });
});

module.exports = router;
