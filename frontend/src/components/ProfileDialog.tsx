import React, { useEffect, useState } from 'react';
import { useAuth, initials } from '../auth/AuthContext';
import { authAPI, getErrorMessage } from '../services/api';
import { X, Loader2, Check } from 'lucide-react';

/** Edit display name and change password. */
export const ProfileDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!user) return null;

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    setNameMsg(null);
    try {
      updateUser(await authAPI.updateProfile(name.trim()));
      setNameMsg({ ok: true, text: 'Name updated.' });
    } catch (err) {
      setNameMsg({ ok: false, text: getErrorMessage(err, 'Could not update your name.') });
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setSavingPw(true);
    setPwMsg(null);
    try {
      await authAPI.changePassword(current, next);
      setPwMsg({ ok: true, text: 'Password changed.' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setPwMsg({ ok: false, text: getErrorMessage(err, 'Could not change your password.') });
    } finally {
      setSavingPw(false);
    }
  };

  const input = 'w-full rounded-xl border-slate-200 bg-slate-50 py-2.5 px-3.5 text-slate-800 focus:border-primary-500 focus:ring-primary-500 focus:bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Profile">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dialog-backdrop" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl dialog-panel max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold" style={{ background: user.avatar_color }}>
              {initials(user.name)}
            </div>
            <div>
              <p className="font-bold text-slate-900">{user.name}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={saveName} className="px-6 pt-6 pb-5 border-b border-slate-100">
          <label htmlFor="profile-name" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Display name</label>
          <div className="flex gap-2">
            <input id="profile-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} className={input} />
            <button type="submit" disabled={savingName || !name.trim() || name.trim() === user.name} className="px-4 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-2">
              {savingName && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </div>
          {nameMsg && <p className={`text-xs mt-2 ${nameMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{nameMsg.text}</p>}
        </form>

        <form onSubmit={savePassword} className="px-6 py-5 space-y-3">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Change password</p>
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" aria-label="Current password" className={input} />
          <input type="password" value={next} onChange={e => setNext(e.target.value)} placeholder="New password (8+ characters, letters and numbers)" autoComplete="new-password" aria-label="New password" className={input} />
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" aria-label="Confirm new password" className={input} />
          {pwMsg && (
            <p className={`text-xs flex items-center gap-1 ${pwMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
              {pwMsg.ok && <Check className="w-3.5 h-3.5" />} {pwMsg.text}
            </p>
          )}
          <button type="submit" disabled={savingPw || !current || !next || !confirm} className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2">
            {savingPw && <Loader2 className="w-4 h-4 animate-spin" />} Update password
          </button>
        </form>
      </div>
    </div>
  );
};
