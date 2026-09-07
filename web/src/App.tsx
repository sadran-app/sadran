import { useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, SUPPORT_EMAIL, type Config } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { SchedulePage } from './pages/SchedulePage';
import { SwapsPage } from './pages/SwapsPage';
import { ReportsPage } from './pages/ReportsPage';
import { HistoryPage } from './pages/HistoryPage';
import { MonitorPage } from './pages/MonitorPage';
import { ChatWidget } from './pages/ChatPage';
import { CopilotWidget } from './pages/CopilotPage';
import { AdminPage } from './pages/AdminPage';
import { DashboardPage } from './pages/DashboardPage';
import { RequestsPage } from './pages/RequestsPage';
import { PageSkeleton, Spinner } from './components/ui';

type Tab = 'home' | 'schedule' | 'availability' | 'requests' | 'monitor' | 'history' | 'reports' | 'settings' | 'swaps';
type HallModule = 'staff' | 'calendar' | 'seating' | 'rsvp'; // event-hall top-level modules

const I = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
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
  monitor: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M3 12h4l2-7 4 14 2-7h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  requests: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
      <path d="M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
} satisfies Record<Tab, ReactNode>;

const TABS: { key: Tab; label: string }[] = [
  { key: 'home', label: 'בית' },
  { key: 'schedule', label: 'סידור' },
  { key: 'availability', label: 'עובדים' },
  { key: 'requests', label: 'בקשות' },
  { key: 'monitor', label: 'מעקב' },
  { key: 'history', label: 'היסטוריה' },
  { key: 'reports', label: 'דוחות' },
  { key: 'settings', label: 'הגדרות' },
  { key: 'swaps', label: 'החלפות' },
];

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [hallModule, setHallModule] = useState<HallModule>('staff');
  const [config, setConfig] = useState<Config | null>(null);
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const loadConfig = () => api.getConfig().then(setConfig).catch((e) => setError(e.message));

  useEffect(() => {
    const onUnauth = () => { setAuthed(false); setConfig(null); setIsAdmin(null); };
    const onBlocked = (e: Event) => setBlocked((e as CustomEvent).detail || 'החשבון אינו פעיל');
    window.addEventListener('sadran-unauth', onUnauth);
    window.addEventListener('sadran-blocked', onBlocked as EventListener);
    return () => {
      window.removeEventListener('sadran-unauth', onUnauth);
      window.removeEventListener('sadran-blocked', onBlocked as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!authed) { setIsAdmin(null); return; }
    api.me().then((r) => {
      setIsAdmin(r.isAdmin);
      setOrgName(r.org?.name ?? '');
      if (!r.isAdmin) loadConfig();
    }).catch(() => {
      // never hang on the loading screen — restore admin session or drop to login
      const t = sessionStorage.getItem('sadran_admin_token');
      if (t) { sessionStorage.removeItem('sadran_admin_token'); setToken(t); window.location.reload(); }
      else { api.logout(); setAuthed(false); setIsAdmin(null); }
    });
  }, [authed]);

  const logout = () => { api.logout(); sessionStorage.removeItem('sadran_admin_token'); setAuthed(false); setConfig(null); setIsAdmin(null); setBlocked(null); };

  const impersonating = typeof window !== 'undefined' && !!sessionStorage.getItem('sadran_admin_token');
  const returnToAdmin = () => {
    const t = sessionStorage.getItem('sadran_admin_token');
    sessionStorage.removeItem('sadran_admin_token');
    if (t) setToken(t);
    window.location.reload();
  };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;
  if (blocked) return <BlockedScreen message={blocked} onLogout={logout} />;
  if (isAdmin === null) return <Spinner />;

  if (isAdmin) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 glass border-b border-black/[0.06]">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ink to-slate-700 text-white flex items-center justify-center shadow-sm font-display font-extrabold">ס</div>
              <div className="leading-tight">
                <div className="font-display font-extrabold text-ink text-lg">סַדְרָן</div>
                <div className="text-[11px] text-brand -mt-0.5 font-semibold">ניהול-על</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm text-slate-400 hover:text-slate-700 transition">עזרה</a>
              <button onClick={logout} className="text-sm text-slate-400 hover:text-slate-700 transition">יציאה</button>
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6 animate-fade-in">
          <AdminPage />
        </main>
      </div>
    );
  }

  const schedulingApp = (
    <div className="min-h-screen">
      {impersonating && (
        <div className="bg-amber-500 text-white text-sm px-4 py-2 flex items-center justify-between">
          <span>מחובר כעסק לצורך תמיכה{orgName ? ` — ${orgName}` : ''}</span>
          <button onClick={returnToAdmin} className="underline font-medium">חזרה לניהול-על ↩</button>
        </div>
      )}
      <header className="sticky top-0 z-20 glass ledger border-b border-black/[0.07]">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 h-16 flex items-center gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl badge-3d text-white flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
              </svg>
            </div>
            <div className="leading-tight hidden md:block">
              <div className="font-display font-extrabold text-ink text-[19px] tracking-tight">סַדְרָן</div>
              {orgName ? <div className="text-[11px] text-pine font-semibold -mt-0.5 truncate max-w-[130px]">{orgName}</div> : <div className="text-[10px] text-brass font-semibold -mt-0.5 tracking-wide">ניהול משמרות</div>}
            </div>
          </div>

          <nav className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-2.5 lg:px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
                  tab === t.key ? 'bg-ink text-white shadow-sm' : 'text-slate-500 hover:bg-black/[0.05] hover:text-ink'
                }`}
              >
                {I[t.key]}
                <span className="hidden lg:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-0.5 shrink-0 pr-1 border-r border-black/[0.06]">
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('עזרה — סַדְרָן')}`} title="עזרה / תמיכה" className="p-2 rounded-xl text-slate-400 hover:bg-black/[0.05] hover:text-ink transition">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
                <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3M12 17h.01" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <button onClick={logout} title="יציאה" className="p-2 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 transition">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
                <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M15 12H5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-700 px-4 py-2.5 text-sm">{error}</div>}
        <div key={tab} className="animate-fade-in">
          {tab === 'reports' ? (
            <ReportsPage />
          ) : tab === 'monitor' ? (
            <MonitorPage />
          ) : !config ? (
            <PageSkeleton />
          ) : tab === 'home' ? (
            <DashboardPage config={config} onNavigate={setTab} />
          ) : tab === 'settings' ? (
            <SettingsPage config={config} onSaved={loadConfig} />
          ) : tab === 'availability' ? (
            <AvailabilityPage config={config} />
          ) : tab === 'requests' ? (
            <RequestsPage />
          ) : tab === 'history' ? (
            <HistoryPage config={config} />
          ) : tab === 'schedule' ? (
            <SchedulePage config={config} />
          ) : (
            <SwapsPage config={config} />
          )}
        </div>
      </main>
      <CopilotWidget />
      <ChatWidget />
    </div>
  );

  // Restaurants see the scheduling app directly. Event halls get a 3-module shell:
  // staff scheduling (the app above) + guest seating + RSVP (placeholders for now).
  const isHall = config?.org.businessType === 'eventHall';
  if (!isHall) return schedulingApp;
  return (
    <div className="min-h-screen bg-slate-50">
      {impersonating && (
        <div className="bg-amber-500 text-white text-sm px-4 py-2 flex items-center justify-between">
          <span>מחובר כעסק לצורך תמיכה{orgName ? ` — ${orgName}` : ''}</span>
          <button onClick={returnToAdmin} className="underline font-medium">חזרה לניהול-על ↩</button>
        </div>
      )}
      <HallTopBar active={hallModule} onChange={setHallModule} orgName={orgName} onLogout={logout} />
      {hallModule === 'staff' ? schedulingApp : <HallPlaceholder module={hallModule} />}
    </div>
  );
}

