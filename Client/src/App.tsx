import React, { useState, useCallback, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import ProtectedRoute from './components/ProtectedRoute';



import { Dashboard } from './components/Dashboard';













import { Login } from './components/Login';






















import { AppUser } from '../types/permissions';
import { logout as authLogout, getCurrentUser, onUserChange } from '@/lib/auth';
import { canAccessNav } from '@/lib/permissions';
import { moduleStore } from '@/lib/moduleState';
import { initControlSettings } from '@/lib/settings';
import { applyTheme } from '@/lib/theme';
import api from '@/lib/api';
import { appPath } from '@/lib/basePath';
import { useIdleTimeout } from './hooks/useIdleTimeout';

// ─────────────────────────────────────────────────────────────────────────────
// Route components are code-split: each becomes its own chunk, fetched the first time the user opens
// that screen. Previously all ~40 shipped in one 3 MB bundle that every user downloaded and
// re-parsed on every load — including the hard reload on logout — just to view a single page.
//
// The app shell (Sidebar, Header, ProtectedRoute), Login and Dashboard stay eager: they are needed
// for the first paint, so deferring them would only add a spinner to the critical path.
// ─────────────────────────────────────────────────────────────────────────────
const AdminAttendance = lazy(() => import('./components/Attendance').then(m => ({ default: m.AdminAttendance })));
const AdminMedical = lazy(() => import('./components/Medical').then(m => ({ default: m.AdminMedical })));
const AdminReports = lazy(() => import('./components/AdminReports').then(m => ({ default: m.AdminReports })));
const AdminTraining = lazy(() => import('./components/Training').then(m => ({ default: m.AdminTraining })));
const AiInsights = lazy(() => import('./components/AiInsights').then(m => ({ default: m.AiInsights })));
const AttendanceKiosk = lazy(() => import('./components/AttendanceKiosk').then(m => ({ default: m.AttendanceKiosk })));
const AuditLogs = lazy(() => import('./components/AuditLogs').then(m => ({ default: m.AuditLogs })));
const CareersPortal = lazy(() => import('./components/CareersPortal').then(m => ({ default: m.CareersPortal })));
const CentralApproval = lazy(() => import('./components/CentralApproval').then(m => ({ default: m.CentralApproval })));
const Company = lazy(() => import('./components/Company').then(m => ({ default: m.Company })));
const Documents = lazy(() => import('./components/Document').then(m => ({ default: m.Documents })));
const EmployeeTransfers = lazy(() => import('./components/EmployeeTransfers').then(m => ({ default: m.EmployeeTransfers })));
const Employees = lazy(() => import('./components/Employees').then(m => ({ default: m.Employees })));
const Help = lazy(() => import('./components/Help').then(m => ({ default: m.Help })));
const LeaveCalendar = lazy(() => import('./components/LeaveCalendar').then(m => ({ default: m.LeaveCalendar })));
const LeaveManagement = lazy(() => import('./components/LeaveManagement').then(m => ({ default: m.LeaveManagement })));
const LeaveSettings = lazy(() => import('./components/LeaveSettings').then(m => ({ default: m.LeaveSettings })));
const LeaveSetup = lazy(() => import('./components/LeaveSetup').then(m => ({ default: m.LeaveSetup })));
const ManagePerformance = lazy(() => import('./components/ManagePerformance').then(m => ({ default: m.ManagePerformance })));
const Modules = lazy(() => import('./components/Modules').then(m => ({ default: m.Modules })));
const MyAttendance = lazy(() => import('./components/Attendance').then(m => ({ default: m.MyAttendance })));
const NotificationSettings = lazy(() => import('./components/NotificationSettings').then(m => ({ default: m.NotificationSettings })));
const OnboardingPortal = lazy(() => import('./components/OnboardingPortal').then(m => ({ default: m.OnboardingPortal })));
const Payroll = lazy(() => import('./components/Payroll').then(m => ({ default: m.Payroll })));
const PcCodeOrganogram = lazy(() => import('./components/PcCodeOrganogram').then(m => ({ default: m.PcCodeOrganogram })));
const PcCodes = lazy(() => import('./components/PcCodes').then(m => ({ default: m.PcCodes })));
const PersonalDocuments = lazy(() => import('./components/PersonalDocuments').then(m => ({ default: m.PersonalDocuments })));
const PersonalInfo = lazy(() => import('./components/PersonalInfo').then(m => ({ default: m.PersonalInfo })));
const PersonalMedical = lazy(() => import('./components/Medical').then(m => ({ default: m.PersonalMedical })));
const PersonalPerformance = lazy(() => import('./components/PersonalPerformance').then(m => ({ default: m.PersonalPerformance })));
const PersonalTraining = lazy(() => import('./components/Training').then(m => ({ default: m.PersonalTraining })));
const Recruitment = lazy(() => import('./components/Recruitment').then(m => ({ default: m.Recruitment })));
const Salary = lazy(() => import('./components/Salary').then(m => ({ default: m.Salary })));
const SchedulingPortal = lazy(() => import('./components/SchedulingPortal').then(m => ({ default: m.SchedulingPortal })));
const SelfOnboarding = lazy(() => import('./components/SelfOnboarding').then(m => ({ default: m.SelfOnboarding })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const StaffOrganogram = lazy(() => import('./components/StaffOrganogram').then(m => ({ default: m.StaffOrganogram })));
const System = lazy(() => import('./components/System').then(m => ({ default: m.System })));
const UserReports = lazy(() => import('./components/UserReports').then(m => ({ default: m.UserReports })));
const Users = lazy(() => import('./components/Users').then(m => ({ default: m.Users })));


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

// Inactivity policy. 30 minutes matches the usual expectation for an internal HR tool: long enough
// not to interrupt someone reading a long report, short enough that a walked-away-from desk does
// not stay logged in all afternoon. The last 60s are a warning the user can cancel.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_WARN_MS    = 60 * 1000;

/** Shown while a route's chunk downloads. Deliberately minimal — most chunks load in well under a
 *  second on a warm cache, so anything heavier flashes and draws attention to itself. */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-full w-full py-20" role="status" aria-label="Loading">
      <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
    </div>
  );
}

export default function App() {
  // All hooks must run unconditionally on every render (Rules of Hooks). The public-portal early
  // returns therefore come AFTER the hooks below — never before them.
  const [currentUser, setCurrentUser] = useState<AppUser | null>(loadCurrentUser);
  const [activeView, setActiveView] = useState<string>(() => loadActiveView(currentUser));
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // logout() revokes the refresh token server-side and then hard-reloads to '/'. That is a
  // deliberate full teardown (see lib/auth.ts), but it leaves a gap with nothing on screen — so
  // cover it rather than letting the app look frozen.
  const [isSigningOut, setIsSigningOut] = useState(false);

  const navigate = (view: string) => {
    sessionStorage.setItem('activeView', view);
    setActiveView(view);
  };

  // Notification clicks only. A user can be a legitimate approver (named in an approval flow) without
  // holding the target module's nav permission — sending them to that module would dead-end on Access
  // Denied. Central Approval admits approvers by design and is where they can action the request, so
  // fall back to it. Deliberately NOT applied to navigate(): sidebar/menu clicks must go where the
  // user asked, and silently redirecting them would be wrong.
  const navigateFromNotification = (view: string) => {
    const blocked = currentUser && !canAccessNav(currentUser, view);
    navigate(blocked && canAccessNav(currentUser, 'CentralApproval') ? 'CentralApproval' : view);
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
    // Paint the overlay before authLogout() so the wait is explained. authLogout is async — it
    // awaits the server-side revoke before replacing the location — and is deliberately not awaited
    // here: the reload ends this page either way, and blocking would only delay the overlay.
    setIsSigningOut(true);
    applyTheme('light');   // reset to light so the login screen isn't themed for the next user
    sessionStorage.removeItem('activeView');
    void authLogout();
  }, []);

  // Auto sign-out on inactivity. Armed only while someone is logged in and not already signing
  // out, so it never fires on the login screen or races the logout reload.
  const { secondsLeft, dismissWarning } = useIdleTimeout({
    timeoutMs: IDLE_TIMEOUT_MS,
    warnMs:    IDLE_WARN_MS,
    enabled:   !!currentUser && !isSigningOut,
    onIdle:    handleLogout,
  });

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

  // Rendered ahead of the login guard: the reload is what actually ends this page, so the overlay
  // must stay up until the browser navigates rather than flashing the login screen underneath.
  if (isSigningOut) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-4 bg-[var(--bg)] text-[var(--text-primary)]"
           role="status" aria-live="polite">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
        <p className="text-[13px] font-medium text-[var(--text-secondary)]">Signing out…</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--text-primary)] font-sans">
      <Header
        onMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        onLogout={handleLogout}
        currentUser={currentUser}
        onNavigate={navigateFromNotification}
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
          <Suspense fallback={<RouteFallback />}>{renderView()}</Suspense>
        </main>
      </div>

      {/* Inactivity warning. Any interaction resets the timer via the hook's own listeners, so the
          button only needs to dismiss the banner — the click itself is the activity. */}
      {secondsLeft !== null && (
        <div className="fixed inset-x-0 bottom-0 z-[200] flex justify-center p-4" role="alertdialog" aria-live="assertive">
          <div className="flex items-center gap-4 rounded-[12px] border border-[var(--warning)] bg-[var(--surface)] px-5 py-3.5 shadow-lg">
            <div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)]">Still there?</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                You&apos;ll be signed out in {secondsLeft}s to protect your data.
              </p>
            </div>
            <button className="primary-btn" onClick={dismissWarning}>Stay signed in</button>
          </div>
        </div>
      )}
    </div>
  );
}
