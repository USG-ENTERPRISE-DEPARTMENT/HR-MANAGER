import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, FileText, Loader2, AlertCircle, Download, Printer } from 'lucide-react';
import api from '../../lib/api';

export function DocumentViewer({ document, onClose, allowDownload = false }: any) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [mimeType,  setMimeType]  = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!document?.sourceUrl) {
      setObjectUrl(null);
      setMimeType('');
      setLoadError('');
      return;
    }

    let nextObjectUrl: string | null = null;
    let cancelled = false;

    setIsLoading(true);
    setLoadError('');
    setObjectUrl(null);
    setMimeType('');

    api.get(document.sourceUrl, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        nextObjectUrl = URL.createObjectURL(res.data);
        setObjectUrl(nextObjectUrl);
        setMimeType(res.data.type || '');
      })
      .catch(() => {
        if (!cancelled) setLoadError('Unable to load this document preview.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [document?.sourceUrl]);

  if (!document) return null;

  const fileName      = document.attachmentName || document.name || document.documentType || 'document';
  const lowerFileName = fileName.toLowerCase();
  const isPdf         = mimeType === 'application/pdf' || lowerFileName.endsWith('.pdf');
  const isImage       = mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(lowerFileName);
  const hasFile       = !!(objectUrl && (isPdf || isImage));

  const handleDownload = () => {
    if (!objectUrl) return;
    const a = Object.assign(window.document.createElement('a'), { href: objectUrl, download: fileName });
    a.click();
  };

  const handlePrint = () => {
    if (isPdf && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    } else if (objectUrl) {
      const w = window.open(objectUrl);
      w?.addEventListener('load', () => w.print());
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col p-4 sm:p-6 bg-slate-900/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="flex flex-col h-full bg-white rounded-2xl shadow-2xl overflow-hidden max-w-5xl mx-auto w-full"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg shrink-0">
              <FileText size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-slate-800 syne truncate">
                {document.name || document.documentType || 'Document View'}
              </h3>
              <p className="text-xs text-slate-500 font-medium">Previewing attachment</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {allowDownload && hasFile && (
              <>
                <button
                  onClick={handlePrint}
                  title="Print"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors"
                >
                  <Printer size={14} /> Print
                </button>
                <button
                  onClick={handleDownload}
                  title="Download"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-white bg-[var(--accent)] hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <Download size={14} /> Download
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:bg-slate-200 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 bg-slate-100 p-4 sm:p-6 flex items-center justify-center overflow-auto">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
              <p className="text-sm font-medium">Loading preview...</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <AlertCircle className="w-8 h-8 text-rose-500" />
              <p className="text-sm font-semibold">{loadError}</p>
            </div>
          ) : objectUrl && isPdf ? (
            <iframe
              ref={iframeRef}
              src={`${objectUrl}#toolbar=0&navpanes=0`}
              title={document.name || document.documentType || 'Document preview'}
              className="w-full h-full min-h-[70vh] bg-white rounded-xl border border-slate-200 shadow-sm"
            />
          ) : objectUrl && isImage ? (
            <img
              src={objectUrl}
              alt={document.name || document.documentType || 'Document preview'}
              className="max-w-full max-h-full rounded-xl shadow-sm border border-slate-200 bg-white object-contain"
            />
          ) : (
            <div className="bg-white shadow-md border border-slate-200 max-w-3xl w-full aspect-[1/1.414] p-12 flex flex-col gap-6 mx-auto my-auto relative">
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <FileText size={120} />
              </div>
              <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4">
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 syne">{document.name || document.documentType || 'COMPANY DOCUMENT'}</h1>
                  <p className="text-slate-500 mt-2 font-medium">Issue Date: {document.dateOfIssue || new Date().toLocaleDateString()}</p>
                  {document.expiryDate && <p className="text-slate-500 font-medium">Expiry Date: {document.expiryDate}</p>}
                </div>
              </div>
              <div className="flex flex-col gap-4 mt-8">
                <div className="h-6 bg-slate-100 rounded w-full" />
                <div className="h-6 bg-slate-100 rounded w-full" />
                <div className="h-6 bg-slate-100 rounded w-11/12" />
                <div className="h-6 bg-slate-100 rounded w-full" />
                <div className="h-6 bg-slate-100 rounded w-10/12" />
              </div>
              <div className="mt-8 pt-8 border-t border-slate-200">
                <h4 className="font-bold text-slate-800 mb-2">Details</h4>
                <p className="text-slate-600 leading-relaxed text-sm">
                  {document.details || 'No stored file preview is available for this document.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
