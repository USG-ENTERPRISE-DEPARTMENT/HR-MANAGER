import { useState } from 'react';
import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { DocUploadField } from './ui/DocUploadField';

export function CandidateForm({ onClose, initialData, onSave, jobs = [] }: any) {
  const { formData, handleChange } = useFormState(
    {
      first_name: '',
      last_name: '',
      middle_name: '',
      email: '',
      mobile_phone: '',
      gender: '',
      marital_status: '',
      birthday: '',
      address1: '',
      city: '',
      country: '',
      cv_title: '',
      totalYearsOfExperience: '',
      totalMonthsOfExperience: '',
      expectedSalary: '',
      source: 'Sourced',
      jobId: '',
      notes: '',
    },
    initialData
      ? {
          ...initialData,
          birthday: initialData.birthday ? initialData.birthday.split('T')[0] : '',
          jobId: initialData.jobId ? String(initialData.jobId) : '',
        }
      : undefined
  );

  const [cvFile, setCvFile] = useState<string>(initialData?.cv_file ?? '');

  return (
    <FormModal
      title={initialData ? 'Edit Candidate' : 'Add Candidate'}
      subtitle="Capture the candidate's profile information."
      onClose={onClose}
      onSave={() => onSave({ ...formData, cv_file: cvFile || null })}
      maxWidth="3xl"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
        <FormField label="First Name" required>
          <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Last Name" required>
          <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Middle Name">
          <input type="text" name="middle_name" value={formData.middle_name} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Email">
          <input type="email" name="email" value={formData.email} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Mobile Phone">
          <input type="text" name="mobile_phone" value={formData.mobile_phone} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Gender">
          <select name="gender" value={formData.gender} onChange={handleChange} className={inputClass}>
            <option value="">— Select —</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </FormField>

        <FormField label="Marital Status">
          <select name="marital_status" value={formData.marital_status} onChange={handleChange} className={inputClass}>
            <option value="">— Select —</option>
            <option value="Single">Single</option>
            <option value="Married">Married</option>
            <option value="Divorced">Divorced</option>
            <option value="Widowed">Widowed</option>
          </select>
        </FormField>

        <FormField label="Date of Birth">
          <input type="date" name="birthday" value={formData.birthday} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Address">
          <input type="text" name="address1" value={formData.address1} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="City">
          <input type="text" name="city" value={formData.city} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Country">
          <input type="text" name="country" value={formData.country} onChange={handleChange} className={inputClass} placeholder="e.g. GH" />
        </FormField>

        <FormField label="Position Title">
          <input type="text" name="cv_title" value={formData.cv_title} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Years of Experience">
          <input type="number" name="totalYearsOfExperience" value={formData.totalYearsOfExperience} onChange={handleChange} className={inputClass} min="0" />
        </FormField>

        <FormField label="Months of Experience">
          <input type="number" name="totalMonthsOfExperience" value={formData.totalMonthsOfExperience} onChange={handleChange} className={inputClass} min="0" max="11" />
        </FormField>

        <FormField label="Expected Salary">
          <input type="number" name="expectedSalary" value={formData.expectedSalary} onChange={handleChange} className={inputClass} min="0" />
        </FormField>

        <FormField label="Source">
          <select name="source" value={formData.source ?? 'Sourced'} onChange={handleChange} className={inputClass}>
            <option value="Sourced">Sourced</option>
            <option value="Applied">Applied</option>
          </select>
        </FormField>

        <FormField label="Job Posting" required>
          <select name="jobId" value={formData.jobId} onChange={handleChange} className={inputClass} required>
            <option value="">— Select a job posting —</option>
            {jobs.map((j: any) => (
              <option key={j.id} value={String(j.id)}>{j.title}</option>
            ))}
          </select>
        </FormField>

        {/* CV Upload */}
        <div className="sm:col-span-2">
          <FormField label="CV / Resume">
            <DocUploadField
              value={cvFile}
              onChange={setCvFile}
              accept=".pdf,.jpg,.jpeg,.png"
              hint="PDF, JPG or PNG · max 20 MB"
            />
          </FormField>
        </div>

        <div className="sm:col-span-2">
          <FormField label="Notes">
            <CountedTextarea name="notes" value={formData.notes} onChange={handleChange} rows={3} maxChars={1000} className={inputClass} />
          </FormField>
        </div>
      </div>
    </FormModal>
  );
}
