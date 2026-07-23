import { useState, useEffect } from 'react';
import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { FileUpload } from './ui/FileUpload';
import { SearchSelect } from './ui/SearchSelect';
import api from '../../lib/api';
import { toast } from 'sonner';

export function EmployeeDocumentForm({ onClose, initialData, onSave }: any) {
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api.get('/employees/active').then(r => setEmployees(r.data.data ?? [])).catch(() => {});
  }, []);

  const { formData, handleChange, setFormData } = useFormState(
    {
      employee:     '',
      documentType: '',
      dateOfIssue:  '',
      placeOfIssue: '',
      expiryDate:   '',
      details:      '',
      attachment:   null as File | null,
    },
    initialData
  );

  const handleSave = async () => {
    if (!formData.employee)     { toast.error('Please select an employee');      return; }
    if (!formData.documentType) { toast.error('Please select a document type'); return; }

    let attachmentFilename = initialData?.attachment ?? null;
    if (formData.attachment instanceof File) {
      try {
        const fd = new FormData();
        fd.append('file', formData.attachment);
        const up = await api.post('/employees/documents/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        attachmentFilename = up.data.data?.filename ?? null;
      } catch {
        toast.error('File upload failed — document saved without attachment');
      }
    }

    const payload = {
      employee:     formData.employee,
      documentType: formData.documentType,
      dateOfIssue:  formData.dateOfIssue  || null,
      placeOfIssue: formData.placeOfIssue || null,
      expiryDate:   formData.expiryDate   || null,
      details:      formData.details      || null,
      attachment:   attachmentFilename,
    };

    try {
      if (initialData?.id) {
        await api.put(`/documents/employee/${initialData.id}`, payload);
      } else {
        await api.post('/documents/employee', payload);
      }
      onSave();
      onClose();
    } catch {
      toast.error('Failed to save document');
    }
  };

  return (
    <FormModal
      title={initialData ? 'Edit Employee Document' : 'Add Employee Document'}
      subtitle="Fill in the details and attach the required document."
      onClose={onClose}
      onSave={handleSave}
      saveLabel="Save Document"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <FormField label="Employee" required className="sm:col-span-2">
          <SearchSelect
            value={formData.employee}
            onChange={v => setFormData(prev => ({ ...prev, employee: v }))}
            options={employees.map(e => ({ id: e.id, label: e.name }))}
            placeholder="Select Employee"
          />
        </FormField>

        <FormField label="Document Type" required>
          <select name="documentType" value={formData.documentType} onChange={handleChange} className={inputClass}>
            <option value="">Select Type</option>
            <option value="National ID">National ID</option>
            <option value="Passport">Passport</option>
            <option value="Driver's License">Driver's License</option>
            <option value="Tax Certificate">Tax Certificate</option>
            <option value="SSNIT Card">SSNIT Card</option>
          </select>
        </FormField>

        <FormField label="Expiry Date">
          <input type="date" name="expiryDate" value={formData.expiryDate} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Date of Issue">
          <input type="date" name="dateOfIssue" value={formData.dateOfIssue} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Place of Issue">
          <input type="text" name="placeOfIssue" value={formData.placeOfIssue} onChange={handleChange} className={inputClass} placeholder="e.g. Accra" />
        </FormField>

        <FormField label="Details" className="sm:col-span-2">
          <CountedTextarea name="details" value={formData.details} onChange={handleChange} className={inputClass} placeholder="Additional details..." rows={3} maxChars={1000} />
        </FormField>

        <FormField label="Attachment" className="sm:col-span-2">
          <FileUpload
            onChange={file => setFormData(prev => ({ ...prev, attachment: file }))}
            currentFile={formData.attachment}
            currentFileName={initialData?.attachment}
            accept=".pdf,image/*"
            hint="PDF, Image (Max 5MB)"
          />
        </FormField>
      </div>
    </FormModal>
  );
}
