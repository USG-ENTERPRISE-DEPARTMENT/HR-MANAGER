import { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { FormModal } from './ui/FormModal';

// "Sync All to Core Banking": pushes every approved employee to core banking in one go. The server
// runs it as a background job (one call per employee), so this polls for progress until it finishes.
// Closing the window does not stop the run; reopening it shows where it has got to.

type Failure = { id: string | null; employee_id: string | null; name: string; message: string };
type Status = {
  running: boolean; total?: number; done?: number; succeeded?: number; failed?: number; failures?: Failure[];
  includeExited?: boolean; startedAt?: string | null; finishedAt?: string | null; startedBy?: string | null; error?: string | null;
};

export function SyncAllEmployeesButton({ onFinished }: { onFinished: () => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [includeExited, setIncludeExited] = useState(false);
  const [starting, setStarting] = useState(false);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const r = await api.get('/employees/sync-all');
      const s: Status = r.data?.data ?? { running: false };
      setStatus(s);
      if (wasRunning.current && !s.running) {
        wasRunning.current = false;
        if (s.failed) toast.warning(`Core banking sync finished: ${s.succeeded} synced, ${s.failed} failed`);
        else toast.success(`Core banking sync finished: all ${s.succeeded} employees synced`);
        onFinished();
      }
      if (s.running) wasRunning.current = true;
    } catch { /* keep the last known status */ }
  }, [onFinished]);

  // Pick up a run already in progress (started earlier, or by someone else) when the page loads.
  useEffect(() => { poll(); }, [poll]);
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [status?.running, poll]);

  const start = async () => {
    setStarting(true);
    try {
      const r = await api.post('/employees/sync-all', { includeExited });
      setStatus(r.data?.data ?? null);
      wasRunning.current = true;
      toast.success(r.data?.message || 'Sync started');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not start the sync');
      poll();
    } finally { setStarting(false); }
  };

  const running = !!status?.running;
  const pct = status?.total ? Math.round(((status.done ?? 0) / status.total) * 100) : 0;
  const finished = !running && !!status?.finishedAt;

  return (
    <>
      <button onClick={() => setOpen(true)} className="secondary-btn shrink-0" title="Push every approved employee to core banking">
        <CloudUpload className="w-[14px] h-[14px]" />
        <span className="hidden sm:inline">{running ? `Syncing… ${pct}%` : 'Sync All to Core Banking'}</span>
      </button>

      {open && (
        <FormModal
          title="Sync All Employees to Core Banking"
          subtitle="Sends every approved employee's current record to core banking, one at a time. You can close this window — the sync carries on."
          onClose={() => setOpen(false)}
          onSave={running ? () => setOpen(false) : start}
          saveLabel={running ? 'Close' : starting ? 'Starting…' : finished ? 'Sync Again' : 'Start Sync'}
          maxWidth="lg" scrollable>
          <div className="space-y-4">
            {!running && (
              <label className="flex items-start gap-2.5 text-[13px] text-[var(--text-primary)] cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={includeExited} onChange={e => setIncludeExited(e.target.checked)} />
                <span>
                  Include terminated and resigned employees
                  <span className="block text-[11px] text-[var(--text-muted)]">
                    Off by default, so staff who have left are not sent to core banking again. Turn on only to correct their exit status there.
                  </span>
                </span>
              </label>
            )}

            {status?.total ? (
              <div className="rounded-[12px] border border-[var(--border)] p-4 space-y-3">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {running ? 'Syncing…' : status.error ? 'Stopped' : 'Last sync finished'}
                  </span>
                  <span className="tabular-nums text-[var(--text-muted)]">{status.done ?? 0} of {status.total} ({pct}%)</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg)] overflow-hidden">
                  <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex flex-wrap gap-4 text-[12px]">
                  <span className="inline-flex items-center gap-1 text-[var(--success)]"><CheckCircle2 size={13} /> {status.succeeded ?? 0} synced</span>
                  <span className={`inline-flex items-center gap-1 ${status.failed ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}><AlertTriangle size={13} /> {status.failed ?? 0} failed</span>
                  {status.startedBy && <span className="text-[var(--text-muted)]">Started by {status.startedBy}{status.includeExited ? ' · including exited staff' : ''}</span>}
                </div>
                {status.error && <p className="text-[12px] text-[var(--danger)]">The sync stopped early: {status.error}</p>}
              </div>
            ) : null}

            {!!status?.failures?.length && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Failed employees</p>
                <div className="max-h-64 overflow-y-auto rounded-[12px] border border-[var(--border)] divide-y divide-[var(--border)]">
                  {status.failures.map((f, i) => (
                    <div key={`${f.id}-${i}`} className="px-4 py-2 text-[12px]">
                      <p className="font-medium text-[var(--text-primary)]">{f.name}{f.employee_id ? ` (${f.employee_id})` : ''}</p>
                      <p className="text-[11px] text-[var(--danger)] break-words">{f.message}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Failed employees are marked on the list, keep retrying automatically, and can be retried one at a time with "Retry External Sync".
                </p>
              </div>
            )}
          </div>
        </FormModal>
      )}
    </>
  );
}
