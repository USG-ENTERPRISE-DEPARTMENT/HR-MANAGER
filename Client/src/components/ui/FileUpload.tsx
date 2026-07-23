import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Upload, Eye, X, FileText } from 'lucide-react';
import { DocPreviewModal } from './DocUploadField';

const isImg = (name: string) => /\.(png|jpg|jpeg|gif|webp)$/i.test(name ?? '');

interface FileUploadProps {
  onChange: (file: File) => void;
  onClear?: () => void;
  currentFile?: File | null;
  currentFileName?: string;
  accept?: string;
  hint?: string;
}

export function FileUpload({
  onChange,
  onClear,
  currentFile,
  currentFileName,
  accept = '.pdf,image/*',
  hint  = 'PDF or image (Max 20MB)',
}: FileUploadProps) {
  const [preview, setPreview] = useState(false);

  // Resolve preview URL: local blob for a freshly selected file, server path for existing
  const blobUrl = currentFile
    ? URL.createObjectURL(currentFile)
    : null;
  const serverUrl = currentFileName
    ? `/v1/api/hr/documents/${currentFileName}`
    : null;
  const previewUrl = blobUrl ?? serverUrl;

  const activeFile   = currentFile ?? null;
  const displayName  = activeFile?.name ?? currentFileName ?? null;
  const thumbSrc     = activeFile
    ? (activeFile.type.startsWith('image/') ? blobUrl : null)
    : (currentFileName && isImg(currentFileName) ? serverUrl : null);

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <label className="flex-1 border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-[var(--surface-hover)] transition-colors rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer">
        <Upload size={24} className="text-slate-400 mb-2" />
        <span className="text-sm font-medium text-slate-600">
          {displayName ? 'Click to replace' : 'Click to upload document'}
        </span>
        <span className="text-xs text-slate-400 mt-1">{hint}</span>
        <input
          type="file"
          className="hidden"
          accept={accept}
          onChange={e => e.target.files?.[0] && onChange(e.target.files[0])}
        />
      </label>

      {/* Selected / existing file row */}
      {displayName && (
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5">
          <span className="text-[12px] font-medium text-indigo-700 truncate flex-1">{displayName}</span>
          {previewUrl && (
            <button type="button" onClick={() => setPreview(true)}
              className="shrink-0 text-indigo-500 hover:text-indigo-700 transition-colors p-1" title="Preview">
              <Eye size={14} />
            </button>
          )}
          {onClear && (
            <button type="button" onClick={onClear}
              className="shrink-0 text-slate-400 hover:text-red-500 transition-colors p-1" title="Remove">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Image thumbnail */}
      {thumbSrc && (
        <button type="button" onClick={() => setPreview(true)}
          className="block w-full rounded-xl overflow-hidden border border-slate-200 bg-slate-50 hover:opacity-90 transition-opacity">
          <img src={thumbSrc} alt="preview" className="w-full max-h-40 object-contain"
            onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
        </button>
      )}

      {/* PDF / non-image preview link */}
      {displayName && !thumbSrc && previewUrl && (
        <button type="button" onClick={() => setPreview(true)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:underline">
          <FileText size={12} /> Preview document
        </button>
      )}

      <AnimatePresence>
        {preview && previewUrl && displayName && (
          <DocPreviewModal url={previewUrl} filename={displayName} onClose={() => setPreview(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
