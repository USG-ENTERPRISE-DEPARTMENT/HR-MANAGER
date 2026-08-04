import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, AlertTriangle, Landmark, User, Copy, Scale } from 'lucide-react';
import { toast } from 'sonner';

/** One unrecognised account, as reported by the GL account validator. */
export interface InvalidAccount {
  account: string;
  /** 'employee' → the person's own bank account; 'component' → a payroll/medical GL account. */
  kind?: 'employee' | 'component';
  /** GL component names the account was used for, e.g. ["Salary Basic", "Lunch"]. */
  sourceNames?: string[];
  /** Employee names taken from the journal narration. */
  employeeNames?: string[];
  employeeCodes?: string[];
  sides?: string[];
  /** Raw narrations — fallback when the structured fields are empty. */
  labels?: string[];
}

/** Totals and cause when the journal's debits and credits do not agree. */
export interface GlImbalance {
  totalDr: number;
  totalCr: number;
  diff: number;
  /** Employees with no bank account and no net-payable GL fallback — their net pay was dropped. */
  missingNetAccount?: string[];
  /** Payroll columns with no GL account and no env fallback — those lines were dropped. */
  unmapped?: string[];
}

interface Props {
  isOpen: boolean;
  accounts?: InvalidAccount[] | null;
  imbalance?: GlImbalance | null;
  /** Shown under the title, e.g. the payroll run name. */
  context?: string;
  onClose: () => void;
}

const money = (n: number) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Explains why a GL posting was refused, for the two reasons that stop it before anything is sent:
 * accounts the core system does not recognise, and a journal whose debits and credits disagree.
 *
 * Both are shown as structured detail rather than a toast — the lists are the actionable part, and a
 * toast would truncate them and disappear. An unbalanced batch matters most: the GL accepts whatever
 * it is sent without checking, so posting one would have to be unwound by hand at the bank.
 */
export function GlBlockedModal({ isOpen, accounts, imbalance, context, onClose }: Props) {
  const accountList = accounts ?? [];
  const hasAccounts = accountList.length > 0;
  const hasImbalance = !!imbalance;
  if (!isOpen || (!hasAccounts && !hasImbalance)) return null;

  const employeeAccounts  = accountList.filter(a => a.kind === 'employee');
  const componentAccounts = accountList.filter(a => a.kind !== 'employee');

  const subtitle = [
    hasImbalance ? 'Journal does not balance' : null,
    hasAccounts ? `${accountList.length} account${accountList.length === 1 ? '' : 's'} not recognised` : null,
  ].filter(Boolean).join(' · ');

  const copyAll = () => {
    const lines: string[] = [];
    if (hasImbalance) {
      lines.push('Debits\tCredits\tDifference');
      lines.push(`${money(imbalance!.totalDr)}\t${money(imbalance!.totalCr)}\t${money(imbalance!.diff)}`);
      lines.push('');
    }
    if (hasAccounts) {
      lines.push('Account\tUsed for');
      for (const a of accountList) lines.push(`${a.account}\t${describe(a)}`);
    }
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Could not copy'));
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[var(--surface)] w-full max-w-2xl rounded-2xl shadow-xl z-10 flex flex-col border border-[var(--border)] max-h-[85vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)] shrink-0">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 rounded-full bg-[var(--danger)]/10 shrink-0">
              <AlertTriangle className="w-5 h-5 text-[var(--danger)]" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)] syne">GL posting blocked</h3>
              <p className="text-xs text-[var(--text-muted)] font-medium mt-0.5">
                {subtitle}{context ? ` · ${context}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--surface-hover)] rounded-full text-[var(--text-muted)] transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto">
          <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
            Nothing was sent to the general ledger. Fix the items below, then finalize again — the
            posting is retried from the payroll run, so no data needs regenerating.
          </p>

          {hasImbalance && <ImbalanceSection imbalance={imbalance!} />}

          {componentAccounts.length > 0 && (
            <Section
              icon={<Landmark className="w-4 h-4" />}
              title="Payroll component accounts"
              hint="Maintained in Payroll Setup → Payroll Columns"
              rows={componentAccounts}
            />
          )}

          {employeeAccounts.length > 0 && (
            <Section
              icon={<User className="w-4 h-4" />}
              title="Employee bank accounts"
              hint="Maintained on each employee record → Financial"
              rows={employeeAccounts}
              showStaffId
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--border)] bg-[var(--bg)] shrink-0">
          <button onClick={copyAll} className="secondary-btn flex items-center gap-2">
            <Copy className="w-4 h-4" /> Copy details
          </button>
          <button onClick={onClose} className="primary-btn">Close</button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

/**
 * Debits vs credits, with the reason they diverged.
 *
 * The causes are the whole point: a journal goes out of balance because lines were DROPPED for want
 * of an account, so the difference is exactly the value of what could not be posted.
 */
function ImbalanceSection({ imbalance }: { imbalance: GlImbalance }) {
  const { totalDr, totalCr, diff, missingNetAccount = [], unmapped = [] } = imbalance;
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-1 text-[var(--text-primary)]">
        <Scale className="w-4 h-4" />
        <h4 className="text-sm font-bold">Journal does not balance</h4>
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-2">
        Debits and credits must be equal before a batch can be posted.
      </p>

      <div className="border border-[var(--border)] rounded-xl overflow-hidden mb-3">
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          <Figure label="Total debits"  value={money(totalDr)} />
          <Figure label="Total credits" value={money(totalCr)} />
          <Figure label="Difference"    value={money(diff)} danger />
        </div>
      </div>

      {(missingNetAccount.length > 0 || unmapped.length > 0) && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
          <p className="text-xs font-bold text-[var(--text-primary)] mb-2">Why it is out of balance</p>
          {missingNetAccount.length > 0 && (
            <Cause
              title="No bank account (net pay could not be credited)"
              items={missingNetAccount}
            />
          )}
          {unmapped.length > 0 && (
            <Cause
              title="No GL account on the payroll column"
              items={unmapped}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide font-bold text-[var(--text-muted)]">{label}</p>
      <p className={`text-sm font-mono font-semibold mt-0.5 ${danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'}`}>
        {value}
      </p>
    </div>
  );
}

