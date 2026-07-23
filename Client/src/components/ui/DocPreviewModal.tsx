import { X, Download } from 'lucide-react';

interface Props {
  filename: string;
  onClose: () => void;
}

export function DocPreviewModal({ filename, onClose }: Props) {
  const url = `/v1/api/hr/documents/${filename}`;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  const isPdf   = ext === 'pdf';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative bg-[var(--surface)] rounded-[14px] overflow-hidden shadow-2xl flex flex-col"
        style={{ width: 'min(860px, 95vw)', maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">Document Preview</span>
          <div className="flex items-center gap-2">
            <a
              href={`${url}?download=1`}
              download
              className="secondary-btn text-[12px] flex items-center gap-1"
              onClick={e => e.stopPropagation()}
            >
              <Download size={13} /> Download
            </a>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto bg-[var(--bg)]">
          {isImage ? (
            <div className="flex items-center justify-center p-4">
              <img
                src={url}
                alt="Document preview"
                className="max-w-full h-auto rounded-[8px] shadow"
                style={{ maxHeight: 'calc(92vh - 70px)' }}
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={url}
              title="Document preview"
              className="w-full border-none"
              style={{ height: 'calc(92vh - 70px)' }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-16 text-[var(--text-muted)]">
              <p className="text-[13px]">Preview not available for this file type.</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-btn text-[12px]"
              >
                Open in new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
