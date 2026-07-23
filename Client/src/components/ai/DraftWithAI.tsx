import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { aiDraftStream } from '../../../lib/aiClient';

// A small "Draft with AI" button. Streams a draft of `kind` from `getContext()` and pushes the
// accumulating text into the target field via onText. Available to anyone editing the form; the
// server still gates it behind the master AI enable + drafting feature toggle. Offline.
export function DraftWithAI({
  kind, getContext, onText, disabled, maxChars,
}: {
  kind: 'job_description' | 'review_feedback' | 'development_plan' | 'email' | 'policy';
  getContext: () => string;
  onText: (text: string) => void;
  disabled?: boolean;
  /** Character cap of the target field — the draft is hard-stopped at this length. */
  maxChars?: number;
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const context = getContext().trim();
    if (!context) { toast.error('Add a little context first (e.g. a title).'); return; }
    setBusy(true);
    const controller = new AbortController();
    let acc = '';
    let capped = false;
    try {
      await aiDraftStream(kind, context, (tok) => {
        acc += tok;
        if (maxChars && acc.length >= maxChars) {
          acc = acc.slice(0, maxChars);
          onText(acc);
          capped = true;
          controller.abort();          // stop streaming once the field is full
          return;
        }
        onText(acc);
      }, maxChars, controller.signal);
    } catch (e: any) {
      // An abort we triggered to enforce the cap is expected — don't surface it as an error.
      if (!capped && e?.name !== 'AbortError') toast.error(e?.message || 'Drafting failed');
    } finally { setBusy(false); }
  };

  return (
    <button type="button" onClick={run} disabled={busy || disabled}
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-[var(--purple)] text-[var(--purple)] hover:bg-[var(--purple-dim)] transition-colors disabled:opacity-50">
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      {busy ? 'Drafting…' : 'Draft with AI'}
    </button>
  );
}
