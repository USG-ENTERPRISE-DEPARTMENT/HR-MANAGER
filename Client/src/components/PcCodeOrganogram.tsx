import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Network, Briefcase, UserCheck, ChevronDown, ChevronRight,
  AlignLeft, Search, X, ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { PageHeader } from './ui/PageHeader';

// A position node in the PC-code tree. `reports_to_id` is the parent position.
interface PcNode {
  id: string;
  code: string;
  name: string;
  reports_to_id: string | null;
  current_employee_name: string | null;
  current_employee_id: string | null;
  rm_ro_type: string | null;
}

// ─── RM/RO accents ───────────────────────────────────────────────────────────

type Cfg = { accent: string; bg: string; border: string; text: string };
const RM_CFG: Cfg = { accent: '#0066b3', bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' };
const RO_CFG: Cfg = { accent: '#059669', bg: '#f0fdf4', border: '#6ee7b7', text: '#065f46' };
const VACANT_CFG: Cfg = { accent: '#64748b', bg: '#f8fafc', border: '#cbd5e1', text: '#334155' };

function nodeCfg(n: PcNode): Cfg {
  if (!n.current_employee_name) return VACANT_CFG;
  return n.rm_ro_type === 'RO' ? RO_CFG : RM_CFG;
}

const LINE = '#cbd5e1';

// Roots = positions with no (present) parent. Guards against parent cycles by promoting
// one node per loop (mirrors StaffOrganogram.findRoots).
function findRoots(
  nodes: PcNode[],
  byId: Map<string, PcNode>,
  childrenMap: Map<string, PcNode[]>,
  present: Set<string> | null,
): PcNode[] {
  const exists = (id: string | null) => !!id && byId.has(id) && (!present || present.has(id));
  const kids = (id: string) => (childrenMap.get(id) ?? []).filter(c => !present || present.has(c.id));

  const roots = nodes.filter(s => !s.reports_to_id || s.reports_to_id === s.id || !exists(s.reports_to_id));

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
    const walked = new Set<string>();
    let cur = s;
    while (!walked.has(cur.id)) {
      walked.add(cur.id);
      const next = cur.reports_to_id ? byId.get(cur.reports_to_id) : undefined;
      if (!next || !exists(next.id)) break;
      cur = next;
    }
    roots.push(cur);
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

// ─── Position card (tree view) ────────────────────────────────────────────────

function PcCard({ node, reports, expanded, onToggle, matched, dimmed }: {
  node: PcNode; reports: number; expanded: boolean; onToggle: () => void;
  matched: boolean; dimmed: boolean;
}) {
  const c = nodeCfg(node);
  const holder = node.current_employee_name;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`relative bg-white rounded-[14px] border border-slate-200 shadow-sm hover:shadow-md transition-shadow w-[190px] sm:w-[210px] overflow-hidden select-none ${dimmed ? 'opacity-60' : ''}`}
      style={matched ? { boxShadow: `0 0 0 2px ${c.accent}` } : undefined}
    >
      <div className="absolute left-0 top-0 bottom-0 w-[3.5px] rounded-l-[14px]" style={{ background: c.accent }} />

      <div className="pl-4 pr-3 pt-3 pb-3">
        <div className="flex items-center gap-2.5 mb-2">
          <div
            className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center"
            style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.accent }}
          >
            <Briefcase size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-slate-800 leading-snug truncate">{node.name}</p>
            <p className="text-[10px] font-mono font-semibold text-slate-400">{node.code}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {holder ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}>
              <UserCheck size={9} /> {holder}
            </span>
          ) : (
            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md text-slate-400 bg-slate-50 border border-slate-200">
              Vacant
            </span>
          )}
          {node.rm_ro_type && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}>
              {node.rm_ro_type}
            </span>
          )}
        </div>

        {reports > 0 && (
          <button
            onClick={onToggle}
            className="mt-2.5 w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
            style={{
              background: expanded ? c.bg : '#f8fafc',
              color:      expanded ? c.accent : '#94a3b8',
              border:     `1px solid ${expanded ? c.border : '#e2e8f0'}`,
            }}
          >
            <span>{reports} {reports === 1 ? 'sub-position' : 'sub-positions'}</span>
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

function TreeNode({ node, childrenMap, seen, highlight }: {
  node: PcNode; childrenMap: Map<string, PcNode[]>; seen: Set<string>; highlight: Set<string> | null;
}) {
  const [expanded, setExpanded] = useState(highlight !== null);
  const children = (childrenMap.get(node.id) ?? []).filter(c => !seen.has(c.id));
  const hasChildren = children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <PcCard
        node={node}
        reports={children.length}
        expanded={expanded}
        onToggle={() => setExpanded(v => !v)}
        matched={highlight !== null && highlight.has(node.id)}
        dimmed={highlight !== null && !highlight.has(node.id)}
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
                      <div className="absolute top-0 h-px" style={{ background: LINE, left: isFirst ? '50%' : 0, right: isLast ? '50%' : 0 }} />
                    )}
                    <div className="absolute top-0 w-px h-6 left-1/2 -translate-x-1/2" style={{ background: LINE }} />
                    <TreeNode node={child} childrenMap={childrenMap} seen={new Set([...seen, node.id])} highlight={highlight} />
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

function ListNode({ node, childrenMap, level, seen, highlight }: {
  node: PcNode; childrenMap: Map<string, PcNode[]>; level: number; seen: Set<string>; highlight: Set<string> | null;
}) {
  const [expanded, setExpanded] = useState(highlight !== null);
  const children = (childrenMap.get(node.id) ?? []).filter(c => !seen.has(c.id));
  const hasChildren = children.length > 0;
  const c = nodeCfg(node);
  const indent = level * 22;
  const matched = highlight !== null && highlight.has(node.id);
  const dimmed  = highlight !== null && !highlight.has(node.id);

  return (
    <div>
      <div
        className={`flex items-center gap-2.5 py-2.5 pr-4 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer text-[13px] ${dimmed ? 'opacity-60' : ''}`}
        style={{ paddingLeft: `${12 + indent}px`, background: matched ? c.bg : undefined }}
        onClick={() => hasChildren && setExpanded(v => !v)}
      >
        <div className={`w-4 h-4 shrink-0 flex items-center justify-center rounded ${hasChildren ? 'text-slate-400' : 'opacity-0 pointer-events-none'}`}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
        <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center" style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.accent }}>
          <Briefcase size={13} />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 leading-none">{node.name}</span>
          <span className="text-[11px] font-mono text-slate-400">{node.code}</span>
          <span className="text-[11px] text-slate-400">{node.current_employee_name || 'Vacant'}</span>
        </div>
        {node.rm_ro_type && (
          <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md" style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}>
            {node.rm_ro_type}
          </span>
        )}
        {hasChildren && (
          <span className="shrink-0 text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full" style={{ background: c.bg, color: c.accent, border: `1px solid ${c.border}` }}>
            {children.length}
          </span>
        )}
      </div>

      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div key="children" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div style={{ borderLeft: `2px solid ${c.border}`, marginLeft: `${12 + indent + 12}px` }}>
              {children.map(child => (
                <ListNode key={child.id} node={child} childrenMap={childrenMap} level={level + 1} seen={new Set([...seen, node.id])} highlight={highlight} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function PcCodeOrganogram() {
  const [nodes,   setNodes]   = useState<PcNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState<'tree' | 'list'>('tree');
  const [search,  setSearch]  = useState('');

  useEffect(() => {
    api.get('/pc-codes/organogram')
      .then(r => setNodes(r.data.data ?? []))
      .catch(() => toast.error('Failed to load PC code organogram'))
      .finally(() => setLoading(false));
  }, []);

  const byId = useMemo(() => new Map(nodes.map(s => [s.id, s])), [nodes]);

  const childrenMap = useMemo(() => {
    const m = new Map<string, PcNode[]>();
    for (const s of nodes) {
      if (s.reports_to_id && s.reports_to_id !== s.id && byId.has(s.reports_to_id)) {
        const arr = m.get(s.reports_to_id) ?? [];
        arr.push(s);
        m.set(s.reports_to_id, arr);
      }
    }
    return m;
  }, [nodes, byId]);

  const roots = useMemo(() => findRoots(nodes, byId, childrenMap, null), [nodes, byId, childrenMap]);

  const filtering = search.trim() !== '';
  const matchIds = useMemo(() => {
    if (!filtering) return null;
    const q = search.trim().toLowerCase();
    return new Set(nodes.filter(s =>
      [s.name, s.code, s.current_employee_name, s.current_employee_id].some(v => (v ?? '').toLowerCase().includes(q))
    ).map(s => s.id));
  }, [nodes, search, filtering]);

  const visibleIds = useMemo(() => {
    if (!matchIds) return null;
    const v = new Set<string>();
    for (const id of matchIds) {
      let cur = byId.get(id);
      const path = new Set<string>();
      while (cur && !path.has(cur.id)) {
        path.add(cur.id);
        v.add(cur.id);
        cur = cur.reports_to_id ? byId.get(cur.reports_to_id) : undefined;
      }
    }
    return v;
  }, [matchIds, byId]);

  const effChildrenMap = useMemo(() => {
    if (!visibleIds) return childrenMap;
    const m = new Map<string, PcNode[]>();
    for (const [sup, kids] of childrenMap) {
      if (!visibleIds.has(sup)) continue;
      const f = kids.filter(c => visibleIds.has(c.id));
      if (f.length > 0) m.set(sup, f);
    }
    return m;
  }, [childrenMap, visibleIds]);

  const effRoots = useMemo(() => {
    if (!visibleIds) return roots;
    return findRoots(nodes.filter(s => visibleIds.has(s.id)), byId, childrenMap, visibleIds);
  }, [visibleIds, roots, nodes, byId, childrenMap]);

  const stats = [
    { label: 'Positions', value: nodes.length,  Icon: Briefcase },
    { label: 'Filled',    value: nodes.filter(n => n.current_employee_name).length, Icon: UserCheck },
    { label: 'Top Level', value: roots.length,  Icon: Network   },
  ];

  // Tree zoom-to-fit (mirrors StaffOrganogram)
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const treeRef   = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const clampZoom = (z: number) => Math.round(Math.max(0.3, Math.min(1.3, z)) * 100) / 100;

  const fitToWidth = useCallback(() => {
    const c = canvasRef.current, t = treeRef.current;
    if (!c || !t) return;
    const natural = t.scrollWidth / (zoomRef.current || 1);
    if (!natural) return;
    setZoom(clampZoom((c.clientWidth - 48) / natural));
  }, []);

  useEffect(() => {
    if (view !== 'tree' || loading) return;
    const id = setTimeout(fitToWidth, 80);
    return () => clearTimeout(id);
  }, [view, loading, search, nodes.length, fitToWidth]);

  return (
    <div className="flex-1 w-full relative h-full flex flex-col">
      <div className="w-full px-3 sm:px-6 md:px-8 py-6 sm:py-8 flex-1 flex flex-col max-w-full">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-4 sm:mb-7">
          <PageHeader title="PC Code Organogram" subtitle="Position hierarchy — who reports to whom by performance code, with the current holder of each seat." />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 drop-shadow-sm"
        >
          {/* Toolbar */}
          <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-[var(--border)] flex flex-col sm:flex-row gap-3 sm:gap-4 items-start sm:items-center justify-between">
            <div className="w-full sm:flex-1 sm:min-w-0 flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="search-wrap flex-1 sm:min-w-[240px]">
                <Search size={13} />
                <input type="text" placeholder="Search positions…" value={search} onChange={e => setSearch(e.target.value)} />
                {search && (
                  <button onClick={() => setSearch('')} className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>
                )}
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
                  <button onClick={() => setZoom(z => clampZoom(z - 0.1))} title="Zoom out" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-all"><ZoomOut size={13} /></button>
                  <button onClick={fitToWidth} title="Fit to screen" className="px-1.5 h-7 flex items-center gap-1 rounded-lg text-[11px] font-bold text-slate-600 hover:text-[var(--accent)] hover:bg-white transition-all tabular-nums"><Maximize2 size={11} /> {Math.round(zoom * 100)}%</button>
                  <button onClick={() => setZoom(z => clampZoom(z + 0.1))} title="Zoom in" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-all"><ZoomIn size={13} /></button>
                </div>
              )}

              <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
                <button onClick={() => setView('tree')} className={`px-2 sm:px-3 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-1.5 rounded-lg text-[11px] sm:text-[12px] font-bold transition-all whitespace-nowrap ${view === 'tree' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <Network size={12} /> <span className="hidden sm:inline">Tree</span>
                </button>
                <button onClick={() => setView('list')} className={`px-2 sm:px-3 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-1.5 rounded-lg text-[11px] sm:text-[12px] font-bold transition-all whitespace-nowrap ${view === 'list' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <AlignLeft size={12} /> <span className="hidden sm:inline">List</span>
                </button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className={`flex-1 overflow-auto min-h-[320px] sm:min-h-[480px] ${view === 'list' ? 'p-3 sm:p-5 bg-[var(--bg)]' : 'p-4 sm:p-8 bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:22px_22px]'}`}
          >
            {loading ? (
              <div className="w-full flex flex-col items-center justify-center py-12 sm:py-24 gap-3 text-[var(--text-muted)]">
                <Network size={32} className="opacity-20" /><p className="text-[13px] font-medium">Loading positions…</p>
              </div>
            ) : nodes.length === 0 ? (
              <div className="w-full flex flex-col items-center justify-center py-12 sm:py-24 gap-3 text-[var(--text-muted)]">
                <Network size={32} className="opacity-20" /><p className="text-[13px] font-medium">No PC codes yet.</p>
              </div>
            ) : filtering && matchIds && matchIds.size === 0 ? (
              <div className="w-full flex flex-col items-center justify-center py-12 sm:py-24 gap-3 text-[var(--text-muted)]">
                <Search size={32} className="opacity-20" /><p className="text-[13px] font-medium">No positions match your search.</p>
              </div>
            ) : view === 'tree' ? (
              <div ref={treeRef} key={`tree-${search}`} style={{ zoom }} className="flex flex-col items-center gap-6 sm:gap-10 pb-8 sm:pb-12 pt-2 w-max min-w-full mx-auto">
                {effRoots.map(n => (
                  <TreeNode key={n.id} node={n} childrenMap={effChildrenMap} seen={new Set()} highlight={matchIds} />
                ))}
              </div>
            ) : (
              <div key={`list-${search}`} className="max-w-2xl mx-auto w-full">
                {effRoots.map(n => (
                  <ListNode key={n.id} node={n} childrenMap={effChildrenMap} level={0} seen={new Set()} highlight={matchIds} />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
