import { useState, useEffect } from 'react';

export const ALL_MODULE_IDS = [
  'Employees', 'LeaveManagement', 'Payroll', 'Insights',
  'Company', 'Recruitment', 'Documents', 'Admin',
  'Medical', 'Performance',
  'Training', 'Attendance',
];

let _enabled: string[] = [...ALL_MODULE_IDS];
const _listeners = new Set<() => void>();

function _notify() { _listeners.forEach(fn => fn()); }
function _getDisabled() { return ALL_MODULE_IDS.filter(id => !_enabled.includes(id)); }

export const moduleStore = {
  /** Called once on app load with the server's disabled list. */
  init(disabledIds: string[]) {
    _enabled = ALL_MODULE_IDS.filter(id => !disabledIds.includes(id));
    _notify();
  },
  getEnabled:   ()           => _enabled,
  getDisabled:  ()           => _getDisabled(),
  isEnabled:    (id: string) => _enabled.includes(id),
  toggle(id: string) {
    _enabled = _enabled.includes(id)
      ? _enabled.filter(m => m !== id)
      : [..._enabled, id];
    _notify();
    return _getDisabled();
  },
  toggleAll() {
    _enabled = _enabled.length === ALL_MODULE_IDS.length ? [] : [...ALL_MODULE_IDS];
    _notify();
    return _getDisabled();
  },
  subscribe(fn: () => void) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};

export function useEnabledModules() {
  const [enabled, setEnabled] = useState(_enabled);
  useEffect(() => {
    // Re-sync on subscribe: the store may have changed between the initial render and this effect
    // running (e.g. the post-login /settings/modules fetch resolved in that window). Reading the
    // latest value here — and then subscribing — prevents the sidebar from getting stuck on the
    // default "all enabled" state until a manual page refresh.
    setEnabled([..._enabled]);
    return moduleStore.subscribe(() => setEnabled([..._enabled]));
  }, []);
  return { enabled };
}
