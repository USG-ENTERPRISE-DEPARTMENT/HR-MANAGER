import { useState, useEffect } from 'react';
import type { ReactElement } from 'react';
import {
  ArrowLeft, MapPin, Clock, Briefcase, GraduationCap, Calendar,
  Link2, Loader2, Send, CheckCircle2, DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { CountedTextarea } from './ui/CountedTextarea';
import { publicApi, BRAND_BLUE as BLUE, resolveLogoUrl } from '@/lib/publicApi';

// Social icons (lucide dropped these)
const IconFacebook = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);
const IconTwitter = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M2 3h6.5l13 18H15L2 3z" />
    <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    <path d="M20 4 4 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);
const IconLinkedIn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V9h4v1.5A4 4 0 0 1 16 8z" />
    <rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" />
  </svg>
);

interface OrgSettings { company_name?: string; company_logo_url?: string; accent_color?: string }
interface Props { code: string; onBack: () => void }

function RichText({ html }: { html: string }) {
  const lines = html.split('\n');
  const blocks: ReactElement[] = [];
  let bullets: string[] = [];

  const flush = (key: number) => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${key}`} className="space-y-2 mb-5 pl-0 list-none">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-[9px] w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
            <span className="text-[14.5px] text-slate-600 leading-relaxed">{b}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const t = line.trim();
    const m = t.match(/^[-•*]\s+(.+)/);
    if (m) { bullets.push(m[1]); }
    else { flush(i); if (t) blocks.push(<p key={`p-${i}`} className="text-[14.5px] text-slate-600 leading-relaxed mb-4">{t}</p>); }
  });
  flush(lines.length);
  return <>{blocks}</>;
}

function Sect({ title, brand, children }: { title: string; brand: string; children: React.ReactNode }) {
  return (
    <div className="pt-7 border-t border-slate-100">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-[3px] h-4 rounded-full shrink-0" style={{ background: brand }} />
        <h2 className="text-[14.5px] font-bold text-slate-900 tracking-tight">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function CareersJob({ code, onBack }: Props) {
  const [job, setJob]           = useState<any>(null);
  const [org, setOrg]           = useState<OrgSettings>({});
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Form state
  const [form, setForm]       = useState({ first_name: '', last_name: '', email: '', mobile_phone: '', cv_title: '', coverLetter: '' });
  const [cvFile, setCvFile]   = useState<File | null>(null);
  const [cvPreview, setCvPrev] = useState(false);
  const [submitting, setSub]  = useState(false);
  const [submitted, setDone]  = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    Promise.all([
      publicApi.get(`/public/jobs/${code}`),
      publicApi.get('/public/settings'),
    ]).then(([jRes, sRes]) => {
      setJob(jRes.data.data ?? jRes.data);
      setOrg(sRes.data.data ?? {});
    }).catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [code]);

  const brand   = org.accent_color || BLUE;
  const logoUrl = resolveLogoUrl(org.company_logo_url);
  const orgName = org.company_name || 'Careers';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.first_name || !form.last_name || !form.email) {
      setError('First name, last name and email are required.');
      return;
    }
    setSub(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (cvFile) fd.append('cv', cvFile);
      await publicApi.post(`/public/jobs/${code}/apply`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Submission failed. Please try again.');
    } finally { setSub(false); }
  };

  // Loading
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f6f9]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="text-center space-y-3">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
        <p className="text-[13px] text-slate-400">Loading…</p>
      </div>
    </div>
  );

  // Not found
  if (notFound || !job) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-[#f4f6f9]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
        <Briefcase size={28} className="text-slate-300" />
      </div>
      <div className="text-center">
        <p className="text-[17px] font-bold text-slate-800">Position unavailable</p>
        <p className="text-[13px] text-slate-400 mt-1">This role may have been filled or removed.</p>
      </div>
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[13px] font-semibold"
        style={{ background: brand }}
      >
        <ArrowLeft size={14} /> Browse all jobs
      </button>
    </div>
  );

  const imageUrl = job.attachment ? `/v1/api/hr/documents/${job.attachment}` : null;
  const shareUrl  = window.location.href;
  const shareText = `${job.title}${job.location ? ` in ${job.location}` : ''}. Apply Now!`;
  const hasSalary = job.showSalary === 'Yes' && (job.salaryMin || job.salaryMax);

  const popup = (w: number, h: number) => {
    const l = Math.round(screen.width / 2 - w / 2);
    const t = Math.round(screen.height / 2 - h / 2);
    return `width=${w},height=${h},left=${l},top=${t}`;
  };

  const inputCls = 'w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-offset-0 focus:bg-white transition-all';

  return (
    <div className="min-h-screen bg-[#f4f6f9]" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Sticky Nav ── */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[13px] text-slate-500 hover:text-slate-900 font-medium transition-colors group"
          >
            <span className="w-7 h-7 rounded-full bg-slate-100 group-hover:bg-slate-200 flex items-center justify-center transition-colors shrink-0">
              <ArrowLeft size={13} />
            </span>
            {logoUrl
              ? <img src={logoUrl} alt={orgName} className="h-5 w-auto" />
              : <span className="font-semibold text-slate-800 hidden sm:block">{orgName}</span>
            }
          </button>

          <p className="hidden md:block text-[13px] text-slate-400 truncate max-w-xs">{job.title}</p>

          {!submitted && (
            <a
              href="#apply-form"
              className="shrink-0 px-4 py-2 rounded-lg text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
              style={{ background: brand }}
            >
              Apply Now
            </a>
          )}
        </div>
      </header>

      {/* ── Banner image ── */}
      {imageUrl && (
        <div className="relative w-full h-48 sm:h-60 overflow-hidden">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        </div>
      )}

      {/* ── Job header ── */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {job.department && (
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: brand }}>{job.department}</p>
          )}
          <h1 className="text-[28px] sm:text-[34px] font-extrabold text-slate-900 leading-tight tracking-tight">
            {job.title}
          </h1>
          {job.companyName && (
            <p className="text-[14px] text-slate-500 mt-1 font-medium">{job.companyName}</p>
          )}

          {/* Meta chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            {(job.location || job.country) && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[12px] text-slate-600 font-medium">
                <MapPin size={11} className="text-slate-400 shrink-0" />
                {[job.location, job.country].filter(Boolean).join(', ')}
              </span>
            )}
            {job.employementType && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[12px] text-slate-600 font-medium">
                <Clock size={11} className="text-slate-400 shrink-0" /> {job.employementType}
              </span>
            )}
            {job.experienceLevel && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[12px] text-slate-600 font-medium">
                <Briefcase size={11} className="text-slate-400 shrink-0" /> {job.experienceLevel}
              </span>
            )}
            {job.educationLevel && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[12px] text-slate-600 font-medium">
                <GraduationCap size={11} className="text-slate-400 shrink-0" /> {job.educationLevel}
              </span>
            )}
            {job.closingDate && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-[12px] text-amber-700 font-medium">
                <Calendar size={11} className="text-amber-400 shrink-0" />
                Closes {new Date(job.closingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>

          {/* Salary */}
          {hasSalary && (
            <div
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-[14px] font-bold"
              style={{ background: `${brand}0d`, borderColor: `${brand}30`, color: brand }}
            >
              <DollarSign size={14} />
              {job.currency ? `${job.currency} ` : ''}
              {job.salaryMin ? Number(job.salaryMin).toLocaleString() : ''}
              {job.salaryMin && job.salaryMax ? ' – ' : ''}
              {job.salaryMax ? Number(job.salaryMax).toLocaleString() : ''}
              <span className="font-normal text-[12px] opacity-60">/ year</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">

          {/* Left: content */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-7 space-y-0">
            {job.shortDescription && (
              <div className="pb-7">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-[3px] h-4 rounded-full shrink-0" style={{ background: brand }} />
                  <h2 className="text-[14.5px] font-bold text-slate-900 tracking-tight">About the Role</h2>
                </div>
                <p className="text-[14.5px] text-slate-600 leading-relaxed">{job.shortDescription}</p>
              </div>
            )}

            {job.description && (
              <Sect title="Full Description" brand={brand}><RichText html={job.description} /></Sect>
            )}
            {job.requirements && (
              <Sect title="Requirements" brand={brand}><RichText html={job.requirements} /></Sect>
            )}
            {job.benefits && (
              <Sect title="Benefits" brand={brand}><RichText html={job.benefits} /></Sect>
            )}

            {job.keywords && (
              <Sect title="Skills" brand={brand}>
                <div className="flex flex-wrap gap-2">
                  {job.keywords.split(',').map((k: string) => k.trim()).filter(Boolean).map((k: string) => (
                    <span key={k} className="px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[12.5px] text-slate-600 font-medium">
                      {k}
                    </span>
                  ))}
                </div>
              </Sect>
            )}

            {/* Share */}
            <Sect title="Share this Opening" brand={brand}>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Facebook', color: '#1877F2', Icon: IconFacebook, onClick: () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank', popup(700, 500)) },
                  { label: 'Twitter', color: '#111', Icon: IconTwitter, onClick: () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank', popup(550, 260)) },
                  { label: 'LinkedIn', color: '#0A66C2', Icon: IconLinkedIn, onClick: () => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, '_blank', popup(500, 500)) },
                  { label: 'Copy Link', color: '#64748b', Icon: Link2, onClick: () => navigator.clipboard.writeText(shareUrl).then(() => toast.success('Link copied')) },
                ].map(({ label, color, Icon, onClick }) => (
                  <button
                    key={label}
                    onClick={onClick}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-[12.5px] font-medium transition-colors"
                    style={{ color }}
                  >
                    <Icon /> {label}
                  </button>
                ))}
              </div>
            </Sect>
          </div>

          {/* Right: apply form */}
          <div id="apply-form" className="lg:sticky lg:top-20">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {submitted ? (
                <div className="p-8 text-center space-y-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: `${brand}15` }}>
                    <CheckCircle2 size={28} style={{ color: brand }} />
                  </div>
                  <div>
                    <p className="text-[17px] font-bold text-slate-900">Application Received</p>
                    <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">Thank you for applying. Our team will review your application and be in touch.</p>
                  </div>
                  <button onClick={onBack} className="text-[13px] font-medium hover:opacity-70 transition-opacity" style={{ color: brand }}>
                    ← Browse more jobs
                  </button>
                </div>
              ) : (
                <>
                  {/* Form header */}
                  <div className="px-6 py-4 border-b border-slate-100" style={{ background: `${brand}08` }}>
                    <p className="text-[15px] font-bold text-slate-900">Apply for this Position</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">Fields marked * are required</p>
                  </div>

                  <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                      <div className="px-3.5 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[13px] leading-relaxed">{error}</div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">First Name *</label>
                        <input name="first_name" value={form.first_name} onChange={handleChange} className={inputCls}
                          style={{ ['--tw-ring-color' as string]: `${brand}40` }} required />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Last Name *</label>
                        <input name="last_name" value={form.last_name} onChange={handleChange} className={inputCls}
                          style={{ ['--tw-ring-color' as string]: `${brand}40` }} required />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Email *</label>
                      <input type="email" name="email" value={form.email} onChange={handleChange} className={inputCls}
                        style={{ ['--tw-ring-color' as string]: `${brand}40` }} required />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Phone</label>
                      <input type="tel" name="mobile_phone" value={form.mobile_phone} onChange={handleChange} className={inputCls}
                        style={{ ['--tw-ring-color' as string]: `${brand}40` }} />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Current Job Title</label>
                      <input name="cv_title" value={form.cv_title} onChange={handleChange} className={inputCls}
                        placeholder="e.g. Senior Accountant"
                        style={{ ['--tw-ring-color' as string]: `${brand}40` }} />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Cover Letter</label>
                      <CountedTextarea name="coverLetter" value={form.coverLetter} onChange={handleChange} rows={5}
                        maxChars={2000} className={inputCls} placeholder="Why are you a great fit for this role?"
                        style={{ ['--tw-ring-color' as string]: `${brand}40` }} />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">CV / Resume</label>

                      {cvFile ? (
                        <div className="space-y-2">
                          {/* File row */}
                          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: brand }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                            <span className="flex-1 truncate text-[13px] text-slate-700">{cvFile.name}</span>
                            <button type="button" onClick={() => setCvPrev(true)}
                              className="text-slate-500 hover:opacity-70 transition-opacity" style={{ color: brand }}
                              title="Preview">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            </button>
                            <button type="button" onClick={() => { setCvFile(null); setCvPrev(false); }}
                              className="text-slate-400 hover:text-red-500 transition-colors" title="Remove">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          </div>

                          {/* Image thumbnail */}
                          {cvFile.type.startsWith('image/') && (
                            <button type="button" onClick={() => setCvPrev(true)}
                              className="block w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:opacity-90 transition-opacity">
                              <img src={URL.createObjectURL(cvFile)} alt="CV preview"
                                className="w-full max-h-40 object-contain" />
                            </button>
                          )}

                          {/* PDF preview link */}
                          {cvFile.type === 'application/pdf' && (
                            <button type="button" onClick={() => setCvPrev(true)}
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium hover:underline" style={{ color: brand }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              Preview PDF
                            </button>
                          )}
                        </div>
                      ) : (
                        <label className={`${inputCls} flex items-center gap-2 cursor-pointer`} style={{ ['--tw-ring-color' as string]: `${brand}40` }}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-400"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                          <span className="text-slate-400">Attach CV / Resume…</span>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                            onChange={e => { setCvFile(e.target.files?.[0] ?? null); setCvPrev(false); }} />
                        </label>
                      )}

                      <p className="text-[11px] text-slate-400 mt-1">PDF, JPG or PNG · max 20 MB</p>

                      {/* Preview modal */}
                      {cvPreview && cvFile && (() => {
                        const blobUrl = URL.createObjectURL(cvFile);
                        const isImage = cvFile.type.startsWith('image/');
                        return (
                          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
                            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setCvPrev(false)} />
                            <div className="relative z-10 bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] overflow-hidden border border-slate-200">
                              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
                                <p className="text-[13px] font-semibold text-slate-800 truncate max-w-[80%]">{cvFile.name}</p>
                                <button onClick={() => setCvPrev(false)} className="text-slate-400 hover:text-slate-700 p-1">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                </button>
                              </div>
                              <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center" style={{ minHeight: 400 }}>
                                {isImage
                                  ? <img src={blobUrl} alt={cvFile.name} className="max-w-full max-h-full object-contain p-4" />
                                  : <iframe src={blobUrl} title={cvFile.name} className="w-full border-0" style={{ height: 600 }} />
                                }
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    <button
                      type="submit" disabled={submitting}
                      className="w-full py-3 rounded-xl text-white text-[14px] font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
                      style={{ background: brand }}
                    >
                      {submitting
                        ? <><Loader2 size={15} className="animate-spin" /> Submitting…</>
                        : <><Send size={13} /> Submit Application</>
                      }
                    </button>

                    <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                      By submitting, you consent to processing of your data for recruitment.
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 mt-12 py-8 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {logoUrl
              ? <img src={logoUrl} alt={orgName} className="h-5 w-auto opacity-40" />
              : orgName && <span className="text-[12px] font-semibold text-slate-400">{orgName}</span>
            }
          </div>
          {orgName && (
            <p className="text-[11px] text-slate-400">© {new Date().getFullYear()} {orgName}. All rights reserved.</p>
          )}
        </div>
      </footer>
    </div>
  );
}
