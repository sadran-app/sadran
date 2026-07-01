import { useEffect, useState, type ReactNode } from 'react';
import { api, getToken, type Config } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { SchedulePage } from './pages/SchedulePage';
import { SwapsPage } from './pages/SwapsPage';
import { ReportsPage } from './pages/ReportsPage';
import { HistoryPage } from './pages/HistoryPage';
import { AdminPage } from './pages/AdminPage';

type Tab = 'schedule' | 'availability' | 'history' | 'reports' | 'settings' | 'swaps';

const I = {
  schedule: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
    </svg>
  ),
  availability: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" strokeLinecap="round" /><path d="M17 11a3 3 0 1 0-2-5.2M18 20a5 5 0 0 0-4-4.9" strokeLinecap="round" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M4 20V4M20 20H4" strokeLinecap="round" /><rect x="7" y="12" width="3" height="5" rx="1" /><rect x="12" y="8" width="3" height="9" rx="1" /><rect x="17" y="5" width="3" height="12" rx="1" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M5 7h14M5 12h14M5 17h14" strokeLinecap="round" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  ),
  swaps: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M4 8h13l-3-3M20 16H7l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 4v4h4M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
} satisfies Record<Tab, ReactNode>;

const TABS: { key: Tab; label: string }[] = [
  { key: 'schedule', label: 'סידור' },
  { key: 'availability', label: 'עובדים' },
  { key: 'history', label: 'היסטוריה' },
  { key: 'reports', label: 'דוחות' },
  { key: 'settings', label: 'הגדרות' },
  { key: 'swaps', label: 'החלפות' },
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('schedule');
  const [config, setConfig] = useState<Config | null>(null);
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadConfig = () => api.getConfig().then(setConfig).catch((e) => setError(e.message));

  useEffect(() => {
    const onUnauth = () => { setAuthed(false); setConfig(null); setIsAdmin(null); };
    window.addEventListener('sadran-unauth', onUnauth);
    return () => window.removeEventListener('sadran-unauth', onUnauth);
  }, []);

  useEffect(() => {
    if (!authed) { setIsAdmin(null); return; }
    api.me().then((r) => {
      setIsAdmin(r.isAdmin);
      setOrgName(r.org?.name ?? '');
      if (!r.isAdmin) loadConfig();
    }).catch(() => {});
  }, [authed]);

  const logout = () => { api.logout(); setAuthed(false); setConfig(null); setIsAdmin(null); };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;
  if (isAdmin === null) return <div className="min-h-screen flex items-center justify-center text-slate-400">טוען…</div>;

  if (isAdmin) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-100 shadow-soft">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ink to-slate-700 text-white flex items-center justify-center shadow-sm font-bold">ס</div>
              <div className="leading-tight">
                <div className="font-bold text-ink text-lg">סַדְרָן</div>
                <div className="text-[11px] text-brand -mt-0.5 font-medium">ניהול-על</div>
              </div>
            </div>
            <button onClick={logout} className="text-sm text-slate-400 hover:text-slate-700 transition">יציאה</button>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6 animate-fade-in">
          <AdminPage />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-100 shadow-soft">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white flex items-center justify-center shadow-sm">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="font-bold text-ink text-lg">סַדְרָן</div>
              {orgName && <div className="text-[11px] text-slate-400 -mt-0.5">{orgName}</div>}
            </div>
          </div>

          <nav className="flex items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition ${
                  tab === t.key ? 'bg-ink text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {I[t.key]}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
            <button onClick={logout} title="יציאה" className="mr-1 p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M15 12H5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-700 px-4 py-2.5 text-sm">{error}</div>}
        <div key={tab} className="animate-fade-in">
          {tab === 'reports' ? (
            <ReportsPage />
          ) : !config ? (
            <div className="text-slate-400 py-10 text-center">טוען…</div>
          ) : tab === 'settings' ? (
            <SettingsPage config={config} onSaved={loadConfig} />
          ) : tab === 'availability' ? (
            <AvailabilityPage config={config} />
          ) : tab === 'history' ? (
            <HistoryPage config={config} />
          ) : tab === 'schedule' ? (
            <SchedulePage config={config} />
          ) : (
            <SwapsPage config={config} />
          )}
        </div>
      </main>
    </div>
  );
}
