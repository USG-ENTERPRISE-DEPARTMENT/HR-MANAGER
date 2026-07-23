import React, { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import ProtectedRoute from './components/ProtectedRoute';
import { LeaveManagement } from './components/LeaveManagement';
import { LeaveSetup } from './components/LeaveSetup';
import { LeaveCalendar } from './components/LeaveCalendar';
import { Dashboard } from './components/Dashboard';
import { Employees } from './components/Employees';
import { EmployeeTransfers } from './components/EmployeeTransfers';
import { SelfOnboarding } from './components/SelfOnboarding';
import { OnboardingPortal } from './components/OnboardingPortal';
import { Company } from './components/Company';
import { Documents } from './components/Document';
import { Users } from './components/Users';
import { Salary } from './components/Salary';
import { Payroll } from './components/Payroll';
import { System } from './components/System';
import { AdminReports } from './components/AdminReports';
import { UserReports } from './components/UserReports';
import { Modules } from './components/Modules';
import { Login } from './components/Login';
import { Settings } from './components/Settings';
import { LeaveSettings } from './components/LeaveSettings';
import { NotificationSettings } from './components/NotificationSettings';
import { AuditLogs } from './components/AuditLogs';
import { CentralApproval } from './components/CentralApproval';
import { PersonalMedical, AdminMedical } from './components/Medical';
import { AdminTraining, PersonalTraining } from './components/Training';
import { PersonalDocuments } from './components/PersonalDocuments';
import { PersonalInfo } from './components/PersonalInfo';
import { StaffOrganogram } from './components/StaffOrganogram';
import { PcCodes } from './components/PcCodes';
import { PcCodeOrganogram } from './components/PcCodeOrganogram';
import { Help } from './components/Help';
import { Recruitment } from './components/Recruitment';
import { ManagePerformance } from './components/ManagePerformance';
import { AiInsights } from './components/AiInsights';
import { PersonalPerformance } from './components/PersonalPerformance';
import { CareersPortal } from './components/CareersPortal';
import { SchedulingPortal } from './components/SchedulingPortal';
import { AdminAttendance, MyAttendance } from './components/Attendance';
import { AttendanceKiosk } from './components/AttendanceKiosk';

import { AppUser } from '../types/permissions';
import { logout as authLogout, getCurrentUser, onUserChange } from '@/lib/auth';
import { canAccessNav } from '@/lib/permissions';
import { moduleStore } from '@/lib/moduleState';
import { initControlSettings } from '@/lib/settings';
import { applyTheme } from '@/lib/theme';
import api from '@/lib/api';
import { appPath } from '@/lib/basePath';

function loadCurrentUser(): AppUser | null {
  try {
    const u = getCurrentUser();
    if (!u || !u.name || u.name.includes('undefined')) {
      // Clear from localStorage (current storage backend) and legacy sessionStorage keys
      localStorage.removeItem('hr_current_user');
      localStorage.removeItem('hr_access_token');
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

// Users without Overview (Dashboard) access land on Modules instead.
function landingView(user: AppUser | null): string {
  return user && !canAccessNav(user, 'Dashboard') ? 'Modules' : 'Dashboard';
}

function loadActiveView(user: AppUser | null): string {
  const stored = sessionStorage.getItem('activeView');
  if (stored) {
    // Don't strand a user on the Overview page if they can't access it
    if (stored === 'Dashboard' && user && !canAccessNav(user, 'Dashboard')) return 'Modules';
    return stored;
  }
  return landingView(user);
}

export default function App() {
  // All hooks must run unconditionally on every render (Rules of Hooks). The public-portal early
  // returns therefore come AFTER the hooks below — never before them.
  const [currentUser, setCurrentUser] = useState<AppUser | null>(loadCurrentUser);
  const [activeView, setActiveView] = useState<string>(() => loadActiveView(currentUser));
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navigate = (view: string) => {
    sessionStorage.setItem('activeView', view);
    setActiveView(view);
  };

  React.useEffect(() => {
    if (currentUser && (!currentUser.name || currentUser.name.includes('undefined'))) {
      authLogout();
      setCurrentUser(null);
    }
  }, [currentUser]);

  React.useEffect(() => onUserChange(freshUser => setCurrentUser(freshUser)), []);

  // Never leave a user stranded on the Overview page they can't access
  React.useEffect(() => {
    if (currentUser && activeView === 'Dashboard' && !canAccessNav(currentUser, 'Dashboard')) {
      navigate('Modules');
    }
  }, [currentUser, activeView]);

  // main.tsx pre-loads module settings before first render for session-restore.
  // For fresh logins (user was on the login screen), load them here after login.
  const handleLogin = useCallback((user: AppUser) => {
    setCurrentUser(user);
    applyTheme(user.theme);
    navigate(landingView(user));
    api.get('/settings/modules')
      .then(r => moduleStore.init(r.data?.data?.disabled ?? []))
      .catch(() => {/* keep default on failure */});
    void initControlSettings();
  }, []);

  const handleLogout = useCallback(() => {
    authLogout();
    applyTheme('light');   // reset to light so the login screen isn't themed for the next user
    sessionStorage.removeItem('activeView');
    setCurrentUser(null);
  }, []);

  // Public portals are matched on the base-stripped path, so they work under any VITE_BASE_PATH
  // (e.g. "/xhrm/careers" resolves the same as "/careers"). Checked AFTER all hooks so the Rules of
  // Hooks are never violated by an early return.
  const portalPath = appPath();
  if (portalPath.startsWith('/careers'))    return <CareersPortal />;
  if (portalPath.startsWith('/schedule'))   return <SchedulingPortal />;
  if (portalPath.startsWith('/kiosk'))      return <AttendanceKiosk />;
  if (portalPath.startsWith('/onboarding')) return <OnboardingPortal />;

  const renderView = () => {
    // renderView only runs after the `!currentUser` guard below, so currentUser is non-null here.
    // The local narrows the type for ProtectedRoute's `user: AppUser` prop.
    const user = currentUser;
    if (!user) return null;
    // All routes now require permission check via ProtectedRoute
    // If user lacks permission, they see AccessDenied component
    switch (activeView) {
      case 'Dashboard': return <ProtectedRoute user={user} navKey="Dashboard"><Dashboard /></ProtectedRoute>;
      case 'Modules': return <ProtectedRoute user={user} navKey="Modules"><Modules onNavigate={navigate} /></ProtectedRoute>;
      case 'Employees': return <ProtectedRoute user={user} navKey="Employees"><Employees /></ProtectedRoute>;
      case 'EmployeeTransfers': return <ProtectedRoute user={user} navKey="EmployeeTransfers"><EmployeeTransfers /></ProtectedRoute>;
      case 'SelfOnboarding': return <ProtectedRoute user={user} navKey="SelfOnboarding"><SelfOnboarding /></ProtectedRoute>;
      case 'Company': return <ProtectedRoute user={user} navKey="Company"><Company /></ProtectedRoute>;
      case 'PcCodes': return <ProtectedRoute user={user} navKey="PcCodes"><PcCodes /></ProtectedRoute>;
      case 'PcCodeOrganogram': return <ProtectedRoute user={user} navKey="PcCodeOrganogram"><PcCodeOrganogram /></ProtectedRoute>;
      case 'Documents':         return <ProtectedRoute user={user} navKey="Documents"><Documents /></ProtectedRoute>;
      case 'PersonalDocuments': return <ProtectedRoute user={user} navKey="PersonalDocuments"><PersonalDocuments /></ProtectedRoute>;
      case 'LeaveManagement': return <ProtectedRoute user={user} navKey="LeaveManagement"><LeaveManagement /></ProtectedRoute>;
      case 'Leave': return <ProtectedRoute user={user} navKey="Leave"><LeaveManagement /></ProtectedRoute>;
      case 'LeaveSetup': return <ProtectedRoute user={user} navKey="LeaveSetup"><LeaveSetup /></ProtectedRoute>;
      case 'LeaveCalendar': return <ProtectedRoute user={user} navKey="LeaveCalendar"><LeaveCalendar /></ProtectedRoute>;
      case 'Salary': return <ProtectedRoute user={user} navKey="Salary"><Salary /></ProtectedRoute>;
      case 'Payroll': return <ProtectedRoute user={user} navKey="Payroll"><Payroll /></ProtectedRoute>;
      case 'Users': return <ProtectedRoute user={user} navKey="Users"><Users /></ProtectedRoute>;
      case 'System': return <ProtectedRoute user={user} navKey="System"><System /></ProtectedRoute>;
      case 'Settings': return <ProtectedRoute user={user} navKey="Settings"><Settings /></ProtectedRoute>;
      case 'AuditLogs': return <ProtectedRoute user={user} navKey="AuditLogs"><AuditLogs /></ProtectedRoute>;
      case 'LeaveSettings': return <ProtectedRoute user={user} navKey="Settings"><LeaveSettings /></ProtectedRoute>;
      case 'NotificationSettings': return <ProtectedRoute user={user} navKey="Settings"><NotificationSettings /></ProtectedRoute>;
      case 'AdminReports': return <ProtectedRoute user={user} navKey="AdminReports"><AdminReports /></ProtectedRoute>;
      case 'UserReports': return <ProtectedRoute user={user} navKey="UserReports"><UserReports /></ProtectedRoute>;
      case 'CentralApproval': return <ProtectedRoute user={user} navKey="CentralApproval"><CentralApproval onNavigate={navigate} /></ProtectedRoute>;
      case 'PersonalInfo':    return <ProtectedRoute user={user} navKey="PersonalInfo"><PersonalInfo /></ProtectedRoute>;
      case 'StaffOrganogram': return <ProtectedRoute user={user} navKey="StaffOrganogram"><StaffOrganogram /></ProtectedRoute>;
      case 'PersonalMedical': return <ProtectedRoute user={user} navKey="Medical"><PersonalMedical /></ProtectedRoute>;
      case 'AdminMedical':    return <ProtectedRoute user={user} navKey="AdminMedical"><AdminMedical /></ProtectedRoute>;
      case 'AdminTraining':    return <ProtectedRoute user={user} navKey="AdminTraining"><AdminTraining /></ProtectedRoute>;
      case 'PersonalTraining': return <ProtectedRoute user={user} navKey="PersonalTraining"><PersonalTraining /></ProtectedRoute>;
      case 'AdminAttendance':  return <ProtectedRoute user={user} navKey="AdminAttendance"><AdminAttendance /></ProtectedRoute>;
      case 'MyAttendance':     return <ProtectedRoute user={user} navKey="Attendance"><MyAttendance /></ProtectedRoute>;
      case 'Help':            return <ProtectedRoute user={user} navKey="Help"><Help /></ProtectedRoute>;
      case 'Recruitment':        return <ProtectedRoute user={user} navKey="Recruitment"><Recruitment onNavigate={navigate} /></ProtectedRoute>;
      case 'ManagePerformance':  return <ProtectedRoute user={user} navKey="ManagePerformance"><ManagePerformance /></ProtectedRoute>;
      case 'PersonalPerformance': return <ProtectedRoute user={user} navKey="PersonalPerformance"><PersonalPerformance /></ProtectedRoute>;
      case 'AiInsights':         return <ProtectedRoute user={user} navKey="AiInsights"><AiInsights /></ProtectedRoute>;
      default: return <ProtectedRoute user={user} navKey="Dashboard"><Dashboard /></ProtectedRoute>;
    }
  };

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-primary)] font-sans">
      <Header
        onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        onLogout={handleLogout}
        currentUser={currentUser}
        onNavigate={navigate}
      />
      <div className="flex flex-1 overflow-hidden relative">
        {isMobileMenuOpen && (
          <div
            className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
        <Sidebar
          currentUser={currentUser}
          activeView={activeView}
          setActiveView={(view) => {
            navigate(view);
            setIsMobileMenuOpen(false);
          }}
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />
        <main className="flex-1 overflow-y-auto w-full relative">
          {renderView()}
        </main>
      </div>
    </div>
  );
}
