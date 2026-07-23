/**
 * DocUploadField — uploads immediately on file selection, then shows a preview.
 * Use this wherever a document/CV is attached inside the authenticated app.
 *
 * Props
 *   value      — stored filename (e.g. "abc123.pdf") returned by the upload API
 *   onChange   — called with the new filename after a successful upload, or '' to clear
 *   accept     — file types string passed to <input> (default: pdf + common images)
 *   hint       — small help text shown in the drop area
 *   uploading  — optional external loading override
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { UploadCloud, Eye, X, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../lib/api';

// ── Preview modal ─────────────────────────────────────────────────────────────

export function DocPreviewModal({ url, filename, onClose }: { url: string; filename: string; onClose: () => void }) {
  const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(filename ?? '');
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-[var(--surface)] rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] overflow-hidden border border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 bg-[var(--bg)]">
          <p className="text-[13px] font-semibold text-[var(--text-primary)] truncate max-w-[80%]">{filename}</p>
          <div className="flex items-center gap-1">
            <a href={url} download={filename} className="action-btn text-[var(--accent)]" title="Download">
              <Download size={14} />
            </a>
            <button onClick={onClose} className="action-btn"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 flex items-center justify-center" style={{ minHeight: 400 }}>
          {isImg
            ? <img src={url} alt={filename} className="max-w-full max-h-full object-contain p-4" />
            : <iframe src={url} title={filename} className="w-full border-0" style={{ height: 600 }} />
          }
        </div>
      </motion.div>
    </div>
  );
}

// ── Upload field ──────────────────────────────────────────────────────────────

interface Props {
  value: string;
  onChange: (filename: string) => void;
  accept?: string;
  hint?: string;
}

const isImg = (name: string) => /\.(png|jpg|jpeg|gif|webp)$/i.test(name ?? '');

export function DocUploadField({
  value,
  onChange,
  accept = '.pdf,.jpg,.jpeg,.png',
  hint  = 'PDF, JPG or PNG · max 20 MB',
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [localBlob, setLocalBlob] = useState<string | null>(null);
  const [preview,   setPreview]   = useState(false);

  // Clean up blob when cleared
  useEffect(() => { if (!value) setLocalBlob(null); }, [value]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    // Show local thumbnail immediately for images
    if (file.type.startsWith('image/')) setLocalBlob(URL.createObjectURL(file));
    else setLocalBlob(null);

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/employees/documents/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const filename = res.data.data?.filename ?? res.data?.filename;
      if (filename) onChange(filename);
      else toast.error('Upload failed — no filename returned');
    } catch {
      toast.error('Failed to upload document');
      setLocalBlob(null);
    } finally {
      setUploading(false);
    }
  };

  const docUrl   = localBlob ?? (value ? `/v1/api/hr/documents/${value}` : null);
  const thumbSrc = localBlob ?? (value && isImg(value) ? `/v1/api/hr/documents/${value}` : null);

  return (
    <div className="w-full space-y-2">
      {/* Action row */}
      <div className="flex items-center gap-2 min-w-0">
        <label className={[
          'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border cursor-pointer transition-colors',
          uploading
            ? 'opacity-50 cursor-wait border-[var(--border)] bg-[var(--bg)]'
            : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]',
        ].join(' ')}>
          <input type="file" className="hidden" accept={accept} disabled={uploading}
            onChange={e => handleFile(e.target.files?.[0])} />
          <UploadCloud size={13} className={uploading ? 'animate-pulse text-[var(--accent)]' : ''} />
          {uploading ? 'Uploading…' : value ? 'Replace' : 'Choose File'}
        </label>

        {value && !uploading && (
          <>
            <span className="text-[12px] text-[var(--text-secondary)] truncate min-w-0 flex-1">{value}</span>
            <button type="button" onClick={() => setPreview(true)}
              className="shrink-0 action-btn text-[var(--accent)]" title="Preview">
              <Eye size={13} />
            </button>
            <button type="button" onClick={() => { onChange(''); setLocalBlob(null); }}
              className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors" title="Remove">
              <X size={13} />
            </button>
          </>
        )}

        {!value && !uploading && (
          <span className="text-[12px] text-[var(--text-muted)] italic">{hint}</span>
        )}
      </div>

      {/* Image thumbnail (clickable) */}
      {thumbSrc && (
        <button type="button" onClick={() => setPreview(true)}
          className="block w-full rounded-lg overflow-hidden border border-[var(--border)] bg-slate-50 hover:opacity-90 transition-opacity">
          <img src={thumbSrc} alt="preview" className="w-full max-h-40 object-contain"
            onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
        </button>
      )}

      {/* PDF / non-image preview link */}
      {value && !isImg(value) && !uploading && (
        <button type="button" onClick={() => setPreview(true)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)] hover:underline">
          <FileText size={12} /> Preview attached document
        </button>
      )}

      <AnimatePresence>
        {preview && docUrl && (
          <DocPreviewModal url={docUrl} filename={value} onClose={() => setPreview(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
