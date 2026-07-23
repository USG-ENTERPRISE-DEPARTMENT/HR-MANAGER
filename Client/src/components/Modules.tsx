import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users, CalendarCheck, Banknote, Building2,
  ShieldAlert, PieChart, FolderOpen, Briefcase, GraduationCap,
  Stethoscope, TrendingUp, Clock,
  ArrowUpRight, Search, LayoutGrid, List
} from 'lucide-react';
import { usePermission } from '../../hooks/usePermission';
import { getCurrentUser } from '../../lib/auth';
import { useEnabledModules, moduleStore, ALL_MODULE_IDS } from '../../lib/moduleState';
import api from '../../lib/api';
import { toast } from 'sonner';
import { PageHeader } from './ui/PageHeader';
import { HairlineDecor } from './ui/HairlineDecor';

/* ─────────────────────────────────────────────────────────────────────────────
   DESIGN TOKENS
   Colors encode CATEGORY, not "one per card". Three semantic ramps:
     blue  → core business ops  (Employees, Organisation, Admin)
     teal  → people & growth    (Leave, Recruitment, Training)
     amber → finance & data     (Payroll, Salary, Analytics, Documents)
───────────────────────────────────────────────────────────────────────────── */
const RAMP = {
  blue:  { bg: 'rgba(55,138,221,0.09)',  border: 'rgba(55,138,221,0.20)',  icon: '#378ADD', tag: '#185FA5' },
  teal:  { bg: 'rgba(29,158,117,0.09)',  border: 'rgba(29,158,117,0.20)',  icon: '#1D9E75', tag: '#0F6E56' },
  amber: { bg: 'rgba(186,117,23,0.09)', border: 'rgba(186,117,23,0.20)',  icon: '#BA7517', tag: '#854F0B' },
};

const modules = [
  { id: 'Employees',       icon: Users,         title: 'Employee Directory',     desc: 'Personnel records, onboarding workflows, and complete employee profile management.',      tag: 'Core',         ramp: 'blue',  stat: '200 employees',    statColor: '#378ADD' },
  { id: 'LeaveManagement', icon: CalendarCheck, title: 'Leave Management',       desc: 'Time-off requests, public holiday calendars, approval chains, and leave balances.',       tag: 'HR',           ramp: 'teal',  stat: '12 pending',       statColor: '#f59e0b' },
  { id: 'Payroll',         icon: Banknote,      title: 'Payroll & Salary',       desc: 'Payroll cycles, payslip generation, salary structures, pay grades, and compensation policy.', tag: 'Finance', ramp: 'amber', stat: 'Last run: Jan', statColor: '#10b981' },
  { id: 'Insights',        icon: PieChart,      title: 'Analytics & Reports',    desc: 'Custom report generation, trend visualisation, and organisation-wide insights.',          tag: 'Intelligence', ramp: 'amber', stat: '24 reports',       statColor: '#BA7517' },
  { id: 'Company',         icon: Building2,     title: 'Organisation Structure', desc: 'Departments, branches, reporting lines, and full company hierarchy configuration.',      tag: 'Core',         ramp: 'blue',  stat: '5 branches',       statColor: '#378ADD' },
  { id: 'Recruitment',     icon: Briefcase,     title: 'Recruitment',            desc: 'Job postings, applicant tracking pipeline, and interview panel scheduling.',              tag: 'HR',           ramp: 'teal',  stat: '16 applicants',    statColor: '#1D9E75' },
  { id: 'Training',        icon: GraduationCap, title: 'Training & Development', desc: 'Employee courses, certifications, skills matrices, and learning path design.',            tag: 'Growth',       ramp: 'teal',  stat: '7 active courses', statColor: '#1D9E75' },
  { id: 'Documents',       icon: FolderOpen,    title: 'Document Centre',        desc: 'Secure storage, organisation, and sharing of company files and HR policies.',            tag: 'Operations',   ramp: 'amber', stat: '340 files',        statColor: '#BA7517' },
  { id: 'Admin',        icon: ShieldAlert,  title: 'System Administration',  desc: 'Roles, permissions, audit logs, and global platform configuration settings.',           tag: 'Core',    ramp: 'blue',  stat: '3 admins',        statColor: '#64748b' },
  { id: 'Medical',      icon: Stethoscope,  title: 'Medical Claims',         desc: 'Employee medical reimbursements, hospital visits, pharmacy claims, and GL postings.',      tag: 'HR',      ramp: 'teal',  stat: '0 pending',       statColor: '#1D9E75' },
  { id: 'Performance',  icon: TrendingUp,   title: 'Performance Management', desc: 'Appraisal cycles, KPI tracking, review scores, and performance history.',                  tag: 'Growth',  ramp: 'teal',  stat: '0 reviews',       statColor: '#1D9E75' },
  { id: 'Attendance',   icon: Clock,        title: 'Time & Attendance',      desc: 'Clock in/out, biometric device sync, kiosk punching, timesheets, and absence tracking.',   tag: 'HR',      ramp: 'teal',  stat: 'Live tracking',   statColor: '#1D9E75' },
];

