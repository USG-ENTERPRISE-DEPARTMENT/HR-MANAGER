import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { useFormState } from '../hooks/useFormState';
import { FormModal } from './ui/FormModal';
import { FormField, inputClass } from './ui/FormField';
import { MultiSearchSelect } from './ui/SearchSelect';

const YES_NO = (
  <>
    <option value="Yes">Yes</option>
    <option value="No">No</option>
  </>
);

export function LeaveTypeForm({ onClose, initialData, onSave, leaveGroups = [] }: any) {
  const [genders, setGenders] = useState<any[]>([]);
  useEffect(() => {
    api.get('/system/code-lists/GEN/values')
      .then(r => setGenders(r.data?.data ?? []))
      .catch(() => setGenders([]));
  }, []);

  const { formData, handleChange, setFormData } = useFormState(
    {
      name: '',
      gl: '',
      leavesPerPeriod: '',
      adminCanAssign: 'Yes',
      applyBeyondBalance: 'No',
      leaveAccrueEnabled: 'No',
      accrualFrequency: 'Monthly',
      accrualRate: '',
      leaveCarriedForward: 'No',
      percentageCarriedForward: '100',
      maxCarriedForwardAmount: '0',
      carriedForwardAvailability: '1 Month',
      proportionateOnJoined: 'Yes',
      sendNotificationEmails: 'Yes',
      gender: 'All',
      leaveAllowance: 'No',
      leaveAllowanceOnce: 'No',
      leaveGroups: [],
      leaveColor: '#3b82f6',
    },
    initialData
  );

  return (
    <FormModal
      title={initialData ? 'Edit Leave Type' : 'Add Leave Type'}
      subtitle="Configure the settings for this leave type."
      onClose={onClose}
      onSave={() => onSave(formData)}
      maxWidth="3xl"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
        <FormField label="Leave Name" required hint="The display name for this leave type, e.g. Annual Leave, Sick Leave, Maternity Leave.">
          <input type="text" name="name" value={formData.name} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Leave GL" hint="General Ledger account code used to post leave liability or expense entries in your accounting system.">
          <input type="text" name="gl" value={formData.gl} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Leaves Per Leave Period" required hint="The total number of days an employee is entitled to for this leave type within one leave period (usually a year).">
          <input type="number" name="leavesPerPeriod" value={formData.leavesPerPeriod} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Supervisor can assign leave to employees" required hint="When set to Yes, a supervisor can apply for this leave type on behalf of their direct reports from the Subordinate Leave tab.">
          <select name="adminCanAssign" value={formData.adminCanAssign} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        <FormField label="Employees can apply beyond the current leave balance" required hint="When set to Yes, employees are allowed to apply for more days than their remaining balance, resulting in a negative balance.">
          <select name="applyBeyondBalance" value={formData.applyBeyondBalance} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        <FormField label="Leave Accrue Enabled" required hint="When enabled, leave days are earned gradually over time rather than being granted all at once at the start of the period.">
          <select name="leaveAccrueEnabled" value={formData.leaveAccrueEnabled} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        {formData.leaveAccrueEnabled === 'Yes' && (
          <FormField label="Accrual Frequency" required hint="How often leave days are granted — Monthly (each month), Quarterly (every 3 months), or Bi-annually (every 6 months).">
            <select name="accrualFrequency" value={formData.accrualFrequency} onChange={handleChange} className={inputClass}>
              <option value="Monthly">Monthly</option>
              <option value="Quarterly">Quarterly</option>
              <option value="Bi-annually">Bi-annually</option>
            </select>
          </FormField>
        )}

        {formData.leaveAccrueEnabled === 'Yes' && (
          <FormField label="Accrual Rate (days per period)" hint="Optional. Number of days earned per accrual period (e.g. 1.67 days/month). Leave blank to auto-divide the annual allocation evenly.">
            <input type="number" name="accrualRate" value={formData.accrualRate} onChange={handleChange} className={inputClass} min="0" step="0.01" placeholder="Auto" onWheel={(e: any) => e.currentTarget.blur()} />
            {(() => {
              const rate        = parseFloat(formData.accrualRate);
              const alloc       = parseFloat(formData.leavesPerPeriod);
              const periods     = formData.accrualFrequency === 'Quarterly' ? 4 : formData.accrualFrequency === 'Bi-annually' ? 2 : 12;
              const periodLabel = formData.accrualFrequency === 'Quarterly' ? 'quarter' : formData.accrualFrequency === 'Bi-annually' ? 'half' : 'month';
              if (!rate || !alloc) return null;
              const annualAccrual = rate * periods;
              const periodsToFull = Math.ceil(alloc / rate);
              const low  = Math.floor(alloc / periods);
              const high = Math.ceil(alloc / periods);
              if (annualAccrual > alloc) return (
                <p className="mt-1 text-[11px] text-amber-600">
                  At {rate} days/{periodLabel} the full {alloc} days accrue by {periodLabel} {periodsToFull} of {periods} — no new accrual for the remaining {periods - periodsToFull}.
                  {low > 0 && ` Use ${low} days/${periodLabel} to spread evenly (${low * periods} days total${low * periods < alloc ? `, ${alloc - low * periods} short` : ''}).`}
                </p>
              );
              if (annualAccrual < alloc) return (
                <p className="mt-1 text-[11px] text-amber-600">
                  At {rate} days/{periodLabel} only {annualAccrual} of {alloc} days accrue by year end — {alloc - annualAccrual} day(s) will never be granted.
                  {` Use ${high} days/${periodLabel} so all ${alloc} days are reached by year end (last ${periodLabel} may grant fewer).`}
                </p>
              );
              return <p className="mt-1 text-[11px] text-green-600">✓ Rate spreads the full allocation evenly across all {periods} {periodLabel}s.</p>;
            })()}
          </FormField>
        )}

        <FormField label="Leave Carried Forward" required hint="When set to Yes, any unused leave balance at the end of a period is rolled over into the next period instead of being forfeited.">
          <select name="leaveCarriedForward" value={formData.leaveCarriedForward} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        <FormField label="Percentage of Leave Carried Forward" required hint="The portion of the unused balance that is carried forward. E.g. 50 means only half of unused days roll over. Set to 100 to carry the full balance.">
          <input type="number" name="percentageCarriedForward" value={formData.percentageCarriedForward} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Maximum Carried Forward Amount" required hint="A cap on how many days can be carried forward regardless of the percentage. Set to 0 to apply no cap.">
          <input type="number" name="maxCarriedForwardAmount" value={formData.maxCarriedForwardAmount} onChange={handleChange} className={inputClass} />
        </FormField>

        <FormField label="Carried Forward Leave Availability Period" required hint="How long the carried-forward days remain available before they expire. After this window, any unspent carried-forward balance is forfeited.">
          <select name="carriedForwardAvailability" value={formData.carriedForwardAvailability} onChange={handleChange} className={inputClass}>
            <option value="1 Month">1 Month</option>
            <option value="3 Months">3 Months</option>
            <option value="6 Months">6 Months</option>
            <option value="1 Year">1 Year</option>
          </select>
        </FormField>

        <FormField label="Proportionate leaves on Joined Date" required hint="When set to Yes, a new joiner's entitlement is reduced based on how much of the period remains. Formula: (months remaining from hire date ÷ total period months) × full allocation, rounded to the nearest whole day. Only applies if the employee's hire date falls within the active leave period.">
          <select name="proportionateOnJoined" value={formData.proportionateOnJoined} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        <FormField label="Send Notification Emails" required hint="When set to Yes, email notifications are sent to the employee and their supervisor when a leave application is submitted, approved, or rejected.">
          <select name="sendNotificationEmails" value={formData.sendNotificationEmails} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        <FormField label="Gender Restriction" required hint="Restrict this leave type to a specific gender, e.g. Paternity Leave for males or Maternity Leave for females. Select 'All' to make it available to everyone. Genders are managed in the GEN code value list.">
          <select name="gender" value={formData.gender} onChange={handleChange} className={inputClass}>
            <option value="All">All (No Restriction)</option>
            {genders.map((g: any) => (
              <option key={g.id} value={String(g.label ?? '').charAt(0).toUpperCase()}>
                {g.label} Only
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Leave Allowance" required hint="When set to Yes, employees taking this leave type will receive a leave allowance payout based on the configured allowance settings. The amount is calculated from the employee's salary grade.">
          <select name="leaveAllowance" value={formData.leaveAllowance} onChange={handleChange} className={inputClass}>{YES_NO}</select>
        </FormField>

        {formData.leaveAllowance === 'Yes' && (
          <FormField label="Allowance Frequency" required hint="'Every Application' pays the allowance each time a leave of this type is approved. 'Once Per Leave Period' pays it only on the first approved application in each leave period — subsequent applications in the same period will not trigger another payout.">
            <select name="leaveAllowanceOnce" value={formData.leaveAllowanceOnce} onChange={handleChange} className={inputClass}>
              <option value="No">Every Application</option>
              <option value="Yes">Once Per Leave Period</option>
            </select>
          </FormField>
        )}

        <FormField label="Leave Group" hint="Assign this leave type to one or more groups for organisational purposes, e.g. Statutory Leaves, Paid Leaves. Optional.">
          <MultiSearchSelect
            options={leaveGroups.map((g: any) => ({ id: String(g.id), label: g.name }))}
            value={Array.isArray(formData.leaveGroups) ? formData.leaveGroups.map(String) : []}
            onChange={(vals) => setFormData((prev: any) => ({ ...prev, leaveGroups: vals }))}
            placeholder="Select leave groups…"
          />

        </FormField>

        <FormField label="Leave Color" required hint="A colour used to identify this leave type on calendars and reports. Click the colour swatch to open the colour picker.">
          <div className="flex gap-2">
            <input type="color" name="leaveColor" value={formData.leaveColor} onChange={handleChange} className="w-12 h-11 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg cursor-pointer" />
            <input type="text" value={formData.leaveColor} onChange={(e) => setFormData((prev) => ({ ...prev, leaveColor: e.target.value }))} className={inputClass} />
          </div>
        </FormField>
      </div>
    </FormModal>
  );
}
