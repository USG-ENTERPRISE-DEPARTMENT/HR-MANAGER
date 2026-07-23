import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock, LogIn, LogOut, MapPin, Plus, Edit2, Trash2, Eye, Upload,
  Download, RefreshCw, Loader2, CalendarDays, Users as UsersIcon,
  Filter, X, UserCheck, Hourglass, XCircle, AlertCircle, HelpCircle, TrendingUp, Camera,
  ClipboardList, Moon, BarChart3,
} from 'lucide-react';
import { motion } from 'motion/react';
import { PageHeader }      from './ui/PageHeader';
import { RowActions }      from './ui/RowActions';
import { TabBar }          from './ui/TabBar';
import { TableToolbar }    from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { FormModal }       from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { DetailSlideOver } from './ui/DetailSlideOver';
import { SearchSelect, MultiSearchSelect } from './ui/SearchSelect';
import { ConfirmModal }    from './ui/ConfirmModal';
import api                 from '../../lib/api';
import { toast }           from 'sonner';
import { useCan }          from '@/hooks/useCan';

// ── Shared bits ───────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
  Present:    'pill-success',
  Late:       'bg-amber-500/10 text-amber-700 border border-amber-200/50',
  Half_Day:   'bg-sky-50 text-sky-700 border border-sky-200',
  Incomplete: 'bg-orange-50 text-orange-700 border border-orange-200',
  Absent:     'pill-danger',
  Holiday:    'bg-purple-50 text-purple-700 border border-purple-200',
  Weekend:    'bg-slate-100 text-slate-500 border border-slate-200',
  On_Leave:   'bg-indigo-50 text-indigo-700 border border-indigo-200',
};

const STATUS_OPTIONS = ['Present', 'Late', 'Half_Day', 'Incomplete', 'Absent', 'Holiday', 'Weekend', 'On_Leave'];

function StatusPill({ status }: { status?: string | null }) {
  if (!status) return <span className="text-[var(--text-muted)]">—</span>;
  const cls = STATUS_MAP[status] ?? 'bg-[var(--surface-hover)] text-[var(--text-muted)]';
  return <span className={`pill ${cls}`}>{status.replace(/_/g, ' ')}</span>;
}

const fmtMin = (m?: number | null) => m == null ? '—' : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;

// Attendance-designed stat card — icon chip, tinted wash, hairline corner arcs
function StatCard({ label, value, color, icon: Icon, hint, delay = 0 }: {
  label: string; value: string | number; color: string; icon: any; hint?: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="relative overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-[14px] px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="absolute inset-0" style={{ background: `linear-gradient(225deg, color-mix(in srgb, ${color} 7%, transparent), transparent 45%)` }} />
        <svg className="absolute -top-9 -right-9 h-24 w-24" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="34" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${color} 22%, transparent)` }} />
          <circle cx="48" cy="48" r="42" fill="none" strokeWidth="1" style={{ stroke: `color-mix(in srgb, ${color} 14%, transparent)` }} />
        </svg>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] shrink-0" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
          <Icon size={14} style={{ color }} />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] truncate">{label}</p>
      </div>
      <p className="text-[24px] font-bold tabular-nums leading-none" style={{ color }}>{value}</p>
      {hint && <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 truncate">{hint}</p>}
    </motion.div>
  );
}

// Build and download a CSV file from rows of cells
function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const blob = new Blob([rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const monthNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const dateNow  = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

function useEmployees() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    api.get('/employees/active').then(r => setList(r.data?.data ?? [])).catch(() => {});
  }, []);
  return list.map((e: any) => ({
    id: String(e.id),
    label: `${e.name ?? `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim()}${e.employee_id ? ` (${e.employee_id})` : ''}`.trim(),
  }));
}

function useDepartments() {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    api.get('/company/structures')
      .then(r => setList((r.data?.data ?? []).filter((s: any) => s.type === 'Department' || s.structureType === 'Department')))
      .catch(() => {});
  }, []);
  return list.map((d: any) => ({ id: String(d.id), label: String(d.title ?? d.name ?? d.description ?? d.id) }));
}

// ══════════════════════════════════════════════════════════════════════════════
// MY ATTENDANCE (personal)
// ══════════════════════════════════════════════════════════════════════════════

