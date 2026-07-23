import { useRef, useState } from 'react';
import { ScanLine, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { aiOcr } from '../../../lib/aiClient';

export interface OcrFields { amount?: number | null; date?: string | null; hospital?: string | null; description?: string | null; }

// "Scan receipt with AI" — picks an image/PDF, runs offline OCR + field extraction on the
// server, and hands the parsed fields back to the caller to pre-fill a form. Available to anyone
// using the form; the server still gates it behind the master AI enable + OCR feature toggle.
export function OcrScanButton({ onExtract, label = 'Scan receipt with AI' }: {
  onExtract: (fields: OcrFields) => void; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = () => ref.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const res = await aiOcr(file);
      const fields = (res?.fields || {}) as OcrFields;
      const any = fields.amount != null || fields.date || fields.hospital || fields.description;
      if (!any) { toast.message(res?.note || 'No fields could be read from that image.'); return; }
      onExtract(fields);
      toast.success('Receipt scanned — review the pre-filled fields.');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Scan failed');
    } finally { setBusy(false); }
  };

  return (
    <>
      <input ref={ref} type="file" accept="image/*,.pdf" hidden onChange={onFile} />
      <button type="button" onClick={pick} disabled={busy}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[var(--purple)] text-[var(--purple)] hover:bg-[var(--purple-dim)] transition-colors disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ScanLine size={12} />}
        {busy ? 'Scanning…' : label}
      </button>
    </>
  );
}
