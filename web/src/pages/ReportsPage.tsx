import { useEffect, useState } from 'react';
import { api, type EmployeeReport, type Insight, type OrgReport, type TrendPoint } from '../lib/api';
import { PageSkeleton } from '../components/ui';

const ils = (n: number) => n.toLocaleString('he-IL');
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });

// 4.3 — payroll-ready CSV: hours + rate + gross per employee (importable to מיכפל / חילן / חשבשבת)
function exportPayroll(data: OrgReport) {
  const headers = ['מזהה עובד', 'שם', 'טלפון', 'סה"כ שעות', 'שכר לשעה', 'שכר ברוטו (₪)'];
  const rows = data.employees.filter((e) => e.hours > 0).map((e) => [e.id, e.name, e.phone, e.hours, e.hourlyRate, e.laborCost]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sadran-payroll-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// rank → badge style (gold / silver / bronze / plain)
function rankStyle(rank: number): string {
  if (rank === 1) return 'bg-amber-100 text-amber-800 border-amber-300';
  if (rank === 2) return 'bg-slate-200 text-slate-700 border-slate-300';
  if (rank === 3) return 'bg-orange-100 text-orange-800 border-orange-300';
  return 'bg-slate-100 text-slate-500 border-slate-200';
}
// bar colour by rank tier
function barColor(rank: number): string {
  if (rank === 1) return '#d97706';
  if (rank === 2) return '#64748b';
  if (rank === 3) return '#ea580c';
  return '#3b82f6';
}

function exportCsv(data: OrgReport) {
  const headers = ['דירוג', 'עובד', 'תפקידים', 'גיל', 'משמרות', 'שעות', 'ממוצע לשבוע', 'סופ"ש', 'סגירות', 'עלות שכר ₪', 'הפיל', 'כיסה', 'קטין', 'פעיל'];
  const rows = data.employees.map((e) => [
    e.rank || '', e.name, e.roleNames.join(' / '), e.age ?? '', e.shifts, e.hours, e.avgShiftsPerWeek,
    e.weekendShifts, e.closingShifts, e.laborCost, e.swapOuts, e.swapIns, e.isMinor ? 'כן' : 'לא', e.active ? 'כן' : 'לא',
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sadran-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const [data, setData] = useState<OrgReport | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => api.getReports().then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    reload();
    api.getInsights().then(setInsights).catch(() => {});
    api.getTrends().then(setTrends).catch(() => {});
  }, []);

  if (error) return <div className="rounded-md bg-red-100 text-red-800 px-4 py-2 text-sm">{error}</div>;
  if (!data) return <PageSkeleton />;

  const s = data.summary;
  const cards: { label: string; value: string; tone: string }[] = [
    { label: 'עובדים פעילים', value: String(s.activeEmployees), tone: 'text-ink' },
    { label: 'שבועות שפורסמו', value: String(s.weeks), tone: 'text-ink' },
    { label: 'סה״כ משמרות', value: String(s.totalShifts), tone: 'text-sky-700' },
    { label: 'סה״כ שעות', value: String(s.totalHours), tone: 'text-violet-700' },
    { label: 'עלות שכר', value: '₪' + ils(s.totalLaborCost), tone: 'text-emerald-700' },
    { label: 'אחוז כיסוי', value: s.coverageRate + '%', tone: s.coverageRate >= 90 ? 'text-emerald-700' : 'text-amber-600' },
    { label: 'חוסרים פתוחים', value: String(s.openGaps), tone: s.openGaps > 0 ? 'text-red-600' : 'text-emerald-700' },
    { label: 'קטינים', value: String(s.minors), tone: 'text-ink' },
    { label: 'החלפות שבוצעו', value: String(s.totalSwaps), tone: 'text-ink' },
    { label: 'ממוצע שעות לעובד', value: String(s.avgHoursPerEmployee), tone: 'text-ink' },
  ];

  const active = data.employees.filter((e) => e.active && e.shifts > 0);
  const maxShifts = Math.max(1, ...active.map((e) => e.shifts));
  const maxHours = Math.max(1, ...active.map((e) => e.hours));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">דוחות</h2>
          <p className="text-xs text-slate-400">מבוסס על סידורים <b>שפורסמו בלבד</b> — נתונים מאומתים, לא טיוטות.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportPayroll(data)} className="btn-soft text-sm flex items-center gap-1.5" title="ייצוא שעות ושכר ברוטו לתוכנת שכר">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ייצוא לשכר
          </button>
          <button onClick={() => exportCsv(data)} className="btn-soft text-sm flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            ייצוא לאקסל
          </button>
        </div>
      </div>

      {/* 4.2 — labour cost vs budget/revenue */}
      <BudgetPanel summary={s} onSaved={reload} />

      {/* 4.1 — trends over published weeks */}
      {trends.length >= 2 && <TrendsPanel trends={trends} />}

      {/* smart insights */}
      {insights.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <h3 className="font-semibold text-ink">תובנות חכמות</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((i) => <InsightCard key={i.id} insight={i} />)}
          </div>
        </div>
      )}

      {/* summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-100 shadow-soft p-4">
            <div className={`text-2xl font-bold ${c.tone}`}>{c.value}</div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* graphs */}
      {active.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BarChart title="תרומת עובדים — משמרות" rows={active} value={(e) => e.shifts} max={maxShifts} suffix="" />
          <BarChart title="תרומת עובדים — שעות" rows={active} value={(e) => e.hours} max={maxHours} suffix=" ש׳" />
          {/* 4.4 — fairness: undesirable (weekend/closing) load PER WEEK WORKED, so tenure
              doesn't distort the picture — a veteran and a new hire are compared fairly. */}
          <BarChart title="הוגנות — עומס סופ״ש/סגירה לשבוע" rows={active.filter((e) => e.undesirablePerWeek > 0)} value={(e) => e.undesirablePerWeek} max={Math.max(0.1, ...active.map((e) => e.undesirablePerWeek))} suffix="" />
        </div>
      )}

      {/* per-employee table with ranking */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
        <h2 className="text-lg font-semibold mb-3">פירוט ודירוג לפי עובד</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b text-right">
                <th className="py-2 font-medium text-center">דירוג</th>
                <th className="py-2 font-medium">עובד</th>
                <th className="py-2 font-medium">תפקידים</th>
                <th className="py-2 font-medium text-center">גיל</th>
                <th className="py-2 font-medium text-center">משמרות</th>
                <th className="py-2 font-medium text-center">שעות</th>
                <th className="py-2 font-medium text-center">ממוצע/שבוע</th>
                <th className="py-2 font-medium text-center">סופ״ש</th>
                <th className="py-2 font-medium text-center">סגירות</th>
                <th className="py-2 font-medium text-center">עלות שכר</th>
                <th className="py-2 font-medium text-center">הפיל</th>
                <th className="py-2 font-medium text-center">כיסה</th>
                <th className="py-2 font-medium text-center">אמינות</th>
                <th className="py-2 font-medium">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <tr key={e.id} className={`border-b last:border-0 ${e.active ? '' : 'opacity-50'}`}>
                  <td className="py-2 text-center">
                    {e.rank > 0 ? <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold ${rankStyle(e.rank)}`}>{e.rank}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2 font-medium text-slate-800">{e.name}</td>
                  <td className="py-2 text-slate-500">{e.roleNames.join(' · ')}</td>
                  <td className="py-2 text-center">{e.age ?? '—'}</td>
                  <td className="py-2 text-center font-semibold">{e.shifts}</td>
                  <td className="py-2 text-center">{e.hours}</td>
                  <td className="py-2 text-center">{e.avgShiftsPerWeek}</td>
                  <td className="py-2 text-center">{e.weekendShifts}</td>
                  <td className="py-2 text-center">{e.closingShifts}</td>
                  <td className="py-2 text-center">₪{ils(e.laborCost)}</td>
                  <td className="py-2 text-center">{e.swapOuts || '—'}</td>
                  <td className="py-2 text-center">{e.swapIns || '—'}</td>
                  <td className="py-2 text-center">
                    {e.shifts > 0 || e.responseRate > 0 ? (
                      <span className={`inline-block min-w-[42px] px-1.5 py-0.5 rounded-full text-xs font-semibold ${e.reliability >= 80 ? 'bg-emerald-100 text-emerald-700' : e.reliability >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{e.reliability}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1 flex-wrap">
                      {!e.active && <Tag color="slate">לא פעיל</Tag>}
                      {e.isMinor && <Tag color="amber">קטין</Tag>}
                      {e.belowMin && e.active && <Tag color="red">מתחת למינ׳</Tag>}
                      {e.optInStatus === 'pending' && <Tag color="sky">ממתין לאישור</Tag>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function BarChart({ title, rows, value, max, suffix }: { title: string; rows: EmployeeReport[]; value: (e: EmployeeReport) => number; max: number; suffix: string }) {
  const sorted = rows.slice().sort((a, b) => value(b) - value(a)).slice(0, 8);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
      <h3 className="text-sm font-semibold text-ink mb-3">{title}</h3>
      <div className="space-y-2">
        {sorted.map((e) => {
          const v = value(e);
          const w = Math.round((v / max) * 100);
          return (
            <div key={e.id} className="flex items-center gap-2">
              <span className="w-24 text-xs text-slate-600 truncate text-left" dir="rtl">{e.name}</span>
              <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
                <div className="h-full rounded-md flex items-center justify-end px-2" style={{ width: `${Math.max(w, 8)}%`, background: barColor(e.rank) }}>
                  <span className="text-[10px] text-white font-medium">{v}{suffix}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SEV: Record<Insight['severity'], { border: string; dot: string }> = {
  warning: { border: 'border-amber-200 bg-amber-50/40', dot: 'bg-amber-500' },
  info: { border: 'border-sky-200 bg-sky-50/40', dot: 'bg-sky-500' },
  positive: { border: 'border-emerald-200 bg-emerald-50/40', dot: 'bg-emerald-500' },
};
function InsightCard({ insight }: { insight: Insight }) {
  const s = SEV[insight.severity];
  return (
    <div className={`rounded-xl border p-3 ${s.border}`}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        <span className="text-sm font-medium text-slate-800">{insight.title}</span>
      </div>
      <p className="text-sm text-slate-600">{insight.detail}</p>
      {insight.tip && <p className="text-xs text-slate-500 mt-1">💡 {insight.tip}</p>}
    </div>
  );
}

function Tag({ color, children }: { color: 'slate' | 'amber' | 'red' | 'sky'; children: React.ReactNode }) {
  const map = {
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    sky: 'bg-sky-100 text-sky-700',
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${map[color]}`}>{children}</span>;
}

// 4.2 — labour cost vs manager's weekly budget, plus optional revenue for labour-% analysis.
function BudgetPanel({ summary, onSaved }: { summary: OrgReport['summary']; onSaved: () => void }) {
  const [budget, setBudget] = useState(summary.weeklyLaborBudget ? String(summary.weeklyLaborBudget) : '');
  const [revenue, setRevenue] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const cost = summary.avgWeeklyLaborCost;
  const budgetNum = summary.weeklyLaborBudget;
  const pct = budgetNum > 0 ? Math.round((cost / budgetNum) * 100) : 0;
  const over = budgetNum > 0 && cost > budgetNum;
  const save = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); setMsg(ok); onSaved(); } catch (e) { setMsg((e as Error).message); } };

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <h3 className="font-semibold text-ink">עלות עבודה מול תקציב</h3>
        {msg && <span className="text-xs text-emerald-600">{msg}</span>}
      </div>
      <p className="text-xs text-slate-500 mb-3">עלות שכר שבועית ממוצעת (מסידורים שפורסמו) מול יעד שתגדיר. אפשר גם להזין הכנסה שבועית כדי לראות שכר כאחוז מהכנסה.</p>

      {budgetNum > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span>עלות ממוצעת: <b className="text-ink">₪{ils(cost)}</b></span>
            <span className={over ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>{pct}% מהתקציב (₪{ils(budgetNum)})</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          {over && <p className="text-xs text-red-600 mt-1">חריגה של ₪{ils(cost - budgetNum)} מהתקציב השבועי.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">יעד תקציב שבועי (₪)</span>
          <div className="flex gap-2">
            <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 w-32" placeholder="0" />
            <button onClick={() => save(() => api.setLaborBudget(Number(budget) || 0), 'התקציב נשמר')} className="btn-soft text-sm">שמור</button>
          </div>
        </label>
        <label className="text-sm">
          <span className="block text-slate-600 mb-1">הכנסת השבוע הנוכחי (₪)</span>
          <div className="flex gap-2">
            <input type="number" value={revenue} onChange={(e) => setRevenue(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 w-32" placeholder="אופציונלי" />
            <button onClick={() => save(() => api.setRevenue(revenue ? Number(revenue) : null), 'ההכנסה נשמרה')} disabled={!revenue} className="btn-soft text-sm">שמור</button>
          </div>
        </label>
      </div>
    </section>
  );
}

// 4.1 — trend line charts across published weeks.
function TrendsPanel({ trends }: { trends: TrendPoint[] }) {
  const hasRev = trends.some((p) => p.laborPctOfRevenue != null);
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
      <h3 className="font-semibold text-ink mb-3">מגמות לאורך זמן · {trends.length} שבועות שפורסמו</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <LineChart title="אחוז כיסוי" points={trends} value={(p) => p.coveragePct} fmt={(n) => `${n}%`} color="#0d9488" />
        <LineChart title="עלות שכר שבועית" points={trends} value={(p) => p.laborCost} fmt={(n) => `₪${ils(n)}`} color="#7c3aed" />
        {hasRev
          ? <LineChart title="שכר כ-% מהכנסה" points={trends} value={(p) => p.laborPctOfRevenue} fmt={(n) => `${n}%`} color="#ea580c" />
          : <LineChart title="פיזור הוגנות (נמוך=הוגן)" points={trends} value={(p) => p.fairnessSpread} fmt={(n) => String(n)} color="#ea580c" />}
      </div>
    </section>
  );
}

function LineChart({ title, points, value, fmt, color }: { title: string; points: TrendPoint[]; value: (p: TrendPoint) => number | null; fmt: (n: number) => string; color: string }) {
  const W = 280, H = 84, P = 10;
  const nums = points.map(value).filter((v): v is number => v != null);
  if (nums.length < 2) return <div className="rounded-xl border border-slate-100 p-3 text-xs text-slate-400">{title}: אין מספיק נתונים</div>;
  const min = Math.min(...nums), max = Math.max(...nums), range = max - min || 1;
  const n = points.length;
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / range) * (H - 2 * P);
  const path = points.map((p, i) => { const v = value(p); return v == null ? null : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; }).filter(Boolean).join(' ');
  const last = nums[nums.length - 1]!;
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="flex items-baseline justify-between mb-1">
        <h4 className="text-xs font-semibold text-slate-600">{title}</h4>
        <span className="text-sm font-bold" style={{ color }}>{fmt(last)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => { const v = value(p); return v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.2} fill={color} />; })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
        <span>{shortDate(points[0]!.weekStartDate)}</span>
        <span>{shortDate(points[n - 1]!.weekStartDate)}</span>
      </div>
    </div>
  );
}
