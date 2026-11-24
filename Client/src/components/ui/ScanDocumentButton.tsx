/**
 * ScanDocumentButton — opens the DMS document scanner page in a modal (iframe).
 * Place it next to any document upload control.
 *
 * Scanner URL can be overridden with VITE_DOC_SCANNER_URL.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ScanLine, X, ExternalLink, RotateCw } from 'lucide-react';

export const DOC_SCANNER_URL: string =
  (import.meta as any).env?.VITE_DOC_SCANNER_URL ||
  'http://10.32.11.82:8087/docscanner/dms/scan?scannedby=UNIONADMIN&branch=000';

export function ScanDocumentModal({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState(0);
  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="relative z-10 bg-[var(--surface)] rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[90vh] overflow-hidden border border-[var(--border)]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0 bg-[var(--bg)]">
          <p className="text-[13px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <ScanLine size={15} className="text-[var(--accent)]" /> Scan Document
          </p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setKey(k => k + 1)} className="action-btn" title="Reload scanner">
              <RotateCw size={14} />
            </button>
            <a href={DOC_SCANNER_URL} target="_blank" rel="noreferrer" className="action-btn" title="Open in new tab">
              <ExternalLink size={14} />
            </a>
            <button type="button" onClick={onClose} className="action-btn" title="Close"><X size={16} /></button>
          </div>
        </div>
        <iframe key={key} src={DOC_SCANNER_URL} title="Document Scanner"
          className="flex-1 w-full border-0 bg-white" />
      </motion.div>
    </div>,
    document.body,
  );
}

export function ScanDocumentButton({ className, label = 'Scan' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={className ?? 'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] transition-colors'}
        title="Scan a document">
        <ScanLine size={13} /> {label}
      </button>
      <AnimatePresence>
        {open && <ScanDocumentModal onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
