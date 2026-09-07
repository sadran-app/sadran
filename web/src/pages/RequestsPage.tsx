import { useEffect, useState } from 'react';
import { api, DAY_NAMES, type Employee, type StandingRule, type TimeOff } from '../lib/api';

const TYPE_LABEL: Record<string, string> = { vacation: 'חופשה', reserve: 'מילואים', sick: 'מחלה', other: 'אחר' };
const fmtDate = (s: string) => new Date(s).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });

export function RequestsPage() {
  const [emps, setEmps] = useState<Employee[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [rules, setRules] = useState<StandingRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const [e, t, r] = await Promise.all([api.getEmployees(), api.getTimeOff(), api.getStandingRules()]);
    setEmps(e.employees.filter((x) => x.active));
    setTimeOff(t);
    setRules(r);
  };
  useEffect(() => { load().catch((err) => setMsg((err as Error).message)); }, []);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await load(); if (ok) setMsg(ok); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  };

  const empName = (id: string) => emps.find((e) => e.id === id)?.name ?? '—';
  const pendingTO = timeOff.filter((t) => t.status === 'pending');
  const pendingRules = rules.filter((r) => r.status === 'pending');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">בקשות עובדים</h2>
        <p className="text-xs text-slate-400">חופש ומילואים + כללי זמינות קבועים. בקשות מהעובד (וואטסאפ) ממתינות לאישורך.</p>
      </div>
      {msg && <div className="rounded-xl bg-ink text-white text-sm px-4 py-2.5">{msg}</div>}

      {/* pending approvals banner */}
      {(pendingTO.length > 0 || pendingRules.length > 0) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
          <div className="text-amber-800 font-semibold text-sm">{pendingTO.length + pendingRules.length} בקשות ממתינות לאישור</div>
          {pendingTO.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-sm bg-white rounded-lg px-3 py-2 border border-amber-100">
              <span><b>{empName(t.employeeId)}</b> · {TYPE_LABEL[t.type]} {t.note ? `· "${t.note}"` : ''} <span className="text-slate-400">({t.source === 'whatsapp' ? 'וואטסאפ' : 'מנהל'})</span></span>
              <span className="flex gap-2">
                <button disabled={busy} onClick={() => act(() => api.setTimeOffStatus(t.id, 'approved'), 'אושר')} className="text-emerald-600 hover:underline text-xs">אשר</button>
                <button disabled={busy} onClick={() => act(() => api.setTimeOffStatus(t.id, 'rejected'))} className="text-red-500 hover:underline text-xs">דחה</button>
              </span>
            </div>
          ))}
          {pendingRules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm bg-white rounded-lg px-3 py-2 border border-amber-100">
              <span><b>{empName(r.employeeId)}</b> · כלל קבוע: יום {DAY_NAMES[r.dayIndex]} {r.mode === 'off' ? 'לא זמין' : `${r.fromTime}–${r.toTime}`} <span className="text-slate-400">({r.source === 'whatsapp' ? 'וואטסאפ' : 'מנהל'})</span></span>
              <span className="flex gap-2">
                <button disabled={busy} onClick={() => act(() => api.setStandingRuleStatus(r.id, 'approved'), 'אושר')} className="text-emerald-600 hover:underline text-xs">אשר</button>
                <button disabled={busy} onClick={() => act(() => api.deleteStandingRule(r.id))} className="text-red-500 hover:underline text-xs">דחה</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <TimeOffSection emps={emps} rows={timeOff} busy={busy} act={act} empName={empName} />
        <StandingSection emps={emps} rows={rules} busy={busy} act={act} empName={empName} />
      </div>
    </div>
  );
}

type ActFn = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function TimeOffSection({ emps, rows, busy, act, empName }: { emps: Employee[]; rows: TimeOff[]; busy: boolean; act: ActFn; empName: (id: string) => string }) {
  const [employeeId, setEmp] = useState('');
  const [type, setType] = useState('vacation');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd] = useState('');
  const add = () => {
    if (!employeeId || !startDate || !endDate) return;
    act(() => api.createTimeOff({ employeeId, type, startDate, endDate }), 'נוסף ואושר').then(() => { setStart(''); setEnd(''); });
  };
  const approved = rows.filter((r) => r.status === 'approved');
  return (
    <section className="card p-5">
      <h3 className="font-semibold mb-1">חופש · מילואים · מחלה</h3>
      <p className="text-xs text-slate-500 mb-3">בטווח מאושר העובד לא ישובץ באותם ימים — גם לא בכפייה.</p>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <select value={employeeId} onChange={(e) => setEmp(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">בחר עובד…</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        <input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
        <button onClick={add} disabled={busy || !employeeId || !startDate || !endDate} className="btn-primary text-sm">הוסף</button>
      </div>
      {approved.length === 0 ? <p className="text-sm text-slate-400">אין חופשות מאושרות.</p> : (
        <ul className="divide-y divide-slate-100">
          {approved.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2 text-sm">
              <span><b>{empName(t.employeeId)}</b> · {TYPE_LABEL[t.type]} · {fmtDate(t.startDate)}{t.startDate !== t.endDate ? `–${fmtDate(t.endDate)}` : ''}</span>
              <button disabled={busy} onClick={() => act(() => api.deleteTimeOff(t.id))} className="text-red-500 hover:underline text-xs">מחק</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StandingSection({ emps, rows, busy, act, empName }: { emps: Employee[]; rows: StandingRule[]; busy: boolean; act: ActFn; empName: (id: string) => string }) {
  const [employeeId, setEmp] = useState('');
  const [dayIndex, setDay] = useState(5);
  const [mode, setMode] = useState<'off' | 'hours'>('off');
  const [fromTime, setFrom] = useState('09:00');
  const [toTime, setTo] = useState('15:00');
  const add = () => {
    if (!employeeId) return;
    act(() => api.createStandingRule({ employeeId, dayIndex, mode, ...(mode === 'hours' ? { fromTime, toTime } : {}) }), 'הכלל נוסף ואושר');
  };
  const approved = rows.filter((r) => r.status === 'approved');
  return (
    <section className="card p-5">
      <h3 className="font-semibold mb-1">כללי זמינות קבועים</h3>
      <p className="text-xs text-slate-500 mb-3">חלים אוטומטית על כל שבוע חדש (למשל "אף פעם לא שישי"), אלא אם העובד עדכן ידנית לאותו שבוע.</p>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <select value={employeeId} onChange={(e) => setEmp(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="">בחר עובד…</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={dayIndex} onChange={(e) => setDay(Number(e.target.value))} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as 'off' | 'hours')} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
          <option value="off">לא זמין</option>
          <option value="hours">רק בשעות</option>
        </select>
        {mode === 'hours' && (
          <>
            <input type="time" value={fromTime} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
            <input type="time" value={toTime} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </>
        )}
        <button onClick={add} disabled={busy || !employeeId} className="btn-primary text-sm">הוסף</button>
      </div>
      {approved.length === 0 ? <p className="text-sm text-slate-400">אין כללים קבועים.</p> : (
        <ul className="divide-y divide-slate-100">
          {approved.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span><b>{empName(r.employeeId)}</b> · יום {DAY_NAMES[r.dayIndex]} · {r.mode === 'off' ? 'לא זמין' : `${r.fromTime}–${r.toTime}`}</span>
              <button disabled={busy} onClick={() => act(() => api.deleteStandingRule(r.id))} className="text-red-500 hover:underline text-xs">מחק</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
