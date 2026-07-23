import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Users, UserPlus, ClipboardList, CalendarCheck,
  Calendar, MoreHorizontal, TrendingUp, Clock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import api from '../../lib/api';
import { PageHeader } from './ui/PageHeader';

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
const AVATAR_COLORS = [
  { bg: 'rgba(99,102,241,0.14)',  color: '#6366f1' },
  { bg: 'rgba(16,185,129,0.14)',  color: '#10b981' },
  { bg: 'rgba(245,158,11,0.14)',  color: '#f59e0b' },
  { bg: 'rgba(239,68,68,0.14)',   color: '#ef4444' },
  { bg: 'rgba(14,165,233,0.14)',  color: '#0ea5e9' },
  { bg: 'rgba(168,85,247,0.14)',  color: '#a855f7' },
];

const initialsOf = (name: string) =>
  String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '—';

const STATUS_COLORS = ['var(--accent)', 'var(--warning)', 'var(--danger)', '#10b981', '#a855f7', '#0ea5e9'];

/* ─────────────────────────────────────────────
   CUSTOM TOOLTIP
───────────────────────────────────────────── */
interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; fill: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '10px 14px',
      fontSize: '12px',
      color: 'var(--text-primary)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block' }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   STAT CARD
───────────────────────────────────────────── */
interface StatCardProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  value: string;
  delta: string;
  deltaPositive: boolean;
  iconColor: string;
  iconBg: string;
  delay: number;
}

function StatCard({ icon: Icon, label, value, delta, deltaPositive, iconColor, iconBg, delay }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="stat-card"
      style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px 20px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '10px',
          background: iconBg, color: iconColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={18} strokeWidth={1.8} />
        </div>
      </div>

      <div>
        <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' }}>
          {label}
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.15, letterSpacing: '-.01em' }}>
          {value}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <TrendingUp size={13} style={{ color: deltaPositive ? 'var(--success)' : 'var(--text-muted)', transform: deltaPositive ? 'none' : 'scaleY(-1)' }} />
        <span style={{ fontSize: '12px', fontWeight: 500, color: deltaPositive ? 'var(--success)' : 'var(--text-muted)' }}>
          {delta}
        </span>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────
   AVATAR + PILLS
───────────────────────────────────────────── */
function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const c = AVATAR_COLORS[(String(name ?? '').charCodeAt(0) || 0) % AVATAR_COLORS.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: c.bg, color: c.color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size < 32 ? '11px' : '12px', fontWeight: 600, flexShrink: 0,
    }}>
      {initialsOf(name)}
    </div>
  );
}

function AttendancePill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Present:    'pill pill-success',
    Late:       'pill pill-danger',
    Half_Day:   'pill pill-warning',
    Incomplete: 'pill pill-warning',
    On_Leave:   'pill',
  };
  return <span className={map[status] ?? 'pill'}>{String(status ?? '').replace(/_/g, ' ')}</span>;
}

function EmploymentPill({ label }: { label?: string | null }) {
  if (!label) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const cls = /permanent/i.test(label) ? 'pill pill-success'
            : /contract/i.test(label)  ? 'pill pill-warning'
            : /probation|temp/i.test(label) ? 'pill pill-danger'
            : 'pill';
  return <span className={cls}>{label}</span>;
}

