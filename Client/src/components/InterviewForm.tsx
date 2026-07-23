import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect, MultiSearchSelect } from './ui/SearchSelect';

export function InterviewForm({ onClose, initialData, onSave, candidates = [], jobs = [], interviews = [], employees = [] }: any) {
  const { formData, handleChange } = useFormState(
    { job: '', candidate: '', level: '', location: '', notes: '', interviewers: '', status: 'Scheduled', outcome: '', feedback: '' },
    initialData
      ? {
          ...initialData,
          job:       initialData.job       ? String(initialData.job)       : '',
          candidate: initialData.candidate ? String(initialData.candidate) : '',
        }
      : undefined
  );

  // Date/time broken into three separate fields for better UX
  const [interviewDate, setInterviewDate] = useState<string>(() => {
    if (!initialData?.scheduled) return '';
    return String(initialData.scheduled).slice(0, 10);
  });
  const [startTime, setStartTime] = useState<string>(() => {
    if (!initialData?.scheduled) return '';
    return String(initialData.scheduled).slice(11, 16);
  });
  const [endTime, setEndTime] = useState<string>(() => {
    if (!initialData?.scheduled_end) return '';
    return String(initialData.scheduled_end).slice(11, 16);
  });

  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);

  // Interviewers stored as comma-separated employee names; split for multi-select
  const [selectedInterviewers, setSelectedInterviewers] = useState<string[]>(() => {
    if (!initialData?.interviewers) return [];
    return initialData.interviewers.split(',').map((s: string) => s.trim()).filter(Boolean);
  });

  // Set of candidate IDs that already have at least one interview
  const interviewedIds = useMemo(
    () => new Set(interviews.map((iv: any) => String(iv.candidate))),
    [interviews]
  );

  // Candidates eligible for the selected job (applied for it + no interview yet)
  const availableCandidates = useMemo(() => {
    if (!formData.job) return [];
    return candidates.filter(
      (c: any) => String(c.jobId) === formData.job && !interviewedIds.has(String(c.id))
    );
  }, [formData.job, candidates, interviewedIds]);

  // Reset candidate selection when job changes
  const prevJob = useRef(formData.job);
  useEffect(() => {
    if (prevJob.current !== formData.job) {
      setSelectedCandidates([]);
      prevJob.current = formData.job;
    }
  }, [formData.job]);

  // Auto-reset status to Scheduled when the date changes (e.g. rescheduling a cancelled interview)
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    if (formData.status === 'Cancelled' || formData.status === 'No Show') {
      handleChange({ target: { name: 'status', value: 'Scheduled' } } as any);
    }
  }, [interviewDate]);

  type Slot = { date: string; startTime: string; endTime: string };
  const [slots, setSlots] = useState<Slot[]>(() => {
    try {
      const raw = JSON.parse(initialData?.schedule_options || '[]');
      return raw.map((s: any) => {
        if (typeof s === 'string') return { date: s.slice(0, 10), startTime: s.slice(11, 16), endTime: '' };
        return {
          date:      s.start ? String(s.start).slice(0, 10) : '',
          startTime: s.start ? String(s.start).slice(11, 16) : '',
          endTime:   s.end   ? String(s.end).slice(11, 16)   : '',
        };
      });
    } catch { return []; }
  });

  const addSlot    = () => setSlots(prev => [...prev, { date: interviewDate || '', startTime: '', endTime: '' }]);
  const removeSlot = (i: number) => setSlots(prev => prev.filter((_, idx) => idx !== i));
  const updateSlot = (i: number, field: keyof Slot, val: string) =>
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  const employeeOptions = useMemo(
    () => employees.map((e: any) => ({ id: e.name, label: e.jobTitle ? `${e.name} — ${e.jobTitle}` : e.name })),
    [employees]
  );

  const handleSave = () => {
    const validSlots = slots
      .filter(s => s.date && s.startTime)
      .map(s => ({ start: `${s.date}T${s.startTime}`, end: s.endTime ? `${s.date}T${s.endTime}` : null }));
    const scheduled     = interviewDate && startTime ? `${interviewDate}T${startTime}` : null;
    const scheduled_end = interviewDate && endTime   ? `${interviewDate}T${endTime}`   : null;
    const base = {
      ...formData,
      scheduled,
      scheduled_end,
      schedule_options: validSlots.length ? JSON.stringify(validSlots) : null,
      interviewers: selectedInterviewers.join(', '),
    };
    if (!initialData && selectedCandidates.length > 0) {
      onSave({ ...base, candidates: selectedCandidates });
    } else {
      onSave(base);
    }
  };

  return (
    <FormModal
      title={initialData ? 'Edit Interview' : 'Schedule Interview'}
      subtitle="Capture the interview details."
      onClose={onClose}
      onSave={handleSave}
      maxWidth="2xl"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">

        {initialData ? (
          /* ── Edit mode: simple selects, no filtering ── */
          <>
            <FormField label="Job Posting">
              <SearchSelect
                value={formData.job}
                onChange={v => handleChange({ target: { name: 'job', value: v } } as any)}
                options={[{ id: '', label: '— None —' }, ...jobs.map((j: any) => ({ id: String(j.id), label: j.title }))]}
                placeholder="Select a job posting…"
              />
            </FormField>

            <FormField label="Candidate" required>
              <SearchSelect
                value={formData.candidate}
                onChange={v => handleChange({ target: { name: 'candidate', value: v } } as any)}
                options={candidates.map((c: any) => ({ id: String(c.id), label: `${c.first_name} ${c.last_name}` }))}
                placeholder="Select candidate…"
              />
            </FormField>
          </>
        ) : (
          /* ── New mode: job first, then filtered candidates ── */
          <>
            <div className="sm:col-span-2">
              <FormField label="Job Posting" required>
                <SearchSelect
                  value={formData.job}
                  onChange={v => handleChange({ target: { name: 'job', value: v } } as any)}
                  options={jobs.map((j: any) => ({ id: String(j.id), label: j.title }))}
                  placeholder="Select a job posting…"
                />
              </FormField>
            </div>

            <div className="sm:col-span-2">
              <FormField label="Candidates" required hint="Select one or more — an interview is created for each.">
                {!formData.job ? (
                  <div className={`${inputClass} text-[var(--text-muted)] opacity-60 cursor-not-allowed select-none`}>
                    Select a job posting first…
                  </div>
                ) : availableCandidates.length === 0 ? (
                  <div className={`${inputClass} text-[var(--text-muted)] opacity-60 select-none`}>
                    No eligible candidates for this job posting.
                  </div>
                ) : (
                  <MultiSearchSelect
                    value={selectedCandidates}
                    onChange={setSelectedCandidates}
                    options={availableCandidates.map((c: any) => ({
                      id: String(c.id),
                      label: `${c.first_name} ${c.last_name}`,
                    }))}
                    placeholder="Select candidates…"
                  />
                )}
              </FormField>
            </div>
          </>
        )}

        <FormField label="Interview Level / Round">
          <input type="text" name="level" value={formData.level} onChange={handleChange} className={inputClass} placeholder="e.g. Round 1, Final" />
        </FormField>

        <FormField label="Status">
          <SearchSelect
            value={formData.status}
            onChange={v => handleChange({ target: { name: 'status', value: v } } as any)}
            options={['Scheduled', 'Completed', 'Cancelled', 'No Show'].map(s => ({ id: s, label: s }))}
          />
        </FormField>

        <div className="sm:col-span-2">
          <FormField label="Date & Time" required>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3 sm:col-span-1">
                <input
                  type="date"
                  value={interviewDate}
                  onChange={e => setInterviewDate(e.target.value)}
                  className={inputClass}
                  placeholder="Date"
                />
              </div>
              <div>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className={inputClass}
                  title="Start time"
                />
              </div>
              <div>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className={inputClass}
                  title="End time"
                />
              </div>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">Date &nbsp;·&nbsp; Start time &nbsp;·&nbsp; End time</p>
          </FormField>
        </div>

        <FormField label="Location / Video Link">
          <input type="text" name="location" value={formData.location} onChange={handleChange} className={inputClass} placeholder="Room B or https://meet.example.com/..." />
        </FormField>

        <FormField label="Interviewers">
          <MultiSearchSelect
            value={selectedInterviewers}
            onChange={setSelectedInterviewers}
            options={employeeOptions}
            placeholder="Select interviewers…"
          />
        </FormField>

        {formData.status === 'Completed' && (
          <FormField label="Outcome">
            <SearchSelect
              value={formData.outcome}
              onChange={v => handleChange({ target: { name: 'outcome', value: v } } as any)}
              options={[{ id: 'Passed', label: 'Passed' }, { id: 'Failed', label: 'Failed' }, { id: 'Pending', label: 'Pending Decision' }]}
              placeholder="Select…"
            />
          </FormField>
        )}

        <div className="sm:col-span-2">
          <FormField label="Notes">
            <CountedTextarea name="notes" value={formData.notes} onChange={handleChange} rows={2} maxChars={1000} className={inputClass} />
          </FormField>
        </div>

        {formData.status === 'Completed' && (
          <div className="sm:col-span-2">
            <FormField label="Feedback">
              <CountedTextarea name="feedback" value={formData.feedback} onChange={handleChange} rows={3} maxChars={2000} className={inputClass} />
            </FormField>
          </div>
        )}

        {/* Self-scheduling slots */}
        <div className="sm:col-span-2">
          <div className="rounded-[10px] border border-[var(--border)] p-4 bg-[var(--surface-hover)]">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">Available Slots for Self-Scheduling</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Candidate will pick one slot via a scheduling link.</p>
              </div>
              <button
                type="button"
                onClick={addSlot}
                className="flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"
              >
                <Plus size={13} /> Add Slot
              </button>
            </div>

            {slots.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)] italic">No slots added. Click "Add Slot" to define available times.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {slots.map((slot, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 flex-1">
                      <input
                        type="date"
                        value={slot.date}
                        onChange={e => updateSlot(i, 'date', e.target.value)}
                        className={inputClass}
                      />
                      <input
                        type="time"
                        value={slot.startTime}
                        onChange={e => updateSlot(i, 'startTime', e.target.value)}
                        className={inputClass}
                        title="Start time"
                      />
                      <input
                        type="time"
                        value={slot.endTime}
                        onChange={e => updateSlot(i, 'endTime', e.target.value)}
                        className={inputClass}
                        title="End time"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlot(i)}
                      className="text-[var(--text-muted)] hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Date &nbsp;·&nbsp; Start time &nbsp;·&nbsp; End time</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </FormModal>
  );
}
