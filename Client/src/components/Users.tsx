import { useState, useMemo, useEffect, useCallback } from 'react';
import { FileEdit, Trash2, Plus, KeyRound, ShieldOff, CheckCircle2, Lock, Eye, EyeOff, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { ConfirmAlert } from './ConfirmAlert';
import { UserCreationForm } from './UserCreationForm';
import { PageHeader } from './ui/PageHeader';
import { TabBar } from './ui/TabBar';
import { TableToolbar } from './ui/TableToolbar';
import { TablePagination } from './ui/TablePagination';
import { RowActions } from './ui/RowActions';
import { PermissionTooltip } from './ui/PermissionTooltip';
import api from '../../lib/api';
import { toast } from 'sonner';
import { useCan } from '@/hooks/useCan';
import { PERMISSION_GROUPS, formatPermission as fmtPerm } from '@/lib/permissionGroups';

const TABS = ['Users', 'Roles', 'Permissions'];

function serialize(data: any): any {
  if (Array.isArray(data)) return data.map(serialize);
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : serialize(v)])
    );
  }
  return data;
}

function parseJsonField(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

export function Users() {
  const { can } = useCan();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('Users');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewRole, setViewRole] = useState<any | null>(null);  // role whose permissions are being viewed
  // Password reset modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      const r = await api.get('/users');
      const raw = r.data.data ?? [];
      setUsers(raw.map((u: any) => ({
        ...serialize(u),
        name: u.name || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
        directPermissions: parseJsonField(u.direct_permissions),
        roles: parseJsonField(u.roles),
      })));
    } catch (e) { console.error(e); }
  }, []);

  const loadRoles = useCallback(async () => {
    try {
      const r = await api.get('/roles');
      setRoles((r.data.data ?? []).map((role: any) => ({
        ...serialize(role),
        permissionsCount: (role.permissions ?? []).length,
      })));
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadUsers(); loadRoles(); }, [loadUsers, loadRoles]);

  const filteredUsers = useMemo(
    () => users.filter((u) =>
      u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username?.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [users, searchQuery]
  );

  const filteredRoles = useMemo(
    () => roles.filter((r) => r.roleName?.toLowerCase().includes(searchQuery.toLowerCase()) || r.name?.toLowerCase().includes(searchQuery.toLowerCase())),
    [roles, searchQuery]
  );

  const handleAddClick = () => { setSelectedItem(null); setIsFormOpen(true); };
  const handleEditClick = (item: any) => {
    const firstRoleName = (item.roles ?? [])[0];
    const matchedRole = roles.find((r: any) => r.name === firstRoleName);
    setSelectedItem({ ...item, roleId: matchedRole ? String(matchedRole.id) : '' });
    setIsFormOpen(true);
  };
  const handleDeleteClick = (item: any) => { setSelectedItem(item); setIsAlertOpen(true); };

  const handleToggleStatus = async (item: any) => {
    if (activeTab === 'Users') {
      const next = item.status === '1' ? '0' : '1';
      try {
        await api.put(`/user/${item.id}/status`, { status: next });
        await loadUsers();
      } catch (e) { console.error(e); }
    } else {
      const next = item.status === '1' ? '0' : '1';
      try {
        await api.put(`/roles/${item.id}/status`, { status: next });
        await loadRoles();
      } catch (e) { console.error(e); }
    }
  };

  const handleResetPassword = (item: any) => {
    setPasswordTarget(item);
    setNewPassword('');
    setShowPassword(false);
    setPasswordError('');
    setPasswordModalOpen(true);
  };

  const handleConfirmPasswordReset = async () => {
    if (!passwordTarget) return;
    if (newPassword.trim() === '') {
      setPasswordError('Password cannot be empty');
      return;
    }
    if (newPassword.trim().length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    setPasswordLoading(true);
    setPasswordError('');
    try {
      const response = await api.put(`/${passwordTarget.id}/change-password`, { newPassword: newPassword.trim() });
      setPasswordModalOpen(false);
      setPasswordTarget(null);
      setNewPassword('');
    } catch (e: any) {
      console.error(e);
      setPasswordError(e.response?.data?.message || 'Failed to change password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSave = async (data: any) => {
    setLoading(true);
    try {
      if (activeTab === 'Users') {
        const payload = {
          employeeId:  data.employeeId,
          username:    data.username,
          status:      data.status === 'Active' ? '1' : '0',
          roles:       data.roleId ? [data.roleId] : [],
          permissions: data.directPermissions ?? [],
        };
        if (data.id) {
          await api.put(`/${data.id}`, payload);
        } else {
          await api.post('/user/register', payload);
        }
        toast.success(data.id ? 'User updated' : 'User created');
      } else {
        const payload = {
          roleName:    data.roleName,
          name:        data.roleName,
          status:      data.status === 'Active' ? '1' : '0',
          permissions: data.permissions ?? [],
        };
        if (data.id) {
          await api.put(`/roles/${data.id}`, payload);
        } else {
          await api.post('/roles', payload);
        }
        toast.success(data.id ? 'Role updated' : 'Role created');
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Save failed');
      console.error(e);
    } finally {
      setLoading(false);
      // Always refresh regardless of success/failure so table is current
      if (activeTab === 'Users') loadUsers();
      else loadRoles();
      setIsFormOpen(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedItem) return;
    try {
      if (activeTab === 'Roles') {
        await api.delete(`/roles/${selectedItem.id}`);
        await loadRoles();
      } else {
        // Users: deactivate instead of hard delete
        await api.put(`/${selectedItem.id}/deactivate`);
        await loadUsers();
      }
    } catch (e) { console.error(e); }
    setIsAlertOpen(false);
    setSelectedItem(null);
  };

  const onTabChange = (tab: string) => { setActiveTab(tab); setSearchQuery(''); };

  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => { setPage(1); }, [activeTab, searchQuery]);

  const isUsers = activeTab === 'Users';
  const isPerms = activeTab === 'Permissions';
  const filtered = isUsers ? filteredUsers : filteredRoles;
  const total = isUsers ? users.length : roles.length;
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Build a map of permissionName → [roleName, ...] for the Permissions tab
  const permRoleMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const role of roles) {
      const perms: any[] = role.permissions ?? [];
      for (const p of perms) {
        const name = typeof p === 'object' ? p.name : p;
        if (!map[name]) map[name] = [];
        map[name].push(role.roleName ?? role.name);
      }
    }
    return map;
  }, [roles]);

  return (
    <div className="p-4 sm:p-6 md:p-6 w-full max-w-[1400px] mx-auto overflow-x-hidden flex flex-col h-full relative">
      <PageHeader title="System Users & Roles" subtitle="Manage application access, mapping users to employees, and configuring role permissions." />

      <TabBar tabs={TABS} activeTab={activeTab} onChange={onTabChange}
        icons={{
          Users:       <UsersIcon size={14} />,
          Roles:       <ShieldCheck size={14} />,
          Permissions: <Lock size={14} />,
        }} />

      {/* ── Permissions tab ─────────────────────────────────────────────── */}
      {isPerms ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
          <TableToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search permissions..."
          />
          <div className="overflow-y-auto flex-1 p-4 space-y-3">
            {PERMISSION_GROUPS.map((group) => {
              const visiblePerms = searchQuery
                ? group.perms.filter(p => p.toLowerCase().includes(searchQuery.toLowerCase()) || fmtPerm(p).toLowerCase().includes(searchQuery.toLowerCase()))
                : group.perms;
              if (visiblePerms.length === 0) return null;
              const color = group.color.active;
              return (
                <div key={group.label} className="border border-[var(--border)] rounded-xl overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: color + '18' }}>
                    <ShieldCheck size={13} style={{ color }} />
                    <span className="text-[13px] font-bold" style={{ color }}>{group.label}</span>
                    <span className="text-[11px] font-semibold text-[var(--text-muted)] ml-1">{visiblePerms.length} permission{visiblePerms.length !== 1 ? 's' : ''}</span>
                  </div>
                  {/* Permission rows */}
                  <div className="divide-y divide-[var(--border)]">
                    {visiblePerms.map((perm, i) => {
                      const assignedRoles = permRoleMap[perm] ?? [];
                      return (
                        <motion.div
                          key={perm}
                          className="flex items-center justify-between px-4 py-2.5 bg-[var(--surface)] hover:bg-[var(--bg)] transition-colors"
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                        >
                          <span className="text-[13px] font-medium text-[var(--text-primary)]">
                            <PermissionTooltip permission={perm} />
                          </span>
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {assignedRoles.length === 0 ? (
                              <span className="text-[11px] text-[var(--text-muted)] italic">No roles assigned</span>
                            ) : (
                              assignedRoles.map(role => (
                                <span key={role} className="pill text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                                  style={{ backgroundColor: color + '15', borderColor: color + '40', color }}>
                                  {role}
                                </span>
                              ))
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[16px] overflow-hidden flex flex-col flex-1 max-h-min drop-shadow-sm">
        <TableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={`Search ${activeTab.toLowerCase()}...`}
          actions={
            (isUsers ? can('create_users') : can('manage_roles')) ? (
              <button onClick={handleAddClick} className="primary-btn shrink-0">
                <span className="hidden sm:inline">Add {isUsers ? 'User' : 'Role'}</span>
                <span className="sm:hidden">Add</span>
                <Plus className="w-[14px] h-[14px]" />
              </button>
            ) : undefined
          }
        />

        <div className="overflow-x-auto flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {isUsers ? (
                  <>
                    <th scope="col" className="th">Employee</th>
                    <th scope="col" className="th">Username</th>
                    <th scope="col" className="th">Role</th>
                    <th scope="col" className="th">Status</th>
                    <th scope="col" className="th">Direct Permissions</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="th">Role Name</th>
                    <th scope="col" className="th">Status</th>
                    <th scope="col" className="th">Total Permissions</th>
                  </>
                )}
                <th scope="col" className="th text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.length > 0 ? (
                paged.map((row: any, i) => (
                  <motion.tr key={row.id} className="tr group" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06 }}>
                    {isUsers ? (
                      <>
                        <td className="td font-medium text-[var(--text-primary)]">{row.name}</td>
                        <td className="td">{row.username}</td>
                        <td className="td">{row.roles?.join(', ') || '—'}</td>
                        <td className="td">
                          <span className={`pill ${row.status === '1' ? 'pill-success' : 'pill-danger'}`}>
                            {row.status === '1' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="td max-w-[260px]">
                          {row.directPermissions?.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {row.directPermissions.map((permission: string) => (
                                <span key={permission} className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                                  <PermissionTooltip permission={permission} showIcon={false} />
                                </span>
                              ))}
                            </div>
                          ) : 'None'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="td font-medium text-[var(--text-primary)]">{row.roleName ?? row.name}</td>
                        <td className="td">
                          <span className={`pill ${row.status === '1' ? 'pill-success' : 'pill-danger'}`}>
                            {row.status === '1' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="td">{row.permissionsCount} permissions granted</td>
                      </>
                    )}
                    <td className="td">
                      <div className="flex justify-end">
                        <RowActions actions={[
                          { label: 'Reset Password', icon: KeyRound, onClick: () => handleResetPassword(row), hidden: !(isUsers && can('change_user_password')) },
                          { label: 'View Permissions', icon: Eye, onClick: () => setViewRole(row), hidden: isUsers },
                          {
                            label: row.status === '1' ? 'Deactivate' : 'Activate',
                            icon: row.status === '1' ? ShieldOff : CheckCircle2,
                            onClick: () => handleToggleStatus(row),
                            danger: row.status === '1',
                            hidden: !(isUsers ? can(row.status === '1' ? 'deactivate_users' : 'activate_users') : can('manage_roles')),
                          },
                          { label: 'Edit', icon: FileEdit, onClick: () => handleEditClick(row), hidden: !(isUsers ? can('edit_users') : can('manage_roles')) },
                          { label: 'Delete', icon: Trash2, onClick: () => handleDeleteClick(row), danger: true, hidden: !(isUsers && can('deactivate_users')) },
                        ]} />
                      </div>
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={isUsers ? 6 : 4} className="td text-center py-10">
                    {loading ? 'Loading...' : filtered.length === 0 ? `No ${isUsers ? 'users' : 'roles'} found.` : 'No results on this page.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={total} filtered={filtered.length}
          page={page} pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      </div>
      )}

      {isFormOpen && (
        <UserCreationForm
          onClose={() => setIsFormOpen(false)}
          initialData={selectedItem}
          onSave={handleSave}
          type={activeTab}
          roles={roles}
          users={users}
        />
      )}

      <ConfirmAlert
        isOpen={isAlertOpen}
        title={`${isUsers ? 'Deactivate User' : 'Delete Role'}`}
        message={isUsers
          ? 'Are you sure you want to deactivate this user? They will lose access immediately.'
          : 'Are you sure you want to delete this role? This action cannot be undone.'}
        confirmText={isUsers ? 'Yes, Deactivate' : 'Yes, Delete'}
        onConfirm={handleConfirmDelete}
        onCancel={() => setIsAlertOpen(false)}
        variant="danger"
      />

      {/* ── View Role Permissions Modal ──────────────────────── */}
      {viewRole && (() => {
        const rolePerms = new Set((viewRole.permissions ?? []).map((p: any) => typeof p === 'object' ? p.name : p));
        const isInactive = viewRole.status !== '1';
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setViewRole(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-[var(--surface)] w-full max-w-2xl rounded-2xl shadow-xl z-10 flex flex-col border border-[var(--border)] overflow-hidden max-h-[85vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#7c3aed18' }}>
                    <ShieldCheck size={16} style={{ color: '#7c3aed' }} />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{viewRole.roleName ?? viewRole.name}</h3>
                    <p className="text-[11px] text-[var(--text-muted)]">{rolePerms.size} permission{rolePerms.size !== 1 ? 's' : ''} assigned</p>
                  </div>
                </div>
                <span className={`pill ${isInactive ? 'pill-danger' : 'pill-success'}`}>{isInactive ? 'Inactive' : 'Active'}</span>
              </div>

              {isInactive && (
                <div className="px-6 py-2.5 text-[12px] font-medium border-b border-[var(--border)]"
                  style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', color: 'var(--danger)' }}>
                  This role is deactivated — users with it do not receive these permissions until it is reactivated.
                </div>
              )}

              <div className="overflow-y-auto flex-1 p-4 space-y-3">
                {rolePerms.size === 0 ? (
                  <p className="text-[13px] text-[var(--text-muted)] text-center py-8">No permissions assigned to this role.</p>
                ) : (
                  PERMISSION_GROUPS.map(group => {
                    const granted = group.perms.filter(p => rolePerms.has(p));
                    if (granted.length === 0) return null;
                    const color = group.color.active;
                    return (
                      <div key={group.label} className="border border-[var(--border)] rounded-xl overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: color + '18' }}>
                          <ShieldCheck size={13} style={{ color }} />
                          <span className="text-[13px] font-bold" style={{ color }}>{group.label}</span>
                          <span className="text-[11px] font-semibold text-[var(--text-muted)] ml-1">{granted.length}</span>
                        </div>
                        <div className="p-3 flex flex-wrap gap-2 bg-[var(--surface)]">
                          {granted.map(p => (
                            <span key={p} className="text-[11px] font-medium px-2.5 py-1 rounded-full border"
                              style={{ backgroundColor: color + '12', borderColor: color + '35', color }}>
                              <PermissionTooltip permission={p} showIcon={false} />
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-6 py-4 border-t border-[var(--border)] shrink-0 flex justify-end">
                <button onClick={() => setViewRole(null)} className="secondary-btn">Close</button>
              </div>
            </motion.div>
          </div>
        );
      })()}

      {/* ── Password Reset Modal ──────────────────────── */}
      {passwordModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setPasswordModalOpen(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-[var(--surface)] w-full max-w-md rounded-2xl shadow-xl z-10 flex flex-col border border-[var(--border)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-slate-50/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                  <Lock size={18} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800 syne">Reset Password</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Set a new password for <span className="font-semibold text-slate-700">{passwordTarget?.username}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-6">
              <label className="label">New Password <span className="text-[var(--danger)]">*</span></label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                  placeholder="Enter new password (min. 6 characters)"
                  className="w-full pr-10"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmPasswordReset()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <p className="text-xs text-[var(--danger)] mt-1.5 font-medium">{passwordError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[var(--border)] bg-slate-50/50 flex justify-end gap-3 shrink-0">
              <button onClick={() => setPasswordModalOpen(false)} className="secondary-btn shadow-sm">
                Cancel
              </button>
              <button
                onClick={handleConfirmPasswordReset}
                disabled={passwordLoading}
                className="primary-btn shadow-sm flex items-center gap-2"
              >
                <KeyRound size={16} />
                {passwordLoading ? 'Resetting...' : 'Reset Password'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
