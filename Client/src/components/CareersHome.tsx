import { useState, useEffect, useMemo } from 'react';
import { Search, MapPin, Clock, ChevronRight, X, Briefcase, Loader2, Building2 } from 'lucide-react';
import { publicApi, BRAND_BLUE as BLUE, resolveLogoUrl } from '@/lib/publicApi';

interface OrgSettings { company_name?: string; company_logo_url?: string; accent_color?: string }
interface Props { onSelectJob: (code: string) => void }

export function CareersHome({ onSelectJob }: Props) {
  const [jobs, setJobs]       = useState<any[]>([]);
  const [org, setOrg]         = useState<OrgSettings>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [dept, setDept]       = useState('');
  const [type, setType]       = useState('');

  useEffect(() => {
    Promise.all([
      publicApi.get('/public/jobs'),
      publicApi.get('/public/settings'),
    ]).then(([jRes, sRes]) => {
      setJobs(jRes.data.data ?? []);
      setOrg(sRes.data.data ?? {});
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const departments = useMemo(() =>
    [...new Set(jobs.map(j => j.department).filter(Boolean))].sort() as string[], [jobs]);

  const empTypes = useMemo(() =>
    [...new Set(jobs.map(j => j.employementType).filter(Boolean))].sort() as string[], [jobs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return jobs.filter(j => {
      if (q && !j.title?.toLowerCase().includes(q) && !j.department?.toLowerCase().includes(q) && !j.keywords?.toLowerCase().includes(q)) return false;
      if (dept && j.department !== dept) return false;
      if (type && j.employementType !== type) return false;
      return true;
    });
  }, [jobs, search, dept, type]);

  const groups = useMemo(() => {
    const map: Record<string, any[]> = {};
    filtered.forEach(j => {
      const d = j.department || 'General';
      if (!map[d]) map[d] = [];
      map[d].push(j);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const jobId    = (j: any) => j.code || String(j.id);
  const hasFilter = !!(search || dept || type);
  const logoUrl  = resolveLogoUrl(org.company_logo_url);
  const brand    = org.accent_color || BLUE;
  const orgName  = org.company_name || '';

  return (
    <div className="min-h-screen bg-[#f4f6f9]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Hero ── */}
      <div style={{ background: brand, position: 'relative', overflow: 'hidden' }}>
        {/* Subtle noise overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.07) 0%, transparent 60%), radial-gradient(circle at 20% 80%, rgba(0,0,0,0.12) 0%, transparent 60%)',
          pointerEvents: 'none',
        }} />

        {/* Nav */}
        <div className="relative max-w-5xl mx-auto px-6 pt-5 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={orgName} className="h-8 w-auto object-contain brightness-0 invert" />
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-sm backdrop-blur-sm">
                  {(orgName || 'C').charAt(0)}
                </div>
                {orgName && <span className="text-white font-semibold text-[15px] opacity-90">{orgName}</span>}
              </div>
            )}
          </div>
          {!loading && (
            <span className="text-white/60 text-[12px] font-medium tabular-nums">
              {jobs.length} open position{jobs.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Hero text */}
        <div className="relative max-w-5xl mx-auto px-6 pt-14 pb-20">
          <p className="text-white/50 text-[11px] font-bold uppercase tracking-[0.18em] mb-3">Careers</p>
          <h1 className="text-white text-[38px] sm:text-[50px] font-extrabold leading-[1.1] tracking-tight mb-4 max-w-lg">
            {orgName ? `Grow with ${orgName}` : 'Join Our Team'}
          </h1>
          <p className="text-white/65 text-[15px] leading-relaxed max-w-md">
            Explore open roles across every team. Find where you fit and build something meaningful.
          </p>

          {/* Search bar */}
          <div className="relative mt-10 max-w-lg">
            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by title, skill, or keyword…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-11 pr-10 py-3.5 rounded-xl bg-white text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none shadow-lg shadow-black/20"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {!loading && jobs.length > 0 && (
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6 text-[12px] text-slate-500 flex-wrap">
            <span className="flex items-center gap-1.5">
              <Briefcase size={12} className="text-slate-400" />
              <strong className="text-slate-700 font-semibold">{jobs.length}</strong> open position{jobs.length !== 1 ? 's' : ''}
            </span>
            {departments.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Building2 size={12} className="text-slate-400" />
                <strong className="text-slate-700 font-semibold">{departments.length}</strong> department{departments.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-12 flex items-center gap-3 overflow-x-auto scrollbar-none">
          {departments.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Dept</span>
              {departments.map(d => (
                <button
                  key={d}
                  onClick={() => setDept(dept === d ? '' : d)}
                  className={[
                    'px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition-all whitespace-nowrap',
                    dept === d
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-800',
                  ].join(' ')}
                  style={dept === d ? { background: brand, borderColor: brand } : {}}
                >
                  {d}
                </button>
              ))}
            </div>
          )}

          {departments.length > 0 && empTypes.length > 0 && (
            <span className="w-px h-4 bg-slate-200 shrink-0" />
          )}

          {empTypes.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Type</span>
              {empTypes.map(t => (
                <button
                  key={t}
                  onClick={() => setType(type === t ? '' : t)}
                  className={[
                    'px-2.5 py-1 rounded-md text-[11.5px] font-semibold border transition-all whitespace-nowrap',
                    type === t
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-800',
                  ].join(' ')}
                  style={type === t ? { background: brand, borderColor: brand } : {}}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {hasFilter && (
            <>
              <span className="w-px h-4 bg-slate-200 shrink-0 ml-auto" />
              <button
                onClick={() => { setSearch(''); setDept(''); setType(''); }}
                className="flex items-center gap-1 text-[11.5px] text-slate-500 hover:text-slate-800 transition-colors shrink-0 font-medium"
              >
                <X size={11} /> Clear
              </button>
            </>
          )}

          {!departments.length && !empTypes.length && (
            <span className="text-[13px] text-slate-400">
              {loading ? 'Loading…' : filtered.length === 0 ? 'No positions found' : `${filtered.length} position${filtered.length !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </div>

      {/* ── Job listing ── */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-3 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <p className="text-[13px]">Loading positions…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-32">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Briefcase size={28} className="text-slate-300" />
            </div>
            <p className="text-[16px] font-bold text-slate-700">
              {hasFilter ? 'No positions match your filters' : 'No open positions at the moment'}
            </p>
            <p className="text-[13px] text-slate-400 mt-1.5">
              {hasFilter ? 'Try adjusting your filters.' : 'Check back soon — new roles are added regularly.'}
            </p>
            {hasFilter && (
              <button
                onClick={() => { setSearch(''); setDept(''); setType(''); }}
                className="mt-4 text-[13px] font-semibold underline underline-offset-2"
                style={{ color: brand }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(([deptName, deptJobs]) => (
              <div key={deptName}>
                {/* Dept heading */}
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{deptName}</h2>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: brand }}
                  >
                    {deptJobs.length}
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {/* Job cards */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100 shadow-sm">
                  {deptJobs.map(job => (
                    <button
                      key={job.id}
                      onClick={() => onSelectJob(jobId(job))}
                      className="group w-full text-left px-5 py-4 hover:bg-slate-50 transition-colors flex items-center gap-4"
                    >
                      {/* Icon / avatar */}
                      {job.attachment ? (
                        <img
                          src={`/v1/api/hr/documents/${job.attachment}`}
                          alt=""
                          className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-200"
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-[14px] font-bold"
                          style={{ background: `${brand}15`, color: brand }}
                        >
                          {job.title?.charAt(0)?.toUpperCase()}
                        </div>
                      )}

                      {/* Job info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[13.5px] text-slate-900 group-hover:text-blue-700 transition-colors truncate leading-snug">
                          {job.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                          {(job.location || job.country) && (
                            <span className="flex items-center gap-1 text-[11.5px] text-slate-500">
                              <MapPin size={9} className="text-slate-400 shrink-0" />
                              {[job.location, job.country].filter(Boolean).join(', ')}
                            </span>
                          )}
                          {job.employementType && (
                            <span className="flex items-center gap-1 text-[11.5px] text-slate-500">
                              <Clock size={9} className="text-slate-400 shrink-0" />
                              {job.employementType}
                            </span>
                          )}
                          {job.experienceLevel && (
                            <span className="text-[11.5px] text-slate-500">{job.experienceLevel}</span>
                          )}
                          {job.showSalary === 'Yes' && (job.salaryMin || job.salaryMax) && (
                            <span className="text-[11.5px] font-semibold" style={{ color: brand }}>
                              {job.currency ? `${job.currency} ` : ''}
                              {job.salaryMin ? Number(job.salaryMin).toLocaleString() : ''}
                              {job.salaryMin && job.salaryMax ? '–' : ''}
                              {job.salaryMax ? Number(job.salaryMax).toLocaleString() : ''}
                            </span>
                          )}
                          {job.closingDate && (
                            <span className="text-[11px] text-slate-400">
                              Closes {new Date(job.closingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div
                        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                        style={{ background: `${brand}12` }}
                      >
                        <ChevronRight size={14} style={{ color: brand }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Result count */}
            {hasFilter && (
              <p className="text-center text-[12px] text-slate-400 pt-2">
                Showing {filtered.length} of {jobs.length} position{jobs.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 mt-20 py-8 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {logoUrl
              ? <img src={logoUrl} alt={orgName} className="h-5 w-auto opacity-40" />
              : orgName && <span className="text-[12px] font-semibold text-slate-400">{orgName}</span>
            }
          </div>
          <p className="text-[11px] text-slate-400">
            {orgName ? `© ${new Date().getFullYear()} ${orgName}. All rights reserved.` : ''}
          </p>
        </div>
      </footer>
    </div>
  );
}
