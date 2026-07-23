import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Building2, Layers, Briefcase, Users, UserCircle,
  ChevronDown, ChevronRight, Network, AlignLeft, Workflow,
  ZoomIn, ZoomOut, Maximize2,
} from 'lucide-react';

// ─── Type config ──────────────────────────────────────────────────────────────

type TypeCfg = { label: string; accent: string; bg: string; border: string; text: string; Icon: React.ElementType };

const TYPE_MAP: Record<string, TypeCfg> = {
  company:    { label: 'Company',    accent: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd', text: '#5b21b6', Icon: Building2 },
  branch:     { label: 'Branch',     accent: '#0066b3', bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8', Icon: Layers    },
  department: { label: 'Department', accent: '#d97706', bg: '#fffbeb', border: '#fcd34d', text: '#92400e', Icon: Briefcase },
  unit:       { label: 'Unit',       accent: '#059669', bg: '#f0fdf4', border: '#6ee7b7', text: '#065f46', Icon: Users     },
  team:       { label: 'Team',       accent: '#059669', bg: '#f0fdf4', border: '#6ee7b7', text: '#065f46', Icon: Users     },
};

function cfg(type: string): TypeCfg {
  return TYPE_MAP[type?.toLowerCase()] ?? {
    label: type || 'Node', accent: '#64748b', bg: '#f8fafc', border: '#cbd5e1', text: '#334155', Icon: UserCircle,
  };
}

// ─── Node card (tree view) ────────────────────────────────────────────────────

function NodeCard({ node, onToggle, expanded, hasChildren, childCount }: {
  node: any; onToggle: () => void; expanded: boolean; hasChildren: boolean; childCount: number;
}) {
  const c = cfg(node.type);
  const { Icon } = c;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="relative bg-white rounded-[14px] border border-slate-200 shadow-sm hover:shadow-md transition-shadow w-[210px] overflow-hidden select-none"
    >
      {/* Left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-[3.5px] rounded-l-[14px]" style={{ background: c.accent }} />

      <div className="pl-4 pr-3 pt-3 pb-3">
        {/* Icon + code row */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: c.bg, border: `1px solid ${c.border}` }}
            >
              <Icon size={13} style={{ color: c.accent }} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: c.text }}>
              {c.label}
            </span>
          </div>
          {node.comp_code && (
            <span className="text-[9px] font-mono font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-md">
              {node.comp_code}
            </span>
          )}
        </div>

        {/* Name */}
        <p className="text-[13px] font-bold text-slate-800 leading-snug mb-2 pr-1">{node.name}</p>

        {/* Manager */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <UserCircle size={11} className="shrink-0" />
          <span className="truncate">{node.manager || 'No manager assigned'}</span>
        </div>

        {/* Expand / collapse */}
        {hasChildren && (
          <button
            onClick={onToggle}
            className="mt-2.5 w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
            style={{
              background: expanded ? c.bg : '#f8fafc',
              color:      expanded ? c.accent : '#94a3b8',
              border:     `1px solid ${expanded ? c.border : '#e2e8f0'}`,
            }}
          >
            <span>{childCount} {childCount === 1 ? 'child' : 'children'}</span>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Tree node ────────────────────────────────────────────────────────────────

const LINE = '#cbd5e1';

const TreeNode: React.FC<{ node: any; allData: any[]; level: number }> = ({ node, allData, level }) => {
  const [expanded, setExpanded] = useState(level < 2);
  const children = allData.filter((d: any) => d.parent === node.name);
  const hasChildren = children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        onToggle={() => setExpanded(v => !v)}
        expanded={expanded}
        hasChildren={hasChildren}
        childCount={children.length}
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
            {/* Vertical stem down from parent */}
            <div className="w-px h-6 shrink-0" style={{ background: LINE }} />

            {/* Children row */}
            <div className="flex justify-center">
              {children.map((child: any, i: number) => {
                const isFirst = i === 0;
                const isLast  = i === children.length - 1;
                const isOnly  = children.length === 1;

                return (
                  <div key={child.id} className="relative flex flex-col items-center pt-6 px-4">
                    {/* Horizontal connector bar */}
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
                    {/* Vertical drop to child */}
                    <div
                      className="absolute top-0 w-px h-6 left-1/2 -translate-x-1/2"
                      style={{ background: LINE }}
                    />
                    <TreeNode node={child} allData={allData} level={level + 1} />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── List node ────────────────────────────────────────────────────────────────

const ListNode: React.FC<{ node: any; allData: any[]; level: number }> = ({ node, allData, level }) => {
  const [expanded, setExpanded] = useState(level < 1);
  const children = allData.filter((d: any) => d.parent === node.name);
  const hasChildren = children.length > 0;
  const c = cfg(node.type);
  const { Icon } = c;
  const indent = level * 22;

  return (
    <div>
      <div
        className="flex items-center gap-2.5 py-2.5 pr-4 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
        style={{ paddingLeft: `${12 + indent}px` }}
        onClick={() => hasChildren && setExpanded(v => !v)}
      >
        {/* Expand chevron */}
        <div
          className={`w-4 h-4 shrink-0 flex items-center justify-center rounded transition-colors ${
            hasChildren ? 'text-slate-400 hover:text-slate-700' : 'opacity-0 pointer-events-none'
          }`}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </div>

        {/* Type icon */}
        <div
          className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center"
          style={{ background: c.bg, border: `1px solid ${c.border}` }}
        >
          <Icon size={12} style={{ color: c.accent }} />
        </div>

        {/* Name + code */}
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-slate-800 leading-none">{node.name}</span>
          {node.comp_code && (
            <span className="text-[9px] font-mono text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
              {node.comp_code}
            </span>
          )}
        </div>

        {/* Type badge */}
        <span
          className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md"
          style={{ color: c.text, background: c.bg, border: `1px solid ${c.border}` }}
        >
          {c.label}
        </span>

        {/* Manager */}
        {node.manager && (
          <span className="shrink-0 hidden sm:flex items-center gap-1 text-[11px] text-slate-400">
            <UserCircle size={10} /> {node.manager}
          </span>
        )}

        {/* Children badge */}
        {hasChildren && (
          <span
            className="shrink-0 text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full"
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
            {/* Colored left border at each level */}
            <div
              className="ml-[27px] pl-0"
              style={{ borderLeft: `2px solid ${c.border}`, marginLeft: `${12 + indent + 12}px` }}
            >
              {children.map((child: any) => (
                <ListNode key={child.id} node={child} allData={allData} level={level + 1} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Pipeline node (left-to-right horizontal tree) ────────────────────────────

const PipelineNode: React.FC<{ node: any; allData: any[]; level: number }> = ({ node, allData, level }) => {
  const [expanded, setExpanded] = useState(level < 2);
  const children = allData.filter((d: any) => d.parent === node.name);
  const hasChildren = children.length > 0;
  const c = cfg(node.type);
  const { Icon } = c;

  return (
    <div className="flex items-center">
      {/* Node card — compact horizontal variant */}
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18 }}
        className="relative bg-white rounded-[12px] border border-slate-200 shadow-sm hover:shadow-md transition-shadow min-w-[180px] max-w-[200px] overflow-hidden shrink-0"
      >
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-[12px]" style={{ background: c.accent }} />
        <div className="px-3 pt-4 pb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center"
              style={{ background: c.bg, border: `1px solid ${c.border}` }}
            >
              <Icon size={12} style={{ color: c.accent }} />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: c.text }}>
              {c.label}
            </span>
            {node.comp_code && (
              <span className="ml-auto text-[8px] font-mono text-slate-400 bg-slate-50 border border-slate-200 px-1 py-0.5 rounded shrink-0">
                {node.comp_code}
              </span>
            )}
          </div>
          <p className="text-[12px] font-bold text-slate-800 leading-snug mb-1.5">{node.name}</p>
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <UserCircle size={10} className="shrink-0" />
            <span className="truncate">{node.manager || 'No manager'}</span>
          </div>
          {hasChildren && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="mt-2 w-full flex items-center justify-between px-2 py-1 rounded-md text-[10px] font-semibold transition-all"
              style={{
                background: expanded ? c.bg : '#f8fafc',
                color:      expanded ? c.accent : '#94a3b8',
                border:     `1px solid ${expanded ? c.border : '#e2e8f0'}`,
              }}
            >
              <span>{children.length} {children.length === 1 ? 'child' : 'children'}</span>
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
        </div>
      </motion.div>

      {/* Children branch */}
      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            key="branch"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center overflow-visible"
          >
            {/* Horizontal stem to children */}
            <div className="w-8 h-px shrink-0" style={{ background: LINE }} />

            {/* Children stack */}
            <div className="flex flex-col gap-4 py-2">
              {children.map((child: any, i: number) => {
                const isFirst = i === 0;
                const isLast  = i === children.length - 1;
                const isOnly  = children.length === 1;

                return (
                  <div key={child.id} className="relative flex items-center pl-8">
                    {/* Vertical spine connecting siblings */}
                    {!isOnly && (
                      <div
                        className="absolute left-0 w-px"
                        style={{
                          background: LINE,
                          top:    isFirst ? '50%' : 0,
                          bottom: isLast  ? '50%' : 0,
                        }}
                      />
                    )}
                    {/* Horizontal branch to this child */}
                    <div
                      className="absolute left-0 top-1/2 h-px w-8 -translate-y-1/2"
                      style={{ background: LINE }}
                    />
                    <PipelineNode node={child} allData={allData} level={level + 1} />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  const items = [
    { key: 'branch',     ...TYPE_MAP.branch     },
    { key: 'department', ...TYPE_MAP.department },
    { key: 'unit',       ...TYPE_MAP.unit       },
  ];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {items.map(({ key, label, accent, bg, border }) => (
        <div key={key} className="flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: accent }}>
          <div className="w-2.5 h-2.5 rounded-sm border" style={{ background: bg, borderColor: accent }} />
          {label}
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Organogram({ data }: { data: any[] }) {
  const [view, setView] = useState<'tree' | 'list' | 'pipeline'>('tree');

  const roots = data.filter(d => d.parent === 'None' || !data.find(p => p.name === d.parent));

  // Zoom-to-fit: a wide chart would otherwise overflow horizontally. We scale the tree/pipeline
  // down with CSS `zoom` so the whole structure fits the container width.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const clampZoom = (z: number) => Math.round(Math.max(0.3, Math.min(1.3, z)) * 100) / 100;

  const fitToWidth = useCallback(() => {
    const c = canvasRef.current, t = contentRef.current;
    if (!c || !t) return;
    const natural = t.scrollWidth / (zoomRef.current || 1); // scrollWidth scales with zoom
    if (!natural) return;
    const avail = c.clientWidth - 48; // breathing room for padding
    setZoom(clampZoom(avail / natural));
  }, []);

  // Auto-fit whenever the data, view, or container size changes.
  useEffect(() => {
    if (view === 'list') return;
    const id = setTimeout(fitToWidth, 80);
    const onResize = () => fitToWidth();
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(id); window.removeEventListener('resize', onResize); };
  }, [view, data.length, fitToWidth]);

  const count = (types: string[]) =>
    data.filter(d => types.includes(d.type?.toLowerCase())).length;

  const stats = [
    { label: 'Branches',    value: count(['branch']),           color: TYPE_MAP.branch.accent     },
    { label: 'Departments', value: count(['department']),       color: TYPE_MAP.department.accent },
    { label: 'Units',       value: count(['unit', 'team']),     color: TYPE_MAP.unit.accent       },
  ];

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col min-h-[500px]">
      {/* Toolbar */}
      <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <h3 className="syne font-bold text-[var(--text-primary)] text-[15px]">Organization Chart</h3>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">Visual hierarchy — Branch → Department → Unit</p>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-5">
            {stats.map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className="text-[20px] font-extrabold syne leading-none" style={{ color }}>{value}</p>
                <p className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wide mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Legend />
          {view !== 'list' && (
            <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0">
              <button onClick={() => setZoom(z => clampZoom(z - 0.1))} title="Zoom out" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-all"><ZoomOut size={13} /></button>
              <button onClick={fitToWidth} title="Fit to screen" className="px-1.5 h-7 flex items-center gap-1 rounded-lg text-[11px] font-bold text-slate-600 hover:text-[var(--accent)] hover:bg-white transition-all tabular-nums"><Maximize2 size={11} /> {Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom(z => clampZoom(z + 0.1))} title="Zoom in" className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white transition-all"><ZoomIn size={13} /></button>
            </div>
          )}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setView('tree')}
              className={`px-3 py-1.5 flex items-center gap-1.5 rounded-lg text-[12px] font-bold transition-all ${
                view === 'tree' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Network size={13} /> Tree
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-1.5 flex items-center gap-1.5 rounded-lg text-[12px] font-bold transition-all ${
                view === 'list' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <AlignLeft size={13} /> List
            </button>
            <button
              onClick={() => setView('pipeline')}
              className={`px-3 py-1.5 flex items-center gap-1.5 rounded-lg text-[12px] font-bold transition-all ${
                view === 'pipeline' ? 'bg-white text-[var(--accent)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Workflow size={13} /> Pipeline
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`flex-1 overflow-auto ${
          view === 'list'
            ? 'p-5 bg-[var(--bg)]'
            : 'p-8 flex justify-start items-start bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:22px_22px]'
        }`}
      >
        {roots.length === 0 ? (
          <div className="w-full flex flex-col items-center justify-center py-24 gap-3 text-[var(--text-muted)]">
            <Network size={36} className="opacity-20" />
            <p className="text-[13px] font-medium">No company structures found.</p>
          </div>
        ) : view === 'tree' ? (
          <div ref={contentRef} style={{ zoom }} className="inline-flex flex-col items-center gap-0 pb-12 pt-2 min-w-max mx-auto">
            {roots.map(node => (
              <TreeNode key={node.id} node={node} allData={data} level={0} />
            ))}
          </div>
        ) : view === 'pipeline' ? (
          <div ref={contentRef} style={{ zoom }} className="inline-flex flex-col gap-6 pb-12 pt-2 min-w-max">
            {roots.map(node => (
              <PipelineNode key={node.id} node={node} allData={data} level={0} />
            ))}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full">
            {roots.map(node => (
              <ListNode key={node.id} node={node} allData={data} level={0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
