import { useEffect, useMemo, useState } from 'react';
import { User, ShieldCheck } from 'lucide-react';
import { FormModal } from './ui/FormModal';
import { Combobox } from './EmployeeTabs';
import api from '../../lib/api';
import { toast } from 'sonner';
import { PERMISSION_GROUPS, formatPermission as fmtPerm } from '@/lib/permissionGroups';
import { PermissionTooltip } from './ui/PermissionTooltip';

const blank = (type: string) =>
  type === 'Users'
    ? { employeeId: '', employee: '', username: '', roleId: '', status: 'Active', directPermissions: [] }
    : { roleName: '', status: 'Active', permissions: [] };

export function UserCreationForm({ onClose, initialData, onSave, type, roles = [], users = [] }: any) {
  const [formData, setFormData] = useState<any>(() => initialData ?? blank(type));
  const [employees, setEmployees] = useState<any[]>([]);
  // Map of permission name → id from the database
  const [permMap, setPermMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (type === 'Users') {
      api.get('/employees/active').then((r) => setEmployees(r.data.data ?? [])).catch(() => {});
    }
    // Load permissions to get real IDs
    api.get('/permissions').then((r) => {
      const perms: any[] = r.data.data ?? [];
      const map: Record<string, string> = {};
      perms.forEach((p) => { map[p.name] = String(p.id); });
      setPermMap(map);
    }).catch(() => {});
  }, [type]);

  useEffect(() => {
    if (initialData) {
      const normalizedStatus = (initialData.status === '1' || initialData.status === 'Active') ? 'Active' : 'Inactive';
      if (type === 'Roles') {
        const normalizedPerms = (initialData.permissions ?? []).map((p: any) => typeof p === 'object' ? p.name : p);
        setFormData({
          ...initialData,
          roleName: initialData.roleName || initialData.name || '',
          status: normalizedStatus,
          permissions: normalizedPerms,
        });
      } else {
        setFormData({
          ...initialData,
          status: normalizedStatus,
        });
      }
    } else {
      setFormData(blank(type));
    }
  }, [initialData, type]);

  // Employees that already have a user account — exclude them from the picker so a second
  // account can't be created for the same person. Keep the employee linked to the user being
  // edited so it still shows in edit mode.
  const takenEmployeeIds = useMemo(() => {
    const editingEmpId = initialData?.employeeId != null ? String(initialData.employeeId) : null;
    return new Set(
      (users as any[])
        .map((u) => (u.employeeId != null ? String(u.employeeId) : null))
        .filter((id): id is string => !!id && id !== editingEmpId)
    );
  }, [users, initialData]);

  const empOpts = employees
    .filter((e) => !takenEmployeeIds.has(String(e.id)))
    .map((e) => ({
      id: String(e.id),
      label: e.name + (e.employee_id ? ` (${e.employee_id})` : ''),
    }));

  const handleEmpChange = (id: string) => {
    const match = employees.find((e) => String(e.id) === id);
    setFormData((prev: any) => ({
      ...prev,
      employeeId: id,
      employee: match ? (match.name + (match.employee_id ? ` (${match.employee_id})` : '')) : '',
      username: match?.employee_id || prev.username,
    }));
  };

  const set = (key: string, val: any) =>
    setFormData((prev: any) => ({ ...prev, [key]: val }));

  const permKey = type === 'Users' ? 'directPermissions' : 'permissions';

  // Compute which permissions are inherited from the selected role (Users mode only)
  const roleInheritedPerms: Set<string> = useMemo(() => {
    if (type !== 'Users' || !formData.roleId) return new Set<string>();
    const selectedRole = roles.find((r: any) => String(r.id) === String(formData.roleId));
    if (!selectedRole?.permissions) return new Set<string>();
    return new Set(
      selectedRole.permissions.map((p: any) => (typeof p === 'object' ? p.name : p))
    );
  }, [type, formData.roleId, roles]);

  // Selected perms stored as permission names; on save, map to IDs
  const togglePerm = (perm: string) => {
    // Don't toggle if it's an inherited (role) permission in Users mode
    if (type === 'Users' && roleInheritedPerms.has(perm)) return;
    const list: string[] = formData[permKey] ?? [];
    set(permKey, list.includes(perm) ? list.filter((p) => p !== perm) : [...list, perm]);
  };

  const handleSave = () => {
    if (type === 'Users' && !formData.roleId) {
      toast.error('Please select a role for this user');
      return;
    }
    const data = { ...formData };
    if (type === 'Roles') {
      data.permissionsCount = (data.permissions ?? []).length;
      // Map perm names → IDs
      data.permissions = (data.permissions ?? []).map((n: string) => permMap[n] ?? n).filter(Boolean);
    } else {
      // Map direct permission names → IDs
      data.directPermissions = (data.directPermissions ?? []).map((n: string) => permMap[n] ?? n).filter(Boolean);
    }
    onSave(data);
    onClose();
  };

  // Display names of currently selected permissions
  const selectedPerms: string[] = formData[permKey] ?? [];

  return (
    <FormModal
      title={initialData ? `Edit ${type === 'Users' ? 'User' : 'Role'}` : `Add New ${type === 'Users' ? 'User' : 'Role'}`}
      subtitle={type === 'Users' ? 'Set up account access and direct permissions.' : 'Define role capabilities.'}
      onClose={onClose}
      onSave={handleSave}
      saveLabel={`Save ${type === 'Users' ? 'User' : 'Role'}`}
      maxWidth="3xl"
      scrollable
    >
      {/* ── Account Details ───────────────────────────────── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0">
            <User size={14} className="text-white" />
          </div>
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {type === 'Users' ? 'Account Details' : 'Role Details'}
          </span>
        </div>

        {type === 'Users' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Employee */}
            <div className="sm:col-span-2">
              <label className="label">Employee <span className="text-[var(--danger)]">*</span></label>
              <Combobox
                options={empOpts}
                value={formData.employeeId ?? ''}
                onChange={handleEmpChange}
                placeholder="Select employee..."
              />
            </div>

            {/* Username */}
            <div>
              <label className="label">Username <span className="text-[var(--danger)]">*</span></label>
              <input
                type="text"
                value={formData.username ?? ''}
                onChange={(e: any) => set('username', e.target.value)}
                placeholder="Auto-filled from employee ID"
              />
            </div>

            {/* Role */}
            <div>
              <label className="label">Role <span className="text-[var(--danger)]">*</span></label>
              <select value={formData.roleId ?? ''} onChange={(e: any) => set('roleId', e.target.value)}>
                <option value="">Select role</option>
                {roles.map((r: any) => (
                  <option key={r.id} value={r.id}>{r.roleName ?? r.name}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="label">Status</label>
              <div className="flex gap-2 mt-1">
                {['Active', 'Inactive'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set('status', s)}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold border transition-all"
                    style={formData.status === s
                      ? { background: s === 'Active' ? '#059669' : '#e11d48', color: '#fff', borderColor: 'transparent' }
                      : { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Role Name <span className="text-[var(--danger)]">*</span></label>
              <input
                type="text"
                value={formData.roleName ?? ''}
                onChange={(e: any) => set('roleName', e.target.value)}
                placeholder="e.g. HR Manager"
              />
            </div>
            <div>
              <label className="label">Status</label>
              <div className="flex gap-2 mt-1">
                {['Active', 'Inactive'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set('status', s)}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold border transition-all"
                    style={formData.status === s
                      ? { background: s === 'Active' ? '#059669' : '#e11d48', color: '#fff', borderColor: 'transparent' }
                      : { background: 'transparent', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Direct Permissions ────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[var(--text-primary)]">
              {type === 'Users' ? 'Direct Permissions' : 'Permissions'}
            </span>
            <span className="text-xs font-semibold" style={{ color: '#7c3aed' }}>
              ({[...new Set([...selectedPerms, ...roleInheritedPerms])].length} selected)
            </span>
          </div>
          <span className="text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border)] rounded-full px-3 py-1 bg-[var(--bg)]">
            {type === 'Users' ? 'Assigned directly to user' : 'Assigned to role'}
          </span>
        </div>

        <div className="border border-[var(--border)] rounded-xl overflow-hidden" style={{ maxHeight: 420, overflowY: 'auto' }}>
          {PERMISSION_GROUPS.map((group, gi) => {
            const groupCount = group.perms.filter(p => selectedPerms.includes(p) || roleInheritedPerms.has(p)).length;
            const allSelected = groupCount === group.perms.length;

            const selectAll = () => {
              // Only operate on non-inherited perms in this group
              const nonInherited = group.perms.filter(p => !roleInheritedPerms.has(p));
              const directInGroup = nonInherited.filter(p => selectedPerms.includes(p));
              const allDirectSelected = directInGroup.length === nonInherited.length;
              const next = allDirectSelected
                ? selectedPerms.filter(p => !nonInherited.includes(p))
                : [...new Set([...selectedPerms, ...nonInherited])];
              set(permKey, next);
            };

            return (
              <div key={group.label} className={gi > 0 ? 'border-t border-[var(--border)]' : ''}>
                {/* Group header */}
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ backgroundColor: `color-mix(in srgb, ${group.color.active} 14%, transparent)` }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: group.color.active }}>
                      {group.label}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: group.color.active, opacity: 0.75 }}>
                      {groupCount}/{group.perms.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-xs font-semibold transition-opacity hover:opacity-70"
                    style={{ color: group.color.active }}
                  >
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                {/* Chips */}
                <div className="p-3 flex flex-wrap gap-2 bg-[var(--surface)]">
                  {group.perms.map((perm) => {
                    const inherited = type === 'Users' && roleInheritedPerms.has(perm);
                    const on = selectedPerms.includes(perm) || inherited;
                    return (
                      <button
                        key={perm}
                        type="button"
                        onClick={() => togglePerm(perm)}
                        aria-disabled={inherited}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all select-none"
                        style={inherited
                          ? { backgroundColor: `color-mix(in srgb, ${group.color.active} 14%, transparent)`, borderColor: group.color.active, color: group.color.active, opacity: 0.85, cursor: 'default' }
                          : on
                            ? { backgroundColor: `color-mix(in srgb, ${group.color.active} 14%, transparent)`, borderColor: group.color.active, color: group.color.active }
                            : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }
                        }
                      >
                        <PermissionTooltip permission={perm}>
                          <span
                            className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                            style={on
                              ? { borderColor: group.color.active, backgroundColor: group.color.active }
                              : { borderColor: '#cbd5e1', backgroundColor: 'transparent' }
                            }
                          >
                            {on && <span className="w-1.5 h-1.5 rounded-full bg-white block" />}
                          </span>
                          {fmtPerm(perm)}
                          {inherited && (
                            <span className="flex items-center gap-0.5 ml-0.5 text-[10px] font-semibold" style={{ color: group.color.active }}>
                              <ShieldCheck size={10} /> Role
                            </span>
                          )}
                        </PermissionTooltip>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FormModal>
  );
}