function Cause({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-xs font-semibold text-[var(--text-secondary)]">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i, n) => (
          <li key={n} className="text-xs text-[var(--text-muted)] pl-3 border-l-2 border-[var(--border)]">{i}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Human description of where an account came from.
 *
 * A component account is described by the payroll column alone ("Salary Basic") — naming the
 * employees who happened to be in the run would suggest the fix is on their records, when the GL
 * number lives on the column itself. An employee bank account is the reverse: the person IS the
 * thing to go and correct.
 */
function describe(a: InvalidAccount): string {
  if (a.kind === 'employee') {
    const who = a.employeeNames?.length ? a.employeeNames.join(', ') : a.employeeCodes?.join(', ');
    return who || 'Employee bank account';
  }
  if (a.sourceNames?.length) return a.sourceNames.join(', ');
  // Fallback when the server could not split the narration: strip the trailing " - <employee>" so a
  // component row never lists people.
  if (a.labels?.length) {
    const stripped = [...new Set(a.labels.map(l => l.split(' - ')[0].trim()).filter(Boolean))];
    if (stripped.length) return stripped.join(', ');
  }
  return 'Unattributed line';
}

/**
 * `showStaffId` is off by default: a component's GL account belongs to the payroll column, not to a
 * person, so listing staff there implies the fix is on an employee record when it is not. Employee
 * bank accounts are the opposite — the staff ID is how you find the record to correct.
 */
function Section({ icon, title, hint, rows, showStaffId = false }: {
  icon: React.ReactNode; title: string; hint: string; rows: InvalidAccount[]; showStaffId?: boolean;
}) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-1 text-[var(--text-primary)]">
        {icon}
        <h4 className="text-sm font-bold">{title}</h4>
        <span className="pill pill-accent ml-1">{rows.length}</span>
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-2">{hint}</p>

      <div className="border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg)]">
                <th className="th text-left whitespace-nowrap">Account</th>
                <th className="th text-left">Used for</th>
                {showStaffId && <th className="th text-left whitespace-nowrap">Staff ID</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.account} className="tr border-t border-[var(--border)]">
                  <td className="td font-mono font-semibold text-[var(--danger)] whitespace-nowrap">{a.account}</td>
                  <td className="td text-[var(--text-secondary)]">{describe(a)}</td>
                  {showStaffId && (
                    <td className="td text-[var(--text-muted)] whitespace-nowrap">
                      {a.employeeCodes?.length ? a.employeeCodes.join(', ') : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
