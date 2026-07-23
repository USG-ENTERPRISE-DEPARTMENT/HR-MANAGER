import { useState, useRef, useEffect } from 'react';
import { X, Check, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const MultiSelect = ({ 
  options, 
  placeholder,
  value = [],
  onChange
}: { 
  options: string[], 
  placeholder: string,
  value?: string[],
  onChange?: (val: string[]) => void
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [internalSelected, setInternalSelected] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const selected = onChange ? value : internalSelected;

  useEffect(() => {
    const h = (e: MouseEvent) => { 
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false); 
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const toggle = (opt: string) => {
    const next = selected.includes(opt) ? selected.filter(p => p !== opt) : [...selected, opt];
    if (onChange) {
      onChange(next);
    } else {
      setInternalSelected(next);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`
          min-h-[40px] px-3 py-1.5 bg-[var(--surface)] 
          border rounded-lg cursor-pointer flex flex-wrap gap-1.5 items-center justify-between
          transition-all duration-200
          ${isOpen ? 'border-[var(--accent)] ring-[3px] ring-[var(--accent-dim)]' : 'border-[var(--border)]'}
        `}
      >
        <div className="flex flex-wrap gap-1.5 flex-1">
          {selected.length === 0 ? (
            <span className="text-[var(--text-muted)] text-[13px] py-[1px]">{placeholder}</span>
          ) : selected.map(item => (
            <span key={item} className="flex items-center gap-1 bg-[var(--accent-dim)] text-[var(--accent)] px-2 py-0.5 rounded-md text-[12px] font-semibold border border-[var(--accent)]/20">
              {item}
              <button onClick={(e) => { e.stopPropagation(); toggle(item); }} className="hover:opacity-75 transition-opacity p-0 flex items-center">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <ChevronDown size={15} className={`text-[var(--text-muted)] transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute z-50 w-full mt-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] max-h-[200px] overflow-y-auto"
          >
            {options.map(opt => (
              <div 
                key={opt} 
                onClick={() => toggle(opt)} 
                className={`
                  px-3.5 py-2.5 text-[13px] text-[var(--text-secondary)] cursor-pointer
                  flex items-center gap-2.5 transition-colors duration-150
                  hover:bg-[var(--surface-hover)]
                  ${selected.includes(opt) ? 'bg-[var(--accent-dim)]/50' : ''}
                `}
              >
                <div className={`
                  w-4 h-4 rounded-[4px] border-[1.5px] flex items-center justify-center transition-all flex-shrink-0
                  ${selected.includes(opt) ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border)]'}
                `}>
                  {selected.includes(opt) && <Check size={11} color="#fff" strokeWidth={3} />}
                </div>
                {opt}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
