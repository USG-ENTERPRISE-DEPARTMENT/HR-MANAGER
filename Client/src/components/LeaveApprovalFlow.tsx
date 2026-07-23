import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowUp, ArrowDown, ShieldCheck } from 'lucide-react';
import api from '../../lib/api';
import { FormModal } from './ui/FormModal';
import { SearchSelect } from './ui/SearchSelect';
import { inputClass } from './ui/FormField';

type Stage = {
  name: string; minAmount: string; maxAmount: string;
  approverType: 'role' | 'user'; approverId: string; approverLabel: string;
};
type Opt = { id: string; label: string };

/**
 * Editor for the leave-allowance amount-range approval flow. Each stage has a name, an APPROVER (role or
 * specific user), and an AMOUNT RANGE. After a leave is fully approved, its allowance is routed only through
 * the stages whose [min, max] covers the payout; amounts below every range skip financial approval and go
 * straight to GL. Saved to PUT /leave/approval-flow.
 */
export function LeaveApprovalFlow({ onClose }: { onClose: () => void }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [roles, setRoles] = useState<Opt[]>([]);
  const [users, setUsers] = useState<Opt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/leave/approval-flow'),
      api.get('/roles'),
      api.get('/users'),
    ]).then(([flowR, rolesR, usersR]) => {
      const flow = Array.isArray(flowR.data?.data) ? flowR.data.data : [];
      setStages(flow.map((s: any) => ({
        name: s.name ?? '',
        minAmount: s.minAmount != null ? String(s.minAmount) : '0',
        maxAmount: s.maxAmount != null ? String(s.maxAmount) : '',
        approverType: s.approverType === 'user' ? 'user' : 'role',
        approverId: String(s.approverId ?? ''), approverLabel: s.approverLabel ?? '',
      })));
      setRoles((rolesR.data?.data || []).map((r: any) => ({ id: String(r.id), label: r.name })));
      setUsers((usersR.data?.data || []).map((u: any) => ({ id: String(u.id), label: u.name || u.username || `User ${u.id}` })));
    }).catch(() => toast.error('Failed to load the approval flow')).finally(() => setLoading(false));
  }, []);

  const update = (i: number, patch: Partial<Stage>) =>
    setStages(s => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const addStage = () => setStages(s => [...s, { name: '', minAmount: '0', maxAmount: '', approverType: 'role', approverId: '', approverLabel: '' }]);
  const removeStage = (i: number) => setStages(s => s.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => setStages(s => {
    const j = i + dir; if (j < 0 || j >= s.length) return s;
    const a = [...s]; [a[i], a[j]] = [a[j], a[i]]; return a;
  });
  const pickApprover = (i: number, id: string, opts: Opt[]) =>
    update(i, { approverId: id, approverLabel: opts.find(o => o.id === id)?.label ?? '' });

  const save = async () => {
    for (const st of stages) {
      if (!st.name.trim()) return toast.error('Every stage needs a name');
      if (!st.approverId) return toast.error(`Stage "${st.name.trim()}" needs an approver`);
      const min = Number(st.minAmount || 0);
      if (!Number.isFinite(min) || min < 0) return toast.error(`Stage "${st.name.trim()}" needs a valid minimum amount`);
      if (st.maxAmount.trim() !== '') {
        const max = Number(st.maxAmount);
        if (!Number.isFinite(max) || max <= min) return toast.error(`Stage "${st.name.trim()}" maximum must be greater than the minimum`);
      }
    }
    setSaving(true);
    try {
      const payload = stages.map(st => ({
        name: st.name.trim(),
        minAmount: Number(st.minAmount || 0),
        maxAmount: st.maxAmount.trim() === '' ? null : Number(st.maxAmount),
        approverType: st.approverType,
        approverId: st.approverId,
        approverLabel: st.approverLabel,
      }));
      await api.put('/leave/approval-flow', { stages: payload });
      toast.success(stages.length ? 'Approval flow saved' : 'Approval flow cleared');
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save the approval flow');
    } finally { setSaving(false); }
  };

  return (
    <FormModal
      title="Leave Allowance Approval Flow"
      subtitle="After a leave is approved, its allowance is routed only through the stages whose amount range covers the payout. Amounts below every range skip financial approval and go straight to GL."
      onClose={onClose}
      onSave={save}
      saveLabel={saving ? 'Saving…' : 'Save Flow'}
      maxWidth="lg"
      scrollable
    >
      {loading ? (
        <div className="py-10 text-center text-[13px] text-[var(--text-muted)]">Loading…</div>
      ) : (
        <div className="space-y-3">
          {stages.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-[13px] text-[var(--text-muted)]">
              <ShieldCheck size={18} className="mx-auto mb-2 opacity-60" />
              No approval stages yet. Add a stage — a leave allowance whose payout falls in its range will need that sign-off.
            </div>
          )}

          {stages.map((st, i) => {
            const opts = st.approverType === 'role' ? roles : users;
            return (
              <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white text-[11px] font-semibold">{i + 1}</span>
                  <input
                    className={`${inputClass} flex-1`}
                    value={st.name}
                    onChange={e => update(i, { name: e.target.value })}
                    placeholder={`Stage ${i + 1} name (e.g. Finance Manager)`}
                  />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30" title="Move up"><ArrowUp size={15} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1}
                    className="p-1.5 rounded hover:bg-black/5 disabled:opacity-30" title="Move down"><ArrowDown size={15} /></button>
                  <button type="button" onClick={() => removeStage(i)}
                    className="p-1.5 rounded text-red-500 hover:bg-red-50" title="Remove stage"><Trash2 size={15} /></button>
                </div>

                <div className="grid grid-cols-[auto_1fr] items-center gap-2 pl-8 mb-2">
                  <div className="inline-flex rounded-md border border-[var(--border)] overflow-hidden text-[12px]">
                    {(['role', 'user'] as const).map(type => (
                      <button key={type} type="button"
                        onClick={() => update(i, { approverType: type, approverId: '', approverLabel: '' })}
                        className={`px-3 py-1.5 font-medium ${st.approverType === type ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-black/5'}`}>
                        {type === 'role' ? 'Role' : 'Specific user'}
                      </button>
                    ))}
                  </div>
                  <SearchSelect
                    value={st.approverId}
                    onChange={id => pickApprover(i, id, opts)}
                    options={opts}
                    placeholder={st.approverType === 'role' ? 'Select approving role…' : 'Select approving user…'}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 pl-8">
                  <label className="text-[11px] text-[var(--text-muted)]">
                    Min amount
                    <input type="number" min="0" step="0.01" className={`${inputClass} mt-0.5`}
                      value={st.minAmount} onChange={e => update(i, { minAmount: e.target.value })} placeholder="0" />
                  </label>
                  <label className="text-[11px] text-[var(--text-muted)]">
                    Max amount <span className="opacity-70">(blank = no upper limit)</span>
                    <input type="number" min="0" step="0.01" className={`${inputClass} mt-0.5`}
                      value={st.maxAmount} onChange={e => update(i, { maxAmount: e.target.value })} placeholder="∞" />
                  </label>
                </div>
              </div>
            );
          })}

          <button type="button" onClick={addStage}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-2.5 text-[13px] font-medium text-[var(--accent)] hover:bg-black/5">
            <Plus size={15} /> Add stage
          </button>
        </div>
      )}
    </FormModal>
  );
}
