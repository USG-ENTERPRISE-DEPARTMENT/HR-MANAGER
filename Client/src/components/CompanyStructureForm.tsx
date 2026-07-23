import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Wand2 } from 'lucide-react';
import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { SearchSelect } from './ui/SearchSelect';
import api from '../../lib/api';
import { getSettings } from '../../lib/settings';

interface Props {
  onClose: () => void;
  initialData?: any;
  onSave: (formData: any, id?: string) => void;
  currentStructures?: any[];
}

function genCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function CompanyStructureForm({ onClose, initialData, onSave, currentStructures = [] }: Props) {
  const [typeOptions, setTypeOptions] = useState<any[]>([]);
  const [employees, setEmployees]     = useState<any[]>([]);

  const isCreate = !initialData;
  const autoGen = getSettings().companyStructure.autoGenerateCode;

  // Memoize so the object reference stays stable between renders.
  // Without this, useFormState's useEffect would fire on every keystroke
  // (new object reference each render) and reset the form mid-edit.
  const mappedInitial = useMemo(() =>
    initialData
      ? {
          title:       initialData.title       ?? '',
          description: initialData.description ?? '',
          address:     initialData.address     ?? '',
          type:        initialData.typeLabel   ?? '',
          comp_code:   initialData.comp_code   ?? '',
          parent2:     initialData.parent2     ?? '',
          // Legacy records store `heads` as an employee id; prefer the resolved name so the
          // manager picker shows a name (and re-saves it as a name, matching how it's stored now).
          heads:       initialData.managerName ?? initialData.heads ?? '',
        }
      : null,
  [initialData]);

  const { formData, handleChange, setFormData } = useFormState(
    { title: '', description: '', address: '', type: '', comp_code: '', parent2: '', heads: '' },
    mappedInitial
  );

  // Auto-generate code when type changes (create mode only)
  useEffect(() => {
    if (!autoGen || !isCreate) return;
    if (formData.type && formData.type !== 'Branch') {
      setFormData(prev => ({ ...prev, comp_code: genCode() }));
    } else {
      setFormData(prev => ({ ...prev, comp_code: '' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.type]);

  useEffect(() => {
    api.get('/company/structures/types')
      .then(res => setTypeOptions(res.data.data ?? []))
      .catch(() => {});
    api.get('/employees/active')
      .then(res => setEmployees(res.data.data ?? []))
      .catch(() => {});
  }, []);

  // Manager is picked from the employees list (stored as the employee's name).
  // Keep any pre-existing manager value selectable even if not in the active list.
  const managerOptions = useMemo(() => {
    const opts = employees.map((e: any) => ({
      id: e.name,
      label: e.employee_id ? `${e.name} (${e.employee_id})` : e.name,
    }));
    if (formData.heads && !opts.some(o => o.id === formData.heads)) {
      opts.unshift({ id: formData.heads, label: formData.heads });
    }
    return opts;
  }, [employees, formData.heads]);

  // Code field is locked when auto-generate is on, in create mode, and type is not Branch
  const codeIsLocked = autoGen && !!formData.type && formData.type !== 'Branch';

  // Exclude current structure from parent options (prevents self-reference)
  const parentOptions = currentStructures.filter(s => !initialData || s.id !== initialData.id);

  const handleSubmit = () => {
    if (!formData.title?.trim())     return toast.error('Name is required');
    if (!formData.type)              return toast.error('Type of structure is required');
    if (!formData.comp_code?.trim()) return toast.error('Code is required');
    if (!formData.heads?.trim())     return toast.error('Manager is required');

    onSave(
      {
        title:       formData.title,
        comp_code:   formData.comp_code   || null,
        description: formData.description || null,
        address:     formData.address     || null,
        type:        formData.type        || null,
        parent2:     formData.parent2     || null,
        heads:       formData.heads       || null,
      },
      initialData?.id
    );
  };

  return (
    <FormModal
      title={initialData ? 'Edit Company Structure' : 'Add Company Structure'}
      subtitle="Fill in the details for the organization unit."
      onClose={onClose}
      onSave={handleSubmit}
      saveLabel="Save Structure"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

        <FormField label="Name *">
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className={inputClass}
            placeholder="e.g. Engineering"
          />
        </FormField>

        <FormField label="Type of Company Structure *">
          <select name="type" value={formData.type} onChange={handleChange} className={inputClass}>
            <option value="">Select Type</option>
            {typeOptions.map(t => (
              <option key={t.id} value={t.label}>{t.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label={
          <span className="flex items-center gap-1.5">
            Code *
            {codeIsLocked && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--accent)] bg-[var(--accent-dim)] px-1.5 py-0.5 rounded-full">
                <Wand2 size={9} /> Auto
              </span>
            )}
          </span>
        }>
          <input
            type="text"
            name="comp_code"
            value={formData.comp_code}
            onChange={handleChange}
            readOnly={codeIsLocked}
            className={`${inputClass} ${codeIsLocked ? 'opacity-60 cursor-not-allowed bg-[var(--surface-hover)]' : ''}`}
            placeholder={codeIsLocked ? '' : 'e.g. ENG-01'}
          />
        </FormField>

        <FormField label="Manager *">
          <SearchSelect
            value={formData.heads}
            onChange={v => setFormData(prev => ({ ...prev, heads: v }))}
            options={managerOptions}
            placeholder="Select manager…"
          />
        </FormField>

        <FormField label="Parent Structure">
          <select name="parent2" value={formData.parent2} onChange={handleChange} className={inputClass}>
            <option value="">None (Top Level)</option>
            {parentOptions.map(s => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Address">
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            className={inputClass}
            placeholder="Structure address"
          />
        </FormField>

        <FormField label="Description" className="sm:col-span-2">
          <CountedTextarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            className={inputClass}
            placeholder="Additional details..."
            rows={3}
            maxChars={1000}
          />
        </FormField>

      </div>
    </FormModal>
  );
}
