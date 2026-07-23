import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Network, Users, Building2, ChevronDown, ChevronRight,
  AlignLeft, Search, X, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import { toast } from 'sonner';
import { SearchSelect } from './ui/SearchSelect';
import api from '../../lib/api';
import { PageHeader } from './ui/PageHeader';

interface StaffNode {
  id: string;
  employee_id: string | null;
  name: string;
  job_title: string | null;
  department: string | null;
  supervisor_id: string | null;
}

// ─── Department accents (deterministic per department name) ──────────────────

type DeptCfg = { accent: string; bg: string; border: string; text: string };

const PALETTE: DeptCfg[] = [
  { accent: '#0066b3', bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
  { accent: '#d97706', bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
  { accent: '#059669', bg: '#f0fdf4', border: '#6ee7b7', text: '#065f46' },
  { accent: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd', text: '#5b21b6' },
  { accent: '#dc2626', bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
  { accent: '#0891b2', bg: '#ecfeff', border: '#67e8f9', text: '#155e75' },
  { accent: '#db2777', bg: '#fdf2f8', border: '#f9a8d4', text: '#9d174d' },
];
const NEUTRAL: DeptCfg = { accent: '#64748b', bg: '#f8fafc', border: '#cbd5e1', text: '#334155' };

function deptCfg(dept: string | null): DeptCfg {
  if (!dept) return NEUTRAL;
  let h = 0;
  for (let i = 0; i < dept.length; i++) h = (h * 31 + dept.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';

const LINE = '#cbd5e1';

// Roots = staff with no (present) supervisor. Supervisor cycles (A→B→…→A) make
// every member look like they have a boss, leaving no roots — detect anyone not
// reachable from the natural roots and promote one member of each loop instead.
function findRoots(
  nodes: StaffNode[],
  byId: Map<string, StaffNode>,
  childrenMap: Map<string, StaffNode[]>,
  present: Set<string> | null,
): StaffNode[] {
  const exists = (id: string | null) => !!id && byId.has(id) && (!present || present.has(id));
  const kids = (id: string) => (childrenMap.get(id) ?? []).filter(c => !present || present.has(c.id));

  const roots = nodes.filter(s => !s.supervisor_id || s.supervisor_id === s.id || !exists(s.supervisor_id));

  const reachable = new Set<string>();
  const stack = roots.map(r => r.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    kids(id).forEach(c => stack.push(c.id));
  }

  for (const s of nodes) {
    if (reachable.has(s.id)) continue;
    // Walk up the supervisor chain until it loops; the repeated node is in the cycle
    const walked = new Set<string>();
    let cur = s;
    while (!walked.has(cur.id)) {
      walked.add(cur.id);
      const next = cur.supervisor_id ? byId.get(cur.supervisor_id) : undefined;
      if (!next || !exists(next.id)) break;
      cur = next;
    }
    roots.push(cur);
    // Mark the whole component reachable so we only promote one root per cycle
    const st = [cur.id];
    while (st.length) {
      const id = st.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      kids(id).forEach(c => st.push(c.id));
    }
  }

  return roots.sort((a, b) => (childrenMap.get(b.id)?.length ?? 0) - (childrenMap.get(a.id)?.length ?? 0));
}

// ─── Staff card (tree view) ───────────────────────────────────────────────────

function StaffCard({ emp, reports, expanded, onToggle, matched, dimmed }: {
  emp: StaffNode; reports: number; expanded: boolean; onToggle: () => void;
  matched: boolean; dimmed: boolean;
}) {
  const c = deptCfg(emp.department);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`relative bg-white rounded-[14px] border border-slate-200 shadow-sm hover:shadow-md transition-shadow w-[180px] sm:w-[200px] md:w-[220px] overflow-hidden select-none ${dimmed ? 'opacity-60' : ''}`}
      style={matched ? { boxShadow: `0 0 0 2px ${c.accent}` } : undefined}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3.5px] rounded-l-[14px]" style={{ background: c.accent }} />

      <div className="pl-4 pr-3 pt-3 pb-3">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full shrink-0 flex items-center justify-center text-[11px] sm:text-[12px] font-bold"
            style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.accent }}
          >
            {initials(emp.name)}
          </div>
          <div className="min-w-0">
            <p className="text-[12px] sm:text-[13px] font-bold text-slate-800 leading-snug truncate">{emp.name}</p>
            <p className="text-[9px] sm:text-[10.5px] text-slate-400 truncate">{emp.job_title || 'No job title'}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[8px] sm:text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-md"
            style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}
          >
            {emp.department || 'No department'}
          </span>
          {emp.employee_id && (
            <span className="text-[8px] sm:text-[9px] font-mono font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-md">
              {emp.employee_id}
            </span>
          )}
        </div>

        {reports > 0 && (
          <button
            onClick={onToggle}
            className="mt-2.5 w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[10px] sm:text-[11px] font-semibold transition-all"
            style={{
              background: expanded ? c.bg : '#f8fafc',
              color:      expanded ? c.accent : '#94a3b8',
              border:     `1px solid ${expanded ? c.border : '#e2e8f0'}`,
            }}
          >
            <span>{reports} {reports === 1 ? 'report' : 'reports'}</span>
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

function TreeNode({ emp, childrenMap, level, seen, highlight }: {
  emp: StaffNode; childrenMap: Map<string, StaffNode[]>; level: number; seen: Set<string>;
  highlight: Set<string> | null;
}) {
  // Start collapsed to just the top level (no-supervisor staff); the user expands from there.
  // While filtering, the tree is pruned to matches — keep every branch open.
  const [expanded, setExpanded] = useState(highlight !== null);
  // Guard against bad data cycles (an employee appearing in its own chain)
  const children = (childrenMap.get(emp.id) ?? []).filter(c => !seen.has(c.id));
  const hasChildren = children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <StaffCard
        emp={emp}
        reports={children.length}
        expanded={expanded}
        onToggle={() => setExpanded(v => !v)}
        matched={highlight !== null && highlight.has(emp.id)}
        dimmed={highlight !== null && !highlight.has(emp.id)}
      />

      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            key="children"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center overflow-visible"
          >
            <div className="w-px h-6 shrink-0" style={{ background: LINE }} />

            <div className="flex justify-center">
              {children.map((child, i) => {
                const isFirst = i === 0;
                const isLast  = i === children.length - 1;
                const isOnly  = children.length === 1;

                return (
                  <div key={child.id} className="relative flex flex-col items-center pt-4 sm:pt-6 px-2 sm:px-4">
                    {!isOnly && (
                      <div
                        className="absolute top-0 h-px"
                        style={{
                          background: LINE,
                          left:  isFirst ? '50%' : 0,
                          right: isLast  ? '50%' : 0,
                        }}
                      />
                    )}
                    <div
                      className="absolute top-0 w-px h-6 left-1/2 -translate-x-1/2"
                      style={{ background: LINE }}
                    />
                    <TreeNode
                      emp={child}
                      childrenMap={childrenMap}
                      level={level + 1}
                      seen={new Set([...seen, emp.id])}
                      highlight={highlight}
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── List node ────────────────────────────────────────────────────────────────

function ListNode({ emp, childrenMap, level, seen, highlight }: {
  emp: StaffNode; childrenMap: Map<string, StaffNode[]>; level: number; seen: Set<string>;
  highlight: Set<string> | null;
}) {
  const [expanded, setExpanded] = useState(highlight !== null);
  const children = (childrenMap.get(emp.id) ?? []).filter(c => !seen.has(c.id));
  const hasChildren = children.length > 0;
  const c = deptCfg(emp.department);
  const indent = level * 22;
  const matched = highlight !== null && highlight.has(emp.id);
  const dimmed  = highlight !== null && !highlight.has(emp.id);

  return (
    <div>
      <div
        className={`flex items-center gap-2 sm:gap-2.5 py-2 sm:py-2.5 pr-2 sm:pr-4 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer text-[12px] sm:text-[13px] ${dimmed ? 'opacity-60' : ''}`}
        style={{ paddingLeft: `${12 + indent}px`, background: matched ? c.bg : undefined }}
        onClick={() => hasChildren && setExpanded(v => !v)}
      >
        <div
          className={`w-4 h-4 shrink-0 flex items-center justify-center rounded transition-colors ${
            hasChildren ? 'text-slate-400 hover:text-slate-700' : 'opacity-0 pointer-events-none'
          }`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>

        <div
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-full shrink-0 flex items-center justify-center text-[9px] sm:text-[10px] font-bold"
          style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.accent }}
        >
          {initials(emp.name)}
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 leading-none">{emp.name}</span>
          {emp.job_title && (
            <span className="text-[11px] text-slate-400">{emp.job_title}</span>
          )}
        </div>

        <span
          className="shrink-0 text-[8px] sm:text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md"
          style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}
        >
          {emp.department || 'No dept'}
        </span>

        {hasChildren && (
          <span
            className="shrink-0 text-[9px] sm:text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full"
            style={{ background: c.bg, color: c.accent, border: `1px solid ${c.border}` }}
          >
            {children.length}
          </span>
        )}
      </div>

      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            key="children"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div style={{ borderLeft: `2px solid ${c.border}`, marginLeft: `${12 + indent + 12}px` }}>
              {children.map(child => (
                <ListNode
                  key={child.id}
                  emp={child}
                  childrenMap={childrenMap}
                  level={level + 1}
                  seen={new Set([...seen, emp.id])}
                  highlight={highlight}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function StaffOrganogram() {
  const [staff,   setStaff]   = useState<StaffNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState<'tree' | 'list'>('tree');
  const [search,  setSearch]  = useState('');
  const [dept,    setDept]    = useState('');

  useEffect(() => {
    api.get('/employees/organogram')
      .then(r => setStaff(r.data.data ?? []))
      .catch(() => toast.error('Failed to load staff organogram'))
      .finally(() => setLoading(false));
  }, []);

  const byId = useMemo(() => new Map(staff.map(s => [s.id, s])), [staff]);

  const childrenMap = useMemo(() => {
    const m = new Map<string, StaffNode[]>();
    for (const s of staff) {
      if (s.supervisor_id && s.supervisor_id !== s.id && byId.has(s.supervisor_id)) {
        const arr = m.get(s.supervisor_id) ?? [];
        arr.push(s);
        m.set(s.supervisor_id, arr);
      }
    }
    return m;
  }, [staff, byId]);

  const roots = useMemo(
    () => findRoots(staff, byId, childrenMap, null),
    [staff, byId, childrenMap]
  );

  const departments = useMemo(
    () => [...new Set(staff.map(s => s.department).filter(Boolean) as string[])].sort(),
    [staff]
  );
  const deptOpts = useMemo(
    () => [{ id: '', label: 'All departments' }, ...departments.map(d => ({ id: d, label: d }))],
    [departments]
  );

  const filtering = search.trim() !== '' || dept !== '';
  const matchIds = useMemo(() => {
    if (!filtering) return null;
    const q = search.trim().toLowerCase();
    return new Set(staff.filter(s => {
      if (dept && s.department !== dept) return false;
      if (q && ![s.name, s.job_title, s.department, s.employee_id]
        .some(v => (v ?? '').toLowerCase().includes(q))) return false;
      return true;
    }).map(s => s.id));
  }, [staff, search, dept, filtering]);

  // Matches plus their full supervisor chain, so the reporting line stays visible
  const visibleIds = useMemo(() => {
    if (!matchIds) return null;
    const v = new Set<string>();
    for (const id of matchIds) {
      let cur = byId.get(id);
      const path = new Set<string>();
      while (cur && !path.has(cur.id)) {
        path.add(cur.id);
        v.add(cur.id);
        cur = cur.supervisor_id ? byId.get(cur.supervisor_id) : undefined;
      }
    }
    return v;
  }, [matchIds, byId]);

  const effChildrenMap = useMemo(() => {
    if (!visibleIds) return childrenMap;
    const m = new Map<string, StaffNode[]>();
    for (const [sup, kids] of childrenMap) {
      if (!visibleIds.has(sup)) continue;
      const f = kids.filter(c => visibleIds.has(c.id));
      if (f.length > 0) m.set(sup, f);
    }
    return m;
  }, [childrenMap, visibleIds]);

  const effRoots = useMemo(() => {
    if (!visibleIds) return roots;
    return findRoots(staff.filter(s => visibleIds.has(s.id)), byId, childrenMap, visibleIds);
  }, [visibleIds, roots, staff, byId, childrenMap]);

  // A natural root has no supervisor on record; a root that still has one was
  // promoted to break a supervisor loop in the data
  const cycleRoots = useMemo(
    () => roots.filter(r => r.supervisor_id && r.supervisor_id !== r.id && byId.has(r.supervisor_id)),
    [roots, byId]
  );

  const stats = [
    { label: 'Staff',       value: staff.length,       Icon: Users     },
    { label: 'Departments', value: departments.length, Icon: Building2 },
    { label: 'Top Level',   value: roots.length,       Icon: Network   },
  ];

  // ── Tree zoom-to-fit ──────────────────────────────────────────────────────
  // A wide org overflows horizontally; zooming lets the whole structure be seen
  // at a glance. We use CSS `zoom` (reflows, so scrollbars stay correct).
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const treeRef   = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const ZMIN = 0.3, ZMAX = 1.3;
  const clampZoom = (z: number) => Math.round(Math.max(ZMIN, Math.min(ZMAX, z)) * 100) / 100;

  const fitToWidth = useCallback(() => {
    const c = canvasRef.current, t = treeRef.current;
    if (!c || !t) return;
    const natural = t.scrollWidth / (zoomRef.current || 1); // scrollWidth scales with zoom
    if (!natural) return;
    const avail = c.clientWidth - 48; // leave a little breathing room
    setZoom(clampZoom(avail / natural));
  }, []);

  // Auto-fit whenever the tree content changes (load, filter, view switch).
  useEffect(() => {
    if (view !== 'tree' || loading) return;
    const id = setTimeout(fitToWidth, 80);
    return () => clearTimeout(id);
  }, [view, loading, search, dept, staff.length, fitToWidth]);

  return (
    <div className="flex-1 w-full relative h-full flex flex-col">
      <div className="w-full px-3 sm:px-6 md:px-8 py-6 sm:py-8 flex-1 flex flex-col max-w-full">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 sm:mb-7">
          <PageHeader title="Staff Organogram" subtitle="Who reports to whom — built from each employee's supervisor and department." />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 drop-shadow-sm"
        >
        {/* Toolbar */}
          <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:gap-4 items-start sm:items-center justify-between">
            <div className="w-full sm:flex-1 sm:min-w-0 flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="search-wrap flex-1 sm:sm:min-w-[240px]">
                <Search size={13} />
                <input
                  type="text"
                  placeholder="Search staff…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="w-full sm:w-52">
                <SearchSelect value={dept} onChange={setDept} options={deptOpts} placeholder="All departments" />
              </div>
            </div>

            <div className="w-full sm:w-auto flex items-center gap-2 sm:gap-4 flex-wrap justify-between sm:justify-end">
              <div className="flex items-center gap-1.5 sm:gap-4 flex-wrap">
                {stats.map(({ label, value, Icon }) => (
                  <div key={label} className="flex items-center gap-1">
                    <Icon size={13} className="text-[var(--accent)] shrink-0" />
                    <span className="text-[12px] sm:text-[15px] font-extrabold syne text-[var(--text-primary)] leading-none">{value}</span>
                    <span className="text-[9px] sm:text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wide">{label}</span>
                  </div>
                ))}
              </div>

              {view === 'tree' && (
                <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0">
                  <button
                    onClick={() => setZoom(z => clampZoom(z - 0.1))}
                    title="Zoom out"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-all"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <button
                    onClick={fitToWidth}
                    title="Fit to screen"
                    className="px-1.5 h-7 flex items-center gap-1 rounded-lg text-[11px] font-bold text-slate-600 hover:text-[var(--accent)] hover:bg-white transition-all tabular-nums"
                  >
                    <Maximize2 size={11} /> {Math.round(zoom * 100)}%
                  </button>
                  <button
                    onClick={() => setZoom(z => clampZoom(z + 0.1))}
                    title="Zoom in"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-all"
                  >
                    <ZoomIn size={13} />
                  </button>
                </div>
              )}

              <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
                <button
                  onClick={() => setView('tree')}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-1.5 rounded-lg text-[11px] sm:text-[12px] font-bold transition-all whitespace-nowrap ${
                    view === 'tree' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Network size={12} /> <span className="hidden sm:inline">Tree</span>
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`px-2 sm:px-3 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-1.5 rounded-lg text-[11px] sm:text-[12px] font-bold transition-all whitespace-nowrap ${
                    view === 'list' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <AlignLeft size={12} /> <span className="hidden sm:inline">List</span>
                </button>
              </div>
            </div>
          </div>

          {/* Supervisor loop warning */}
          {!loading && cycleRoots.length > 0 && (
            <div className="px-3 sm:px-5 py-2 sm:py-2.5 border-b border-amber-200 bg-amber-50 flex items-start gap-2 text-[11px] sm:text-[12px] text-amber-800">
              <Network size={12} className="shrink-0 mt-0.5 sm:w-4 sm:h-4" />
              <span>
                Supervisor assignments form a loop around{' '}
                <strong>{cycleRoots.map(r => r.name).join(', ')}</strong>
                {' '}— each person in the chain ends up supervising themselves, so no one is truly top-level.
                The chart breaks the loop to display everyone; fix the Supervisor field on the affected employee profiles
                (the most senior person should have no supervisor).
              </span>
            </div>
          )}

          {/* Filter hint */}
          {filtering && !loading && matchIds && matchIds.size > 0 && (
            <div className="px-3 sm:px-5 py-2 border-b border-[var(--border)] bg-[var(--bg)] flex items-center gap-1.5 text-[11px] sm:text-[12px] text-[var(--text-muted)]">
              <Search size={11} className="shrink-0 sm:w-3 sm:h-3" />
              <span>
                {matchIds.size} matching staff highlighted — supervisors above them are kept (dimmed) to show the reporting line.
              </span>
            </div>
          )}

          {/* Canvas */}
          <div
            ref={canvasRef}
            className={`flex-1 overflow-auto min-h-[320px] sm:min-h-[480px] ${
              view === 'list'
                ? 'p-3 sm:p-5 bg-[var(--bg)]'
                : 'p-4 sm:p-8 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:22px_22px]'
            }`}
          >
            {loading ? (
              <div className="w-full flex flex-col items-center justify-center py-12 sm:py-24 gap-3 text-[var(--text-muted)]">
                <Network size={32} className="opacity-20 sm:w-9 sm:h-9" />
                <p className="text-[12px] sm:text-[13px] font-medium">Loading staff…</p>
              </div>
            ) : staff.length === 0 ? (
              <div className="w-full flex flex-col items-center justify-center py-12 sm:py-24 gap-3 text-[var(--text-muted)]">
                <Network size={32} className="opacity-20 sm:w-9 sm:h-9" />
                <p className="text-[12px] sm:text-[13px] font-medium">No active employees found.</p>
              </div>
            ) : filtering && matchIds && matchIds.size === 0 ? (
              <div className="w-full flex flex-col items-center justify-center py-12 sm:py-24 gap-3 text-[var(--text-muted)]">
                <Search size={32} className="opacity-20 sm:w-9 sm:h-9" />
                <p className="text-[12px] sm:text-[13px] font-medium">No staff match your filters.</p>
              </div>
            ) : view === 'tree' ? (
              <div
                ref={treeRef}
                key={`tree-${search}-${dept}`}
                style={{ zoom }}
                className="flex flex-col items-center gap-6 sm:gap-10 pb-8 sm:pb-12 pt-2 w-max min-w-full mx-auto"
              >
                {effRoots.map(emp => (
                  <TreeNode key={emp.id} emp={emp} childrenMap={effChildrenMap} level={0} seen={new Set()} highlight={matchIds} />
                ))}
              </div>
            ) : (
              <div key={`list-${search}-${dept}`} className="max-w-2xl mx-auto w-full">
                {effRoots.map(emp => (
                  <ListNode key={emp.id} emp={emp} childrenMap={effChildrenMap} level={0} seen={new Set()} highlight={matchIds} />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
