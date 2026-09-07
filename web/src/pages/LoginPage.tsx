import { useState } from 'react';
import { api, SUPPORT_EMAIL } from '../lib/api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'login' | 'change'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.login(username.trim(), password);
      onLogin();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const submitChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setOk(null);
    try {
      await api.changePassword(username, current, next);
      setOk('הסיסמה שונתה. אם הוזן טלפון — נשלח אליך עדכון בוואטסאפ. התחבר/י עם הסיסמה החדשה.');
      setMode('login'); setPassword(''); setCurrent(''); setNext('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const toMode = (m: 'login' | 'change') => { setMode(m); setError(null); setOk(null); };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-[#241d19] via-[#1a1614] to-[#120f0d]" />
      <div className="absolute -top-24 -right-24 w-[28rem] h-[28rem] rounded-full bg-brand/25 blur-3xl" />
      <div className="absolute -bottom-32 -left-20 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl badge-3d text-white flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8">
              <rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-5xl font-display font-extrabold text-white tracking-tight">סַדְרָן</h1>
          <p className="text-slate-400 mt-2 text-sm">{mode === 'login' ? 'ניהול סידור משמרות · כניסת מנהל' : 'שינוי סיסמה'}</p>
        </div>

        {mode === 'login' ? (
          <form onSubmit={submit} className="bg-white rounded-2xl floating p-6 space-y-4">
            <label className="block">
              <span className="block text-sm text-slate-600 mb-1.5">שם משתמש</span>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="input text-right" dir="ltr" autoCapitalize="none" autoCorrect="off" required />
            </label>
            <label className="block">
              <span className="block text-sm text-slate-600 mb-1.5">סיסמה</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" required />
            </label>
            {ok && <div className="rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-2 text-sm">{ok}</div>}
            {error && <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-accent w-full py-2.5 text-base">{busy ? 'מתחבר…' : 'התחברות'}</button>
            <button type="button" onClick={() => toMode('change')} className="w-full text-center text-sm text-brand hover:text-brand-dark transition">שינוי סיסמה</button>
          </form>
        ) : (
          <form onSubmit={submitChange} className="bg-white rounded-2xl floating p-6 space-y-4">
            <label className="block">
              <span className="block text-sm text-slate-600 mb-1.5">שם משתמש</span>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="input text-right" dir="ltr" autoCapitalize="none" autoCorrect="off" required />
            </label>
            <label className="block">
              <span className="block text-sm text-slate-600 mb-1.5">סיסמה נוכחית</span>
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="input" required />
            </label>
            <label className="block">
              <span className="block text-sm text-slate-600 mb-1.5">סיסמה חדשה (לפחות 6 תווים)</span>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className="input" minLength={6} required />
            </label>
            {error && <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}
            <button type="submit" disabled={busy} className="btn-accent w-full py-2.5 text-base">{busy ? 'משנה…' : 'שנה סיסמה'}</button>
            <button type="button" onClick={() => toMode('login')} className="w-full text-center text-sm text-slate-500 hover:text-slate-800 transition">חזרה להתחברות</button>
          </form>
        )}

        {mode === 'login' && (
          <div className="mt-4 text-center">
            <p className="text-xs text-slate-400">אין לך חשבון?</p>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('פתיחת חשבון לסַדְרָן')}`} dir="ltr" className="inline-flex items-center gap-1.5 mt-1 text-sm font-medium text-slate-300 hover:text-white transition">
              {SUPPORT_EMAIL}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
