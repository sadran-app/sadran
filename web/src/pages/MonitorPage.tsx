import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type MonitorData } from '../lib/api';
import { PageSkeleton } from '../components/ui';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const d = await api.monitor();
    setData(d);
    setLastRefresh(new Date());
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (live) timer.current = setInterval(() => load().catch(() => {}), 7000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [live, load]);

  const remind = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.sendAvailability();
      setMsg(r.sent > 0 ? `נשלחו ${r.sent} תזכורות בוואטסאפ.` : 'כולם כבר הגישו 🎉');
      await load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!data) return <PageSkeleton />;

  const { availability: av, issues } = data;
  const pct = av.total ? Math.round((av.submittedCount / av.total) * 100) : 0;
  const issueCount = issues.deliveryFailures.length + issues.noPhone.length + issues.optedOut.length + issues.pendingOptIn.length;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">מרכז שליטה</h2>
          <p className="text-xs text-slate-400">מעקב חי אחר הגשת זמינות ותקלות במערכת.</p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && <span className="text-[11px] text-slate-400">עודכן {fmtTime(lastRefresh.toISOString())}</span>}
          <button onClick={() => setLive((l) => !l)} className={`text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition ${live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {live ? 'לייב פעיל' : 'לייב כבוי'}
          </button>
          <button onClick={() => load()} className="text-sm px-3 py-1.5 rounded-lg bg-ink text-white hover:opacity-90">רענן</button>
        </div>
      </div>

      {msg && <div className="rounded-xl bg-ink text-white text-sm px-4 py-2.5">{msg}</div>}

      {/* availability tracking */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-ink">{av.submittedCount}/{av.total}</span>
            <span className="text-sm text-slate-500">עובדים הגישו זמינות לשבוע זה</span>
          </div>
          {av.pending.length > 0 && (
            <button onClick={remind} disabled={busy} className="btn-soft text-sm">שלח תזכורת ל-{av.pending.length} שטרם</button>
          )}
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-4">
          <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-semibold text-emerald-700 mb-2">הגישו ({av.submitted.length})</div>
            <ul className="space-y-1">
              {av.submitted.map((e) => (
                <li key={e.id} className="flex items-center justify-between text-sm bg-emerald-50/60 rounded-lg px-3 py-1.5">
                  <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{e.name}</span>
                  <span className="text-[11px] text-slate-400">{fmtTime(e.at)}</span>
                </li>
              ))}
              {av.submitted.length === 0 && <li className="text-sm text-slate-400">אף אחד עדיין.</li>}
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-700 mb-2">טרם הגישו ({av.pending.length})</div>
            <ul className="space-y-1">
              {av.pending.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-sm bg-amber-50/60 rounded-lg px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{e.name}
                </li>
              ))}
              {av.pending.length === 0 && <li className="text-sm text-emerald-600">כולם הגישו 🎉</li>}
            </ul>
          </div>
        </div>
      </div>

      {/* issues panel */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-soft p-5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold text-ink">פאנל תקלות</h3>
          <span className={`text-xs rounded-full px-2 py-0.5 ${issueCount ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{issueCount ? `${issueCount} תקלות` : 'תקין'}</span>
        </div>

        {issueCount === 0 ? (
          <p className="text-sm text-slate-400">אין תקלות — כל העובדים מחוברים ומקבלים הודעות. ✅</p>
        ) : (
          <div className="space-y-3">
            <IssueGroup title="כשל בשליחת הודעה בוואטסאפ" tone="red" items={issues.deliveryFailures.map((f) => ({ id: f.employeeId + f.at, name: f.name, note: `${fmtDateTime(f.at)} · ${f.detail}` }))} />
            <IssueGroup title="ללא מספר טלפון" tone="amber" items={issues.noPhone} />
            <IssueGroup title="ממתין לאישור וואטסאפ" tone="amber" items={issues.pendingOptIn} />
            <IssueGroup title="ביטלו קבלת הודעות" tone="slate" items={issues.optedOut} />
          </div>
        )}
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  red: 'border-red-200 bg-red-50/40',
  amber: 'border-amber-200 bg-amber-50/40',
  slate: 'border-slate-200 bg-slate-50',
};
function IssueGroup({ title, tone, items }: { title: string; tone: string; items: { id: string; name: string; note?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className={`rounded-xl border p-3 ${TONE[tone]}`}>
      <div className="text-sm font-medium text-slate-700 mb-1.5">{title} <span className="text-slate-400">({items.length})</span></div>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="text-sm">
            <span className="font-medium text-slate-700">{it.name}</span>
            {it.note && <span className="text-[11px] text-slate-500 block">{it.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
