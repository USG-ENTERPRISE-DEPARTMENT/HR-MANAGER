import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Camera, Loader2, Lock, Eye, EyeOff, Mail, Phone, Shield, IdCard, Briefcase, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { inputClass } from './ui/FormField';
import type { AppUser } from '@/types/permissions';

interface Props {
  currentUser: AppUser;
  onClose: () => void;
  onPhotoChange?: (b64: string) => void;
}

function resizeImage(file: File, maxPx = 800, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width >= height) { height = Math.round((height / width) * maxPx); width = maxPx; }
        else { width = Math.round((width / height) * maxPx); height = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function UserProfileModal({ currentUser, onClose, onPhotoChange }: Props) {
  const [emp, setEmp] = useState<any>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const empId = currentUser.employeeId;

  useEffect(() => {
    if (!empId) return;
    api.get(`/employees/${empId}`)
      .then(r => { const d = r.data?.data ?? r.data; setEmp(d); setPhoto(d?.profile_imagebase64 ?? null); })
      .catch(() => {});
  }, [empId]);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (!empId) { toast.error('No employee record linked to this account'); return; }
    setPhotoUploading(true);
    try {
      const b64 = await resizeImage(file);
      await api.put(`/employees/${empId}`, { profile_imagebase64: b64 });
      setPhoto(b64);
      onPhotoChange?.(b64);
      toast.success('Profile photo updated');
    } catch { toast.error('Failed to update photo'); }
    finally { setPhotoUploading(false); }
  };

  const changePassword = async () => {
    if (!cur || !next) { toast.error('Enter your current and new password'); return; }
    if (next.length < 6) { toast.error('New password must be at least 6 characters'); return; }
    if (next === cur) { toast.error('New password must be different from the current one'); return; }
    if (next !== confirm) { toast.error('New password and confirmation do not match'); return; }
    setSaving(true);
    try {
      await api.put(`/${currentUser.id}/change-password`, { currentPassword: cur, newPassword: next });
      toast.success('Password changed');
      setCur(''); setNext(''); setConfirm('');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Failed to change password');
    } finally { setSaving(false); }
  };

  const name = currentUser.name || `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim() || currentUser.email;
  const initials = (name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const roleName = (currentUser.role as any)?.name ?? currentUser.userType ?? '—';

  const details: { icon: any; label: string; value?: string }[] = [
    { icon: Mail,      label: 'Email',        value: currentUser.email || emp?.work_email || emp?.email },
    { icon: Phone,     label: 'Phone',        value: emp?.mobilePhone || currentUser.phone },
    { icon: Shield,    label: 'Role',         value: roleName },
    { icon: IdCard,    label: 'Employee ID',  value: emp?.employee_id },
    { icon: Briefcase, label: 'Job Title',    value: emp?.jobTitle?.label },
    { icon: Building2, label: 'Department',   value: emp?.department?.title },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative bg-[var(--surface)] border border-[var(--border)] rounded-[16px] w-full max-w-[480px] max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-[15px] font-bold text-[var(--text-primary)] syne">My Profile</h2>
          <button onClick={onClose} className="action-btn"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Identity + photo */}
          <div className="flex flex-col items-center gap-3 px-5 py-6 border-b border-[var(--border)]">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-[var(--accent-dim)] flex items-center justify-center overflow-hidden">
                {photo
                  ? <img src={photo} alt={name} className="w-full h-full object-cover" />
                  : <span className="text-[24px] font-bold text-[var(--accent)]">{initials}</span>}
              </div>
              {empId && (
                <label className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center cursor-pointer shadow-md hover:opacity-90 ${photoUploading ? 'pointer-events-none opacity-70' : ''}`}
                  title="Change photo">
                  {photoUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} disabled={photoUploading} />
                </label>
              )}
            </div>
            <div className="text-center">
              <p className="text-[16px] font-bold text-[var(--text-primary)]">{name}</p>
              <p className="text-[12px] text-[var(--text-muted)]">{roleName}</p>
            </div>
          </div>

          {/* Details */}
          <div className="px-5 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {details.filter(d => d.value).map(d => (
              <div key={d.label} className="flex items-center gap-3 min-w-0">
                <span className="w-8 h-8 rounded-lg bg-[var(--bg)] flex items-center justify-center shrink-0">
                  <d.icon size={14} className="text-[var(--text-muted)]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wide">{d.label}</p>
                  <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{d.value}</p>
                </div>
              </div>
            ))}
            {!empId && (
              <p className="col-span-2 text-[12px] text-[var(--text-muted)] italic">This account isn't linked to an employee record, so a profile photo can't be set.</p>
            )}
          </div>

          {/* Change password */}
          <div className="px-5 py-4 border-t border-[var(--border)]">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={14} className="text-[var(--accent)]" />
              <span className="text-[13px] font-bold text-[var(--text-primary)]">Change Password</span>
            </div>
            <div className="space-y-2.5">
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} className={inputClass} placeholder="Current password"
                  value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <input type={showPw ? 'text' : 'password'} className={inputClass} placeholder="New password"
                value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
              <input type={showPw ? 'text' : 'password'} className={inputClass} placeholder="Confirm new password"
                value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
              <button onClick={changePassword} disabled={saving} className="primary-btn w-full justify-center disabled:opacity-60">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                {saving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