// Webcam capture overlay used when in-app photo capture is enabled
function PhotoCaptureModal({ title, actionLabel, onCancel, onCapture }: {
  title: string; actionLabel: string; onCancel: () => void; onCapture: (photo: string) => void;
}) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' } })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch(() => setErr('Camera access is required for this punch. Allow camera access for this site in your browser, then try again.'));
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 480;
    canvas.height = video.videoHeight || 360;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.7));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] w-full max-w-md p-5">
        <h3 className="font-bold text-[var(--text-primary)] mb-1">{title}</h3>
        <p className="text-[12px] text-[var(--text-muted)] mb-3 flex items-center gap-1.5">
          <Camera size={12} /> A photo is captured with this punch
        </p>
        {err ? (
          <p className="text-[13px] text-[var(--danger)] py-6 text-center">{err}</p>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-[12px] bg-[var(--bg)] border border-[var(--border)]" />
        )}
        <div className="flex gap-2 mt-4">
          <button className="secondary-btn flex-1" onClick={onCancel}>Cancel</button>
          <button className="primary-btn flex-1" disabled={!ready || !!err} onClick={capture}>
            <Camera size={14} className="inline mr-1.5" />{actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClockCard() {
  const [now, setNow]         = useState(new Date());
  const [today, setToday]     = useState<any>(null);
  const [punching, setPunching] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [policy, setPolicy]   = useState({ require_location: false, require_photo: false });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(() => {
    api.get('/attendance/today?personal=1').then(r => setToday(r.data?.data ?? null)).catch(() => {});
    api.get('/attendance/punch-policy').then(r => setPolicy(r.data?.data ?? { require_location: false, require_photo: false })).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const getCoords = (): Promise<{ lat: number | null; lng: number | null; accuracy: number | null }> =>
    new Promise(resolve => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null, accuracy: null });
      const timer = setTimeout(() => resolve({ lat: null, lng: null, accuracy: null }), 8000);
      navigator.geolocation.getCurrentPosition(
        pos => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }); },
        ()  => { clearTimeout(timer); resolve({ lat: null, lng: null, accuracy: null }); },
        { timeout: 8000, enableHighAccuracy: true }
      );
    });

  const punch = async (photo: string | null = null) => {
    setConfirming(false);
    setPunching(true);
    try {
      const coords = await getCoords();
      if (policy.require_location && (coords.lat == null || coords.lng == null)) {
        toast.error('Location is required to clock in. Allow location access for this site in your browser settings, then try again.');
        return;
      }
      const r = await api.post('/attendance/punch', { ...coords, photo });
      toast.success(r.data?.message ?? 'Punched');
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Punch failed');
      load();
    } finally { setPunching(false); }
  };

  const clockedIn  = !!today?.in_time;
  const clockedOut = !!today?.out_time;
  const onLeave    = today?.day_status === 'On_Leave';
  const dayDone    = clockedIn && clockedOut;
  const label      = !clockedIn ? 'Clock In' : 'Clock Out';
  const timeNow    = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  // Clock-in is only open within the shift's working hours (re-evaluated every tick;
  // the server enforces this too). Clock-out is never window-blocked.
  const toM = (s?: string) => { const m = String(s ?? '').match(/(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const winS = toM((policy as any).window_start);
  const winE = toM((policy as any).window_end);
  const nowM = now.getHours() * 60 + now.getMinutes();
  const clockInOpen = winS == null || winE == null
    ? true
    : winS > winE ? (nowM >= winS || nowM <= winE) : (nowM >= winS && nowM <= winE);
  const windowClosed = !clockedIn && !clockInOpen;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] p-8 flex flex-col items-center gap-5 drop-shadow-sm">
      <div className="text-center">
        <p className="text-[13px] text-[var(--text-muted)]">{now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <p className="syne text-[52px] font-bold tabular-nums leading-tight text-[var(--text-primary)]">
          {pad2(now.getHours())}:{pad2(now.getMinutes())}<span className="text-[26px] text-[var(--text-muted)]">:{pad2(now.getSeconds())}</span>
        </p>
      </div>

      {onLeave ? (
        <div className="text-center px-6 py-4 rounded-[14px] bg-indigo-50 border border-indigo-200">
          <p className="text-[14px] font-bold text-indigo-700">You are on approved leave today</p>
          <p className="text-[12px] text-indigo-600/80 mt-1">Clocking in is disabled — enjoy your time off.</p>
        </div>
      ) : dayDone ? (
        <div className="text-center px-6 py-4 rounded-[14px] bg-[var(--bg)] border border-[var(--border)]">
          <p className="text-[14px] font-bold text-[var(--text-primary)]">You're done for today</p>
          <p className="text-[12px] text-[var(--text-muted)] mt-1">Worked {fmtMin(today?.worked_minutes)} — see you tomorrow.</p>
        </div>
      ) : windowClosed ? (
        <div className="text-center px-6 py-4 rounded-[14px] bg-amber-50 border border-amber-200">
          <p className="text-[14px] font-bold text-amber-700">Clock-in is closed</p>
          <p className="text-[12px] text-amber-600/90 mt-1">
            {(policy as any).shift === 'night' ? 'Night shift' : 'Working'} hours are {(policy as any).window_start} – {(policy as any).window_end}.
            {nowM < (winS ?? 0) && (winS ?? 0) <= (winE ?? 0) ? ' Come back when the day starts.' : ' See you on the next work day.'}
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={() => setConfirming(true)}
            disabled={punching}
            className={`flex items-center gap-2.5 px-10 py-4 rounded-full text-white text-[15px] font-bold transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-60 ${!clockedIn ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`}
          >
            {punching ? <Loader2 size={18} className="animate-spin" /> : !clockedIn ? <LogIn size={18} /> : <LogOut size={18} />}
            {punching ? 'Recording…' : label}
          </button>
          <p className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <MapPin size={11} /> {policy.require_location ? 'Location is required for each punch' : 'Your location is captured with each punch'}
            {policy.require_photo && <><span className="mx-1">·</span><Camera size={11} /> Photo required</>}
          </p>
        </>
      )}

      <div className="w-full grid grid-cols-3 gap-3 mt-1">
        {[
          { label: 'Clock In',  value: today?.in_time  ?? '—' },
          { label: 'Clock Out', value: today?.out_time ?? '—' },
          { label: 'Status',    value: null },
        ].map(stat => (
          <div key={stat.label} className="bg-[var(--bg)] border border-[var(--border)] rounded-[12px] px-4 py-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{stat.label}</p>
            {stat.label === 'Status'
              ? <StatusPill status={today?.day_status ?? (clockedIn ? 'Incomplete' : null)} />
              : <p className="text-[16px] font-bold tabular-nums text-[var(--text-primary)]">{stat.value}</p>}
          </div>
        ))}
      </div>
      {confirming && policy.require_photo && (
        <PhotoCaptureModal
          title={!clockedIn ? `Clock in now at ${timeNow}?` : `Clock out now at ${timeNow}?`}
          actionLabel={label}
          onCancel={() => setConfirming(false)}
          onCapture={photo => { void punch(photo); }}
        />
      )}
      {confirming && !policy.require_photo && (
        <ConfirmModal
          title={!clockedIn ? 'Clock In?' : 'Clock Out?'}
          message={!clockedIn
            ? `Record your clock-in now at ${timeNow}? You can only clock in once per day.`
            : `Record your clock-out now at ${timeNow}? This completes your day — you cannot punch again until tomorrow.`}
          confirmLabel={label}
          onConfirm={() => { void punch(null); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </motion.div>
  );
}

function TimesheetView({ employee, employeeOptions }: { employee?: string; employeeOptions?: { id: string; label: string }[] }) {
  const [from, setFrom]   = useState(`${monthNow()}-01`);
  const [to, setTo]       = useState(dateNow());
  const [selEmp, setSelEmp] = useState(employee ?? '');
  const [data, setData]   = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    const q = employeeOptions ? (selEmp ? `&employee=${selEmp}` : '') : '&personal=1';
    if (employeeOptions && !selEmp) { setData(null); return; }
    setLoading(true);
    api.get(`/attendance/timesheet?date_from=${from}&date_to=${to}${q}`)
      .then(r => setData(r.data?.data ?? null))
      .catch(e => toast.error(e.response?.data?.message ?? 'Failed to load timesheet'))
      .finally(() => setLoading(false));
  }, [from, to, selEmp, employeeOptions]);
  useEffect(() => { load(); }, [load]);

  const exportTimesheet = () => {
    if (!data) return;
    const who = data.employee_name ? `${data.employee_name}${data.employee_no ? ` (${data.employee_no})` : ''}` : 'Timesheet';
    downloadCsv(`timesheet_${(data.employee_no ?? data.employee ?? 'me')}_${from}_${to}.csv`, [
      [`Timesheet — ${who} — ${from} to ${to}`],
      ['Date', 'Status', 'Holiday', 'In', 'Out', 'Worked (min)', 'Late (min)', 'Overtime (min)'],
      ...(data.days ?? []).map((d: any) => [
        d.date, d.status ? d.status.replace(/_/g, ' ') : '', d.holiday,
        d.in_time, d.out_time, d.worked_minutes, d.late_minutes, d.overtime_minutes,
      ]),
      [],
      ['Totals', '', '', '', '', data.totals?.worked_minutes ?? 0, '', data.totals?.overtime_minutes ?? 0],
      ['Present Days', data.totals?.present_days ?? 0],
      ['Absent Days',  data.totals?.absent_days ?? 0],
      ['Late Days',    data.totals?.late_days ?? 0],
    ]);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {employeeOptions && (
          <div className="w-72">
            <label className="label">Employee</label>
            <SearchSelect value={selEmp} onChange={setSelEmp} options={employeeOptions} placeholder="Select employee…" />
          </div>
        )}
        <div>
          <label className="label">From</label>
          <input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} />
        </div>
        {data && (
          <button className="secondary-btn ml-auto" onClick={exportTimesheet}>
            <Download size={14} className="inline mr-1.5" />Download Timesheet
          </button>
        )}
      </div>

      {data && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Present Days', value: String(data.totals?.present_days ?? 0), color: '#16a34a', icon: UserCheck,  hint: 'Incl. late & half days' },
            { label: 'Absent Days',  value: String(data.totals?.absent_days ?? 0),  color: '#dc2626', icon: XCircle,    hint: 'No punch recorded' },
            { label: 'Late Days',    value: String(data.totals?.late_days ?? 0),    color: '#d97706', icon: Clock,      hint: 'Beyond grace period' },
            { label: 'Hours Worked', value: fmtMin(data.totals?.worked_minutes ?? 0), color: '#185FA5', icon: Hourglass, hint: 'Clock-in to clock-out' },
            { label: 'Overtime',     value: fmtMin(data.totals?.overtime_minutes ?? 0), color: '#7c3aed', icon: TrendingUp, hint: 'Past official end time' },
          ].map((c, i) => <StatCard key={c.label} {...c} delay={i * 0.04} />)}
        </div>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--bg)]">
                {['Date', 'Status', 'In', 'Out', 'Worked', 'Late', 'Overtime'].map(h => <th key={h} className="th">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">Loading...</td></tr>
              ) : employeeOptions && !selEmp ? (
                <tr><td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">Select an employee to view their timesheet.</td></tr>
              ) : !data || (data.days ?? []).length === 0 ? (
                <tr><td colSpan={7} className="td text-center py-10 text-[var(--text-muted)]">No attendance data for this month yet.</td></tr>
              ) : (
                data.days.map((d: any) => (
                  <tr key={d.date} className="tr">
                    <td className="td font-medium tabular-nums">{d.date}{d.holiday ? <span className="ml-2 text-[11px] text-purple-600">{d.holiday}</span> : null}</td>
                    <td className="td"><StatusPill status={d.status} /></td>
                    <td className="td tabular-nums">{d.in_time ?? '—'}</td>
                    <td className="td tabular-nums">{d.out_time ?? '—'}</td>
                    <td className="td tabular-nums">{d.worked_minutes != null ? fmtMin(d.worked_minutes) : '—'}</td>
                    <td className="td tabular-nums">{d.late_minutes ? `${d.late_minutes}m` : '—'}</td>
                    <td className="td tabular-nums">{d.overtime_minutes ? fmtMin(d.overtime_minutes) : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SubordinateAttendanceTab() {
  const [rows, setRows]     = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [from, setFrom]     = useState(dateNow());
  const [to, setTo]         = useState(dateNow());
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ date_from: from, date_to: to });
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/attendance/subordinates?${params}`)
      .then(r => setRows(r.data?.data ?? []))
      .catch(() => toast.error('Failed to load subordinate attendance'));
  }, [from, to, statusFilter]);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !search ||
    r.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.employee_no?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <TableToolbar
        searchQuery={search}
        onSearchChange={setSearch}
        showFilters={showFilters}
        filterBar={showFilters ? (
          <div className="flex flex-wrap items-end gap-3 py-1">
            <div><label className="label">From</label><input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><label className="label">To</label><input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></div>
            <div className="w-44"><label className="label">Status</label><SearchSelect value={statusFilter} onChange={setStatusFilter} options={[{ id: '', label: 'All statuses' }, ...STATUS_OPTIONS.map(s => ({ id: s, label: s.replace(/_/g, ' ') }))]} placeholder="All statuses" /></div>
            {statusFilter && (
              <button onClick={() => setStatusFilter('')} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
                <X size={12} /> Clear all (1)
              </button>
            )}
          </div>
        ) : undefined}
        actions={
          <div className="flex items-center gap-2">
            <button
              className="secondary-btn shrink-0"
              onClick={() => {
                if (!filtered.length) { toast.error('Nothing to export for this range'); return; }
                downloadCsv(`subordinate_attendance_${from}_${to}.csv`, [
                  ['Date', 'Employee', 'ID', 'In', 'Out', 'Worked (min)', 'Late (min)', 'Status'],
                  ...filtered.map(r => [r.date, r.employee_name, r.employee_no, r.in_time, r.out_time, r.worked_minutes, r.late_minutes, r.day_status?.replace(/_/g, ' ')]),
                ]);
              }}
            >
              <Download size={14} className="inline mr-1.5" />Export
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`secondary-btn shrink-0 relative ${showFilters || statusFilter ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
            >
              Filter <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
              {statusFilter && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">1</span>
              )}
            </button>
          </div>
        }
      />

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['Date', 'Employee', 'ID', 'In', 'Out', 'Worked', 'Late', 'Status'].map(h => <th key={h} className="th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">
                {rows.length === 0 ? 'No direct reports or no attendance records for this range' : 'No records match the selected filter'}
              </td></tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="tr">
                <td className="td tabular-nums">{row.date}</td>
                <td className="td font-medium">{row.employee_name || '—'}</td>
                <td className="td text-[var(--text-muted)]">{row.employee_no || '—'}</td>
                <td className="td tabular-nums">{row.in_time ?? '—'}</td>
                <td className="td tabular-nums">{row.out_time ?? '—'}</td>
                <td className="td tabular-nums">{row.worked_minutes != null ? fmtMin(row.worked_minutes) : '—'}</td>
                <td className="td tabular-nums">{row.late_minutes ? `${row.late_minutes}m` : '—'}</td>
                <td className="td"><StatusPill status={row.day_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TablePagination total={rows.length} filtered={filtered.length} />
    </motion.div>
  );
}

export function MyAttendance() {
  const [tab, setTab] = useState('Clock In/Out');
  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto flex flex-col gap-4 min-h-full">
      <PageHeader title="My Attendance" subtitle="Clock in and out, review your timesheet, and monitor your team" />
      <TabBar tabs={['Clock In/Out', 'My Timesheet', 'Subordinate Attendance']} activeTab={tab} onChange={setTab}
        icons={{
          'Clock In/Out':           <Clock size={14} />,
          'My Timesheet':           <CalendarDays size={14} />,
          'Subordinate Attendance': <UsersIcon size={14} />,
        }} />
      {tab === 'Clock In/Out' && <div className="max-w-xl w-full mx-auto"><ClockCard /></div>}
      {tab === 'My Timesheet' && <TimesheetView />}
      {tab === 'Subordinate Attendance' && <SubordinateAttendanceTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Daily Log
// ══════════════════════════════════════════════════════════════════════════════

const blankManual = { employee: '', date: dateNow(), in_time: '', out_time: '', note: '' };

function DailyLogTab() {
  const { can } = useCan();
  const canManage = can('manage_attendance');
  const [rows, setRows]       = useState<any[]>([]);
  const [search, setSearch]   = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [from, setFrom]       = useState(dateNow());
  const [to, setTo]           = useState(dateNow());
  const [empFilter, setEmpFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewRec, setViewRec] = useState<any>(null);
  const [punches, setPunches] = useState<any[]>([]);
  const [photos, setPhotos]   = useState<{ image_in?: string | null; image_out?: string | null } | null>(null);
  const [open, setOpen]       = useState(false);
  const [editRec, setEditRec] = useState<any>(null);
  const [pendingVoid, setPendingVoid] = useState<any>(null);
  const [f, setF]             = useState(blankManual);
  const [saving, setSaving]   = useState(false);

  const employees   = useEmployees();
  const departments = useDepartments();
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const load = useCallback(() => {
    const params = new URLSearchParams({ date_from: from, date_to: to });
    if (empFilter)    params.set('employee', empFilter);
    if (deptFilter)   params.set('department', deptFilter);
    if (statusFilter) params.set('status', statusFilter);
    api.get(`/attendance?${params}`)
      .then(r => setRows(r.data?.data ?? []))
      .catch(() => toast.error('Failed to load attendance'));
  }, [from, to, empFilter, deptFilter, statusFilter]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!viewRec) { setPunches([]); setPhotos(null); return; }
    api.get(`/attendance/punches?date=${viewRec.date}&employee=${viewRec.employee}`)
      .then(r => setPunches(r.data?.data ?? []))
      .catch(() => {});
    if (viewRec.has_photo_in || viewRec.has_photo_out) {
      api.get(`/attendance/${viewRec.id}/photos`)
        .then(r => setPhotos(r.data?.data ?? null))
        .catch(() => setPhotos(null));
    }
  }, [viewRec]);

  const openManual = () => { setEditRec(null); setF({ ...blankManual, date: from }); setOpen(true); };
  const openEdit = (row: any) => {
    setEditRec(row);
    setF({ employee: String(row.employee), date: row.date, in_time: row.in_time ?? '', out_time: row.out_time ?? '', note: row.note ?? '' });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!editRec && !f.employee) { toast.error('Employee is required'); return; }
    if (!f.date)    { toast.error('Date is required'); return; }
    if (!f.in_time) { toast.error('In time is required'); return; }
    setSaving(true);
    try {
      if (editRec) {
        await api.put(`/attendance/${editRec.id}`, { in_time: f.in_time, out_time: f.out_time || null, note: f.note, edit_note: f.note });
        toast.success('Record updated');
      } else {
        await api.post('/attendance/manual', { employee: f.employee, date: f.date, in_time: f.in_time, out_time: f.out_time || null, note: f.note });
        toast.success('Attendance recorded');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Save failed');
    } finally { setSaving(false); }
  };

  const handleVoid = async () => {
    if (!pendingVoid) return;
    try {
      await api.delete(`/attendance/${pendingVoid.id}`);
      toast.success('Record voided');
      setPendingVoid(null);
      setViewRec(null);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Void failed');
    }
  };

  const exportCsv = async () => {
    try {
      const params = new URLSearchParams({ date_from: from, date_to: to });
      if (empFilter)    params.set('employee', empFilter);
      if (deptFilter)   params.set('department', deptFilter);
      if (statusFilter) params.set('status', statusFilter);
      const r = await api.get(`/attendance/export?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `attendance_${from}_${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  const filtered = rows.filter(r =>
    !search ||
    r.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.employee_no?.toLowerCase().includes(search.toLowerCase()) ||
    r.department_name?.toLowerCase().includes(search.toLowerCase())
  );

  const activeFilterCount = [empFilter, deptFilter, statusFilter].filter(Boolean).length;
  const clearFilters = () => { setEmpFilter(''); setDeptFilter(''); setStatusFilter(''); };

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3 py-1">
      <div><label className="label">From</label><input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></div>
      <div className="w-56"><label className="label">Employee</label><SearchSelect value={empFilter} onChange={setEmpFilter} options={[{ id: '', label: 'All employees' }, ...employees]} placeholder="All employees" /></div>
      <div className="w-48"><label className="label">Department</label><SearchSelect value={deptFilter} onChange={setDeptFilter} options={[{ id: '', label: 'All departments' }, ...departments]} placeholder="All departments" /></div>
      <div className="w-44"><label className="label">Status</label><SearchSelect value={statusFilter} onChange={setStatusFilter} options={[{ id: '', label: 'All statuses' }, ...STATUS_OPTIONS.map(s => ({ id: s, label: s.replace(/_/g, ' ') }))]} placeholder="All statuses" /></div>
      {activeFilterCount > 0 && (
        <button onClick={clearFilters} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
          <X size={12} /> Clear all ({activeFilterCount})
        </button>
      )}
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
      <TableToolbar
        searchQuery={search}
        onSearchChange={setSearch}
        showFilters={showFilters}
        filterBar={showFilters ? filterBar : undefined}
        actions={
          <div className="flex items-center gap-2">
            <button className="secondary-btn" onClick={() => { load(); toast.success('Attendance log refreshed'); }} title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button className="secondary-btn" onClick={exportCsv}><Download size={14} className="inline mr-1.5" />Export</button>
            {canManage && <button className="primary-btn" onClick={openManual}><Plus size={15} className="mr-1.5 inline" />Manual Entry</button>}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
            >
              Filter <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        }
      />

      <div className="overflow-x-auto flex-1">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['Date', 'Employee', 'ID', 'Department', 'In', 'Out', 'Worked', 'Status', ''].map(h => <th key={h} className="th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="td text-center text-[var(--text-muted)] py-10">No attendance records for this range</td></tr>
            ) : filtered.map(row => (
              <tr key={row.id} className="tr">
                <td className="td tabular-nums">{row.date}</td>
                <td className="td font-medium">{row.employee_name || '—'}</td>
                <td className="td text-[var(--text-muted)]">{row.employee_no || '—'}</td>
                <td className="td">{row.department_name || '—'}</td>
                <td className="td tabular-nums">{row.in_time ?? '—'}{!!Number(row.has_photo_in) && <Camera size={11} className="inline ml-1.5 text-[var(--text-muted)]" />}</td>
                <td className="td tabular-nums">{row.out_time ?? '—'}{!!Number(row.has_photo_out) && <Camera size={11} className="inline ml-1.5 text-[var(--text-muted)]" />}</td>
                <td className="td tabular-nums">{row.worked_minutes != null ? fmtMin(row.worked_minutes) : '—'}</td>
                <td className="td"><StatusPill status={row.day_status} /></td>
                <td className="td">
                  <div className="flex justify-end">
                    <RowActions actions={[
                      { label: 'View', icon: Eye, onClick: () => setViewRec(row) },
                      { label: 'Edit', icon: Edit2, onClick: () => openEdit(row), hidden: !canManage },
                      { label: 'Void', icon: Trash2, danger: true, onClick: () => setPendingVoid(row), hidden: !canManage },
                    ]} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TablePagination total={rows.length} filtered={filtered.length} />

      {/* Manual entry / edit */}
      {open && (
        <FormModal
          title={editRec ? `Edit Record — ${editRec.employee_name ?? ''} (${editRec.date})` : 'Manual Attendance Entry'}
          onClose={() => setOpen(false)}
          onSave={() => { void handleSave(); }}
          maxWidth="lg"
        >
          <div className="grid grid-cols-2 gap-4">
            {!editRec && (
              <>
                <div className="col-span-2">
                  <FormField label="Employee" required>
                    <SearchSelect value={f.employee} onChange={v => set('employee', v)} options={employees} placeholder="Select employee…" />
                  </FormField>
                </div>
                <FormField label="Date" required>
                  <input type="date" className={inputClass} value={f.date} onChange={e => set('date', e.target.value)} />
                </FormField>
                <div />
              </>
            )}
            <FormField label="Clock In" required>
              <input type="time" className={inputClass} value={f.in_time} onChange={e => set('in_time', e.target.value)} />
            </FormField>
            <FormField label="Clock Out">
              <input type="time" className={inputClass} value={f.out_time} onChange={e => set('out_time', e.target.value)} />
            </FormField>
            <div className="col-span-2">
              <FormField label={editRec ? 'Correction Reason' : 'Note'} required={!!editRec}>
                <textarea className={inputClass} rows={2} value={f.note} onChange={e => set('note', e.target.value)} placeholder={editRec ? 'Why is this record being corrected?' : 'Optional note'} />
              </FormField>
            </div>
          </div>
        </FormModal>
      )}

      {pendingVoid && (
        <ConfirmModal
          title="Void Attendance Record?"
          message={`Remove the ${pendingVoid.date} record for ${pendingVoid.employee_name ?? 'this employee'}? This is audit-logged.`}
          confirmLabel="Void"
          onConfirm={handleVoid}
          onCancel={() => setPendingVoid(null)}
        />
      )}

      {/* Detail slide-over */}
      <DetailSlideOver
        open={!!viewRec}
        title={viewRec ? `${viewRec.employee_name ?? 'Attendance'} — ${viewRec.date}` : ''}
        subtitle={viewRec?.employee_no ?? ''}
        onClose={() => setViewRec(null)}
        footerActions={viewRec && canManage ? (
          <>
            <button className="secondary-btn text-[var(--danger)] border-[var(--danger)]/40" onClick={() => setPendingVoid(viewRec)}>
              <Trash2 size={14} className="inline mr-1.5" />Void
            </button>
            <button className="primary-btn" onClick={() => { openEdit(viewRec); setViewRec(null); }}>
              <Edit2 size={14} className="inline mr-1.5" />Correct
            </button>
          </>
        ) : undefined}
      >
        {viewRec && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Status',  el: <StatusPill status={viewRec.day_status} /> },
                { label: 'Worked',  el: <span className="font-bold">{fmtMin(viewRec.worked_minutes)}</span> },
                { label: 'Clock In', el: <span className="font-bold tabular-nums">{viewRec.in_time ?? '—'}</span> },
                { label: 'Clock Out', el: <span className="font-bold tabular-nums">{viewRec.out_time ?? '—'}</span> },
                { label: 'Late', el: <span>{viewRec.late_minutes ? `${viewRec.late_minutes}m` : '—'}</span> },
                { label: 'Overtime', el: <span>{viewRec.overtime_minutes ? fmtMin(viewRec.overtime_minutes) : '—'}</span> },
              ].map(x => (
                <div key={x.label} className="bg-[var(--bg)] border border-[var(--border)] rounded-[10px] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{x.label}</p>
                  <div className="text-[14px] text-[var(--text-primary)]">{x.el}</div>
                </div>
              ))}
            </div>

            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Capture Details</p>
              </div>
              <div className="px-4 py-1 text-[13px]">
                {[
                  ['Source In',  viewRec.source_in ?? '—'],
                  ['Source Out', viewRec.source_out ?? '—'],
                  ['In IP',      viewRec.in_ip ?? '—'],
                  ['Out IP',     viewRec.out_ip ?? '—'],
                  ['Device',     viewRec.device_id ?? '—'],
                ].map(([l, v]) => (
                  <div key={l as string} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0">
                    <span className="text-[var(--text-muted)]">{l}</span><span className="font-medium">{v}</span>
                  </div>
                ))}
                {[
                  { label: 'Clock-in GPS',  lat: viewRec.map_lat,     lng: viewRec.map_lng,     acc: viewRec.map_accuracy },
                  { label: 'Clock-out GPS', lat: viewRec.map_out_lat, lng: viewRec.map_out_lng, acc: viewRec.map_out_accuracy },
                ].map(g => (
                  <div key={g.label} className="flex justify-between py-2 border-b border-[var(--border)] last:border-0">
                    <span className="text-[var(--text-muted)]">{g.label}</span>
                    {g.lat != null ? (
                      <span className="text-right">
                        <a className="font-medium text-[var(--accent)] underline" target="_blank" rel="noreferrer"
                           href={`https://www.google.com/maps?q=${g.lat},${g.lng}`}>
                          {Number(g.lat).toFixed(5)}, {Number(g.lng).toFixed(5)}
                        </a>
                        {g.acc != null && (
                          <span className={`block text-[11px] ${Number(g.acc) > 1000 ? 'text-amber-600' : 'text-[var(--text-muted)]'}`}>
                            ±{Number(g.acc) >= 1000 ? `${(Number(g.acc) / 1000).toFixed(1)} km` : `${g.acc} m`}{Number(g.acc) > 1000 ? ' — approximate (no GPS, likely network-based)' : ''}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="font-medium text-[var(--text-muted)]">Not captured</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {(photos?.image_in || photos?.image_out) && (
              <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
                <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Punch Photos</p>
                </div>
                <div className="p-3 grid grid-cols-2 gap-3">
                  {[
                    { label: `Clock In${viewRec.in_time ? ` · ${viewRec.in_time}` : ''}`,  src: photos?.image_in },
                    { label: `Clock Out${viewRec.out_time ? ` · ${viewRec.out_time}` : ''}`, src: photos?.image_out },
                  ].map(p => (
                    <div key={p.label}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">{p.label}</p>
                      {p.src ? (
                        <img src={p.src} alt={p.label} className="w-full rounded-[10px] border border-[var(--border)] object-cover" />
                      ) : (
                        <div className="w-full aspect-[4/3] rounded-[10px] border border-dashed border-[var(--border)] flex items-center justify-center text-[11px] text-[var(--text-muted)]">No photo</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-[12px] border border-[var(--border)] overflow-hidden">
              <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Punch Trail</p>
              </div>
              {punches.length === 0 ? (
                <p className="px-4 py-3 text-[12px] text-[var(--text-muted)]">No raw punches recorded</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {punches.map((p: any) => (
                    <div key={p.id} className="px-4 py-2 flex items-center justify-between text-[12.5px]">
                      <span className="tabular-nums font-medium">{String(p.punch_time).slice(11, 19)}</span>
                      <span className="text-[var(--text-muted)]">{p.source}{p.device_id ? ` · ${p.device_id}` : ''}{p.ip ? ` · ${p.ip}` : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(viewRec.edited_at || viewRec.note) && (
              <div className="rounded-[12px] border border-[var(--border)] px-4 py-3 text-[12.5px] bg-[var(--bg)]">
                {viewRec.note && <p className="mb-1"><span className="text-[var(--text-muted)]">Note:</span> {viewRec.note}</p>}
                {viewRec.edited_at && <p className="text-[var(--text-muted)]">Last corrected {viewRec.edited_at}{viewRec.edit_note ? ` — ${viewRec.edit_note}` : ''}</p>}
              </div>
            )}
          </div>
        )}
      </DetailSlideOver>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Imports
// ══════════════════════════════════════════════════════════════════════════════

function ImportsTab() {
  const { can } = useCan();
  const canManage = can('manage_attendance');
  const [batches, setBatches] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get('/attendance/import/batches').then(r => setBatches(r.data?.data ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/attendance/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = r.data?.data;
      toast.success(`Imported: ${d?.inserted ?? 0} punches, ${d?.duplicates ?? 0} duplicates, ${d?.failed ?? 0} failed`);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Import failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-[var(--text-primary)]">Import Punch Log</h3>
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
            CSV columns: <code className="font-mono">employee_no, date, time[, direction]</code> or <code className="font-mono">employee_no, datetime</code>. Save Excel sheets as CSV first.
          </p>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => handleFile(e.target.files?.[0] ?? null)} />
        {canManage && <button className="primary-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 size={14} className="inline mr-1.5 animate-spin" /> : <Upload size={14} className="inline mr-1.5" />}
          {uploading ? 'Importing…' : 'Upload CSV'}
        </button>}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['When', 'File / Device', 'Source', 'Rows', 'Inserted', 'Duplicates', 'Failed', 'Errors'].map(h => <th key={h} className="th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr><td colSpan={8} className="td text-center text-[var(--text-muted)] py-10">No imports yet</td></tr>
            ) : batches.map(b => (
              <tr key={b.id} className="tr">
                <td className="td tabular-nums">{b.imported_at}</td>
                <td className="td font-medium">{b.file_name ?? b.device_id ?? '—'}</td>
                <td className="td">{b.source}</td>
                <td className="td tabular-nums">{b.total_rows}</td>
                <td className="td tabular-nums text-[var(--success)]">{b.inserted}</td>
                <td className="td tabular-nums">{b.duplicates}</td>
                <td className="td tabular-nums text-[var(--danger)]">{b.failed}</td>
                <td className="td text-[12px] text-[var(--text-muted)] max-w-[280px] truncate" title={b.errors ?? ''}>{b.errors ? b.errors.split('\n')[0] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Reports
// ══════════════════════════════════════════════════════════════════════════════

function ReportsTab() {
  const [from, setFrom] = useState(dateNow());
  const [to, setTo]     = useState(dateNow());
  const [data, setData] = useState<any>(null);

  const load = useCallback(() => {
    api.get(`/attendance/summary?date_from=${from}&date_to=${to}`)
      .then(r => setData(r.data?.data ?? null))
      .catch(() => toast.error('Failed to load summary'));
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const totals = data?.totals ?? {};
  // "No Record" only makes sense for a single day: headcount minus everyone with any record that day.
  // Mid-day this is "not clocked in yet"; the 21:30 auto-absent job converts them to Absent.
  const singleDay  = from === to;
  const dayCounts: Record<string, number> = singleDay ? (data?.days?.[from] ?? {}) : {};
  const recorded   = Object.values(dayCounts).reduce((a, b) => a + Number(b), 0);
  const noRecord   = singleDay ? Math.max(0, (data?.headcount ?? 0) - recorded) : null;

  const cards = [
    { label: 'Headcount',  value: data?.headcount ?? 0, color: '#185FA5', icon: UsersIcon,   hint: 'Approved employees' },
    { label: 'Present',    value: totals.Present ?? 0,  color: '#16a34a', icon: UserCheck,   hint: 'On time, full day' },
    { label: 'Late',       value: totals.Late ?? 0,     color: '#d97706', icon: Clock,       hint: 'Beyond grace period' },
    { label: 'Half Day',   value: totals.Half_Day ?? 0, color: '#0284c7', icon: Hourglass,   hint: 'Below day threshold' },
    { label: 'On Leave',   value: totals.On_Leave ?? 0, color: '#6366f1', icon: CalendarDays, hint: 'Approved leave' },
    { label: 'Incomplete', value: totals.Incomplete ?? 0, color: '#ea580c', icon: AlertCircle, hint: 'No clock-out yet' },
    { label: 'Absent',     value: totals.Absent ?? 0,   color: '#dc2626', icon: XCircle,     hint: 'No punch recorded' },
    ...(noRecord != null ? [{ label: 'No Record', value: noRecord, color: '#64748b', icon: HelpCircle, hint: 'Not clocked in yet' }] : []),
  ];

  const exportSummary = () => {
    if (!data) return;
    const days = Object.entries(data.days ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (!days.length) { toast.error('Nothing to export for this range'); return; }
    downloadCsv(`attendance_summary_${from}_${to}.csv`, [
      ['Date', ...STATUS_OPTIONS.map(s => s.replace(/_/g, ' '))],
      ...days.map(([d, counts]: any) => [d, ...STATUS_OPTIONS.map(st => counts[st] ?? 0)]),
      ['Total', ...STATUS_OPTIONS.map(st => totals[st] ?? 0)],
    ]);
  };

  const exportDetailed = async () => {
    try {
      const r = await api.get(`/attendance/export?date_from=${from}&date_to=${to}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url; a.download = `attendance_${from}_${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">From</label><input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="flex items-center gap-2 ml-auto">
          <button className="secondary-btn" onClick={exportSummary}><Download size={14} className="inline mr-1.5" />Export Summary</button>
          <button className="secondary-btn" onClick={exportDetailed}><Download size={14} className="inline mr-1.5" />Export Detailed Report</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {cards.map((c, i) => <StatCard key={c.label} {...c} delay={i * 0.04} />)}
      </div>
      {singleDay && (
        <p className="text-[11.5px] text-[var(--text-muted)] -mt-2">
          No Record = approved employees with no attendance entry yet today. The nightly job marks them Absent at 21:30 if they never punch.
        </p>
      )}

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-x-auto">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h3 className="font-bold text-[var(--text-primary)] text-[14px]">Daily Breakdown</h3>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[var(--bg)]">
              {['Date', ...STATUS_OPTIONS.map(s => s.replace(/_/g, ' '))].map(h => <th key={h} className="th">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {Object.keys(data?.days ?? {}).length === 0 ? (
              <tr><td colSpan={9} className="td text-center text-[var(--text-muted)] py-10">No data for this range</td></tr>
            ) : Object.entries(data.days).sort(([a], [b]) => b.localeCompare(a)).map(([d, counts]: any) => (
              <tr key={d} className="tr">
                <td className="td font-medium tabular-nums">{d}</td>
                {STATUS_OPTIONS.map(st => <td key={st} className="td tabular-nums">{counts[st] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — Night Shift assignment
// ══════════════════════════════════════════════════════════════════════════════

function NightShiftTab() {
  const { can } = useCan();
  const canManage = can('manage_attendance');
  const [assigned, setAssigned] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [assignedFrom, setAssignedFrom] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [policy, setPolicy] = useState<{ start: string; end: string }>({ start: '21:00', end: '06:00' });
  const [addOpen, setAddOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<any>(null);
  const employees = useEmployees();

  const load = useCallback(() => {
    api.get('/attendance/night-shift')
      .then(r => setAssigned(r.data?.data ?? []))
      .catch(() => toast.error('Failed to load night shift assignments'));
    api.get('/attendance/settings').then(r => {
      const d = r.data?.data ?? {};
      setPolicy({ start: d.attendance_night_start ?? '21:00', end: d.attendance_night_end ?? '06:00' });
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // Only employees not already on the night shift are offered in the Add modal
  const assignedIds = new Set(assigned.map(a => String(a.employee)));
  const addOptions  = employees.filter(e => !assignedIds.has(e.id));

  const handleAdd = async () => {
    if (!selection.length) { toast.error('Select at least one employee'); return; }
    setSaving(true);
    try {
      const r = await api.post('/attendance/night-shift', { employees: selection });
      toast.success(r.data?.message ?? 'Added to night shift');
      setAddOpen(false);
      setSelection([]);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Save failed');
    } finally { setSaving(false); }
  };

  const handleRemove = async () => {
    if (!pendingRemove) return;
    try {
      await api.delete(`/attendance/night-shift/${pendingRemove.employee}`);
      toast.success(`${pendingRemove.name ?? 'Employee'} removed from night shift`);
      setPendingRemove(null);
      load();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Remove failed');
    }
  };

  const filtered = assigned.filter(a => {
    if (search && !(
      a.name?.toLowerCase().includes(search.toLowerCase()) ||
      a.employee_no?.toLowerCase().includes(search.toLowerCase())
    )) return false;
    const d = a.assigned_at ? String(a.assigned_at).slice(0, 10) : '';
    if (assignedFrom && d && d < assignedFrom) return false;
    if (assignedTo && d && d > assignedTo) return false;
    return true;
  });

  const activeFilterCount = [assignedFrom, assignedTo].filter(Boolean).length;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] p-5">
        <h3 className="font-bold text-[var(--text-primary)]">Night Shift Employees</h3>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Assigned employees are measured against the night shift hours
          (<span className="font-semibold tabular-nums">{policy.start} – {policy.end}</span>, configurable in
          Settings → Controls → Attendance). Their punches after midnight count toward the shift that started
          the previous evening, and they are marked Absent only after the night closing time the next morning.
        </p>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
        <TableToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          showFilters={showFilters}
          filterBar={showFilters ? (
            <div className="flex flex-wrap items-end gap-3 py-1">
              <div><label className="label">Assigned From</label><input type="date" className={inputClass} value={assignedFrom} onChange={e => setAssignedFrom(e.target.value)} /></div>
              <div><label className="label">Assigned To</label><input type="date" className={inputClass} value={assignedTo} onChange={e => setAssignedTo(e.target.value)} /></div>
              {activeFilterCount > 0 && (
                <button onClick={() => { setAssignedFrom(''); setAssignedTo(''); }} className="flex items-center gap-1 text-[12px] text-[var(--danger)] hover:underline h-8 self-end">
                  <X size={12} /> Clear all ({activeFilterCount})
                </button>
              )}
            </div>
          ) : undefined}
          actions={
            <div className="flex items-center gap-2">
              {canManage && <button className="primary-btn" onClick={() => { setSelection([]); setAddOpen(true); }}>
                <Plus size={15} className="mr-1.5 inline" />Add Employees
              </button>}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`secondary-btn shrink-0 relative ${showFilters || activeFilterCount > 0 ? 'ring-2 ring-[var(--accent)] border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-dim)]' : ''}`}
              >
                Filter <Filter className="w-[14px] h-[14px] fill-current opacity-80" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[9px] font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          }
        />

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--bg)]">
                {['Employee', 'ID', 'Assigned Since', ''].map(h => <th key={h} className="th">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="td text-center text-[var(--text-muted)] py-10">
                  {assigned.length === 0 ? 'No employees on the night shift — everyone follows the day schedule' : 'No records match the selected filter'}
                </td></tr>
              ) : filtered.map(a => (
                <tr key={a.employee} className="tr">
                  <td className="td font-medium">{a.name || '—'}</td>
                  <td className="td text-[var(--text-muted)]">{a.employee_no || '—'}</td>
                  <td className="td tabular-nums">{a.assigned_at ? String(a.assigned_at).slice(0, 10) : '—'}</td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1">
                      {canManage
                        ? <button className="action-btn text-[var(--danger)]" title="Remove from night shift" onClick={() => setPendingRemove(a)}><Trash2 size={14} /></button>
                        : <span className="text-[var(--text-muted)]">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TablePagination total={assigned.length} filtered={filtered.length} />
      </div>

      {addOpen && (
        <FormModal
          title="Add Employees to Night Shift"
          onClose={() => setAddOpen(false)}
          onSave={() => { void handleAdd(); }}
          maxWidth="lg"
        >
          <FormField label="Employees" required hint="Only employees not already on the night shift are listed. Their attendance will follow the night schedule from their next punch.">
            <MultiSearchSelect
              options={addOptions}
              value={selection}
              onChange={setSelection}
              placeholder={addOptions.length ? 'Select employees…' : 'All employees are already assigned'}
            />
          </FormField>
        </FormModal>
      )}

      {pendingRemove && (
        <ConfirmModal
          title="Remove from Night Shift?"
          message={`${pendingRemove.name ?? 'This employee'} will follow the day schedule from their next punch.`}
          confirmLabel="Remove"
          onConfirm={handleRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — page
// ══════════════════════════════════════════════════════════════════════════════

export function AdminAttendance() {
  const [tab, setTab] = useState('Daily Log');
  const employees = useEmployees();
  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto flex flex-col gap-4 min-h-full">
      <PageHeader title="Attendance Management" subtitle="Daily logs, timesheets, device imports, and reports — policy lives in Settings → Controls → Attendance" />
      <TabBar tabs={['Daily Log', 'Timesheets', 'Night Shift', 'Imports', 'Reports']} activeTab={tab} onChange={setTab}
        icons={{
          'Daily Log':   <ClipboardList size={14} />,
          'Timesheets':  <CalendarDays size={14} />,
          'Night Shift': <Moon size={14} />,
          'Imports':     <Upload size={14} />,
          'Reports':     <BarChart3 size={14} />,
        }} />
      {tab === 'Daily Log'   && <DailyLogTab />}
      {tab === 'Timesheets'  && <TimesheetView employeeOptions={employees} />}
      {tab === 'Night Shift' && <NightShiftTab />}
      {tab === 'Imports'     && <ImportsTab />}
      {tab === 'Reports'     && <ReportsTab />}
    </div>
  );
}
