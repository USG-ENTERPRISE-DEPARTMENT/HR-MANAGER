import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';

export function LeavePeriodForm({ onClose, onSave, initialData }: any) {
  const { formData, handleChange } = useFormState({ name: '', startDate: '', endDate: '' }, initialData);

  return (
    <FormModal
      title={initialData ? 'Edit Leave Period' : 'Add Leave Period'}
      subtitle="Define a company-wide leave period."
      onClose={onClose}
      onSave={() => { onSave(formData); onClose(); }}
      maxWidth="md"
      scrollable={false}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Period Name" required>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className={inputClass} placeholder="e.g. 2026" />
        </FormField>

        <FormField label="Start Date" required>
          <input type="date" name="startDate" value={formData.startDate} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="End Date" required>
          <input type="date" name="endDate" value={formData.endDate} onChange={handleChange} className={inputClass} />
        </FormField>
      </div>
    </FormModal>
  );
}
