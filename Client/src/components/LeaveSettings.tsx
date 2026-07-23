import { motion } from 'motion/react';

export function LeaveSettings() {
  return (
    <div className="p-4 sm:p-6 md:p-8 w-full max-w-[1400px] mx-auto flex flex-col h-full">
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h2 className="text-[22px] font-extrabold syne text-[var(--text-primary)] tracking-tight">
          Leave Settings
        </h2>
        <p className="text-[13px] text-[var(--text-muted)] mt-1 font-medium">
          Configure rules and preferences for leaves.
        </p>
      </motion.div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 drop-shadow-sm p-8 text-center text-[var(--text-muted)]">
        Leave configurations will be displayed here.
      </div>
    </div>
  );
}
