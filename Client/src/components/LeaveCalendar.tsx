import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { DetailSlideOver } from './ui/DetailSlideOver';
import api from '../../lib/api';

type ViewMode = 'month' | 'week' | 'day';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function leaveChipStyle(color: string | null | undefined, pending = false): React.CSSProperties {
  const base = color
    ? { background: `${color}${pending ? '11' : '22'}`, borderColor: `${color}${pending ? '44' : '66'}`, color }
    : { background: 'rgba(209,250,229,0.6)', borderColor: '#6ee7b7', color: '#065f46' };
  return pending ? { ...base, borderStyle: 'dashed' } : base;
}

function isPending(leave: any) {
  return leave.status === 'Pending Approval' || leave.status === 'Pending Financial Approval' || leave.status === 'Pending HR Approval';
}

export function LeaveCalendar() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [viewMode, setViewMode]       = useState<ViewMode>('month');
  const [leaves, setLeaves]           = useState<any[]>([]);
  const [holidays, setHolidays]       = useState<any[]>([]);
  const [workWeek, setWorkWeek]       = useState<Record<string, string>>(
    () => Object.fromEntries(WEEKDAY_NAMES.map(d => [d, d === 'Saturday' || d === 'Sunday' ? 'Non_working_Day' : 'Full_Day'])),
  );
  const [selectedLeave, setSelectedLeave] = useState<any | null>(null);

  const today = new Date();

  const getRange = () => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    if (viewMode === 'month') {
      const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m + 1, 0).getDate();
      const to   = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { from, to };
    }
    if (viewMode === 'week') {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return { from: formatDateStr(startOfWeek), to: formatDateStr(endOfWeek) };
    }
    const ds = formatDateStr(currentDate);
    return { from: ds, to: ds };
  };

  useEffect(() => {
    const { from, to } = getRange();
    Promise.allSettled([
      api.get(`/leave/calendar?from=${from}&to=${to}`),
      api.get('/leave/holidays'),
    ]).then(([leavesResult, holResult]) => {
      if (leavesResult.status === 'fulfilled') setLeaves(leavesResult.value.data.data ?? []);
      if (holResult.status === 'fulfilled')    setHolidays(holResult.value.data.data ?? []);
    });
  }, [currentDate, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Work-week config is global (not date-dependent) — fetch once.
  useEffect(() => {
    api.get('/leave/workweek')
      .then(r => {
        const map: Record<string, string> = {};
        for (const row of (r.data.data ?? [])) map[row.name] = row.status;
        if (Object.keys(map).length) setWorkWeek(prev => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, []);

  const handlePrev = () => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() - 1);
    else if (viewMode === 'week') d.setDate(d.getDate() - 7);
    else d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  };

  const handleNext = () => {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + 1);
    else if (viewMode === 'week') d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  };

  const handleToday = () => setCurrentDate(new Date());

  const monthName = currentDate.toLocaleString('default', { month: 'long' });
  const year      = currentDate.getFullYear();

  const getHolidayForDate = (dateStr: string) =>
    holidays.find(h => String(h.dateh ?? h.date ?? '').substring(0, 10) === dateStr);

  // A day is non-working when the Work Week (Manage Leave → Work Week) marks it
  // Non-working, or it's a public holiday — leaves are never counted on these days.
  const isNonWorkingDay = (dateStr: string) => {
    const weekday = WEEKDAY_NAMES[new Date(`${dateStr}T00:00:00`).getDay()];
    return workWeek[weekday] === 'Non_working_Day' || !!getHolidayForDate(dateStr);
  };

  const getLeavesForDate = (dateStr: string) => {
    if (isNonWorkingDay(dateStr)) return [];
    return leaves.filter(l => dateStr >= String(l.date_start).substring(0, 10) && dateStr <= String(l.date_end).substring(0, 10));
  };

  const daysInMonth     = new Date(year, currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, currentDate.getMonth(), 1).getDay();
  const monthDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) monthDays.push(null);
  for (let i = 1; i <= daysInMonth; i++) monthDays.push(i);

  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const renderTitle = () => {
    if (viewMode === 'month') return `${monthName} ${year}`;
    if (viewMode === 'week') {
      const start = weekDays[0];
      const end   = weekDays[6];
      if (start.getMonth() === end.getMonth())
        return `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()} – ${end.getDate()}, ${year}`;
      return `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()} – ${end.toLocaleString('default', { month: 'short' })} ${end.getDate()}, ${year}`;
    }
    return `${currentDate.toLocaleString('default', { weekday: 'long' })}, ${monthName} ${currentDate.getDate()}, ${year}`;
  };

  return (
    <div className="p-4 sm:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-[22px] font-bold syne text-[var(--text-primary)] tracking-tight">Leave Calendar</h2>
          <p className="text-xs sm:text-[13px] text-[var(--text-muted)] font-medium mt-1">View approved leave schedules.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center bg-slate-100 p-1 rounded-lg">
            {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-bold rounded-md capitalize transition-colors ${
                  viewMode === mode ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-100 border border-emerald-300"></span>
              <span className="text-xs font-medium text-slate-600">Approved</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-slate-100 border border-dashed border-slate-400"></span>
              <span className="text-xs font-medium text-slate-600">Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-100 border border-red-300"></span>
              <span className="text-xs font-medium text-slate-600">Holiday</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 min-h-[600px]">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2 text-slate-700 font-bold text-lg syne">
            <CalendarIcon size={20} className="text-[var(--accent)]" />
            {renderTitle()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleToday}
              className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded hover:bg-slate-100 transition-colors text-slate-600"
            >
              Today
            </button>
            <button onClick={handlePrev} className="p-1.5 border border-slate-200 rounded hover:bg-slate-100 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <button onClick={handleNext} className="p-1.5 border border-slate-200 rounded hover:bg-slate-100 transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Month view */}
        {viewMode === 'month' && (
          <div className="flex-1 overflow-auto">
           <div className="min-w-[720px] sm:min-w-0 flex flex-col h-full">
            <div className="grid grid-cols-7 border-b border-[var(--border)] bg-slate-100 sticky top-0 z-10">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="py-2 text-center text-xs font-bold text-slate-500 uppercase tracking-widest border-r border-[var(--border)] last:border-0">{day}</div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7 auto-rows-fr bg-[var(--border)] gap-px">
              {monthDays.map((day, index) => {
                if (day === null) return <div key={`empty-${index}`} className="bg-slate-50 min-h-[100px]" />;
                const dateStr    = formatDateStr(new Date(year, currentDate.getMonth(), day));
                const dateLeaves = getLeavesForDate(dateStr);
                const holiday    = getHolidayForDate(dateStr);
                const isToday    = dateStr === formatDateStr(today);
                return (
                  <div key={`day-${day}`} className="bg-white min-h-[100px] p-2 hover:bg-slate-50 transition-colors flex flex-col">
                    <span className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full mb-1 ${isToday ? 'bg-[var(--accent)] text-white' : holiday ? 'bg-red-50 text-red-600' : dateLeaves.length > 0 ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400'}`}>
                      {day}
                    </span>
                    <div className="flex flex-col gap-1 overflow-y-auto flex-1 pr-1">
                      {holiday && (
                        <div className="text-[10px] px-2 py-1 rounded border leading-tight truncate bg-red-50 text-red-700 border-red-200" title={holiday.name}>
                          <strong className="block truncate">🌟 {holiday.name}</strong>
                          <span className="opacity-80 truncate">Holiday</span>
                        </div>
                      )}
                      {dateLeaves.map((leave: any) => {
                        const pending = isPending(leave);
                        return (
                          <button
                            key={leave.id}
                            className="text-left text-[10px] px-2 py-1 rounded border leading-tight w-full hover:opacity-80 transition-opacity"
                            style={leaveChipStyle(leave.leave_color, pending)}
                            title={`${leave.employee_name || leave.employee} – ${leave.leave_type_name || ''}${pending ? ' (Pending)' : ''}`}
                            onClick={() => setSelectedLeave(leave)}
                          >
                            <strong className="block truncate">{leave.employee_name || leave.employee}</strong>
                            <span className="block truncate opacity-75">{leave.leave_type_name}</span>
                            {pending && <span className="block truncate opacity-60 italic">Pending</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
           </div>
          </div>
        )}

        {/* Week view */}
        {viewMode === 'week' && (
          <div className="flex-1 flex flex-col overflow-auto bg-slate-50">
            <div className="grid grid-cols-7 min-w-[720px] sm:min-w-0 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
              {weekDays.map((date, i) => {
                const isToday = formatDateStr(date) === formatDateStr(today);
                return (
                  <div key={i} className="py-3 text-center border-r border-slate-200 last:border-0">
                    <div className="text-xs font-bold text-slate-500 uppercase">{date.toLocaleString('default', { weekday: 'short' })}</div>
                    <div className={`text-lg font-bold mt-0.5 ${isToday ? 'bg-[var(--accent)] text-white w-8 h-8 flex items-center justify-center rounded-full mx-auto' : 'text-slate-800'}`}>
                      {date.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex-1 grid grid-cols-7 min-w-[720px] sm:min-w-0 bg-[var(--border)] gap-px p-4">
              {weekDays.map((date, i) => {
                const dateStr    = formatDateStr(date);
                const dateLeaves = getLeavesForDate(dateStr);
                const holiday    = getHolidayForDate(dateStr);
                return (
                  <div key={i} className={`rounded-lg p-2 min-h-[400px] shadow-sm flex flex-col gap-2 ${holiday ? 'bg-red-50/20' : 'bg-white'}`}>
                    {dateLeaves.length === 0 && !holiday && (
                      <div className="flex items-center justify-center h-full text-xs text-slate-400 font-medium">No leaves</div>
                    )}
                    {holiday && (
                      <div className="text-xs p-3 rounded-lg border flex flex-col gap-1 bg-red-50 text-red-800 border-red-200 shadow-sm">
                        <strong className="flex items-center gap-1.5"><span>🌟</span>{holiday.name}</strong>
                        <span className="opacity-80">Holiday</span>
                      </div>
                    )}
                    {dateLeaves.map((leave: any) => {
                      const pending = isPending(leave);
                      return (
                        <button
                          key={leave.id}
                          className="text-left text-xs p-3 rounded-lg border flex flex-col gap-1 hover:opacity-80 transition-opacity w-full"
                          style={leaveChipStyle(leave.leave_color, pending)}
                          onClick={() => setSelectedLeave(leave)}
                        >
                          <strong>{leave.employee_name || leave.employee}</strong>
                          <span className="opacity-80">{leave.leave_type_name}</span>
                          {pending && <span className="text-[10px] italic opacity-60">Pending</span>}
                          <div className="mt-1 pt-1 border-t border-black/5 text-[10px] font-medium opacity-70">
                            {String(leave.date_start).substring(0,10) === String(leave.date_end).substring(0,10) ? 'Full Day' : `${String(leave.date_start).substring(0,10)} to ${String(leave.date_end).substring(0,10)}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Day view */}
        {viewMode === 'day' && (
          <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 p-6">
            <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
              {(() => {
                const dateStr    = formatDateStr(currentDate);
                const dateLeaves = getLeavesForDate(dateStr);
                const holiday    = getHolidayForDate(dateStr);
                if (dateLeaves.length === 0 && !holiday) {
                  return (
                    <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center">
                      <CalendarIcon size={48} className="text-slate-300 mb-4" />
                      <h3 className="text-lg font-bold text-slate-700 syne">No Leaves Today</h3>
                      <p className="text-slate-500 mt-1 text-sm">No leaves scheduled for this date.</p>
                    </div>
                  );
                }
                return (
                  <>
                    {holiday && (
                      <div className="bg-white rounded-xl p-5 border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-red-200">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl bg-red-100 text-red-600">🌟</div>
                          <div>
                            <h4 className="font-bold text-slate-800 text-base">{holiday.name}</h4>
                            <p className="text-slate-500 text-sm font-medium">Holiday</p>
                          </div>
                        </div>
                        <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-red-50 text-red-700 border border-red-100">Public Holiday</span>
                      </div>
                    )}
                    {dateLeaves.map((leave: any) => {
                      const pending   = isPending(leave);
                      const chipStyle = leaveChipStyle(leave.leave_color, pending);
                      return (
                        <button
                          key={leave.id}
                          className="text-left bg-white rounded-xl p-5 border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow w-full"
                          style={{ borderColor: chipStyle.borderColor, borderStyle: pending ? 'dashed' : 'solid' }}
                          onClick={() => setSelectedLeave(leave)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: chipStyle.background, color: chipStyle.color }}>
                              {String(leave.employee_name || leave.employee).substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800 text-base">{leave.employee_name || leave.employee}</h4>
                              <p className="text-slate-500 text-sm font-medium">{leave.leave_type_name}</p>
                              {pending && <p className="text-slate-400 text-xs italic">Pending approval</p>}
                            </div>
                          </div>
                          <div className="flex flex-col sm:items-end gap-1 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-100">
                            <span className="text-xs px-2.5 py-1 rounded-full font-bold self-start sm:self-auto" style={{ background: chipStyle.background, color: chipStyle.color }}>
                              {leave.status}
                            </span>
                            <span className="text-xs text-slate-400 font-medium">
                              {String(leave.date_start).substring(0,10) === String(leave.date_end).substring(0,10) ? 'Full Day' : `${String(leave.date_start).substring(0,10)} → ${String(leave.date_end).substring(0,10)}`}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Leave detail slide-over */}
      <DetailSlideOver
        open={!!selectedLeave}
        title="Leave Details"
        subtitle={selectedLeave ? (selectedLeave.employee_name ?? selectedLeave.employee) : undefined}
        onClose={() => setSelectedLeave(null)}
        maxWidth="md"
      >
        {selectedLeave && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
            {[
              ['Leave Type',   selectedLeave.leave_type_name],
              ['Period',       selectedLeave.period_name],
              ['Start Date',   String(selectedLeave.date_start).substring(0, 10)],
              ['End Date',     String(selectedLeave.date_end).substring(0, 10)],
              ['Days',         selectedLeave.day_count ?? '—'],
              ['Status',       selectedLeave.status],
              ['Department',   selectedLeave.department_name ?? '—'],
              ['Employee ID',  selectedLeave.employee_code ?? '—'],
            ].map(([label, val]) => (
              <div key={label as string}>
                <p className="text-[11px] text-[var(--text-muted)] font-semibold uppercase tracking-wider mb-0.5">{label}</p>
                <p className="font-medium text-[var(--text-primary)]">{val ?? '—'}</p>
              </div>
            ))}
            {selectedLeave.notes && (
              <div className="col-span-2">
                <p className="text-[11px] text-[var(--text-muted)] font-semibold uppercase tracking-wider mb-0.5">Notes</p>
                <p className="font-medium text-[var(--text-primary)] whitespace-pre-wrap">{selectedLeave.notes}</p>
              </div>
            )}
          </div>
        )}
      </DetailSlideOver>
    </div>
  );
}
