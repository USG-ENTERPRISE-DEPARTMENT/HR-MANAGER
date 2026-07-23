import { useState, useEffect, useMemo } from 'react';
import { Loader2, CheckCircle2, UploadCloud, Building2 } from 'lucide-react';
import {
  ONBOARDING_FIELDS, ONBOARDING_GROUPS, type OnboardingField,
} from '@/lib/onboardingFields';
import { publicApi, BRAND_BLUE as BLUE, resolveLogoUrl } from '@/lib/publicApi';
import { appPath } from '@/lib/basePath';

interface Branding { company_name?: string; company_logo_url?: string; accent_color?: string }
interface FormConfig {
  available: boolean;
  branding?: Branding;
  enabledFields?: string[];
  requiredFields?: string[];
  codeLists?: Record<string, { value: string; label: string }[]>;
}

export function OnboardingPortal() {
  const token = useMemo(() => {
    const m = appPath().match(/^\/onboarding\/(.+)$/);
    return m ? m[1] : '';
  }, []);

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    publicApi.get(`/public/onboarding/${token}`)
      .then(r => setConfig(r.data?.data ?? { available: false }))
      .catch(() => setConfig({ available: false }))
      .finally(() => setLoading(false));
  }, [token]);

  const brand = config?.branding?.accent_color || BLUE;
  const logoUrl = resolveLogoUrl(config?.branding?.company_logo_url);
  const orgName = config?.branding?.company_name || 'Onboarding';

  const enabled = config?.enabledFields ?? [];
  const required = useMemo(() => new Set(config?.requiredFields ?? []), [config]);

  const fieldsByGroup = useMemo(() => {
    const map: Record<string, OnboardingField[]> = {};
    for (const f of ONBOARDING_FIELDS) {
      if (!enabled.includes(f.key)) continue;
      (map[f.group] ||= []).push(f);
    }
    return map;
  }, [enabled]);

  const setVal = (key: string, v: string) => {
    setValues(p => ({ ...p, [key]: v }));
    if (errors[key]) setErrors(p => ({ ...p, [key]: false }));
  };

  const optionsFor = (f: OnboardingField) => {
    if (f.staticOptions) return f.staticOptions.map(o => ({ value: o, label: o }));
    if (f.codeList) return config?.codeLists?.[f.codeList] ?? [];
    return [];
  };

  const submit = async () => {
    // validate required
    const errs: Record<string, boolean> = {};
    for (const key of enabled) {
      if (!required.has(key)) continue;
      const f = ONBOARDING_FIELDS.find(x => x.key === key);
      const filled = f?.type === 'file' ? !!files[key] : !!values[key]?.trim();
      if (!filled) errs[key] = true;
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(values)) if (v?.trim()) fd.append(k, v);
      for (const [k, file] of Object.entries(files)) fd.append(k, file);
      await publicApi.post(`/public/onboarding/${token}/apply`, fd);
      setDone(true);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── States ───────────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  if (!config?.available) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <div className="max-w-md text-center bg-white rounded-2xl border border-slate-200 p-10 shadow-sm">
          <Building2 className="mx-auto text-slate-300 mb-4" size={40} />
          <h1 className="text-lg font-bold text-slate-800">Form unavailable</h1>
          <p className="text-sm text-slate-500 mt-2">This onboarding link is no longer active. Please contact HR for an up-to-date link.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <div className="max-w-md text-center bg-white rounded-2xl border border-slate-200 p-10 shadow-sm">
          <CheckCircle2 className="mx-auto mb-4" size={44} style={{ color: brand }} />
          <h1 className="text-lg font-bold text-slate-800">Thank you!</h1>
          <p className="text-sm text-slate-500 mt-2">Your details have been submitted. Our HR team will be in touch shortly.</p>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-slate-300 text-[14px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-offset-0';

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          {logoUrl
            ? <img src={logoUrl} alt={orgName} className="h-11 w-11 rounded-xl object-contain bg-white border border-slate-200 p-1" />
            : <div className="h-11 w-11 rounded-xl grid place-items-center text-white font-bold" style={{ background: brand }}>{orgName.charAt(0)}</div>}
          <div>
            <h1 className="text-lg font-bold text-slate-800">{orgName}</h1>
            <p className="text-[13px] text-slate-500">New Hire Onboarding</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100" style={{ background: `${brand}0d` }}>
            <h2 className="font-bold text-slate-800">Welcome aboard 👋</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">Please fill in your details below. Fields marked <span className="text-rose-500">*</span> are required.</p>
          </div>

          <div className="p-6 space-y-7">
            {ONBOARDING_GROUPS.map(group => {
              const fields = fieldsByGroup[group];
              if (!fields?.length) return null;
              return (
                <section key={group}>
                  <h3 className="text-[11px] font-extrabold uppercase tracking-wider mb-3" style={{ color: brand }}>{group}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {fields.map(f => {
                      const isReq = required.has(f.key);
                      const err = errors[f.key];
                      const ringStyle = { ['--tw-ring-color' as any]: err ? '#f43f5e' : brand } as React.CSSProperties;
                      return (
                        <div key={f.key} className={f.type === 'file' || f.key === 'address1' || f.key === 'nxt_kin_address' ? 'sm:col-span-2' : ''}>
                          <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">
                            {f.label}{isReq && <span className="text-rose-500"> *</span>}
                          </label>
                          {f.type === 'select' ? (
                            <select value={values[f.key] ?? ''} onChange={e => setVal(f.key, e.target.value)}
                              className={inputCls} style={ringStyle}>
                              <option value="">— Select —</option>
                              {optionsFor(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : f.type === 'file' ? (
                            <label className={`flex items-center gap-2 ${inputCls} cursor-pointer ${files[f.key] ? 'text-slate-800' : 'text-slate-400'}`} style={ringStyle}>
                              <UploadCloud size={16} className="shrink-0" style={{ color: brand }} />
                              <span className="truncate text-[13px]">{files[f.key]?.name ?? 'Upload file (PDF or image)'}</span>
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) { setFiles(p => ({ ...p, [f.key]: file })); if (errors[f.key]) setErrors(p => ({ ...p, [f.key]: false })); }
                                }} />
                            </label>
                          ) : (
                            <input type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
                              value={values[f.key] ?? ''} onChange={e => setVal(f.key, e.target.value)}
                              className={inputCls} style={ringStyle} />
                          )}
                          {err && <p className="text-[11px] text-rose-500 mt-1">This field is required.</p>}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="px-6 py-5 border-t border-slate-100 flex justify-end">
            <button onClick={submit} disabled={submitting}
              className="h-11 px-7 rounded-lg text-white font-semibold text-[14px] flex items-center gap-2 disabled:opacity-60"
              style={{ background: brand }}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
              Submit
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">Powered by {orgName} HR</p>
      </div>
    </div>
  );
}
