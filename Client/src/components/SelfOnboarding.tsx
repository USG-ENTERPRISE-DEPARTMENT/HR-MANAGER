import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'sonner';
import {
  Copy, RefreshCw, Printer, Download, Loader2, Eye, UserPlus, Trash2, Link as LinkIcon,
} from 'lucide-react';
import api from '@/lib/api';
import { RowActions } from './ui/RowActions';
import { useCan } from '@/hooks/useCan';
import { PageHeader } from './ui/PageHeader';
import { TabBar } from './ui/TabBar';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { DetailSlideOver, DetailGrid, DetailField, DetailSection } from './ui/DetailSlideOver';
import { EmployeeFormFull } from './EmployeeFormFull';
import {
  ONBOARDING_FIELDS, ONBOARDING_GROUPS, ONBOARDING_FIELD_MAP, ALWAYS_ON_KEYS,
} from '@/lib/onboardingFields';
import { employeeFieldVisible } from '@/lib/settings';

const TABS = ['Form Builder', 'Share Link', 'Submissions'];
const DOC_BASE = '/v1/api/hr/documents';

interface Submission {
  id: string;
  status: string;
  employee_id: string | null;
  created: string;
  updated: string;
  data: Record<string, string>;
  files: Record<string, string>;
}

export function SelfOnboarding() {
  const { can } = useCan();
  const readOnly = !can('manage_onboarding');

  const [tab, setTab] = useState(TABS[0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabledFields, setEnabledFields] = useState<string[]>([...ALWAYS_ON_KEYS]);
  const [requiredFields, setRequiredFields] = useState<string[]>([...ALWAYS_ON_KEYS]);
  const [token, setToken] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [serverIp, setServerIp] = useState('');

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [detail, setDetail] = useState<Submission | null>(null);
  const [convertTarget, setConvertTarget] = useState<Submission | null>(null);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const qrWrapRef = useRef<HTMLDivElement>(null);

  const shareUrl = useMemo(() => {
    if (!token) return '';
    const { protocol, hostname, port, origin } = window.location;
    // Swap localhost for the machine's LAN IP so the QR/link works from a phone.
    const isLocal = ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(hostname);
    const host = isLocal && serverIp ? serverIp : hostname;
    const base = isLocal && serverIp
      ? `${protocol}//${host}${port ? `:${port}` : ''}`
      : origin;
    // Public portal lives at the root path (not under the app's /xhrm base), so new hires get a
    // clean link that works without authentication.
    return `${base}/onboarding/${token}`;
  }, [token, serverIp]);

  // ── Load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [cfg, subs] = await Promise.all([
          api.get('/onboarding/config'),
          api.get('/onboarding/submissions'),
        ]);
        const c = cfg.data?.data ?? {};
        setEnabledFields(mergeAlwaysOn(c.config?.enabledFields ?? ALWAYS_ON_KEYS));
        setRequiredFields(mergeAlwaysOn(c.config?.requiredFields ?? ALWAYS_ON_KEYS));
        setToken(c.token ?? '');
        setFormEnabled(c.enabled !== false);
        setServerIp(c.serverIp ?? '');
        setSubmissions(subs.data?.data ?? []);
      } catch {
        toast.error('Failed to load onboarding settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadSubmissions = async () => {
    try {
      const r = await api.get('/onboarding/submissions');
      setSubmissions(r.data?.data ?? []);
    } catch { /* keep current */ }
  };

  // ── Form builder helpers ─────────────────────────────────────────────────────
  const isAlwaysOn = (key: string) => ALWAYS_ON_KEYS.includes(key);

  const toggleEnabled = (key: string) => {
    if (isAlwaysOn(key) || readOnly) return;
    setEnabledFields(prev => {
      if (prev.includes(key)) {
        setRequiredFields(r => r.filter(k => k !== key)); // disabling clears required
        return prev.filter(k => k !== key);
      }
      return [...prev, key];
    });
  };

  const toggleRequired = (key: string) => {
    if (isAlwaysOn(key) || readOnly || !enabledFields.includes(key)) return;
    setRequiredFields(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.put('/onboarding/config', {
        enabledFields: mergeAlwaysOn(enabledFields),
        requiredFields: mergeAlwaysOn(requiredFields),
      });
      toast.success('Form saved');
    } catch {
      toast.error('Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  const toggleFormEnabled = async () => {
    const next = !formEnabled;
    setFormEnabled(next);
    try {
      await api.put('/onboarding/config', { enabled: next });
      toast.success(next ? 'Public form enabled' : 'Public form disabled');
    } catch {
      setFormEnabled(!next);
      toast.error('Failed to update');
    }
  };

  const regenerate = async () => {
    try {
      const r = await api.post('/onboarding/token/regenerate', {});
      setToken(r.data?.data?.token ?? '');
      toast.success('Link regenerated — the old link no longer works');
    } catch {
      toast.error('Failed to regenerate link');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy'),
    );
  };

  const getCanvas = () => qrWrapRef.current?.querySelector('canvas') as HTMLCanvasElement | null;

  const downloadQr = () => {
    const canvas = getCanvas();
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'onboarding-qr.png';
    a.click();
  };

  const printQr = () => {
    const canvas = getCanvas();
    if (!canvas) return;
    const img = canvas.toDataURL('image/png');
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`
      <html><head><title>Onboarding QR</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:40px}
      h1{font-size:18px;margin:0 0 4px}p{color:#475569;font-size:13px;word-break:break-all;margin:8px auto;max-width:340px}
      img{margin-top:24px}</style></head>
      <body><h1>Scan to start onboarding</h1><p>${shareUrl}</p>
      <img src="${img}" width="280" height="280"/>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`);
    w.document.close();
  };

  // ── Convert flow ─────────────────────────────────────────────────────────────
  const convertInitialData = useMemo(() => {
    if (!convertTarget) return null;
    const out: any = {};
    for (const [key, value] of Object.entries(convertTarget.data)) {
      const field = ONBOARDING_FIELD_MAP[key];
      if (!field || value === '' || value == null) continue;
      if (field.wrap) out[field.wrap] = { id: value };
      else out[key] = value;
    }
    return out;
  }, [convertTarget]);

  const handleConvertSave = async (data: any) => {
    try {
      const res = await api.post('/employees', data);
      const newId = res.data?.data?.id;
      if (convertTarget) {
        await api.post(`/onboarding/submissions/${convertTarget.id}/convert`, { employee_id: newId ?? null });
      }
      toast.success('Employee created from submission');
      setConvertTarget(null);
      loadSubmissions();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to create employee');
    }
  };

  const discard = async (sub: Submission) => {
    try {
      await api.delete(`/onboarding/submissions/${sub.id}`);
      toast.success('Submission removed');
      setDetail(null);
      loadSubmissions();
    } catch {
      toast.error('Failed to remove submission');
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────────────
  const subName = (s: Submission) =>
    [s.data.firstName, s.data.lastName].filter(Boolean).join(' ') || '—';

  const statusPill = (status: string) => {
    const cls = status === 'Converted' ? 'pill-success'
      : status === 'New' ? 'pill-accent' : '';
    return <span className={`pill ${cls} text-[11px]`}>{status}</span>;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return submissions;
    return submissions.filter(s =>
      subName(s).toLowerCase().includes(q) ||
      (s.data.work_email ?? '').toLowerCase().includes(q),
    );
  }, [submissions, search]);

  const paginate = (arr: Submission[]) => arr.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Self-Onboarding"
        subtitle="Configure and share a public form for new hires to submit their details."
      />
      <TabBar tabs={TABS} activeTab={tab} onChange={setTab} />

      {/* ── Form Builder ── */}
      {tab === 'Form Builder' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-[var(--text-muted)]">
              Check the fields applicants should fill, and mark which are required.
              <span className="text-[var(--text-primary)] font-semibold"> Name and email</span> are always included.
            </p>
            {!readOnly && (
              <button onClick={saveConfig} disabled={saving} className="primary-btn shrink-0">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save Form'}
              </button>
            )}
          </div>
          <div className="p-4 sm:p-5 space-y-6">
            {ONBOARDING_GROUPS.map(group => {
              // Only offer fields that are visible in Settings → Controls → Employee Form —
              // that config is the master gate for what self-onboarding can collect.
              const fields = ONBOARDING_FIELDS.filter(f => f.group === group && employeeFieldVisible(f.key));
              if (!fields.length) return null;
              return (
                <div key={group}>
                  <h4 className="syne text-[11px] font-extrabold uppercase tracking-wider text-[var(--accent)] mb-3">{group}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {fields.map(f => {
                      const on = enabledFields.includes(f.key);
                      const req = requiredFields.includes(f.key);
                      const locked = isAlwaysOn(f.key);
                      return (
                        <div key={f.key}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${on ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5' : 'border-[var(--border)] bg-[var(--bg)]'}`}>
                          <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
                            <input type="checkbox" checked={on} disabled={locked || readOnly}
                              onChange={() => toggleEnabled(f.key)}
                              className="accent-[var(--accent)] w-4 h-4 shrink-0" />
                            <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{f.label}</span>
                            {f.type === 'file' && <span className="pill text-[9px]">file</span>}
                          </label>
                          <label className={`flex items-center gap-1.5 text-[11px] shrink-0 ${on && !locked ? 'cursor-pointer text-[var(--text-muted)]' : 'text-[var(--text-muted)]/50'}`}>
                            <input type="checkbox" checked={req} disabled={locked || readOnly || !on}
                              onChange={() => toggleRequired(f.key)}
                              className="accent-[var(--accent)] w-3.5 h-3.5" />
                            Required
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Share Link ── */}
      {tab === 'Share Link' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 flex flex-col items-center text-center">
            <div ref={qrWrapRef} className="bg-white p-4 rounded-2xl border border-[var(--border)]">
              {shareUrl
                ? <QRCodeCanvas value={shareUrl} size={208} level="M" includeMargin />
                : <div className="w-52 h-52 grid place-items-center text-[var(--text-muted)] text-xs">No link</div>}
            </div>
            <div className="flex items-center gap-2 mt-5">
              <button onClick={printQr} disabled={!shareUrl} className="secondary-btn"><Printer size={14} /> Print</button>
              <button onClick={downloadQr} disabled={!shareUrl} className="secondary-btn"><Download size={14} /> Download</button>
            </div>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 sm:p-6 space-y-5">
            <div>
              <label className="label flex items-center gap-1.5"><LinkIcon size={13} /> Shareable Link</label>
              <div className="flex items-center gap-2 mt-1.5">
                <input readOnly value={shareUrl} className="flex-1 min-w-0 text-[12.5px] h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)]" />
                <button onClick={copyLink} disabled={!shareUrl} className="secondary-btn shrink-0"><Copy size={14} /> Copy</button>
              </div>
              <p className="text-[11.5px] text-[var(--text-muted)] mt-2">Anyone with this link (or the QR code) can open the form — no login needed.</p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3">
              <div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">Public form {formEnabled ? 'enabled' : 'disabled'}</div>
                <div className="text-[11.5px] text-[var(--text-muted)]">When disabled, the link shows an "unavailable" message.</div>
              </div>
              <button onClick={toggleFormEnabled} disabled={readOnly}
                className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${formEnabled ? 'bg-emerald-500' : 'bg-slate-300'} ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${formEnabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            {!readOnly && (
              <button onClick={regenerate} className="secondary-btn w-full justify-center"><RefreshCw size={14} /> Regenerate Link</button>
            )}
          </div>
        </div>
      )}

      {/* ── Submissions ── */}
      {tab === 'Submissions' && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden flex flex-col">
          <TableToolbar
            searchQuery={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search submissions..."
            actions={
              <button className="secondary-btn" onClick={loadSubmissions} title="Refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            }
          />
          <div className="overflow-x-auto flex-1 min-h-0">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="th w-10"><span className="sr-only">Avatar</span></th>
                  <th className="th">Name</th>
                  <th className="th">Email</th>
                  <th className="th">Phone</th>
                  <th className="th">Submitted</th>
                  <th className="th">Status</th>
                  <th className="th text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="td text-center py-12 text-[var(--text-muted)]">
                    {search ? 'No submissions match your search.' : 'No submissions yet.'}
                  </td></tr>
                ) : paginate(filtered).map((sub, i) => (
                  <motion.tr key={sub.id} className="tr"
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <td className="td">
                      <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center shrink-0">
                        <span className="font-bold text-[13px] text-[var(--accent)]">
                          {(sub.data.firstName ?? '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    </td>
                    <td className="td font-medium text-[var(--text-primary)]">{subName(sub)}</td>
                    <td className="td text-[var(--text-muted)]">{sub.data.work_email ?? '—'}</td>
                    <td className="td text-[var(--text-muted)]">{sub.data.mobilePhone ?? '—'}</td>
                    <td className="td text-[var(--text-muted)]">{new Date(sub.created).toLocaleDateString()}</td>
                    <td className="td">{statusPill(sub.status)}</td>
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'View', icon: Eye, onClick: () => setDetail(sub) },
                          { label: 'Convert to Employee', icon: UserPlus, onClick: () => setConvertTarget(sub), hidden: !(can('manage_onboarding') && sub.status !== 'Converted') },
                          { label: 'Discard', icon: Trash2, danger: true, onClick: () => discard(sub), hidden: !(can('manage_onboarding') && sub.status !== 'Converted') },
                        ]} />
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={page} pageSize={pageSize}
            total={submissions.length} filtered={filtered.length}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* ── Submission detail slide-over ── */}
      <DetailSlideOver
        open={!!detail}
        title={detail ? subName(detail) : ''}
        subtitle={detail ? `Submitted ${new Date(detail.created).toLocaleString()}` : ''}
        onClose={() => setDetail(null)}
        maxWidth="lg"
        footerActions={detail && can('manage_onboarding') && detail.status !== 'Converted' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { setConvertTarget(detail); setDetail(null); }} className="primary-btn"><UserPlus size={14} /> Convert to Employee</button>
            <button onClick={() => discard(detail)} className="secondary-btn"><Trash2 size={14} /> Discard</button>
          </div>
        ) : undefined}
      >
        {detail && (
          <div className="space-y-5">
            <DetailSection title="Submitted Details">
              <DetailGrid>
                {Object.entries(detail.data).map(([key, value]) => (
                  <DetailField key={key} label={ONBOARDING_FIELD_MAP[key]?.label ?? key} value={value} />
                ))}
              </DetailGrid>
            </DetailSection>
            {Object.keys(detail.files).length > 0 && (
              <DetailSection title="Uploaded Files">
                <DetailGrid cols={1}>
                  {Object.entries(detail.files).map(([key, filename]) => (
                    <DetailField key={key} label={ONBOARDING_FIELD_MAP[key]?.label ?? key}
                      value={<a href={`${DOC_BASE}/${filename}`} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">View file</a>} />
                  ))}
                </DetailGrid>
              </DetailSection>
            )}
          </div>
        )}
      </DetailSlideOver>

      {/* ── Convert → prefilled employee form ── */}
      {convertTarget && (
        <EmployeeFormFull
          initialData={convertInitialData}
          onClose={() => setConvertTarget(null)}
          onSave={handleConvertSave}
        />
      )}
    </div>
  );
}

function mergeAlwaysOn(keys: string[]): string[] {
  return Array.from(new Set([...ALWAYS_ON_KEYS, ...keys]));
}
