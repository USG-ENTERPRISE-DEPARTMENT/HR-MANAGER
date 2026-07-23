import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';

export function HolidayForm({ onClose, onSave, initialData }: any) {
  const { formData, handleChange } = useFormState({ name: '', date: '', status: 'Full_Day' }, initialData);

  return (
    <FormModal
      title={initialData ? 'Edit Holiday' : 'Add Holiday'}
      subtitle="Add a company holiday."
      onClose={onClose}
      onSave={() => { onSave(formData); onClose(); }}
      maxWidth="md"
      scrollable={false}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Holiday Name" required>
          <input type="text" name="name" value={formData.name} onChange={handleChange} className={inputClass} placeholder="e.g. Christmas Day" />
        </FormField>

        <FormField label="Date" required>
          <input type="date" name="date" value={formData.date} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Status">
          <select name="status" value={formData.status} onChange={handleChange} className={inputClass}>
            <option value="Full_Day">Full Day</option>
            <option value="Half_Day">Half Day</option>
          </select>
        </FormField>
      </div>
    </FormModal>
  );
}
