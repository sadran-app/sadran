import { useEffect, useState } from 'react';
import { api, DAY_NAMES, WEEKEND_DAYS, type Config, type DayAvailInputMode, type Employee, type NewEmployee, type OrgReport } from '../lib/api';
import { IlDate } from '../lib/ilFields';

export function AvailabilityPage({ config }: { config: Config }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [reports, setReports] = useState<OrgReport | null>(null);

  const load = () =>
    api.getEmployees().then((r) => {
      setEmployees(r.employees);
      setSelectedId((cur) => cur ?? r.employees[0]?.id ?? null);
    });
  useEffect(() => {
    load();
    api.getReports().then(setReports).catch(() => {});
  }, []);

  const roleName = Object.fromEntries(config.roles.map((r) => [r.id, r.name]));
  const selected = employees.find((e) => e.id === selectedId) ?? null;

  // live seat usage vs the plan quota set when the business was opened
  const activeCount = employees.filter((e) => e.active).length;
  const quotaFull = activeCount >= config.org.employeeQuota;

  const [curDay, setCurDay] = useState(0);

  const dayShiftsOf = (day: number) => config.shifts.filter((s) => s.dayIndex === day).sort((a, b) => a.startTime.localeCompare(b.startTime));

  type DayForm = { mode: DayAvailInputMode; fromTime: string; toTime: string };
  const [dayForm, setDayForm] = useState<Record<number, DayForm>>({});

  // (re)build the local hour-form from the employee's saved free-hours whenever that
  // saved data changes — switching employee, or after a save/reload. Editing name/rate
  // does NOT reset it: patchSelected keeps the same dayAvailability array reference.
  useEffect(() => {
    if (!selected) { setDayForm({}); return; }
    // If we have NO info for this employee yet (no WhatsApp reply, not configured),
    // every day starts "unset" — no assumption that they're available all week.
    const fallback: DayAvailInputMode = selected.hasAvailability ? 'all' : 'unset';
    const form: Record<number, DayForm> = {};
    for (let d = 0; d < 7; d++) form[d] = { mode: fallback, fromTime: '09:00', toTime: '17:00' };
    for (const da of selected.dayAvailability) {
      form[da.dayIndex] = { mode: da.mode, fromTime: da.fromTime ?? '09:00', toTime: da.toTime ?? '17:00' };
    }
    setDayForm(form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.dayAvailability, selected?.hasAvailability]);

  const df = (day: number): DayForm => dayForm[day] ?? { mode: 'unset', fromTime: '09:00', toTime: '17:00' };
  const setDay = (day: number, patch: Partial<DayForm>) => setDayForm((f) => ({ ...f, [day]: { ...df(day), ...patch } }));

  const patchSelected = (patch: Partial<Employee>) =>
    setEmployees((list) => list.map((e) => (e.id === selected?.id ? { ...e, ...patch } : e)));

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      // Save availability FIRST and on its own — this panel doesn't edit the phone,
      // so we must never let a profile-field validation (e.g. phone) block the hours.
      const days = Array.from({ length: 7 }, (_, d) => {
        const v = df(d);
        return { dayIndex: d, mode: v.mode, fromTime: v.mode === 'hours' ? v.fromTime : null, toTime: v.mode === 'hours' ? v.toTime : null };
      });
      await api.updateDayAvailability(selected.id, days);
      await api.updateEmployee(selected.id, { minShifts: selected.minShifts, maxShifts: selected.maxShifts, hourlyRate: selected.hourlyRate, employmentNotes: selected.employmentNotes ?? '', roleIds: selected.roleIds, roleLevels: selected.roleLevels, maxConsecutiveDays: selected.maxConsecutiveDays });
      await load();
      setMsg('נשמר');
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setMsg((e as Error).message || 'השמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!selected) return;
    await api.deactivateEmployee(selected.id);
    await load();
  };
  const reactivate = async () => {
    if (!selected) return;
    try {
      await api.updateEmployee(selected.id, { active: true });
      await load();
    } catch (e) {
      setMsg((e as Error).message); // e.g. blocked by the employee quota
    }
  };
  const sendSummary = async () => {
    if (!selected) return;
    try {
      await api.sendEmployeeSummary(selected.id);
      setMsg('הסיכום נשלח לעובד ✓');
      setTimeout(() => setMsg(null), 1500);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const rep = reports?.employees.find((e) => e.id === selected?.id) ?? null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
      <aside className="card p-2 h-fit">
        <button onClick={() => setAdding(true)} disabled={quotaFull} className="btn-primary w-full mb-2 disabled:opacity-50 disabled:cursor-not-allowed">+ הוסף עובד</button>
        {quotaFull && (
          <div className="mb-2 rounded-md bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1.5 text-[11px] text-center leading-snug">
            הגעת למכסת החבילה ({config.org.employeeQuota} עובדים). להגדלת החבילה, פנו אלינו.
          </div>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש עובד…"
          className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm mb-2"
        />
        <ul className="divide-y max-h-[65vh] overflow-y-auto">
          {employees
            .filter((e) => e.name.includes(search.trim()))
            .map((e) => (
            <li key={e.id}>
              <button
                onClick={() => setSelectedId(e.id)}
                className={`w-full text-right px-3 py-2 rounded-md text-sm flex items-center justify-between ${e.id === selectedId ? 'bg-slate-900 text-white' : 'hover:bg-slate-100'} ${e.active ? '' : 'opacity-50'}`}
              >
                <span className="flex items-center gap-2">
                  {e.rank > 0 && (
                    <span title={`דירוג #${e.rank} לפי תרומה`} className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${rankDot(e.rank)}`}>{e.rank}</span>
                  )}
                  <span>{e.name}</span>
                </span>
                <span className="flex gap-1 items-center">
                  {e.active && !e.hasAvailability && <span title="טרם התקבלה זמינות" className="text-xs opacity-70">⏳</span>}
                  {e.isMinor && <span className="text-xs opacity-70">קטין</span>}
                  {!e.active && <span className="text-xs opacity-70">מושבת</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-2 border-t border-slate-100 text-center text-xs text-slate-500">
          עובדים פעילים: <span className={`font-bold ${quotaFull ? 'text-amber-600' : 'text-slate-700'}`}>{activeCount}/{config.org.employeeQuota}</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">סה״כ רשומים למערכת: {employees.length}</span>
        </div>
      </aside>

      {selected && (
        <section className="card p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="text-sm text-slate-500">
                {selected.roleIds.map((r) => roleName[r]).join(' · ')}
                {selected.age !== null && ` · גיל ${selected.age}`}
                {selected.isMinor && ' · קטין'}
                {selected.optInStatus === 'pending' && ' · ממתין לאישור וואטסאפ'}
              </p>
            </div>
            <div className="flex gap-3 items-center flex-wrap">
              <MiniNum label="מינ׳" value={selected.minShifts} onChange={(v) => patchSelected({ minShifts: v })} />
              <MiniNum label="מקס׳" value={selected.maxShifts} onChange={(v) => patchSelected({ maxShifts: v })} />
              <MiniNum label="₪/שעה" value={selected.hourlyRate} onChange={(v) => patchSelected({ hourlyRate: v })} />
              <MiniNum label="מקס׳ רצוף" value={selected.maxConsecutiveDays ?? 0} onChange={(v) => patchSelected({ maxConsecutiveDays: v > 0 ? v : null })} />
            </div>
          </div>

          {/* 3.3 — seniority per role (higher-level seats need higher seniority) */}
          {selected.roleIds.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-slate-500">בכירות לתפקיד:</span>
              {selected.roleIds.map((rid) => (
                <label key={rid} className="flex items-center gap-1.5">
                  <span className="text-slate-700">{roleName[rid]}</span>
                  <select
                    value={selected.roleLevels?.[rid] ?? 1}
                    onChange={(e) => patchSelected({ roleLevels: { ...selected.roleLevels, [rid]: Number(e.target.value) } })}
                    className="border border-slate-300 rounded-md px-1.5 py-1 text-xs"
                  >
                    <option value={1}>זוטר (1)</option>
                    <option value={2}>מנוסה (2)</option>
                    <option value={3}>בכיר (3)</option>
                  </select>
                </label>
              ))}
              <span className="text-[11px] text-slate-400">· "מקס׳ רצוף" = מקסימום ימי עבודה רצופים (0 = ללא הגבלה)</span>
            </div>
          )}

          {rep && (
            <div className="mb-4 rounded-xl bg-slate-50 p-3 flex flex-wrap items-center gap-5">
              <SummaryStat label="משמרות" value={rep.shifts} />
              <SummaryStat label="שעות" value={rep.hours} />
              <SummaryStat label="סופ״ש" value={rep.weekendShifts} />
              <SummaryStat label="סגירות" value={rep.closingShifts} />
              <SummaryStat label="דירוג" value={rep.rank > 0 ? `#${rep.rank}` : '—'} />
              <button onClick={sendSummary} className="mr-auto text-xs px-3 py-1.5 rounded-lg bg-ink text-white hover:opacity-90">שלח סיכום לעובד ↗</button>
            </div>
          )}

          {/* free-hours availability — pick an exact window per day */}
          <p className="text-sm text-slate-500 mb-3">בחר יום והגדר את השעות שבהן העובד יכול לעבוד — היום כולו, לא יכול, או טווח שעות מדויק.</p>
          {DAY_NAMES.every((_, day) => df(day).mode === 'unset') && (
            <div className="mb-3 rounded-lg bg-slate-50 border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
              ⏳ טרם התקבלה זמינות לשבוע — ממתין לתשובת העובד בוואטסאפ, או שאפשר להגדיר ידנית כאן. עד אז לא נניח שהוא זמין.
            </div>
          )}
          <div className="flex gap-2 flex-wrap mb-3">
            {DAY_NAMES.map((dn, day) => {
              const m = df(day).mode;
              const on = day === curDay;
              const weekend = WEEKEND_DAYS.includes(day);
              const cls = on ? 'bg-ink text-white border-ink'
                : m === 'unset' ? 'bg-slate-50 text-slate-400 border-dashed border-slate-300'
                : m === 'off' ? 'bg-red-50 text-red-600 border-red-200'
                : m === 'hours' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : m === 'all' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : weekend ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-slate-600 border-slate-200';
              return <button key={day} onClick={() => setCurDay(day)} className={`px-3 py-1.5 rounded-full text-sm border transition ${cls}`}>{dn}</button>;
            })}
          </div>

          {(() => {
            const v = df(curDay);
            const shifts = dayShiftsOf(curDay);
            const badRange = v.mode === 'hours' && v.fromTime >= v.toTime;
            const matching = shifts.filter((s) => v.fromTime < s.endTime && s.startTime < v.toTime);
            return (
              <div className="border border-slate-200 rounded-xl p-3.5">
                <div className="font-medium mb-2.5">יום {DAY_NAMES[curDay]}</div>
                <div className="flex gap-2">
                  <button onClick={() => setDay(curDay, { mode: 'all' })} className={`flex-1 py-2 rounded-lg text-sm border transition ${v.mode === 'all' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>☀ זמין כל היום</button>
                  <button onClick={() => setDay(curDay, { mode: 'hours' })} className={`flex-1 py-2 rounded-lg text-sm border transition ${v.mode === 'hours' ? 'bg-ink border-ink text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>🕐 שעות מסוימות</button>
                  <button onClick={() => setDay(curDay, { mode: 'off' })} className={`flex-1 py-2 rounded-lg text-sm border transition ${v.mode === 'off' ? 'bg-red-500 border-red-500 text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>✕ לא יכול</button>
                </div>
                {v.mode === 'unset' && (
                  <div className="mt-2.5 text-center text-[11px] text-slate-400">טרם התקבלה זמינות ליום זה — בחר אפשרות כדי להגדיר.</div>
                )}
                {v.mode === 'hours' && (
                  <>
                    <div className="mt-3 flex items-center gap-2 justify-center">
                      <span className="text-sm text-slate-500">מ־</span>
                      <TimeSelect value={v.fromTime} onChange={(t) => setDay(curDay, { fromTime: t })} />
                      <span className="text-sm text-slate-500">עד</span>
                      <TimeSelect value={v.toTime} onChange={(t) => setDay(curDay, { toTime: t })} />
                    </div>
                    {badRange
                      ? <div className="mt-2 text-center text-xs text-red-500">שעת הסיום צריכה להיות אחרי שעת ההתחלה.</div>
                      : shifts.length > 0 && (
                        <div className="mt-3 text-center text-[11px] text-slate-400">
                          משמרות שיתאימו: {matching.map((s) => s.label).join(' · ') || 'אף משמרת בטווח הזה'}
                        </div>
                      )}
                  </>
                )}
              </div>
            );
          })()}

          <div className="text-xs text-slate-500 font-medium mt-4 mb-1.5">הסיכום שלך:</div>
          <div className="space-y-1.5">
            {DAY_NAMES.map((dn, day) => {
              const v = df(day);
              if (v.mode === 'all' || v.mode === 'unset') return null;
              const off = v.mode === 'off';
              return (
                <div key={day} className={`flex justify-between items-center rounded-lg px-3 py-1.5 text-sm border ${off ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <span className="font-medium">יום {dn}</span>
                  <span className="text-slate-600" dir="ltr">{off ? 'לא יכול' : `${v.fromTime}–${v.toTime}`}</span>
                </div>
              );
            })}
            {DAY_NAMES.every((_, day) => df(day).mode === 'unset')
              ? <div className="text-xs text-slate-400">אין עדיין מידע זמינות לעובד זה.</div>
              : DAY_NAMES.every((_, day) => { const m = df(day).mode; return m === 'all' || m === 'unset'; }) && (
                  <div className="text-xs text-slate-400">זמין בכל הימים (לא סומנו הגבלות).</div>
                )}
          </div>

          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">חוקי העסקה ומידע</summary>
            <div className="mt-3 space-y-2 text-sm">
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${selected.isMinor ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {selected.isMinor ? 'קטין' : 'בגיר'}{selected.age !== null ? ` · גיל ${selected.age}` : ''}
              </span>
              <ul className="text-[13px] text-slate-600 space-y-1 mt-1">
                {selected.isMinor && <li>🔒 עוצר קטינים — המשמרת חייבת להסתיים עד השעה {config.laborRules.minorCurfewHour}:00 (נאכף אוטומטית).</li>}
                <li>😴 מנוחה מינימלית בין משמרות: {config.laborRules.minRestHours} שעות.</li>
                <li>📅 מקסימום {config.laborRules.maxDailyHours} שעות ליום · {config.laborRules.maxWeeklyHours} שעות לשבוע.</li>
                <li className="text-slate-400">הכללים נאכפים במנוע השיבוץ — עובד לעולם לא ישובץ בניגוד להם.</li>
              </ul>
              <div>
                <div className="text-xs text-slate-500 mb-1">הערות מעסיק (חוזה, אישורים, הגבלות…)</div>
                <textarea value={selected.employmentNotes ?? ''} onChange={(e) => patchSelected({ employmentNotes: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm resize-none" placeholder="לדוגמה: אישור עבודת נוער עד 23:00, לא עובד בשישי…" />
              </div>
            </div>
          </details>

          <div className="mt-5 flex items-center justify-between">
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'שומר…' : 'שמור'}</button>
            <div className="flex items-center gap-3">
              {msg && <span className="text-sm text-emerald-600">{msg}</span>}
              {selected.active ? (
                <button onClick={deactivate} className="text-sm text-red-600 hover:underline">השבת עובד</button>
              ) : (
                <button onClick={reactivate} className="text-sm text-emerald-600 font-medium hover:underline">החזר עובד לפעילות</button>
              )}
            </div>
          </div>
        </section>
      )}

      {adding && <AddEmployee config={config} onClose={() => setAdding(false)} onCreated={async () => { setAdding(false); await load(); }} />}
    </div>
  );
}

// Explicit 24-hour hour+minute picker (native <input type="time"> renders AM/PM in
// some locales). Guarantees a 24h display and any minute of the day.
function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = (value || '09:00').split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const mins = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  const sel = 'border border-slate-300 rounded-md px-1.5 py-1.5 text-sm bg-white';
  return (
    <span className="inline-flex items-center gap-1" dir="ltr">
      <select value={h} onChange={(e) => onChange(`${e.target.value}:${m}`)} className={sel}>
        {hours.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
      </select>
      <span className="text-slate-400">:</span>
      <select value={m} onChange={(e) => onChange(`${h}:${e.target.value}`)} className={sel}>
        {mins.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
      </select>
    </span>
  );
}

function MiniNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-sm text-slate-600 flex items-center gap-1">
      {label}
      <input type="number" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value)))} className="border border-slate-300 rounded-md px-2 py-1 w-16 text-center" />
    </label>
  );
}

function AddEmployee({ config, onClose, onCreated }: { config: Config; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState<NewEmployee>({ name: '', phone: '', birthDate: '', hourlyRate: 38, minShifts: 2, maxShifts: 5, roleIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (id: string) =>
    setF((s) => ({ ...s, roleIds: s.roleIds.includes(id) ? s.roleIds.filter((r) => r !== id) : [...s.roleIds, id] }));

  const submit = async () => {
    if (!f.name.trim() || !f.phone.trim()) {
      setError('שם וטלפון הם שדות חובה');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createEmployee({ ...f, birthDate: f.birthDate || undefined });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-10 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-pop w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1">הוספת עובד חדש</h3>
        <p className="text-xs text-slate-500 mb-4">עם ההוספה נשלחת אליו אוטומטית הודעת פתיחה ובקשת זמינות בוואטסאפ.</p>
        <div className="space-y-3">
          <Field label="שם מלא *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="טלפון *"><input className="inp" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך לידה"><IlDate value={f.birthDate ?? ''} onChange={(iso) => setF({ ...f, birthDate: iso })} className="inp" /></Field>
            <Field label="₪ לשעה"><input type="number" className="inp" value={f.hourlyRate} onChange={(e) => setF({ ...f, hourlyRate: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="מינ׳ משמרות"><input type="number" className="inp" value={f.minShifts} onChange={(e) => setF({ ...f, minShifts: Number(e.target.value) })} /></Field>
            <Field label="מקס׳ משמרות"><input type="number" className="inp" value={f.maxShifts} onChange={(e) => setF({ ...f, maxShifts: Number(e.target.value) })} /></Field>
          </div>
          <Field label="תפקידים">
            <div className="flex gap-2 flex-wrap">
              {config.roles.map((r) => (
                <button key={r.id} onClick={() => toggleRole(r.id)} className={`text-sm px-3 py-1 rounded-full border ${f.roleIds.includes(r.id) ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600'}`}>
                  {r.name}
                </button>
              ))}
            </div>
          </Field>
          {f.birthDate && isMinorDate(f.birthDate) && (
            <p className="text-xs text-amber-600">לפי תאריך הלידה — קטין. המערכת לא תשבץ אותו למשמרות שנגמרות אחרי העוצר.</p>
          )}
          {error && <div className="rounded-md bg-red-100 text-red-800 px-3 py-2 text-sm">{error}</div>}
        </div>
        <div className="flex justify-between mt-5">
          <button onClick={submit} disabled={busy} className="btn-primary">{busy ? 'מוסיף…' : 'הוסף ושלח הזמנה'}</button>
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">ביטול</button>
        </div>
      </div>
      <style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:6px;padding:6px 10px}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-ink">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  );
}

function rankDot(rank: number): string {
  if (rank === 1) return 'bg-amber-400 text-amber-900';
  if (rank === 2) return 'bg-slate-300 text-slate-700';
  if (rank === 3) return 'bg-orange-300 text-orange-900';
  return 'bg-slate-200 text-slate-600';
}

function isMinorDate(d: string): boolean {
  const b = new Date(d);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age < 18;
}
