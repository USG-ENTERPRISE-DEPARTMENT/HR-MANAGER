import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, Delete, LogIn, CheckCircle2, XCircle, Loader2, Camera } from 'lucide-react';
import { publicApi } from '@/lib/publicApi';
import { appPath } from '@/lib/basePath';

function getToken(): string | null {
  const match = appPath().match(/^\/kiosk\/(.+)$/);
  return match ? match[1] : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

type Stage = 'idle' | 'confirm' | 'done' | 'error';

export function AttendanceKiosk() {
  const token = getToken();
  const [meta, setMeta]       = useState<any>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [now, setNow]         = useState(new Date());
  const [staffId, setStaffId] = useState('');
  const [stage, setStage]     = useState<Stage>('idle');
  const [lookup, setLookup]   = useState<any>(null);
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<{ ok: boolean; message: string; action?: string } | null>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!token) { setMetaError('Invalid kiosk link.'); return; }
    publicApi.get(`/public/attendance/kiosk/${token}/meta`)
      .then(r => setMeta(r.data?.data ?? {}))
      .catch(() => setMetaError('This kiosk link is not active. Ask HR to enable kiosk mode.'));
  }, [token]);

  // Webcam preview on the confirm screen when photos are required
  useEffect(() => {
    if (stage === 'confirm' && meta?.require_photo) {
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' } })
        .then(stream => {
          streamRef.current = stream;
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch(() => {});
    }
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [stage, meta?.require_photo]);

  const reset = useCallback(() => {
    setStaffId('');
    setLookup(null);
    setResult(null);
    setStage('idle');
  }, []);

  // Auto-reset the success/error splash
  useEffect(() => {
    if (stage === 'done' || stage === 'error') {
      const t = setTimeout(reset, 4000);
      return () => clearTimeout(t);
    }
  }, [stage, reset]);

  const press = (k: string) => {
    if (k === 'back') setStaffId(p => p.slice(0, -1));
    else if (staffId.length < 20) setStaffId(p => p + k);
  };

  const findEmployee = async () => {
    if (!staffId.trim()) return;
    setBusy(true);
    try {
      const r = await publicApi.get(`/public/attendance/kiosk/${token}/lookup/${encodeURIComponent(staffId.trim())}`);
      setLookup(r.data?.data ?? null);
      setStage('confirm');
    } catch (e: any) {
      setResult({ ok: false, message: e.response?.data?.message ?? 'Staff ID not found' });
      setStage('error');
    } finally { setBusy(false); }
  };

  const capturePhoto = (): string | null => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return null;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth  || 480;
    canvas.height = video.videoHeight || 360;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  const punch = async () => {
    setBusy(true);
    try {
      const photo = meta?.require_photo ? capturePhoto() : null;
      const r = await publicApi.post(`/public/attendance/kiosk/${token}/punch`, { employee_no: staffId.trim(), photo });
      setResult({ ok: true, message: r.data?.message ?? 'Recorded', action: r.data?.data?.action });
      setStage('done');
    } catch (e: any) {
      setResult({ ok: false, message: e.response?.data?.message ?? 'Punch failed' });
      setStage('error');
    } finally { setBusy(false); }
  };

  const accent = '#185FA5';

  if (metaError) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', color: '#94a3b8', fontFamily: 'Segoe UI, sans-serif' }}>
          <XCircle size={48} color="#ef4444" style={{ margin: '0 auto 16px' }} />
          <p style={{ fontSize: 18 }}>{metaError}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Segoe UI, sans-serif', userSelect: 'none' }}>
      {/* Clock header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <p style={{ color: '#64748b', fontSize: 15, margin: 0, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
          {meta?.company ?? 'Attendance Kiosk'}
        </p>
        <p style={{ color: '#fff', fontSize: 72, fontWeight: 800, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {pad2(now.getHours())}:{pad2(now.getMinutes())}
          <span style={{ fontSize: 32, color: '#475569' }}>:{pad2(now.getSeconds())}</span>
        </p>
        <p style={{ color: '#64748b', fontSize: 15, marginTop: 6 }}>
          {now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 420, background: '#1e293b', borderRadius: 24, padding: 28, boxShadow: '0 24px 60px rgba(0,0,0,.45)' }}>
        {stage === 'idle' && (
          <>
            <p style={{ color: '#94a3b8', textAlign: 'center', margin: '0 0 14px', fontSize: 15 }}>Enter your Staff ID</p>
            <input
              value={staffId}
              onChange={e => setStaffId(e.target.value.toUpperCase().slice(0, 20))}
              onKeyDown={e => { if (e.key === 'Enter') void findEmployee(); }}
              autoFocus
              placeholder="·····"
              style={{
                width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #334155',
                borderRadius: 14, padding: '16px 20px', textAlign: 'center', marginBottom: 18,
                color: '#fff', fontSize: 28, fontWeight: 700, letterSpacing: 3, outline: 'none',
              }}
            />
            <p style={{ color: '#475569', fontSize: 12, textAlign: 'center', margin: '0 0 12px' }}>
              Use the keypad below, your device keyboard, or scan your badge
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', 'back'].map(k => (
                <button key={k} onClick={() => press(k)}
                  style={{ background: '#334155', border: 'none', borderRadius: 12, padding: '18px 0', color: '#fff', fontSize: 22, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {k === 'back' ? <Delete size={22} /> : k}
                </button>
              ))}
            </div>
            <button onClick={findEmployee} disabled={busy || !staffId.trim()}
              style={{ width: '100%', marginTop: 16, background: accent, border: 'none', borderRadius: 14, padding: '16px 0', color: '#fff', fontSize: 18, fontWeight: 800, cursor: 'pointer', opacity: busy || !staffId.trim() ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              {busy ? <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> : <LogIn size={20} />} Continue
            </button>
          </>
        )}

        {stage === 'confirm' && lookup && (
          <div style={{ textAlign: 'center' }}>
            {lookup.photo
              ? <img src={lookup.photo} alt="" style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 12px', border: `3px solid ${accent}` }} />
              : <div style={{ width: 88, height: 88, borderRadius: '50%', background: '#334155', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 32, fontWeight: 800 }}>{lookup.name?.charAt(0) ?? '?'}</div>}
            <p style={{ color: '#fff', fontSize: 22, fontWeight: 800, margin: 0 }}>{lookup.name}</p>
            <p style={{ color: '#64748b', fontSize: 14, margin: '4px 0 14px' }}>{lookup.employee_no}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16, color: '#94a3b8', fontSize: 14 }}>
              <span>In: <b style={{ color: '#fff' }}>{lookup.today_in ?? '—'}</b></span>
              <span>Out: <b style={{ color: '#fff' }}>{lookup.today_out ?? '—'}</b></span>
            </div>

            {meta?.require_photo && (
              <div style={{ marginBottom: 16 }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 14, background: '#0f172a' }} />
                <p style={{ color: '#64748b', fontSize: 12, margin: '6px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Camera size={12} /> A photo is captured with your punch
                </p>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={reset}
                style={{ flex: 1, background: '#334155', border: 'none', borderRadius: 14, padding: '15px 0', color: '#cbd5e1', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={punch} disabled={busy}
                style={{ flex: 2, background: lookup.today_in ? '#dc2626' : '#16a34a', border: 'none', borderRadius: 14, padding: '15px 0', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Recording…' : lookup.today_in ? 'Clock Out' : 'Clock In'}
              </button>
            </div>
          </div>
        )}

        {(stage === 'done' || stage === 'error') && result && (
          <div style={{ textAlign: 'center', padding: '18px 0' }}>
            {result.ok
              ? <CheckCircle2 size={64} color="#22c55e" style={{ margin: '0 auto 14px' }} />
              : <XCircle size={64} color="#ef4444" style={{ margin: '0 auto 14px' }} />}
            <p style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: 0 }}>{result.message}</p>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 10 }}>Returning to the keypad…</p>
          </div>
        )}
      </div>

      <p style={{ color: '#334155', fontSize: 12, marginTop: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Clock size={12} /> Punches use the server clock
      </p>
    </div>
  );
}
