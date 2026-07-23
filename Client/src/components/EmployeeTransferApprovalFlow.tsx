import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { FormModal } from './ui/FormModal';
import { SearchSelect } from './ui/SearchSelect';
import { inputClass } from './ui/FormField';

type Stage = { name: string; approverType: 'role' | 'user'; approverId: string; approverLabel: string };
type Option = { id: string; label: string };

export function EmployeeTransferApprovalFlow({ onClose }: { onClose: () => void }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [useEmployeeApprovalFlow, setUseEmployeeApprovalFlow] = useState(false);
  const [effectiveStages, setEffectiveStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/employee-transfers/approval-flow'),
      api.get('/employee-transfers/approval-settings'),
      api.get('/roles'), api.get('/users'),
    ])
      .then(([flowResponse, settingsResponse, roleResponse, userResponse]) => {
        setStages((flowResponse.data?.data || []).map((stage: any) => ({
          name: stage.name || '',
          approverType: stage.approverType === 'user' ? 'user' : 'role',
          approverId: String(stage.approverId || ''),
          approverLabel: stage.approverLabel || '',
        })));
        setUseEmployeeApprovalFlow(settingsResponse.data?.data?.useEmployeeApprovalFlow === true);
        setEffectiveStages((settingsResponse.data?.data?.employeeStages || []).map((stage: any) => ({
          name: stage.name || '',
          approverType: stage.approverType === 'user' ? 'user' : 'role',
          approverId: String(stage.approverId || ''),
          approverLabel: stage.approverLabel || '',
        })));
        setRoles((roleResponse.data?.data || []).map((role: any) => ({ id: String(role.id), label: role.name })));
        setUsers((userResponse.data?.data || []).map((user: any) => ({ id: String(user.id), label: user.name || user.username || `User ${user.id}` })));
      })
      .catch(() => toast.error('Failed to load the transfer approval flow'))
      .finally(() => setLoading(false));
  }, []);

  const update = (index: number, patch: Partial<Stage>) => setStages(current => current.map((stage, i) => i === index ? { ...stage, ...patch } : stage));
  const move = (index: number, direction: -1 | 1) => setStages(current => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.length) return current;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });

  const save = async () => {
    if (!useEmployeeApprovalFlow) {
      for (const stage of stages) {
        if (!stage.name.trim()) return toast.error('Every stage needs a name');
        if (!stage.approverId) return toast.error(`Stage "${stage.name}" needs an approver`);
      }
    }
    setSaving(true);
    try {
      const requests: Promise<any>[] = [
        api.put('/employee-transfers/approval-settings', { useEmployeeApprovalFlow }),
      ];
      if (!useEmployeeApprovalFlow) requests.push(api.put('/employee-transfers/approval-flow', { stages }));
      await Promise.all(requests);
      toast.success(useEmployeeApprovalFlow
        ? 'Transfers will use the Employee Approval Flow'
        : stages.length ? 'Transfer approval flow saved' : 'Transfer approval flow cleared');
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to save the transfer approval flow');
    } finally { setSaving(false); }
  };

  return (
    <FormModal title="Employee Transfer Approval Flow"
      subtitle="Choose whether transfers inherit the Employee Approval Flow or follow their own stages. The selected flow is snapshotted when a transfer is submitted."
      onClose={onClose} onSave={save} saveLabel={saving ? 'Saving…' : 'Save Flow'} maxWidth="lg" scrollable>
      {loading ? <div className="py-10 text-center text-sm text-[var(--text-muted)]">Loading…</div> : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Use Employee Approval Flow</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                New transfers will use the same stages configured for new employees and employee detail changes.
              </p>
            </div>
            <button type="button" role="switch" aria-checked={useEmployeeApprovalFlow}
              onClick={() => setUseEmployeeApprovalFlow(value => !value)}
              className={`relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full border-2 border-transparent transition-colors ${useEmployeeApprovalFlow ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
              <span className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${useEmployeeApprovalFlow ? 'translate-x-[18px]' : 'translate-x-0'}`} />
            </button>
          </div>

          {useEmployeeApprovalFlow ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Inherited employee stages</p>
              {effectiveStages.length ? <div className="space-y-2">{effectiveStages.map((stage, index) => (
                <div key={`${stage.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md bg-[var(--bg)] px-3 py-2 text-sm">
                  <span className="font-semibold text-[var(--text-primary)]">{index + 1}. {stage.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">{stage.approverLabel || (stage.approverType === 'role' ? 'Approving role' : 'Specific user')}</span>
                </div>
              ))}</div> : <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-5 text-center text-sm text-[var(--text-muted)]">
                The Employee Approval Flow has no stages. Transfers will use direct approval by users with transfer approval permission.
              </div>}
            </div>
          ) : <>
          {!stages.length && (
            <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
              <ShieldCheck size={20} className="mx-auto mb-2 opacity-60" />No configured stages. Add a role or user stage below.
            </div>
          )}
          {stages.map((stage, index) => {
            const options = stage.approverType === 'role' ? roles : users;
            return (
              <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">{index + 1}</span>
                  <input className={`${inputClass} flex-1`} value={stage.name} onChange={event => update(index, { name: event.target.value })} placeholder={`Stage ${index + 1} name`} />
                  <button type="button" className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30" disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30" disabled={index === stages.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                  <button type="button" className="rounded p-1.5 text-red-500 hover:bg-red-50" onClick={() => setStages(current => current.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
                </div>
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 pl-8">
                  <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)] text-xs">
                    {(['role', 'user'] as const).map(type => <button key={type} type="button" className={`px-3 py-2 font-medium ${stage.approverType === type ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-black/5'}`} onClick={() => update(index, { approverType: type, approverId: '', approverLabel: '' })}>{type === 'role' ? 'Role' : 'Specific user'}</button>)}
                  </div>
                  <SearchSelect value={stage.approverId} options={options} placeholder={stage.approverType === 'role' ? 'Select approving role…' : 'Select approving user…'} onChange={id => update(index, { approverId: id, approverLabel: options.find(option => option.id === id)?.label || '' })} />
                </div>
              </div>
            );
          })}
          <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-black/5" onClick={() => setStages(current => [...current, { name: '', approverType: 'role', approverId: '', approverLabel: '' }])}><Plus size={15} />Add stage</button>
          </>}
        </div>
      )}
    </FormModal>
  );
}
