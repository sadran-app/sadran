import { useEffect, useState } from 'react';
import { api, type Config, type Dashboard } from '../lib/api';

type Tab = 'home' | 'schedule' | 'availability' | 'requests' | 'monitor' | 'history' | 'reports' | 'settings' | 'swaps';

const ils = (n: number) => n.toLocaleString('he-IL');
const STEPS: { key: Dashboard['cycle']['status']; label: string }[] = [
  { key: 'collecting', label: 'איסוף זמינות' },
  { key: 'proposed', label: 'טיוטת סידור' },
  { key: 'published', label: 'פורסם' },
];

export function DashboardPage({ config, onNavigate }: { config: Config; onNavigate: (tab: Tab) => void }) {
  const [d, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDashboard().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-4 py-2.5 text-sm">{error}</div>;
  if (!d) return <DashboardSkeleton />;

  const stepIdx = STEPS.findIndex((s) => s.key === d.cycle.status);
  const week = new Date(d.cycle.weekStartDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  const nothingPending = d.counts.forced === 0 && d.counts.openSwaps === 0 && d.counts.pendingAvailability === 0 && d.counts.gaps === 0;

  return (
    <div className="space-y-5">
      {/* editorial hero — ledger texture + eyebrow */}
      <div className="relative overflow-hidden rounded-3xl bg-white border border-black/[0.06] floating ledger px-5 sm:px-7 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="eyebrow">לוח בקרה · שבוע {week}</span>
            <h2 className="text-2xl sm:text-[28px] font-display font-extrabold text-ink mt-2 leading-none">שלום{config.org.name ? `, ${config.org.name}` : ''}</h2>
            <p className="text-sm text-slate-500 mt-1.5">כל מה שדורש את תשומת ליבך השבוע — במקום אחד.</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {STEPS.map((s, i) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className={`px-3 py-1.5 rounded-full font-semibold transition ${i === stepIdx ? 'bg-brand text-white shadow-glow' : i < stepIdx ? 'bg-pine-light text-pine' : 'bg-black/[0.05] text-slate-400'}`}>{s.label}</span>
                {i < STEPS.length - 1 && <span className="text-slate-300">←</span>}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="כיסוי השבוע" value={`${d.coverage.coveragePct}%`} tone={d.coverage.coveragePct >= 90 ? 'good' : d.coverage.coveragePct >= 70 ? 'warn' : 'bad'} onClick={() => onNavigate('schedule')} />
        <Kpi label="משבצות ללא איוש" value={String(d.counts.gaps)} tone={d.counts.gaps > 0 ? 'bad' : 'good'} onClick={() => onNavigate('schedule')} />
        <Kpi label="כפייה לאישור" value={String(d.counts.forced)} tone={d.counts.forced > 0 ? 'warn' : 'good'} onClick={() => onNavigate('schedule')} />
        <Kpi label="הזינו זמינות" value={`${d.availability.responded}/${d.availability.total}`} tone={d.counts.pendingAvailability > 0 ? 'warn' : 'good'} onClick={() => onNavigate('monitor')} />
        <Kpi label="החלפות פתוחות" value={String(d.counts.openSwaps)} tone={d.counts.openSwaps > 0 ? 'warn' : 'neutral'} onClick={() => onNavigate('swaps')} />
        <Kpi label="עלות שכר (טיוטה)" value={`₪${ils(d.labor.cost)}`} sub={`${d.labor.hours} ש׳`} tone="neutral" onClick={() => onNavigate('reports')} />
      </div>

      {/* approvals / attention center */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-lg bg-brand-light text-brand-dark flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="w-4 h-4"><path d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <h3 className="font-semibold text-ink">דורש תשומת לב</h3>
        </div>

        {nothingPending ? (
          <div className="text-center py-8 text-slate-400">
            <div className="text-3xl mb-1">🎉</div>
            <p className="text-sm">הכל תחת שליטה — אין פעולות ממתינות לשבוע זה.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {d.counts.gaps > 0 && (
              <AttnRow tone="bad" title={`${d.counts.gaps} משבצות ללא איוש חוקי`} desc="חסרים עובדים לכיסוי מלא של הסידור." action="לפתרון בלוח" onClick={() => onNavigate('schedule')} />
            )}
            {d.forced.length > 0 && (
              <AttnRow tone="warn" title={`${d.forced.length} שיבוצים בכפייה — דורשים אישור`} desc={d.forced.slice(0, 3).map((f) => `${f.employeeName} · ${f.dayName} ${f.shiftLabel}`).join(' · ') + (d.forced.length > 3 ? ` +${d.forced.length - 3}` : '')} action="עבור ואשר" onClick={() => onNavigate('schedule')} />
            )}
            {d.swaps.length > 0 && (
              <AttnRow tone="warn" title={`${d.swaps.length} בקשות החלפה פתוחות`} desc={d.swaps.slice(0, 3).map((s) => `${s.holderName} · ${s.dayName} ${s.shiftLabel}${s.status === 'claimed' ? ' (ממתין לאישורך)' : ''}`).join(' · ')} action="לניהול החלפות" onClick={() => onNavigate('swaps')} />
            )}
            {d.availability.pending.length > 0 && (
              <AttnRow tone="info" title={`${d.availability.pending.length} עובדים טרם הזינו זמינות`} desc={d.availability.pending.slice(0, 5).join(', ') + (d.availability.pending.length > 5 ? ` +${d.availability.pending.length - 5}` : '')} action="למעקב זמינות" onClick={() => onNavigate('monitor')} />
            )}
          </div>
        )}
      </div>

      {/* quick actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onNavigate('schedule')} className="btn-primary text-sm">לעריכת הסידור ←</button>
        <button onClick={() => onNavigate('availability')} className="btn-soft text-sm">עובדים וזמינות</button>
        <button onClick={() => onNavigate('reports')} className="btn-soft text-sm">דוחות מלאים</button>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  good: 'text-emerald-700', warn: 'text-amber-600', bad: 'text-red-600', neutral: 'text-ink',
};
function Kpi({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone: keyof typeof TONE | string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group text-right card card-hover p-4">
      <div className={`text-[26px] font-display font-extrabold leading-none tnum ${TONE[tone] ?? 'text-ink'}`}>{value}</div>
      <div className="text-[12.5px] text-slate-500 mt-1.5 group-hover:text-slate-700 transition-colors">{label}{sub && <span className="text-slate-400"> · {sub}</span>}</div>
    </button>
  );
}

const ATTN: Record<string, { dot: string; border: string }> = {
  bad: { dot: 'bg-red-500', border: 'border-red-200 bg-red-50/40' },
  warn: { dot: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/40' },
  info: { dot: 'bg-sky-500', border: 'border-sky-200 bg-sky-50/40' },
};
function AttnRow({ tone, title, desc, action, onClick }: { tone: keyof typeof ATTN; title: string; desc: string; action: string; onClick: () => void }) {
  const s = ATTN[tone];
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${s.border}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${s.dot}`} />
          <span className="text-sm font-semibold text-slate-800 truncate">{title}</span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{desc}</p>
      </div>
      <button onClick={onClick} className="flex-none text-xs font-medium text-brand-dark hover:underline whitespace-nowrap">{action} ←</button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-8 w-48 bg-slate-100 rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-2xl" />)}
      </div>
      <div className="h-40 bg-slate-100 rounded-2xl" />
    </div>
  );
}
