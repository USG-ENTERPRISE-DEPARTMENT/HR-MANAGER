import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Send, X, Bot, User, Loader2, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useCan } from '@/hooks/useCan';
import { aiChatStream, aiHealth, type AiHealth } from '../../../lib/aiClient';

interface Msg { role: 'user' | 'assistant'; content: string; }

const SUGGESTIONS = [
  'How many employees are active?',
  'How do I approve a medical claim?',
  'How many leave requests are pending?',
  'How do I start a new medical year?',
];

export function AssistantWidget() {
  const { can } = useCan();
  const [open, setOpen]       = useState(false);
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [input, setInput]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [health, setHealth]   = useState<AiHealth | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && health === null) aiHealth().then(setHealth).catch(() => setHealth({ ok: false, enabled: true, reason: 'AI service unavailable' }));
  }, [open, health]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  if (!can('use_ai_assistant')) return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setMsgs(m => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      await aiChatStream(q, (tok) => {
        setMsgs(m => {
          const next = [...m];
          next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + tok };
          return next;
        });
      }, abortRef.current.signal);
    } catch (e: any) {
      setMsgs(m => {
        const next = [...m];
        next[next.length - 1] = { role: 'assistant', content: `⚠️ ${e?.message || 'Something went wrong.'}` };
        return next;
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const unavailable = health && !health.ok;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="AI Assistant"
        className="relative flex items-center justify-center p-2 text-[var(--text-muted)] hover:text-[var(--purple)] hover:bg-[var(--purple-dim)] rounded-full transition-colors"
      >
        <Sparkles className="w-[18px] h-[18px]" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="fixed z-[120] bottom-4 right-2 sm:right-4 w-[calc(100vw-1rem)] sm:w-[400px] h-[70vh] max-h-[640px] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg)] shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[var(--purple-dim)] text-[var(--purple)]">
                    <Sparkles size={15} />
                  </div>
                  <div>
                    <p className="text-[13px] font-bold text-[var(--text-primary)] syne leading-none">HR Assistant</p>
                    {/* <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Offline · on your server</p> */}
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-[var(--surface-hover)] rounded-full text-[var(--text-muted)]">
                  <X size={16} />
                </button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {unavailable && (
                  <div className="flex items-start gap-2 text-[12px] text-[var(--warning)] bg-[var(--warning-dim)] border border-[var(--border)] rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{health?.reason || 'The local AI service is unavailable.'}</span>
                  </div>
                )}

                {msgs.length === 0 && !unavailable && (
                  <div className="text-center py-6">
                    <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center bg-[var(--purple-dim)] text-[var(--purple)] mb-3">
                      <Bot size={22} />
                    </div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">Ask me about your HR data</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 mb-4">I only answer from what you're allowed to see.</p>
                    <div className="flex flex-col gap-1.5">
                      {SUGGESTIONS.map(s => (
                        <button key={s} onClick={() => send(s)}
                          className="text-left text-[12px] px-3 py-2 rounded-lg border border-[var(--border)] hover:border-[var(--purple)] hover:bg-[var(--purple-dim)] text-[var(--text-secondary)] transition-colors">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msgs.map((m, i) => (
                  <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${m.role === 'user' ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'bg-[var(--purple-dim)] text-[var(--purple)]'}`}>
                      {m.role === 'user' ? <User size={13} /> : <Bot size={13} />}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${m.role === 'user' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg)] text-[var(--text-primary)] border border-[var(--border)]'}`}>
                      {m.role === 'assistant' && !m.content && busy
                        ? <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />
                        : m.role === 'assistant'
                          ? <div className="ai-md prose-sm"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                          : m.content}
                    </div>
                  </div>
                ))}
              </div>

              {/* Composer */}
              <div className="border-t border-[var(--border)] p-2.5 shrink-0">
                <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                    placeholder={unavailable ? 'AI unavailable' : 'Ask anything…'}
                    disabled={!!unavailable}
                    rows={1}
                    className="flex-1 resize-none max-h-28 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-[13px] focus:outline-none focus:border-[var(--purple)] disabled:opacity-50"
                  />
                  <button type="submit" disabled={busy || !!unavailable || !input.trim()}
                    className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--purple)] text-white disabled:opacity-40 hover:opacity-90 transition-opacity">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </form>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
