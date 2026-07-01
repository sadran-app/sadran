import { useState } from 'react';
import { api } from '../lib/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email.trim(), password);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-ink via-slate-800 to-slate-900" />
      <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-brand/25 blur-3xl" />
      <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-teal-500/15 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center shadow-pop">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
              <rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white">סַדְרָן</h1>
          <p className="text-slate-300 mt-1 text-sm">ניהול סידור משמרות · כניסת מנהל</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-pop p-6 space-y-4">
          <label className="block">
            <span className="block text-sm text-slate-600 mb-1.5">אימייל</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input text-right" dir="ltr" required />
          </label>
          <label className="block">
            <span className="block text-sm text-slate-600 mb-1.5">סיסמה</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" required />
          </label>
          {error && <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}
          <button type="submit" disabled={busy} className="btn-accent w-full py-2.5 text-base">
            {busy ? 'מתחבר…' : 'התחברות'}
          </button>
          <p className="text-xs text-slate-400 text-center pt-1">אין לך חשבון? פנה אלינו לפתיחת חשבון לעסק שלך.</p>
        </form>
      </div>
    </div>
  );
}
