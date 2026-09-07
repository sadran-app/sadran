import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, type Business, type CreatedBusiness, type NewBusinessBranch, type WaUsageDetail } from '../lib/api';

const KIND_LABEL: Record<string, string> = {
  availability_request: 'בקשות זמינות',
  schedule: 'שליחת סידור',
  open_shift: 'משמרות פתוחות',
  notify: 'הודעות / צ׳אט',
};
const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

const MONTHS = [
  { v: 1, l: 'חודש' },
  { v: 3, l: '3 חודשים' },
  { v: 6, l: 'חצי שנה' },
  { v: 12, l: 'שנה' },
  { v: 24, l: 'שנתיים' },
  { v: 0, l: 'ללא הגבלה' },
];

const ilDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const ils = (n: number) => n.toLocaleString('he-IL');

const STATUS: Record<Business['status'], { label: string; dot: string; cls: string }> = {
  active: { label: 'פעיל', dot: 'bg-emerald-500', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  suspended: { label: 'מושהה', dot: 'bg-amber-500', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  expired: { label: 'פג תוקף', dot: 'bg-red-500', cls: 'bg-red-50 text-red-700 border-red-200' },
};

type SortKey = 'name' | 'newest' | 'employees' | 'expiry';
type TypeFilter = 'all' | 'single' | 'chain';

// ---- tiny inline icons (stroke inherits currentColor) ----
const Svg = (p: { d: string; className?: string; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={p.fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className ?? 'w-[18px] h-[18px]'}>
    <path d={p.d} />
  </svg>
);
const IC = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5.5a3 3 0 0 1 0 5.8M18.5 20a6 6 0 0 0-3.5-5.4',
  chat: 'M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10M15 9.5a2.5 2.5 0 0 0-3-1c-1.5.4-1.7 2.3 0 2.8 1.7.5 2 2.4.3 2.9a2.5 2.5 0 0 1-3-1',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  enter: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  key: 'M15 7a4 4 0 1 1-3.5 6l-5.5 5.5H4v-2.5l5.5-5.5A4 4 0 0 1 15 7z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.4 2h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z',
};

export function AdminPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState<Business | null>(null);
  const [manage, setManage] = useState<Business | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.listBusinesses().then(setBusinesses).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // branches indexed by parent — built once per data change
  const branchMap = useMemo(() => {
    const m = new Map<string, Business[]>();
    for (const b of businesses) {
      if (!b.parentId) continue;
      const arr = m.get(b.parentId);
      if (arr) arr.push(b); else m.set(b.parentId, [b]);
    }
    return m;
  }, [businesses]);

  const summary = useMemo(() => {
    const operating = businesses.filter((b) => !b.isChain);
    return {
      count: operating.length,
      employees: operating.reduce((s, b) => s + b.employees, 0),
      billable: operating.reduce((s, b) => s + b.waBillableThisMonth, 0),
      overBudget: operating.filter((b) => b.waBillableThisMonth > b.waMonthlyBudget).length,
      mrr: businesses.filter((b) => b.status === 'active' && !b.parentId).reduce((s, b) => s + b.monthlyPrice, 0),
      expiring: operating.filter((b) => b.daysLeft !== null && b.daysLeft <= 7 && b.status !== 'expired').length,
      suspended: businesses.filter((b) => b.status === 'suspended').length,
    };
  }, [businesses]);

  const tops = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = businesses.filter((b) => !b.parentId);
    if (typeFilter === 'single') list = list.filter((b) => !b.isChain);
    else if (typeFilter === 'chain') list = list.filter((b) => b.isChain);
    if (term) {
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(term) ||
          b.username.toLowerCase().includes(term) ||
          (b.planName ?? '').toLowerCase().includes(term) ||
          (branchMap.get(b.id) ?? []).some((br) => br.name.toLowerCase().includes(term)),
      );
    }
    const cmp: Record<SortKey, (a: Business, b: Business) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, 'he'),
      newest: (a, b) => new Date(b.subscriptionStart).getTime() - new Date(a.subscriptionStart).getTime(),
      employees: (a, b) => aggEmployees(b, branchMap) - aggEmployees(a, branchMap),
      expiry: (a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9),
    };
    return [...list].sort(cmp[sort]);
  }, [businesses, q, sort, typeFilter, branchMap]);

  const enterAs = useCallback(async (b: Business) => {
    const adminTok = getToken();
    const r = await api.impersonateBusiness(b.id);
    if (adminTok) sessionStorage.setItem('sadran_admin_token', adminTok);
    setToken(r.token);
    window.location.reload();
  }, []);

  return (
    <div className="space-y-6">
      {/* summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard icon={IC.users} tint="indigo" label="עסקים פעילים" value={summary.count} sub={summary.suspended ? `${summary.suspended} מושהים` : undefined} />
        <SummaryCard icon={IC.users} tint="emerald" label="עובדים (מקבלי הודעות)" value={ils(summary.employees)} />
        <SummaryCard icon={IC.chat} tint="sky" label="הודעות בתשלום החודש" value={ils(summary.billable)} sub={summary.overBudget ? `${summary.overBudget} עסקים מעל התקציב` : undefined} subWarn={!!summary.overBudget} />
        <SummaryCard icon={IC.coin} tint="amber" label="הכנסה חודשית" value={`₪${ils(summary.mrr)}`} sub={summary.expiring ? `${summary.expiring} מנויים פגים בקרוב` : undefined} subWarn={!!summary.expiring} />
      </div>

      {/* toolbar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><Svg d={IC.search} /></span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש לפי שם עסק, רשת, סניף או משתמש…"
            className="w-full pr-10 pl-3 py-2 rounded-xl border border-slate-200 focus:border-ink outline-none text-sm transition"
          />
        </div>

        <div className="flex bg-slate-100 rounded-xl p-0.5">
          {([['all', 'הכל'], ['single', 'יחידים'], ['chain', 'רשתות']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTypeFilter(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${typeFilter === k ? 'bg-white text-ink shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>

        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-ink">
          <option value="name">מיון: שם (א-ת)</option>
          <option value="newest">מיון: הצטרפות אחרונה</option>
          <option value="employees">מיון: הכי הרבה עובדים</option>
          <option value="expiry">מיון: מנוי פג ראשון</option>
        </select>

        <button onClick={() => setShowCreate((s) => !s)} className="btn-accent whitespace-nowrap">
          {showCreate ? 'סגור' : '+ עסק חדש'}
        </button>
      </div>

      {showCreate && <CreateBusiness onDone={() => { setShowCreate(false); load(); }} />}

      {/* list */}
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
      ) : tops.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          {q || typeFilter !== 'all' ? 'לא נמצאו עסקים תואמים.' : 'אין עדיין עסקים. לחץ "עסק חדש".'}
        </div>
      ) : (
        <div className="space-y-3">
          {tops.map((b) => (
            <div key={b.id}>
              <BusinessCard b={b} branches={branchMap.get(b.id)} onReveal={() => setReveal(b)} onManage={() => setManage(b)} onEnter={() => enterAs(b)} />
              {b.isChain && (
                <div className="mr-5 mt-2 space-y-2 border-r-2 border-slate-100 pr-4">
                  {(branchMap.get(b.id) ?? []).map((br) => (
                    <BusinessCard key={br.id} b={br} branch onReveal={() => setReveal(br)} onManage={() => setManage(br)} onEnter={() => enterAs(br)} />
                  ))}
                  {(branchMap.get(b.id) ?? []).length === 0 && <p className="text-sm text-slate-400">אין סניפים.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {reveal && <RevealModal business={reveal} onClose={() => setReveal(null)} />}
      {manage && <ManageModal business={manage} onClose={() => setManage(null)} onSaved={() => { setManage(null); load(); }} />}
    </div>
  );
}

function aggEmployees(b: Business, map: Map<string, Business[]>): number {
  if (!b.isChain) return b.employees;
  return (map.get(b.id) ?? []).reduce((s, x) => s + x.employees, 0);
}
const TINT: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  sky: 'bg-sky-50 text-sky-600',
  amber: 'bg-amber-50 text-amber-600',
};
function SummaryCard({ icon, tint, label, value, sub, subWarn }: { icon: string; tint: string; label: string; value: number | string; sub?: string; subWarn?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4 hover:shadow-pop transition">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${TINT[tint]}`}><Svg d={icon} className="w-[18px] h-[18px]" /></div>
      <div className="text-[13px] text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-ink mt-0.5">{value}</div>
      {sub && <div className={`text-[11px] mt-1 ${subWarn ? 'text-amber-600' : 'text-slate-400'}`}>{sub}</div>}
    </div>
  );
}

function initials(name: string) {
  return name.trim().slice(0, 2);
}

function BusinessCard({
  b, branch, branches, onReveal, onManage, onEnter,
}: { b: Business; branch?: boolean; branches?: Business[]; onReveal: () => void; onManage: () => void; onEnter: () => void }) {
  const isChain = b.isChain;
  const map = useMemo(() => new Map(isChain && branches ? [[b.id, branches]] : []), [b.id, branches, isChain]);
  const employees = isChain ? aggEmployees(b, map) : b.employees;
  const waBillable = isChain ? (branches ?? []).reduce((s, br) => s + br.waBillableThisMonth, 0) : b.waBillableThisMonth;
  const waBudget = isChain ? (branches ?? []).reduce((s, br) => s + br.waMonthlyBudget, 0) : b.waMonthlyBudget;
  const waPct = waBudget > 0 ? Math.min(100, Math.round((waBillable / waBudget) * 100)) : 0;
  const overBudget = waBudget > 0 && waBillable > waBudget;
  const quotaPct = b.employeeQuota > 0 ? Math.min(100, Math.round((employees / b.employeeQuota) * 100)) : 0;
  const overQuota = employees >= b.employeeQuota && b.employeeQuota > 0;
  const expSoon = b.daysLeft !== null && b.daysLeft <= 7 && b.status !== 'expired';
  const ring = b.status === 'suspended' ? 'ring-1 ring-amber-200' : b.status === 'expired' ? 'ring-1 ring-red-200' : expSoon ? 'ring-1 ring-amber-100' : '';

  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-soft hover:shadow-pop transition p-4 ${ring} ${branch ? 'bg-slate-50/60' : ''}`}>
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 ${isChain ? 'bg-gradient-to-br from-indigo-500 to-indigo-700' : branch ? 'bg-slate-400' : 'bg-gradient-to-br from-ink to-slate-700'}`}>
          {initials(b.name)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-ink truncate">{b.name}</span>
            {isChain && <Tag className="bg-indigo-50 text-indigo-700 border-indigo-200">רשת · {branches?.length ?? 0} סניפים</Tag>}
            {branch && <Tag className="bg-slate-100 text-slate-500 border-slate-200">סניף</Tag>}
            {!isChain && !branch && <Tag className="bg-slate-50 text-slate-500 border-slate-200">עסק יחיד</Tag>}
            <span className={`inline-flex items-center gap-1.5 text-[11px] rounded-full px-2 py-0.5 border ${STATUS[b.status].cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS[b.status].dot}`} />{STATUS[b.status].label}
            </span>
            {!b.whatsappEnabled && <Tag className="bg-slate-100 text-slate-400 border-slate-200">וואטסאפ כבוי</Tag>}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex gap-x-3 gap-y-0.5 flex-wrap">
            <span>משתמש: <span className="font-mono text-slate-600" dir="ltr">{b.username}</span></span>
            {b.planName && <span>תוכנית: {b.planName}</span>}
            <span>הצטרפות: {ilDate(b.subscriptionStart)}</span>
            {b.lastLoginAt && <span>כניסה אחרונה: {ilDate(b.lastLoginAt)}</span>}
          </div>
        </div>

        <div className="flex gap-1 shrink-0">
          <IconBtn title="היכנס כעסק" onClick={onEnter} d={IC.enter} solid />
          <IconBtn title="פרטי כניסה" onClick={onReveal} d={IC.key} />
          <IconBtn title="נהל מנוי" onClick={onManage} d={IC.gear} />
        </div>
      </div>

      {/* metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-slate-50">
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-400">עובדים</span>
            <span className={overQuota ? 'text-red-600 font-medium' : 'text-slate-600 font-medium'}>{employees}/{b.employeeQuota}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${overQuota ? 'bg-red-500' : quotaPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${quotaPct}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-slate-400">וואטסאפ בתשלום/חודש</span>
            <span className={overBudget ? 'text-red-600 font-medium' : 'text-slate-600 font-medium'}>{ils(waBillable)}/{ils(waBudget)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${overBudget ? 'bg-red-500' : waPct > 80 ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${waPct}%` }} />
          </div>
        </div>
        <Cell label="מנוי עד" value={b.subscriptionEnd ? ilDate(b.subscriptionEnd) : '∞'} sub={b.daysLeft !== null ? `${b.daysLeft} ימים` : undefined} warn={expSoon} />
        <Cell label="₪ לחודש" value={ils(b.monthlyPrice)} />
      </div>
    </div>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`text-[11px] rounded-full px-2 py-0.5 border ${className}`}>{children}</span>;
}
function Cell({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-sm font-semibold ${warn ? 'text-amber-600' : 'text-ink'}`}>{value}</div>
      {sub && <div className={`text-[10px] ${warn ? 'text-amber-500' : 'text-slate-400'}`}>{sub}</div>}
    </div>
  );
}
function IconBtn({ title, onClick, d, solid }: { title: string; onClick: () => void; d: string; solid?: boolean }) {
  return (
    <button title={title} onClick={onClick} className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${solid ? 'bg-ink text-white hover:opacity-90' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}>
      <Svg d={d} className="w-[17px] h-[17px]" />
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-30 px-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-pop w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 flex items-center justify-center">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RevealModal({ business, onClose }: { business: Business; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');

  const reveal = async () => {
    setBusy(true); setErr(null);
    try { setCreds(await api.revealBusiness(business.id, pw)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const copy = (label: string, v: string) => { navigator.clipboard?.writeText(v); setCopied(label); setTimeout(() => setCopied(''), 1200); };

  return (
    <Modal title={`פרטי כניסה — ${business.name}`} onClose={onClose}>
      {!creds ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">להצגת הסיסמה, אמת את סיסמת מנהל-העל שלך.</p>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="סיסמת מנהל-על" className="input" onKeyDown={(e) => e.key === 'Enter' && reveal()} autoFocus />
          {err && <div className="text-sm text-red-600">{err}</div>}
          <button onClick={reveal} disabled={busy || !pw} className="btn-primary w-full">{busy ? 'בודק…' : 'הצג פרטים'}</button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          {([['שם משתמש', creds.username], ['סיסמה', creds.password]] as const).map(([label, v]) => (
            <button key={label} onClick={() => copy(label, v)} className="w-full flex justify-between items-center bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2.5 transition text-right">
              <span className="text-slate-500">{label}</span>
              <span className="font-mono select-all flex items-center gap-2" dir="ltr">{v}<span className="text-[11px] text-slate-400">{copied === label ? 'הועתק ✓' : 'העתק'}</span></span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ManageModal({ business, onClose, onSaved }: { business: Business; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState(business.planName ?? '');
  const [quota, setQuota] = useState(business.employeeQuota);
  const [price, setPrice] = useState(business.monthlyPrice);
  const [budget, setBudget] = useState(business.waMonthlyBudget);
  const [usage, setUsage] = useState<WaUsageDetail | null>(null);
  const [wa, setWa] = useState(business.whatsappEnabled);
  const [waName, setWaName] = useState(business.waSenderName ?? '');
  const [waPhone, setWaPhone] = useState(business.waPhoneDisplay ?? '');
  const [waPic, setWaPic] = useState(business.waProfilePicUrl ?? '');
  const [extend, setExtend] = useState(1);
  const [newPw, setNewPw] = useState('');
  const [newUser, setNewUser] = useState(business.username);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.waUsage(business.id).then(setUsage).catch(() => {}); }, [business.id]);

  const act = async (fn: () => Promise<unknown>, ok = 'נשמר') => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg(ok); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };
  const saveDetails = () =>
    act(() => api.updateBusiness(business.id, { planName: plan || null, employeeQuota: quota, monthlyPrice: price, waMonthlyBudget: budget, whatsappEnabled: wa, waSenderName: waName, waPhoneDisplay: waPhone, waProfilePicUrl: waPic }));

  const overBudget = budget > 0 && !!usage && usage.billable > budget;

  return (
    <Modal title={`ניהול מנוי — ${business.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {business.status !== 'suspended' ? (
            <button onClick={() => act(() => api.updateBusiness(business.id, { status: 'suspended' }), 'הושהה')} className="text-sm px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200">השהה עסק</button>
          ) : (
            <button onClick={() => act(() => api.updateBusiness(business.id, { status: 'active' }), 'הופעל')} className="text-sm px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200">הפעל מחדש</button>
          )}
          <div className="flex items-center gap-2 mr-auto">
            <select value={extend} onChange={(e) => setExtend(Number(e.target.value))} className="input py-1.5">
              {MONTHS.filter((m) => m.v > 0).map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            <button onClick={() => act(() => api.updateBusiness(business.id, { extendMonths: extend }), 'המנוי הוארך')} className="text-sm px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 whitespace-nowrap">הארך מנוי</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Labeled label="שם תוכנית"><input value={plan} onChange={(e) => setPlan(e.target.value)} className="input" /></Labeled>
          <Labeled label="מכסת עובדים"><input type="number" value={quota} onChange={(e) => setQuota(Number(e.target.value))} className="input" /></Labeled>
          <Labeled label="₪ לחודש"><input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="input" /></Labeled>
          <Labeled label="תקציב הודעות בתשלום / חודש"><input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="input" /></Labeled>
          <label className="flex items-center gap-2 mt-6"><input type="checkbox" checked={wa} onChange={(e) => setWa(e.target.checked)} /> <span className="text-sm">וואטסאפ מופעל</span></label>
        </div>

        {usage && (
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">שימוש וואטסאפ החודש</span>
              <span className={`text-sm font-bold ${overBudget ? 'text-red-600' : 'text-slate-700'}`}>{ils(usage.billable)}/{ils(budget)} בתשלום</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden mb-2">
              <div className={`h-full rounded-full ${overBudget ? 'bg-red-500' : budget > 0 && usage.billable / budget > 0.8 ? 'bg-amber-500' : 'bg-sky-500'}`} style={{ width: `${budget > 0 ? Math.min(100, Math.round((usage.billable / budget) * 100)) : 0}%` }} />
            </div>
            <div className="text-xs text-slate-500">חינם (בתוך חלון 24ש׳): {ils(usage.free)} · סה״כ נשלחו: {ils(usage.total)}</div>
            {usage.byKind.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                {usage.byKind.map((k) => (
                  <div key={k.kind} className="flex justify-between text-[11px] text-slate-500">
                    <span>{kindLabel(k.kind)}</span>
                    <span dir="ltr">בתשלום {k.billable} · חינם {k.free}</span>
                  </div>
                ))}
              </div>
            )}
            {overBudget && <div className="mt-2 text-[11px] text-red-600">⚠ העסק חרג מתקציב ההודעות החודשי.</div>}
          </div>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">זהות שולח וואטסאפ (מספר / שם / תמונה)</summary>
          <div className="grid grid-cols-1 gap-2 mt-2">
            <Labeled label="שם השולח"><input value={waName} onChange={(e) => setWaName(e.target.value)} className="input" /></Labeled>
            <Labeled label="מספר שולח (תצוגה)"><input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} className="input" dir="ltr" /></Labeled>
            <Labeled label="קישור תמונת פרופיל"><input value={waPic} onChange={(e) => setWaPic(e.target.value)} className="input" dir="ltr" /></Labeled>
          </div>
        </details>

        <button onClick={saveDetails} disabled={busy} className="btn-primary w-full">{busy ? 'שומר…' : 'שמור פרטים'}</button>

        <div className="border-t pt-3">
          <div className="text-sm font-medium mb-2">איפוס פרטי כניסה</div>
          <div className="grid grid-cols-2 gap-2">
            <input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="שם משתמש" className="input" dir="ltr" />
            <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="סיסמה חדשה" className="input" dir="ltr" />
          </div>
          <button onClick={() => act(() => api.resetBusinessPassword(business.id, newPw, newUser), 'עודכן')} disabled={busy || newPw.length < 6} className="btn-soft w-full mt-2">אפס שם משתמש/סיסמה</button>
        </div>

        <div className="border-t pt-3 flex items-center justify-between">
          <button
            onClick={() => confirm(`למחוק את "${business.name}" וכל הנתונים? בלתי הפיך.`) && act(async () => { await api.deleteBusiness(business.id); onSaved(); }, 'נמחק')}
            className="text-sm text-red-600 hover:underline"
          >מחק עסק לצמיתות</button>
          {msg && <span className="text-sm text-emerald-600">{msg}</span>}
        </div>

        <button onClick={onSaved} className="btn-accent w-full">סגור ורענן</button>
      </div>
    </Modal>
  );
}

function CreateBusiness({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<'single' | 'chain'>('single');
  const [businessType, setBusinessType] = useState<'restaurant' | 'eventHall' | 'store'>('restaurant');
  const [f, setF] = useState({
    businessName: '', managerName: '', managerPhone: '',
    planName: '', employeeQuota: 20, waMonthlyBudget: 1000, monthlyPrice: 0, subscriptionMonths: 1, whatsappEnabled: true,
    waSenderName: '', waPhoneDisplay: '', waPhoneNumberId: '', waProfilePicUrl: '',
  });
  const [branches, setBranches] = useState<NewBusinessBranch[]>([{ name: '', managerName: '', managerPhone: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBusiness | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    setF({ ...f, [k]: v });
  };
  const setBranch = (i: number, k: keyof NewBusinessBranch, v: string) =>
    setBranches((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: k === 'employeeQuota' ? Number(v) : v } : b)));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.createBusiness({
        type, businessType,
        businessName: f.businessName.trim(), managerName: f.managerName.trim(), managerPhone: f.managerPhone.trim() || undefined,
        planName: f.planName || undefined, employeeQuota: f.employeeQuota, waMonthlyBudget: f.waMonthlyBudget, monthlyPrice: f.monthlyPrice,
        subscriptionMonths: f.subscriptionMonths, whatsappEnabled: f.whatsappEnabled,
        waSenderName: f.waSenderName || undefined, waPhoneDisplay: f.waPhoneDisplay || undefined,
        waPhoneNumberId: f.waPhoneNumberId || undefined, waProfilePicUrl: f.waProfilePicUrl || undefined,
        branches: type === 'chain' ? branches.filter((b) => b.name.trim()).map((b) => ({ ...b, name: b.name.trim() })) : undefined,
      });
      setCreated(res); // show the auto-generated credentials before closing
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (created) return <CreatedCreds created={created} sentTo={f.managerPhone.trim()} onDone={onDone} />;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 space-y-4 animate-fade-in">
      <div>
        <div className="text-sm font-medium text-slate-700 mb-1.5">סוג העסק</div>
        <div className="flex gap-2">
          {([['restaurant', 'מסעדה'], ['eventHall', 'אולם אירועים'], ['store', 'עסק / חנות']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setBusinessType(v)} className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition border ${businessType === v ? 'bg-brand text-white border-brand shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {l}
            </button>
          ))}
        </div>
        {businessType === 'eventHall' && (
          <div className="mt-1.5 text-[11px] text-slate-500">אולם אירועים מקבל 3 מודולים: סידור עובדים · הושבת אורחים · אישורי הגעה.</div>
        )}
        {businessType === 'store' && (
          <div className="mt-1.5 text-[11px] text-slate-500">עסק כללי (אופנה, קמעונאות ועוד) — סידור עובדים מלא עם תפקידים ומשמרות מותאמים לחנות.</div>
        )}
      </div>

      <div className="flex gap-2">
        {(['single', 'chain'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${type === t ? 'bg-ink text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {t === 'single' ? 'עסק יחיד' : 'רשת עם סניפים'}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-brand/5 border border-brand/20 text-slate-600 px-3 py-2 text-xs">
        שם המשתמש והסיסמה ייווצרו אוטומטית (שם המשתמש = שם המנהל). הפרטים יישלחו למנהל בוואטסאפ, ותוכל לראותם גם כאן ובכל עת דרך "פרטי כניסה".
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labeled label={type === 'chain' ? 'שם הרשת' : 'שם העסק'}><input value={f.businessName} onChange={set('businessName')} className="input" /></Labeled>
        <Labeled label="שם המנהל (= שם המשתמש)"><input value={f.managerName} onChange={set('managerName')} className="input" /></Labeled>
        <Labeled label="טלפון המנהל (לשליחת פרטי הכניסה בוואטסאפ)"><input value={f.managerPhone} onChange={set('managerPhone')} className="input" dir="ltr" placeholder="05X-XXXXXXX" /></Labeled>
        <Labeled label="שם תוכנית"><input value={f.planName} onChange={set('planName')} className="input" placeholder="בסיסי / מורחב…" /></Labeled>
        <Labeled label="מכסת עובדים (מקבלי הודעות)"><input type="number" value={f.employeeQuota} onChange={set('employeeQuota')} className="input" /></Labeled>
        <Labeled label="תקציב הודעות בתשלום / חודש"><input type="number" value={f.waMonthlyBudget} onChange={set('waMonthlyBudget')} className="input" /></Labeled>
        <Labeled label="₪ לחודש"><input type="number" value={f.monthlyPrice} onChange={set('monthlyPrice')} className="input" /></Labeled>
        <Labeled label="משך מנוי">
          <select value={f.subscriptionMonths} onChange={(e) => setF({ ...f, subscriptionMonths: Number(e.target.value) })} className="input">
            {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </Labeled>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.whatsappEnabled} onChange={(e) => setF({ ...f, whatsappEnabled: e.target.checked })} />
        אפשר שליחת הודעות וואטסאפ לעסק זה
      </label>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">זהות שולח וואטסאפ (אופציונלי)</summary>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Labeled label="שם השולח"><input value={f.waSenderName} onChange={set('waSenderName')} className="input" /></Labeled>
          <Labeled label="מספר שולח (תצוגה)"><input value={f.waPhoneDisplay} onChange={set('waPhoneDisplay')} className="input" dir="ltr" /></Labeled>
          <Labeled label="Phone Number ID"><input value={f.waPhoneNumberId} onChange={set('waPhoneNumberId')} className="input" dir="ltr" /></Labeled>
          <Labeled label="קישור תמונת פרופיל"><input value={f.waProfilePicUrl} onChange={set('waProfilePicUrl')} className="input" dir="ltr" /></Labeled>
        </div>
      </details>

      {type === 'chain' && (
        <div className="space-y-2">
          <div className="text-sm font-medium">סניפים <span className="text-xs font-normal text-slate-400">(שם משתמש וסיסמה ייווצרו לכל סניף)</span></div>
          {branches.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
              <input value={b.name} onChange={(e) => setBranch(i, 'name', e.target.value)} placeholder="שם סניף" className="input" />
              <input value={b.managerName ?? ''} onChange={(e) => setBranch(i, 'managerName', e.target.value)} placeholder="שם מנהל הסניף" className="input" />
              <input value={b.managerPhone ?? ''} onChange={(e) => setBranch(i, 'managerPhone', e.target.value)} placeholder="טלפון (וואטסאפ)" className="input" dir="ltr" />
              <button onClick={() => setBranches((bs) => bs.filter((_, idx) => idx !== i))} className="text-red-500 px-2">✕</button>
            </div>
          ))}
          <button onClick={() => setBranches((bs) => [...bs, { name: '', managerName: '', managerPhone: '' }])} className="text-sm text-slate-600 hover:underline">+ הוסף סניף</button>
        </div>
      )}

      {err && <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-sm">{err}</div>}
      <button onClick={submit} disabled={busy || !f.businessName.trim() || !f.managerName.trim()} className="btn-accent w-full">{busy ? 'פותח…' : type === 'chain' ? 'פתח רשת' : 'פתח עסק'}</button>
    </div>
  );
}

function CreatedCreds({ created, sentTo, onDone }: { created: CreatedBusiness; sentTo: string; onDone: () => void }) {
  const [copied, setCopied] = useState('');
  const copy = (key: string, text: string) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1200); };
  const Cred = ({ label, value, ck }: { label: string; value: string; ck: string }) => (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        <code className="font-mono font-bold text-ink" dir="ltr">{value}</code>
        <button onClick={() => copy(ck, value)} className="text-xs text-brand hover:underline">{copied === ck ? 'הועתק ✓' : 'העתק'}</button>
      </span>
    </div>
  );
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5 space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">✓</span>
        <h3 className="text-lg font-semibold">העסק "{created.name}" נפתח</h3>
      </div>
      <p className="text-sm text-slate-500">
        {sentTo ? `פרטי הכניסה נשלחו למנהל בוואטסאפ (${sentTo}).` : 'לא הוזן טלפון — פרטי הכניסה לא נשלחו בוואטסאפ. מסור אותם ידנית:'} שמור אותם גם כאן:
      </p>
      <div className="space-y-2">
        <Cred label="שם משתמש" value={created.username} ck="u" />
        <Cred label="סיסמה" value={created.password} ck="p" />
      </div>
      {created.branches && created.branches.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="text-sm font-medium">סניפים</div>
          {created.branches.map((b) => (
            <div key={b.id} className="rounded-lg border border-slate-200 p-2 space-y-1.5">
              <div className="text-sm font-medium">{b.name}</div>
              <Cred label="שם משתמש" value={b.username} ck={'bu' + b.id} />
              <Cred label="סיסמה" value={b.password} ck={'bp' + b.id} />
            </div>
          ))}
        </div>
      )}
      <button onClick={onDone} className="btn-accent w-full">סיום</button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
