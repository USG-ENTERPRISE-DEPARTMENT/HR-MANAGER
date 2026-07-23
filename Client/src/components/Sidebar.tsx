import React, { useState } from 'react';
import {
  ShieldAlert, Users, FileText, Settings, PieChart,
  User, CalendarCheck, FolderOpen, Building2, FileSpreadsheet,
  ChevronRight, ChevronDown, LayoutDashboard, X,
  PanelLeftClose, PanelLeftOpen, Banknote, CheckCircle, HelpCircle, Stethoscope, Briefcase, TrendingUp, GraduationCap, Clock, Network
} from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { AppUser } from '@/types/permissions';
import { useEnabledModules } from '@/lib/moduleState';


interface SidebarProps {
  currentUser: AppUser;
  activeView: string;
  setActiveView: (view: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

type MenuItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  id?: string;
  moduleIds?: string[];
  hasSubmenu?: boolean;
  subItems?: { label: string; id: string }[];
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

const menuSections: MenuSection[] = [
  {
    title: 'Main Menu',
    items: [
      {
        icon: LayoutDashboard,
        label: 'Dashboard',
        hasSubmenu: true,
        subItems: [
          { label: 'Overview', id: 'Dashboard' },
          { label: 'Modules',  id: 'Modules'   },
        ],
      },
      // {
      //   icon: ShieldAlert,
      //   label: 'Admin',
      //   hasSubmenu: true,
      //   subItems: [
      //     { label: 'Job Title Setups',    id: 'JobTitleSetups'     },
      //     { label: 'Qualification Setups', id: 'QualificationSetups' },
      //     { label: 'Leaving Settings',    id: 'LeavingSettings'    },
      //   ],
      // },
      { icon: FileText,      label: 'Admin Reports',      id: 'AdminReports'    },
      { icon: CheckCircle,   label: 'Central Approval',   id: 'CentralApproval' },
      { icon: User,          label: 'Personal Info',      id: 'PersonalInfo'    },
      { icon: Network,       label: 'Staff Organogram',   id: 'StaffOrganogram' },
      { icon: FileSpreadsheet, label: 'User Reports',     id: 'UserReports'     },
    ],
  },
  {
    title: 'Management',
    items: [
      {
        icon: Users,
        label: 'Employees',
        moduleIds: ['Employees'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Employees', id: 'Employees'      },
          { label: 'Self-Onboard Setup',  id: 'SelfOnboarding' },
          { label: 'AI Insights',      id: 'AiInsights'     },
          { label: 'Employee Transfers', id: 'EmployeeTransfers' },
        ],
      },
      { icon: Building2, label: 'Company',   moduleIds: ['Company'],       hasSubmenu: true },
      { icon: Briefcase, label: 'PC Codes',           id: 'PcCodes'          },
      { icon: Network,   label: 'PC Code Organogram', id: 'PcCodeOrganogram' },
      {
        icon: FolderOpen,
        label: 'Documents',
        moduleIds: ['Documents'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Documents',   id: 'Documents'         },
          { label: 'Personal Documents', id: 'PersonalDocuments' },
        ],
      },
      {
        icon: CalendarCheck,
        label: 'Leave',
        id: 'Leave',
        moduleIds: ['LeaveManagement'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Leave',    id: 'LeaveSetup'      },
          { label: 'Leave Calendar', id: 'LeaveCalendar'   },
          { label: 'Personal Leave', id: 'LeaveManagement' },
        ],
      },
      {
        icon: Banknote,
        label: 'Payroll',
        moduleIds: ['Payroll'],
        hasSubmenu: true,
        subItems: [
          { label: 'Salary Setup',  id: 'Salary'  },
          { label: 'Payroll', id: 'Payroll' },
        ],
      },
      {
        icon: Stethoscope,
        label: 'Medical',
        moduleIds: ['Medical'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Medical',   id: 'AdminMedical'    },
          { label: 'Personal Medical', id: 'PersonalMedical' },
        ],
      },
      { icon: Briefcase, label: 'Recruitment', moduleIds: ['Recruitment'], id: 'Recruitment' },
      {
        icon: TrendingUp,
        label: 'Performance',
        moduleIds: ['Performance'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Performance',   id: 'ManagePerformance'   },
          { label: 'Personal Performance', id: 'PersonalPerformance' },
        ],
      },
      {
        icon: GraduationCap,
        label: 'Training',
        moduleIds: ['Training'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Training',   id: 'AdminTraining'    },
          { label: 'Personal Training', id: 'PersonalTraining' },
        ],
      },
      {
        icon: Clock,
        label: 'Attendance',
        moduleIds: ['Attendance'],
        hasSubmenu: true,
        subItems: [
          { label: 'Manage Attendance', id: 'AdminAttendance' },
          { label: 'My Attendance',     id: 'MyAttendance'    },
        ],
      },
      { icon: Users, label: 'Users', hasSubmenu: true },
    ],
  },
  {
    title: 'Support',
    items: [
      {
        icon: Settings,
        label: 'System',
        hasSubmenu: true,
        subItems: [
          { label: 'App Setup', id: 'System' },
          { label: 'Settings', id: 'Settings' },
          { label: 'Audit Logs', id: 'AuditLogs' },
        ],
      },
      { icon: HelpCircle,  label: 'Help',   id: 'Help'       },
    ],
  },
];

export function Sidebar({ currentUser,activeView, setActiveView, isOpen, onClose }: SidebarProps) {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { canNav } = usePermission(currentUser);
  const { enabled: enabledModules } = useEnabledModules();


  const toggleSubmenu = (label: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCollapsed) return;
    setExpandedItems(prev =>
      prev.includes(label) ? prev.filter(i => i !== label) : [...prev, label]
    );
  };

  return (
    <aside
      style={{
        width: isCollapsed ? 68 : 232,
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}
      className={`
        fixed inset-y-0 left-0 lg:static
        bg-[var(--surface)] border-r border-[var(--border)]
        flex-shrink-0 flex flex-col h-full overflow-hidden
        shadow-[1px_0_0_0_var(--border)] lg:shadow-none z-50
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
    >
      {/* ── PROFILE HEADER ─────────────────────────────────────────── */}
      <div
        className="flex items-center border-b border-[var(--border)] shrink-0"
        style={{
          padding: isCollapsed ? '14px 0' : '12px 14px',
          justifyContent: isCollapsed ? 'center' : 'space-between',
          minHeight: 64,
          background: 'var(--surface)',
        }}
      >
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
          {/* Avatar */}
          <div
            className="shrink-0 rounded-[10px] overflow-hidden border border-[var(--border)] bg-[var(--surface-hover)]"
            style={{ width: isCollapsed ? 34 : 36, height: isCollapsed ? 34 : 36, transition: 'all 0.25s' }}
          >
            <User className="w-full h-full text-[var(--text-muted)] p-1.5" />
          </div>

          {/* Name + status */}
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 overflow-hidden">
              <span className="syne text-[11.5px] font-bold text-[var(--text-primary)] tracking-wider uppercase truncate leading-tight">
                {currentUser?.name || currentUser?.email || 'User'}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] flex-shrink-0" />
                <span className="text-[10.5px] text-[var(--text-muted)] font-medium">Online</span>
              </div>
            </div>
          )}
        </div>

        {/* Mobile close — only when not collapsed */}
        {!isCollapsed && (
          <button
            onClick={onClose}
            className="lg:hidden flex-shrink-0 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── NAVIGATION ─────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-1 custom-scrollbar">
        {menuSections.map((section, si) => {
          // Hide an entire section (its label + divider) when the user can't access any of its
          // items — mirrors the per-item visibility checks in the items map below.
          const sectionHasItems = section.items.some(item => {
            if (item.moduleIds && !item.moduleIds.some(m => enabledModules.includes(m))) return false;
            if (item.subItems) return item.subItems.some(s => canNav(s.id));
            return canNav(item.id ?? item.label);
          });
          if (!sectionHasItems) return null;
          return (
            <div
              key={si}
              style={{ margin: '0 8px', padding: '4px 0 8px' }}
            >
              {/* Section label */}
              {!isCollapsed ? (
                <div
                  style={{
                    padding: '5px 10px',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'rgba(0,0,0,0.04)',
                    borderRadius: 7,
                  }}
                >
                  <span className="syne text-[11px] font-bold tracking-tight text-[var(--text-muted)] whitespace-nowrap">
                    {section.title}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.5 }} />
                </div>
              ) : si > 0 ? (
                <div style={{ height: 1, background: 'var(--border)', margin: '0 12px 6px', opacity: 0.5 }} />
              ) : null}

              {/* Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 6px' }}>
                {section.items.map((item, idx) => {
                  // Filter sub-items the user can't access
                  const visibleSubItems = item.subItems
                    ? item.subItems.filter(s => canNav(s.id))
                    : undefined;

                  // Hide if the associated module(s) are disabled
                  if (item.moduleIds && !item.moduleIds.some(m => enabledModules.includes(m))) return null;

                  // Hide parent if it has sub-items and ALL are hidden
                  // or if the parent itself requires permissions the user lacks
                  const parentKey = item.id ?? item.label;
                  if (visibleSubItems !== undefined && visibleSubItems.length === 0) return null;
                  if (!item.subItems && !canNav(parentKey)) return null;

                  const isActive =
                    activeView === (item.id ?? item.label) ||
                    (visibleSubItems?.some(s => activeView === s.id) ?? false);
                  const isExpanded = expandedItems.includes(item.label);

                  return (
                    <div key={idx}>
                      <button
                        onClick={e => {
                          if (item.subItems) {
                            toggleSubmenu(item.label, e);
                          } else {
                            setActiveView(item.id ?? item.label);
                          }
                        }}
                        title={isCollapsed ? item.label : undefined}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: isCollapsed ? 'center' : 'space-between',
                          padding: isCollapsed ? '8px 0' : '7px 10px',
                          borderRadius: 8,
                          border: 'none',
                          cursor: 'pointer',
                          outline: 'none',
                          fontFamily: 'inherit',
                          transition: 'background 0.15s, color 0.15s',
                          background: isActive && (!item.subItems || !isExpanded || isCollapsed)
                            ? 'var(--accent-dim)'
                            : 'transparent',
                          position: 'relative',
                        }}
                        onMouseEnter={e => {
                          const el = e.currentTarget;
                          if (!(isActive && (!item.subItems || !isExpanded || isCollapsed))) {
                            el.style.background = 'rgba(0,0,0,0.04)';
                          }
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget;
                          if (!(isActive && (!item.subItems || !isExpanded || isCollapsed))) {
                            el.style.background = 'transparent';
                          }
                        }}
                      >
                        {/* Active indicator bar */}
                        {isActive && (!item.subItems || !isExpanded || isCollapsed) && (
                          <span
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: 3,
                              height: 18,
                              borderRadius: '0 3px 3px 0',
                              background: 'var(--accent)',
                            }}
                          />
                        )}

                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: isCollapsed ? 0 : 9,
                            justifyContent: isCollapsed ? 'center' : 'flex-start',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <item.icon
                            className={`w-[17px] h-[17px] flex-shrink-0 ${
                              isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                            }`}
                          />
                          {!isCollapsed && (
                            <span
                              style={{
                                fontSize: 12.5,
                                fontWeight: isActive ? 700 : 500,
                                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                                letterSpacing: '0.01em',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                transition: 'color 0.15s',
                              }}
                            >
                              {item.label}
                            </span>
                          )}
                        </span>

                        {!isCollapsed && visibleSubItems && (
                          <span className="flex-shrink-0 ml-1">
                            {isExpanded
                              ? <ChevronDown className="w-3 h-3 text-[var(--accent)]" />
                              : <ChevronRight className={`w-3 h-3 ${isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
                            }
                          </span>
                        )}
                      </button>

                      {/* Submenu */}
                      {visibleSubItems && isExpanded && !isCollapsed && (
                        <div
                          style={{
                            marginTop: 2,
                            paddingLeft: 28,
                            paddingBottom: 2,
                            position: 'relative',
                          }}
                        >
                          {/* Connector line */}
                          <div
                            style={{
                              position: 'absolute',
                              left: 18,
                              top: 0,
                              bottom: 10,
                              width: 1,
                              background: 'var(--border)',
                            }}
                          />
                          {visibleSubItems.map((sub, si2) => {
                            const isSubActive = activeView === sub.id;
                            return (
                              <button
                                key={si2}
                                onClick={() => setActiveView(sub.id)}
                                style={{
                                  width: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 7,
                                  padding: '6px 8px 6px 10px',
                                  borderRadius: 6,
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                  background: isSubActive ? 'var(--accent-dim)' : 'transparent',
                                  transition: 'background 0.15s',
                                  position: 'relative',
                                }}
                                onMouseEnter={e => {
                                  if (!isSubActive) e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
                                }}
                                onMouseLeave={e => {
                                  if (!isSubActive) e.currentTarget.style.background = 'transparent';
                                }}
                              >
                                {/* Dot connector */}
                                <span
                                  style={{
                                    position: 'absolute',
                                    left: -10,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    width: isSubActive ? 6 : 4,
                                    height: isSubActive ? 6 : 4,
                                    borderRadius: '50%',
                                    background: isSubActive ? 'var(--accent)' : 'var(--border)',
                                    transition: 'all 0.15s',
                                  }}
                                />
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: isSubActive ? 700 : 400,
                                    color: isSubActive ? 'var(--accent)' : 'var(--text-muted)',
                                    letterSpacing: '0.01em',
                                    transition: 'color 0.15s',
                                  }}
                                >
                                  {sub.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── COLLAPSE TOGGLE ────────────────────────────────────────── */}
      <div className="shrink-0 p-3 border-t border-[var(--border)]">
        <button
          onClick={() => setIsCollapsed(c => !c)}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            gap: isCollapsed ? 0 : 8,
            height: 36,
            padding: isCollapsed ? '0' : '0 10px',
            borderRadius: 8,
            border: '1px solid transparent',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
            color: 'var(--text-muted)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--surface-hover)';
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.color = 'var(--accent)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
        >
          {isCollapsed
            ? <PanelLeftOpen className="w-4 h-4" />
            : <PanelLeftClose className="w-4 h-4" />
          }
          {!isCollapsed && (
            <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: '0.01em' }}>
              Collapse sidebar
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