/* ─────────────────────────────────────────────
   MAIN DASHBOARD
───────────────────────────────────────────── */
export function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard/summary')
      .then(r => setData(r.data?.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = data?.stats ?? {};
  const hiresDelta = (stats.new_hires_month ?? 0) - (stats.new_hires_last_month ?? 0);
  const appsDelta  = (stats.applicants_month ?? 0) - (stats.applicants_last_month ?? 0);
  const presDelta  = (stats.present_today ?? 0) - (stats.present_yesterday ?? 0);

  const empStatus = (data?.employment_status ?? []).map((s: any, i: number) => ({
    ...s,
    color: STATUS_COLORS[i % STATUS_COLORS.length],
    pct: stats.total_employees ? Math.round((s.count / stats.total_employees) * 100) : 0,
  }));

  const growth: any[]     = data?.growth ?? [];
  const service: any[]    = data?.service ?? [];
  const attendance: any[] = data?.attendance_today ?? [];
  const employees: any[]  = data?.recent_employees ?? [];
  const lastGrowth = growth[growth.length - 1];
  const maxService = Math.max(0, ...service.map((x: any) => x.value));

  return (
    <div style={{ flex: 1, width: '100%' }}>
      <div style={{ maxWidth: 1340, margin: '0 auto', padding: '28px 24px 40px' }}>

        {/* PAGE HEADER */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            display: 'flex', alignItems: 'flex-start',
            justifyContent: 'space-between', gap: 16,
            flexWrap: 'wrap', marginBottom: 28,
          }}
        >
          <div>
            <PageHeader title="Dashboard" subtitle="Welcome to the HR portal. Have a productive day." />
            
          </div>
          <span className="secondary-btn" style={{ gap: 7, cursor: 'default' }}>
            <Calendar size={14} />
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </motion.div>

        {/* STAT STRIP */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14, marginBottom: 22,
        }}>
          <StatCard delay={0.05} icon={Users}         label="Total Employees" value={loading ? '…' : String(stats.total_employees ?? 0)}
            delta={`+${stats.new_hires_month ?? 0} hired this month`} deltaPositive={(stats.new_hires_month ?? 0) > 0}
            iconColor="var(--accent)" iconBg="var(--accent-dim)" />
          <StatCard delay={0.10} icon={UserPlus}      label="New Hires" value={loading ? '…' : String(stats.new_hires_month ?? 0)}
            delta={`${hiresDelta >= 0 ? '+' : ''}${hiresDelta} vs last month`} deltaPositive={hiresDelta >= 0}
            iconColor="var(--danger)" iconBg="rgba(239,68,68,0.10)" />
          <StatCard delay={0.15} icon={ClipboardList} label="Applicants" value={loading ? '…' : String(stats.applicants ?? 0)}
            delta={`${appsDelta >= 0 ? '+' : ''}${appsDelta} vs last month`} deltaPositive={appsDelta >= 0}
            iconColor="var(--success)" iconBg="rgba(16,185,129,0.10)" />
          <StatCard delay={0.20} icon={CalendarCheck} label="Present Today" value={loading ? '…' : String(stats.present_today ?? 0)}
            delta={`${presDelta >= 0 ? '+' : ''}${presDelta} vs yesterday`} deltaPositive={presDelta >= 0}
            iconColor="var(--warning)" iconBg="rgba(245,158,11,0.10)" />
        </div>

        {/* MAIN GRID */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 14, alignItems: 'start' }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* TODAY'S ATTENDANCE */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderBottom: '1px solid var(--border)', gap: 12, flexWrap: 'wrap',
              }}>
                <h3 className="syne" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Today's Attendance
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{data?.date ?? ''}</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Employee', 'Clock In', 'Clock Out', 'Status'].map((h, i) => (
                        <th key={h} className="th" style={{ textAlign: i === 3 ? 'center' : 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendance.length === 0 ? (
                      <tr><td colSpan={4} className="td" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                        {loading ? 'Loading…' : 'No punches recorded yet today'}
                      </td></tr>
                    ) : attendance.map((row, i) => (
                      <motion.tr
                        key={`${row.name}-${i}`} className="tr"
                        initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.3 + i * 0.05 }}
                      >
                        <td className="td">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar name={row.name} />
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.email ?? ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="td">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{row.in_time ?? '—'}</span>
                          </div>
                        </td>
                        <td className="td">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{row.out_time ?? '—'}</span>
                          </div>
                        </td>
                        <td className="td" style={{ textAlign: 'center' }}>
                          <AttendancePill status={row.day_status} />
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>

            {/* NEWEST EMPLOYEES */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderBottom: '1px solid var(--border)', gap: 12,
              }}>
                <h3 className="syne" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Newest Employees
                </h3>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Name', 'Email', 'Position', 'Level', 'Status'].map((h) => (
                        <th key={h} className="th" style={{ textAlign: 'left' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.length === 0 ? (
                      <tr><td colSpan={5} className="td" style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                        {loading ? 'Loading…' : 'No employees found.'}
                      </td></tr>
                    ) : employees.map((emp, i) => (
                      <motion.tr
                        key={emp.id} className="tr"
                        initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.4 + i * 0.05 }}
                      >
                        <td className="td">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Avatar name={emp.name} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{emp.name}</span>
                          </div>
                        </td>
                        <td className="td" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{emp.email ?? '—'}</td>
                        <td className="td" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{emp.position ?? '—'}</td>
                        <td className="td" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{emp.level ?? '—'}</td>
                        <td className="td"><EmploymentPill label={emp.emp_status} /></td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{
                padding: '12px 20px', borderTop: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
              }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Showing the <strong style={{ color: 'var(--text-secondary)' }}>{employees.length}</strong> most recent of{' '}
                  <strong style={{ color: 'var(--text-secondary)' }}>{stats.total_employees ?? 0}</strong> employees
                </span>
              </div>
            </motion.div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* EMPLOYMENT STATUS */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 className="syne" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Employment Status
                </h3>
                <MoreHorizontal size={16} style={{ color: 'var(--text-muted)' }} />
              </div>

              {empStatus.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', margin: 0 }}>
                  {loading ? 'Loading…' : 'No employment status data'}
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 14, marginBottom: 6, gap: 2 }}>
                    {empStatus.map((st: any) => (
                      <div
                        key={st.label}
                        style={{ flex: st.count, background: st.color, borderRadius: 4, transition: 'flex .4s ease' }}
                        title={`${st.label}: ${st.count}`}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>0%</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>100%</span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {empStatus.map((st: any) => (
                      <div
                        key={st.label}
                        style={{
                          flex: 1, minWidth: 96, borderRadius: 12, padding: '12px 14px',
                          background: `color-mix(in srgb, ${st.color} 8%, transparent)`,
                          border: `1px solid color-mix(in srgb, ${st.color} 20%, transparent)`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: st.color, display: 'inline-block' }} />
                          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            {st.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.15, letterSpacing: '-.01em' }}>
                          {st.count}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{st.pct}%</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </motion.div>

            {/* EMPLOYEE GROWTH */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.33, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 className="syne" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Employee Growth
                </h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last 6 months</span>
              </div>

              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={growth} barCategoryGap="28%" barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'inherit' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                  <Bar dataKey="employees" name="Employees" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="new_hires" name="New Hires" fill="rgba(59,130,246,0.35)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              {lastGrowth && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Total ({lastGrowth.month})
                  </div>
                  {[
                    { label: 'Employees', value: lastGrowth.employees, color: 'var(--accent)' },
                    { label: 'New Hires', value: lastGrowth.new_hires, color: 'rgba(59,130,246,0.5)' },
                  ].map((l) => (
                    <div key={l.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color, display: 'inline-block' }} />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.label}</span>
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-.01em' }}>{l.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* LENGTH OF SERVICE */}
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.38, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 className="syne" style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Length of Service
                </h3>
                <MoreHorizontal size={16} style={{ color: 'var(--text-muted)' }} />
              </div>

              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={service} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'inherit' }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                  <Bar dataKey="value" name="Employees" radius={[4, 4, 0, 0]}>
                    {service.map((row: any, i: number) => (
                      <Cell
                        key={i}
                        fill={maxService > 0 && row.value === maxService ? 'var(--accent)' : 'rgba(59,130,246,0.25)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </motion.div>

          </div>
        </div>
      </div>
    </div>
  );
}
