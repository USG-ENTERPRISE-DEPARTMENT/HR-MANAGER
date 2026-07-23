import { useState, useEffect } from 'react';
import { CalendarClock, CheckCircle2, Loader2, Clock } from 'lucide-react';
import { publicApi } from '@/lib/publicApi';
import { appPath } from '@/lib/basePath';

function getToken(): string | null {
  const match = appPath().match(/^\/schedule\/(.+)$/);
  return match ? match[1] : null;
}

function normalizeSlot(raw: any): { start: string; end: string | null } {
  if (typeof raw === 'string') return { start: raw, end: null };
  return { start: raw.start ?? raw, end: raw.end ?? null };
}

function formatSlot(raw: any) {
  const { start, end } = normalizeSlot(raw);
  const d = new Date(start);
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const startTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const endTime = end ? new Date(end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null;
  return { date, time: endTime ? `${startTime} – ${endTime}` : startTime };
}

export function SchedulingPortal() {
  const token = getToken();

  const [loading,    setLoading]    = useState(true);
  const [data,       setData]       = useState<any>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [expired,    setExpired]    = useState(false);
  const [selected,   setSelected]   = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed,  setConfirmed]  = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid link.');
      setLoading(false);
      return;
    }
    publicApi.get(`/public/schedule/${token}`)
      .then(res => setData(res.data.data ?? res.data))
      .catch(err => {
        if (err.response?.status === 410) setExpired(true);
        else setError(err.response?.data?.message ?? 'Link not found or invalid.');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleConfirm = async () => {
    if (!selected || !token) return;
    setConfirming(true);
    try {
      await publicApi.post(`/public/schedule/${token}/confirm`, { slot: selected });
      setConfirmed(true);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to confirm. Please try again.');
      setConfirming(false);
    }
  };

  const card: React.CSSProperties = {
    background: '#fff',
    borderRadius: 14,
    padding: 32,
    boxShadow: '0 1px 6px rgba(0,0,0,.08)',
    width: '100%',
  };

  const accent = '#2563eb';

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 16px' }}>
      <div style={{ width: '100%', maxWidth: 560 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <CalendarClock size={44} color={accent} style={{ marginBottom: 14, display: 'block', margin: '0 auto 14px' }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111', margin: '0 0 6px' }}>Schedule Your Interview</h1>
          {data?.job?.title && (
            <p style={{ color: '#6b7280', margin: 0, fontSize: 15 }}>{data.job.title}</p>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ ...card, textAlign: 'center', padding: 48 }}>
            <Loader2 size={32} color={accent} style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
          </div>
        )}

        {/* Expired */}
        {!loading && expired && (
          <div style={{ ...card, textAlign: 'center' }}>
            <p style={{ color: '#ef4444', fontWeight: 600, fontSize: 16, margin: '0 0 8px' }}>This link has expired.</p>
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Please contact HR to request a new scheduling link.</p>
          </div>
        )}

        {/* Error */}
        {!loading && !expired && error && (
          <div style={{ ...card, textAlign: 'center' }}>
            <p style={{ color: '#ef4444', fontWeight: 600, fontSize: 16, margin: '0 0 8px' }}>Link not found.</p>
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Already booked */}
        {!loading && !error && !expired && data?.alreadyBooked && !confirmed && (
          <div style={{ ...card, textAlign: 'center' }}>
            <CheckCircle2 size={44} color="#22c55e" style={{ margin: '0 auto 14px', display: 'block' }} />
            <p style={{ fontWeight: 600, fontSize: 16, color: '#111', margin: '0 0 8px' }}>Interview already confirmed!</p>
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>You've already selected a slot. Check your email for the calendar invite.</p>
          </div>
        )}

        {/* Post-confirm success */}
        {confirmed && (
          <div style={{ ...card, textAlign: 'center' }}>
            <CheckCircle2 size={44} color="#22c55e" style={{ margin: '0 auto 14px', display: 'block' }} />
            <p style={{ fontWeight: 600, fontSize: 16, color: '#111', margin: '0 0 8px' }}>Interview confirmed!</p>
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>A calendar invite has been sent to your email. See you then!</p>
          </div>
        )}

        {/* Slot selection */}
        {!loading && !error && !expired && data && !data.alreadyBooked && !confirmed && (
          <div style={card}>
            {data.candidate?.first_name && (
              <p style={{ color: '#374151', marginBottom: 20, fontSize: 15 }}>
                Hello <strong>{data.candidate.first_name}</strong>, please select your preferred interview time:
              </p>
            )}
            {(data.interview?.level || data.interview?.location) && (
              <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
                {data.interview.level && <span>Round: <strong>{data.interview.level}</strong></span>}
                {data.interview.level && data.interview.location && ' · '}
                {data.interview.location && <span>{data.interview.location}</span>}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {(data.slots ?? []).length === 0 && (
                <p style={{ color: '#6b7280', fontSize: 14 }}>No slots available. Please contact HR.</p>
              )}
              {(data.slots ?? []).map((slotRaw: any) => {
                const slotKey = normalizeSlot(slotRaw).start;
                const { date, time } = formatSlot(slotRaw);
                const isSelected = selected === slotKey;
                return (
                  <button
                    key={slotKey}
                    onClick={() => setSelected(slotKey)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 18px', borderRadius: 10,
                      border: isSelected ? `2px solid ${accent}` : '2px solid #e5e7eb',
                      background: isSelected ? '#eff6ff' : '#fff',
                      cursor: 'pointer', textAlign: 'left', transition: 'border-color .12s, background .12s',
                      width: '100%',
                    }}
                  >
                    <Clock size={18} color={isSelected ? accent : '#9ca3af'} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: isSelected ? '#1d4ed8' : '#111' }}>{date}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 13, color: isSelected ? '#3b82f6' : '#6b7280' }}>{time}</p>
                    </div>
                    {isSelected && <CheckCircle2 size={18} color={accent} style={{ flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleConfirm}
              disabled={!selected || confirming}
              style={{
                width: '100%', padding: 14, borderRadius: 8,
                background: selected && !confirming ? accent : '#93c5fd',
                color: '#fff', fontWeight: 700, fontSize: 15, border: 'none',
                cursor: selected && !confirming ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background .15s',
              }}
            >
              {confirming && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
              {confirming ? 'Confirming…' : 'Confirm Slot'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