function HallTopBar({ active, onChange, orgName, onLogout }: { active: HallModule; onChange: (m: HallModule) => void; orgName: string; onLogout: () => void }) {
  const modules: { key: HallModule; label: string }[] = [
    { key: 'calendar', label: 'יומן אירועים' },
    { key: 'staff', label: 'סידור עובדים' },
    { key: 'seating', label: 'הושבת אורחים' },
    { key: 'rsvp', label: 'אישורי הגעה' },
  ];
  return (
    <div className="bg-ink text-white sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand/90 flex items-center justify-center font-bold shrink-0">ס</div>
          <div className="leading-tight truncate">
            <div className="font-bold text-sm">סַדְרָן <span className="text-[10px] text-brand-light opacity-80">· אולם אירועים</span></div>
            {orgName && <div className="text-[10px] text-slate-300 -mt-0.5 truncate">{orgName}</div>}
          </div>
        </div>
        <nav className="flex items-center gap-1">
          {modules.map((m) => (
            <button key={m.key} onClick={() => onChange(m.key)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${active === m.key ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
              {m.label}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} title="יציאה" className="p-2 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white transition shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M15 12H5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
    </div>
  );
}

function HallPlaceholder({ module }: { module: HallModule }) {
  const INFO: Record<string, { title: string; desc: string }> = {
    calendar: { title: 'יומן אירועים', desc: 'ניהול כל אירועי האולם במקום אחד — תאריכים תפוסים ופנויים, מניעת דאבל-בוקינג, ופרטי כל אירוע. בפיתוח.' },
    seating: { title: 'הושבת אורחים', desc: 'שיבוץ חכם של אורחים לשולחנות — משפחות וחברים יחד, לפי קיבולת השולחן והעדפות. אלגוריתם ההושבה בפיתוח.' },
    rsvp: { title: 'אישורי הגעה', desc: 'שליחת הזמנות וקבלת אישורי הגעה מהאורחים ישירות בוואטסאפ — כולל ספירת מגיעים אוטומטית. בפיתוח.' },
  };
  const info = INFO[module] ?? INFO.rsvp!;
  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center animate-fade-in">
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-brand/10 text-brand flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-8 h-8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </div>
      <h1 className="text-2xl font-bold text-ink">{info.title}</h1>
      <p className="text-slate-500 mt-2 leading-relaxed">{info.desc}</p>
      <div className="inline-block mt-5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1">בקרוב</div>
    </div>
  );
}

function BlockedScreen({ message, onLogout }: { message: string; onLogout: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-pop p-7 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-7 h-7">
            <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-ink">{message}</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">לחידוש המנוי או בירור, נשמח לעזור:</p>
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('חידוש מנוי / חשבון חסום — סַדְרָן')}`}
          dir="ltr"
          className="inline-flex items-center gap-2 mt-2 text-brand font-medium hover:text-brand-dark transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {SUPPORT_EMAIL}
        </a>
        <button onClick={onLogout} className="btn-soft w-full mt-6">חזרה למסך הכניסה</button>
      </div>
    </div>
  );
}