const TAGS = ['All', 'Core', 'HR', 'Finance', 'Intelligence', 'Operations', 'Growth'];

const MODULE_TITLE_TYPOGRAPHY: React.CSSProperties = {
  fontSize: '14.5px',
  fontWeight: 700,
  lineHeight: 1.25,
  letterSpacing: '-0.025em',
};

const MODULE_TAG_TYPOGRAPHY: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  lineHeight: 1.4,
};

const MODULE_DESCRIPTION_TYPOGRAPHY: React.CSSProperties = {
  fontSize: '12px',
  lineHeight: 1.7,
};

const MODULE_STAT_TYPOGRAPHY: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
};


/* ─────────────────────────────────────────────────────────────────────────────
   MODULE CARD
   Hover state driven by direct DOM style mutation — avoids React re-renders
   on every mousemove event tick that setState() would cause.
───────────────────────────────────────────────────────────────────────────── */
function ModuleCard({ key,mod, index, onClick, isSettings, isEnabled, onToggle }) {
  const Icon = mod.icon;
  const r = RAMP[mod.ramp];

  const handleMouseEnter = (e) => {
    const el = e.currentTarget;
    if (isSettings && !isEnabled) return;
    el.style.borderColor = r.border;
    el.style.boxShadow = `0 8px 32px -8px rgba(0,0,0,0.14), inset 0 0 0 1px ${r.border}`;
    const iconEl = el.querySelector('.card-icon');
    if (iconEl) iconEl.style.transform = 'scale(1.07)';
    const arrowEl = el.querySelector('.card-arrow');
    if (arrowEl) {
      arrowEl.style.color = r.icon;
      arrowEl.style.transform = 'translate(2px,-2px)';
    }
  };

  const handleMouseLeave = (e) => {
    const el = e.currentTarget;
    if (isSettings && !isEnabled) return;
    el.style.borderColor = 'var(--border)';
    el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
    const iconEl = el.querySelector('.card-icon');
    if (iconEl) iconEl.style.transform = 'scale(1)';
    const arrowEl = el.querySelector('.card-arrow');
    if (arrowEl) {
      arrowEl.style.color = 'var(--text-muted)';
      arrowEl.style.transform = 'translate(0,0)';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: index * 0.04, duration: 0.36, ease: [0.23, 1, 0.32, 1] }}
      onClick={() => {
        if (isSettings) onToggle(mod.id);
        else onClick();
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '22px 20px 18px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color .2s ease, box-shadow .2s ease, opacity .2s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        opacity: isSettings && !isEnabled ? 0.6 : 1,
        ...(isSettings && !isEnabled ? { filter: 'grayscale(0.6)' } : {})
      }}
    >
      {/* Tinted wash + hairline corner arcs (matches Attendance/Help cards) */}
      <HairlineDecor color={r.icon} />

      {/* Content sits above the decoration */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Top row — icon + category badge + toggle */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div
            className="card-icon"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: r.bg,
              border: `1px solid ${r.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: r.icon,
              flexShrink: 0,
              transition: 'transform .2s ease',
            }}
          >
            <Icon size={19} strokeWidth={1.75} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          {isSettings && (
            <div
              style={{
                width: '36px', height: '20px', borderRadius: '100px',
                background: isEnabled ? 'var(--accent)' : 'var(--border)',
                position: 'relative', transition: 'background 0.2s',
                cursor: 'pointer'
              }}
            >
              <div style={{
                position: 'absolute', top: '2px', left: isEnabled ? '18px' : '2px',
                width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }} />
            </div>
          )}
          {/* Category badge — text uses same ramp's dark stop, never raw black */}
          <span
            style={{
              ...MODULE_TAG_TYPOGRAPHY,
              color: r.tag,
              background: r.bg,
              border: `1px solid ${r.border}`,
              borderRadius: '100px',
              padding: '3px 9px',
            }}
          >
            {mod.tag}
          </span>
        </div>
      </div>

      {/* Title — clear size step above description */}
      <h3
        className="syne"
        style={{
          ...MODULE_TITLE_TYPOGRAPHY,
          color: 'var(--text-primary)',
          margin: '0 0 7px',
        }}
      >
        {mod.title}
      </h3>

      {/* Description — visually subordinate, comfortable line height */}
      <p
        style={{
          ...MODULE_DESCRIPTION_TYPOGRAPHY,
          color: 'var(--text-muted)',
          margin: 0,
          flex: 1,
        }}
      >
        {mod.desc}
      </p>

      {/* Footer — colored dot anchors the stat, arrow responds to hover */}
      <div
        style={{
          marginTop: '18px',
          paddingTop: '13px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: mod.statColor,
              flexShrink: 0,
            }}
          />
          <span style={{ ...MODULE_STAT_TYPOGRAPHY, color: 'var(--text-muted)' }}>
            {mod.stat}
          </span>
        </div>

        <span
          className="card-arrow"
          style={{
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-muted)',
            transition: 'color .18s ease, transform .18s ease',
          }}
        >
          <ArrowUpRight size={15} strokeWidth={2} />
        </span>
      </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MODULE ROW (LIST VIEW)
───────────────────────────────────────────────────────────────────────────── */
function ModuleRow({ mod, index, onClick, isSettings, isEnabled, onToggle }: any) {
  const Icon = mod.icon;
  const r = RAMP[mod.ramp as keyof typeof RAMP];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.99 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      onClick={() => {
        if (isSettings) onToggle(mod.id);
        else onClick();
      }}
      className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl cursor-pointer"
      style={{
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        opacity: isSettings && !isEnabled ? 0.6 : 1,
        ...(isSettings && !isEnabled ? { filter: 'grayscale(0.6)' } : {})
      }}
    >
      <div className="flex items-center gap-3 w-full sm:w-auto">
        <div
          className="shrink-0 flex items-center justify-center rounded-[10px] w-10 h-10"
          style={{
            background: r.bg,
            border: `1px solid ${r.border}`,
            color: r.icon,
          }}
        >
          <Icon size={18} strokeWidth={2} />
        </div>

        <div className="flex-1 min-w-0 sm:hidden">
          <div className="flex items-center gap-2 mb-1">
             <h3 className="syne m-0 text-[var(--text-primary)] truncate" style={MODULE_TITLE_TYPOGRAPHY}>{mod.title}</h3>
             <span className="shrink-0 px-1.5 py-0.5 rounded-full border whitespace-nowrap" style={{ ...MODULE_TAG_TYPOGRAPHY, background: r.bg, color: r.tag, borderColor: r.border }}>{mod.tag}</span>
          </div>
          <p className="text-[var(--text-muted)] m-0 truncate" style={MODULE_DESCRIPTION_TYPOGRAPHY}>{mod.desc}</p>
        </div>
        
        {/* Right side stuff on mobile */}
        <div className="flex items-center gap-3 shrink-0 ml-auto sm:hidden">
          {isSettings ? (
            <div
              className="relative w-9 h-5 rounded-full transition-colors duration-200"
              style={{ background: isEnabled ? 'var(--accent)' : 'var(--border)' }}
            >
              <div 
                className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
                style={{ left: isEnabled ? '18px' : '2px' }} 
              />
            </div>
          ) : (
            <ArrowUpRight size={16} className="text-[var(--text-muted)]" />
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 hidden sm:block">
         <div className="flex items-center gap-2 mb-1">
            <h3 className="syne m-0 text-[var(--text-primary)] truncate" style={MODULE_TITLE_TYPOGRAPHY}>{mod.title}</h3>
            <span className="shrink-0 px-1.5 py-0.5 rounded-full border whitespace-nowrap" style={{ ...MODULE_TAG_TYPOGRAPHY, background: r.bg, color: r.tag, borderColor: r.border }}>{mod.tag}</span>
         </div>
         <p className="text-[var(--text-muted)] m-0 truncate" style={MODULE_DESCRIPTION_TYPOGRAPHY}>{mod.desc}</p>
      </div>

      <div className="hidden sm:flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-1.5 hidden lg:flex">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: mod.statColor }} />
          <span className="text-[var(--text-muted)] whitespace-nowrap" style={MODULE_STAT_TYPOGRAPHY}>{mod.stat}</span>
        </div>

        {isSettings ? (
          <div
            className="relative w-9 h-5 rounded-full transition-colors duration-200"
            style={{ background: isEnabled ? 'var(--accent)' : 'var(--border)' }}
          >
            <div 
              className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200"
              style={{ left: isEnabled ? '18px' : '2px' }} 
            />
          </div>
        ) : (
          <ArrowUpRight size={16} className="text-[var(--text-muted)]" />
        )}
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   FILTER PILL — with live count badge
───────────────────────────────────────────────────────────────────────────── */
function FilterPill({ label, active, count, onClick }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '30px',
        padding: '0 12px',
        borderRadius: '100px',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all .15s ease',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      <span
        style={{
          fontSize: '10px',
          fontWeight: 700,
          background: active ? 'var(--accent)' : 'var(--border)',
          color: active ? '#fff' : 'var(--text-muted)',
          borderRadius: '100px',
          padding: '1px 5px',
          lineHeight: 1.5,
          transition: 'all .15s ease',
          minWidth: '16px',
          textAlign: 'center',
        }}
      >
        {count}
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export function Modules({ onNavigate, isSettings = false }: any) {
  const [activeTag, setActiveTag] = useState('All');
  const [query, setQuery]         = useState('');
  const [viewMode, setViewMode]   = useState<'grid' | 'list'>('grid');
  const [liveStats, setLiveStats] = useState<Record<string, string> | null>(null);
  const { enabled: enabledModules } = useEnabledModules();

  // Live per-module stat for each card — org-wide when the user can manage the module,
  // otherwise scoped to their own data (the backend decides based on permissions).
  useEffect(() => {
    let active = true;
    api.get('/dashboard/module-stats')
      .then(r => { if (active) setLiveStats(r.data?.data ?? r.data ?? {}); })
      .catch(() => { if (active) setLiveStats({}); });
    return () => { active = false; };
  }, []);

  const statFor = (modId: string, fallback: string): string =>
    liveStats === null ? '…' : (liveStats[modId] ?? fallback);

  async function saveDisabled(disabled: string[]) {
    await api.put('/settings/modules', { disabled }).catch(() => toast.error('Failed to save module settings'));
  }

  function toggleModule(id: string) {
    const disabled = moduleStore.toggle(id);
    saveDisabled(disabled);
  }

  function toggleAll() {
    const disabled = moduleStore.toggleAll();
    saveDisabled(disabled);
  }

  const { canNav } = usePermission(getCurrentUser());

  // Resolve where a module card should navigate for THIS user.
  // Priority: an admin/management view the user can access → otherwise the module's
  // personal page (open to all). Returns null when the user can access neither — such
  // modules are management-only with no personal page and are hidden for normal users.
  function resolveTarget(modId: string): string | null {
    switch (modId) {
      case 'LeaveManagement':
        if (canNav('LeaveSetup'))    return 'LeaveSetup';
        return 'LeaveManagement';        // personal leave — open to all
      case 'Documents':
        if (canNav('Documents'))     return 'Documents';
        return 'PersonalDocuments';      // personal — open to all
      case 'Medical':
      case 'AdminMedical':
      case 'PersonalMedical':
        if (canNav('AdminMedical'))  return 'AdminMedical';
        return 'PersonalMedical';        // personal — open to all
      case 'Insights':
        if (canNav('AdminReports'))  return 'AdminReports';
        return 'UserReports';            // personal — open to all
      case 'Training':
        if (canNav('AdminTraining')) return 'AdminTraining';
        return 'PersonalTraining';       // personal — open to all
      case 'Attendance':
        if (canNav('AdminAttendance')) return 'AdminAttendance';
        return 'MyAttendance';           // personal — open to all
      case 'Performance':
        if (canNav('ManagePerformance')) return 'ManagePerformance';
        return 'PersonalPerformance';    // personal — open to all
      // ── Management-only modules: no personal page → null when no access ──
      case 'Payroll':
        if (canNav('Salary'))        return 'Salary';
        if (canNav('Payroll'))       return 'Payroll';
        return null;
      case 'Admin':
        if (canNav('JobTitleSetups')) return 'JobTitleSetups';
        if (canNav('System'))         return 'System';
        return null;
      case 'Employees':
        return canNav('Employees')   ? 'Employees'   : null;
      case 'Company':
        return canNav('Company')     ? 'Company'     : null;
      case 'Recruitment':
        return canNav('Recruitment') ? 'Recruitment' : null;
      default:
        return modId;
    }
  }

  // A module is reachable when it resolves to a view this user can open.
  const canAccessModule = (modId: string) => resolveTarget(modId) !== null;

  function openModule(modId: string) {
    const target = resolveTarget(modId);
    if (target) onNavigate?.(target);
  }

  const filtered = modules.filter((m) => {
    // In normal mode, only show enabled modules the user can actually open
    // (an admin view they have access to, or a personal page). Settings mode shows all.
    if (!isSettings && !enabledModules.includes(m.id)) return false;
    if (!isSettings && !canAccessModule(m.id)) return false;

    const matchTag    = activeTag === 'All' || m.tag === activeTag;
    const q           = query.toLowerCase();
    const matchSearch = !q || m.title.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q) || m.tag.toLowerCase().includes(q);
    return matchTag && matchSearch;
  });

  const countByTag = (tag: string) =>
    modules.filter((m) => {
      if (!isSettings && !enabledModules.includes(m.id)) return false;
      if (!isSettings && !canAccessModule(m.id)) return false;
      return tag === 'All' || m.tag === tag;
    }).length;

  return (
    <div
      style={{
        padding: 'clamp(24px, 4vw, 44px) clamp(16px, 4vw, 40px)',
        width: '100%',
        maxWidth: '1400px',
        margin: '0 auto',
        minHeight: '100%',
      }}
    >
      {/* ── PAGE HEADER ────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '24px',
          flexWrap: 'wrap',
          marginBottom: '28px',
        }}
      >
        <div style={{ flex: '1 1 300px' }}>
          <PageHeader title="Modules" subtitle="Access and manage every capability within the portal. Select a module below to get started." />
          
        </div>

        {/* Header Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {isSettings && (
            <button
              onClick={() => toggleAll()}
              className="secondary-btn"
              style={{ height: '40px' }}
            >
              {enabledModules.length === ALL_MODULE_IDS.length ? 'Disable All' : 'Enable All'}
            </button>
          )}

          <div style={{ 
            display: 'flex', 
            background: 'var(--surface)', 
            border: '1px solid var(--border)', 
            borderRadius: '10px', 
            padding: '4px',
            height: '40px'
          }}>
             <button 
               onClick={() => setViewMode('grid')} 
               style={{
                 width: '32px', height: '30px', 
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 borderRadius: '6px', border: 'none', cursor: 'pointer',
                 background: viewMode === 'grid' ? 'var(--bg-hover)' : 'transparent',
                 color: viewMode === 'grid' ? 'var(--text-primary)' : 'var(--text-muted)'
               }}
             >
                <LayoutGrid size={16} />
             </button>
             <button 
               onClick={() => setViewMode('list')} 
               style={{
                 width: '32px', height: '30px', 
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 borderRadius: '6px', border: 'none', cursor: 'pointer',
                 background: viewMode === 'list' ? 'var(--bg-hover)' : 'transparent',
                 color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)'
               }}
             >
                <List size={16} />
             </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '0 14px',
              height: '40px',
              width: 'clamp(190px, 24vw, 268px)',
              flexShrink: 0,
              transition: 'border-color .15s ease',
            }}
            onFocusCapture={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlurCapture={(e)  => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules…"
              aria-label="Search modules"
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '13px',
                color: 'var(--text-primary)',
                width: '100%',
                fontFamily: 'inherit',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                  fontSize: '18px',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── COLOR LEGEND — explains what the 3 ramps mean ──────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
        style={{
          display: 'flex',
          gap: '20px',
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: '18px',
          padding: '10px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
        }}
      >
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--text-muted)',
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          Colour key
        </span>

        {[
          { label: 'Business ops',   ramp: 'blue'  },
          { label: 'People & growth', ramp: 'teal'  },
          { label: 'Finance & data', ramp: 'amber' },
        ].map(({ label, ramp }) => {
          const r = RAMP[ramp as keyof typeof RAMP];
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '10px', height: '10px', borderRadius: '3px',
                  background: r.bg, border: `1px solid ${r.border}`,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '12px', color: r.tag, fontWeight: 600 }}>{label}</span>
            </div>
          );
        })}

        {/* Live count — right-aligned */}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '12px',
            color: 'var(--text-muted)',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          {filtered.length} of {modules.length} modules
        </span>
      </motion.div>

      {/* ── FILTER PILLS ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12 }}
        style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '22px' }}
      >
        {TAGS.map((tag) => (
          <FilterPill
            key={tag}
            label={tag}
            active={activeTag === tag}
            count={countByTag(tag)}
            onClick={() => setActiveTag(tag)}
          />
        ))}
      </motion.div>

      {/* ── MODULE GRID/LIST ────────────────────────────────────────────────────── */}
      <AnimatePresence mode="popLayout">
        {filtered.length > 0 ? (
          <motion.div
            key="grid"
            layout
            style={{
              display: viewMode === 'grid' ? 'grid' : 'flex',
              flexDirection: viewMode === 'grid' ? 'row' : 'column',
              gridTemplateColumns: viewMode === 'grid' ? 'repeat(auto-fill, minmax(260px, 1fr))' : 'none',
              gap: '14px',
            }}
          >
            {filtered.map((mod, i) => {
              const liveMod = { ...mod, stat: statFor(mod.id, '—') };
              return viewMode === 'grid' ? (
                <ModuleCard
                  key={mod.id}
                  mod={liveMod}
                  index={i}
                  isSettings={isSettings}
                  isEnabled={enabledModules.includes(mod.id)}
                  onToggle={toggleModule}
                  onClick={() => openModule(mod.id)}
                />
              ) : (
                <ModuleRow
                  key={mod.id}
                  mod={liveMod}
                  index={i}
                  isSettings={isSettings}
                  isEnabled={enabledModules.includes(mod.id)}
                  onToggle={toggleModule}
                  onClick={() => openModule(mod.id)}
                />
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '80px 20px',
              textAlign: 'center',
              gap: '10px',
            }}
          >
            <Search size={32} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
            <p
              className="syne"
              style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}
            >
              No modules found
            </p>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Try a different search term or category filter.
            </p>
            <button
              onClick={() => { setQuery(''); setActiveTag('All'); }}
              style={{
                marginTop: '10px',
                padding: '8px 18px',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Clear filters
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
