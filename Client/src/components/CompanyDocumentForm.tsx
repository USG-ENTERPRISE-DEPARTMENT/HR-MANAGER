import { useState, useEffect } from 'react';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { CountedTextarea } from './ui/CountedTextarea';
import { FileUpload } from './ui/FileUpload';
import { MultiSearchSelect } from './ui/SearchSelect';
import api from '../../lib/api';
import { toast } from 'sonner';

interface Option { id: string; label: string; }

export function CompanyDocumentForm({ onClose, initialData, onSave }: any) {
  const [name,         setName]         = useState(initialData?.name         ?? '');
  const [details,      setDetails]      = useState(initialData?.details      ?? '');
  const [validUntil,   setValidUntil]   = useState(initialData?.valid_until  ? String(initialData.valid_until).substring(0, 10) : '');
  const [shareAll,     setShareAll]     = useState(initialData?.share_userlevel === 'All');
  const [deptIds,      setDeptIds]      = useState<string[]>(
    initialData?.share_departments ? initialData.share_departments.split(',').map((x: string) => x.trim()).filter(Boolean) : []
  );
  const [empIds,       setEmpIds]       = useState<string[]>(
    initialData?.share_employees ? initialData.share_employees.split(',').map((x: string) => x.trim()).filter(Boolean) : []
  );
  const [attachment,   setAttachment]   = useState<File | null>(null);

  const [deptOptions, setDeptOptions] = useState<Option[]>([]);
  const [empOptions,  setEmpOptions]  = useState<Option[]>([]);

  useEffect(() => {
    api.get('/company/structures').then(r => {
      const all: any[] = r.data.data ?? [];
      setDeptOptions(
        all
          .filter(s => s.type === 'Department' || s.typeLabel === 'Department')
          .map(s => ({ id: String(s.id), label: s.title }))
      );
    }).catch(() => {});

    api.get('/employees/active').then(r => {
      const all: any[] = r.data.data ?? [];
      setEmpOptions(all.map(e => ({ id: String(e.id), label: e.name })));
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;

    const payload: Record<string, string | null> = {
      name:              name.trim(),
      details:           details.trim() || null,
      valid_until:       validUntil || null,
      share_userlevel:   shareAll ? 'All' : null,
      share_departments: !shareAll && deptIds.length  ? deptIds.join(',')  : null,
      share_employees:   !shareAll && empIds.length   ? empIds.join(',')   : null,
    };

    // Upload file first if a new one was selected
    if (attachment) {
      try {
        const fd = new FormData();
        fd.append('file', attachment);
        const up = await api.post('/employees/documents/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        payload.attachment = up.data.data?.filename ?? null;
      } catch {
        toast.error('File upload failed — document saved without attachment');
      }
    } else if (initialData?.attachment) {
      payload.attachment = initialData.attachment;
    }

    try {
      if (initialData?.id) {
        await api.put(`/documents/company/${initialData.id}`, payload);
      } else {
        await api.post('/documents/company', payload);
      }
      onSave();
      onClose();
    } catch {
      toast.error('Failed to save document');
    }
  };

  return (
    <FormModal
      title={initialData ? 'Edit Company Document' : 'Add Company Document'}
      subtitle="Fill in the details and set who can see this document."
      onClose={onClose}
      onSave={handleSave}
      saveLabel="Save Document"
    >
      <div className="grid grid-cols-1 gap-5">
        <FormField label="Name" required>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Employee Handbook 2026"
          />
        </FormField>

        <FormField label="Details">
          <CountedTextarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            className={inputClass}
            placeholder="Brief description of the document contents"
            rows={3}
            maxChars={1000}
          />
        </FormField>

        <FormField label="Valid Until">
          <input
            type="date"
            value={validUntil}
            onChange={e => setValidUntil(e.target.value)}
            className={inputClass}
          />
        </FormField>

        {/* Share with All toggle */}
        <div className="flex items-center gap-3 py-1">
          <button
            type="button"
            role="switch"
            aria-checked={shareAll}
            onClick={() => setShareAll(v => !v)}
            className={[
              'relative shrink-0 inline-flex h-[22px] w-[40px] cursor-pointer rounded-full border-2 border-transparent',
              'transition-colors duration-200 focus:outline-none',
              shareAll ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
            ].join(' ')}
          >
            <span className={[
              'pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm ring-0 transition duration-200',
              shareAll ? 'translate-x-[18px]' : 'translate-x-0',
            ].join(' ')} />
          </button>
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)]">Share with all employees</p>
            <p className="text-[11px] text-[var(--text-muted)]">When on, every employee can see this document regardless of department.</p>
          </div>
        </div>

        {!shareAll && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <FormField label="Share with Departments">
              <MultiSearchSelect
                value={deptIds}
                onChange={setDeptIds}
                options={deptOptions}
                placeholder="Search departments…"
              />
            </FormField>

            <FormField label="Share with Employees">
              <MultiSearchSelect
                value={empIds}
                onChange={setEmpIds}
                options={empOptions}
                placeholder="Search employees…"
              />
            </FormField>
          </div>
        )}

        <FormField label="Attachment">
          <FileUpload
            onChange={setAttachment}
            currentFile={attachment}
            currentFileName={initialData?.attachment}
          />
        </FormField>
      </div>
    </FormModal>
  );
}
