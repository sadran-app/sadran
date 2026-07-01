import { useState } from 'react';
import { api, DAY_NAMES, WEEKEND_DAYS, type Automation, type Config, type Shift } from '../lib/api';
import { IlTime } from '../lib/ilFields';

export function SettingsPage({ config, onSaved }: { config: Config; onSaved: () => void }) {
  const [rules, setRules] = useState(config.laborRules);
  const [savingRules, setSavingRules] = useState(false);
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);

  const roleName = Object.fromEntries(config.roles.map((r) => [r.id, r.name]));
  const dayShifts = config.shifts.filter((s) => s.dayIndex === day).sort((a, b) => a.order - b.order);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await api.updateLaborRules(rules);
      onSaved();
    } finally {
      setSavingRules(false);
    }
  };

  const addShift = () =>
    act(() => api.createShift({ dayIndex: day, label: 'משמרת', startTime: '08:00', endTime: '16:00' }));
  const addSlot = (s: Shift) =>
    act(() => api.addSlot(s.id, { roleId: config.roles[0]?.id ?? '', startTime: s.startTime, count: 1 }));

  const copyToAll = () =>
    act(async () => {
      // duplicate the selected day's shifts+slots onto every other day
      for (let d = 0; d < 7; d++) {
        if (d === day) continue;
        for (const ex of config.shifts.filter((s) => s.dayIndex === d)) await api.deleteShift(ex.id);
        for (const s of dayShifts) {
          const ns = await api.createShift({ dayIndex: d, label: s.label, startTime: s.startTime, endTime: s.endTime, colorTier: s.colorTier });
          for (const sl of s.slots) await api.addSlot(ns.id, { roleId: sl.roleId, startTime: sl.startTime, count: sl.count });
        }
      }
    });

  return (
    <div className="space-y-8">
      {/* labor rules */}
      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-4">חוקי עבודה</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Labeled label="מנוחה מינ׳ (שעות)"><Num value={rules.minRestHours} onChange={(v) => setRules({ ...rules, minRestHours: v })} /></Labeled>
          <Labeled label="מקס׳ שעות ליום"><Num value={rules.maxDailyHours} onChange={(v) => setRules({ ...rules, maxDailyHours: v })} /></Labeled>
          <Labeled label="מקס׳ שעות לשבוע"><Num value={rules.maxWeeklyHours} onChange={(v) => setRules({ ...rules, maxWeeklyHours: v })} /></Labeled>
          <Labeled label="עוצר קטינים (שעה)"><Num value={rules.minorCurfewHour} onChange={(v) => setRules({ ...rules, minorCurfewHour: v })} /></Labeled>
          <Labeled label="שעת סגירה (עומס)"><Num value={rules.closingHour} onChange={(v) => setRules({ ...rules, closingHour: v })} /></Labeled>
        </div>
        <button onClick={saveRules} disabled={savingRules} className="mt-4 btn-primary">
          {savingRules ? 'שומר…' : 'שמור חוקי עבודה'}
        </button>
      </section>

      <RolesSection config={config} onSaved={onSaved} />
      <AutomationSection config={config} onSaved={onSaved} />

      {/* per-day shift editor */}
      <section className="card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">משמרות ודרישות לפי יום</h2>
          <button onClick={copyToAll} disabled={busy} className="text-sm text-slate-500 hover:text-slate-800">
            העתק יום זה לכל השבוע
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">לכל יום — הגדר משמרות (מקטעים) עם שעות משלהן, ובתוך כל משמרת כמה עובדים מכל תפקיד ומאיזו שעה.</p>

        <div className="flex gap-1 mb-5 flex-wrap">
          {DAY_NAMES.map((d, i) => (
            <button
              key={i}
              onClick={() => setDay(i)}
              className={`px-3 py-1.5 rounded-md text-sm ${
                i === day ? 'bg-slate-900 text-white' : WEEKEND_DAYS.includes(i) ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {dayShifts.map((s) => (
            <div key={s.id} className="border rounded-lg p-4">
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <input
                  defaultValue={s.label}
                  onBlur={(e) => e.target.value !== s.label && act(() => api.updateShift(s.id, { label: e.target.value }))}
                  className="border border-slate-300 rounded-md px-2 py-1 font-semibold w-32"
                />
                <TimeField label="מ" value={s.startTime} onChange={(v) => act(() => api.updateShift(s.id, { startTime: v }))} />
                <TimeField label="עד" value={s.endTime} onChange={(v) => act(() => api.updateShift(s.id, { endTime: v }))} />
                <button onClick={() => act(() => api.deleteShift(s.id))} className="mr-auto text-sm text-red-600 hover:underline">
                  מחק משמרת
                </button>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-right">
                    <th className="py-1 font-medium">תפקיד</th>
                    <th className="py-1 font-medium">משעה</th>
                    <th className="py-1 font-medium">כמות</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {s.slots.map((sl) => (
                    <tr key={sl.id} className="border-t">
                      <td className="py-1.5">
                        <select
                          defaultValue={sl.roleId}
                          onChange={(e) => act(() => api.updateSlot(sl.id, { roleId: e.target.value }))}
                          className="border border-slate-300 rounded-md px-2 py-1"
                        >
                          {config.roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5">
                        <IlTime
                          value={sl.startTime}
                          onChange={(v) => act(() => api.updateSlot(sl.id, { startTime: v }))}
                          className="border border-slate-300 rounded-md px-2 py-1 w-24"
                        />
                      </td>
                      <td className="py-1.5">
                        <input
                          type="number"
                          min={0}
                          defaultValue={sl.count}
                          onBlur={(e) => Number(e.target.value) !== sl.count && act(() => api.updateSlot(sl.id, { count: Number(e.target.value) }))}
                          className="border border-slate-300 rounded-md px-2 py-1 w-16 text-center"
                        />
                      </td>
                      <td className="py-1.5 text-left">
                        <button onClick={() => act(() => api.deleteSlot(sl.id))} className="text-red-500 hover:text-red-700">✕</button>
                      </td>
                    </tr>
                  ))}
                  {s.slots.length === 0 && (
                    <tr><td colSpan={4} className="py-2 text-slate-400 text-sm">אין דרישות עדיין.</td></tr>
                  )}
                </tbody>
              </table>
              <button onClick={() => addSlot(s)} disabled={busy} className="mt-2 text-sm text-slate-700 hover:underline">
                + הוסף דרישה ({config.roles.map((r) => roleName[r.id]).slice(0, 1)})
              </button>
            </div>
          ))}
          {dayShifts.length === 0 && <p className="text-sm text-slate-400">אין משמרות ליום {DAY_NAMES[day]}.</p>}
        </div>

        <button onClick={addShift} disabled={busy} className="mt-4 btn-primary">
          + הוסף משמרת ל{DAY_NAMES[day]}
        </button>
      </section>
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
function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="border border-slate-300 rounded-md px-2 py-1 w-full" />
  );
}
function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm text-slate-600 flex items-center gap-1">
      {label}
      <IlTime value={value} onChange={onChange} className="border border-slate-300 rounded-md px-2 py-1 w-24" />
    </label>
  );
}

function RolesSection({ config, onSaved }: { config: Config; onSaved: () => void }) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!newName.trim()) return;
    act(async () => { await api.createRole(newName.trim()); setNewName(''); });
  };

  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold mb-1">תפקידים</h2>
      <p className="text-sm text-slate-500 mb-4">כל המקצועות במסעדה — מלצר, טבח, אחראי משמרת, מתלמד, מארח… הוסף ככל שתרצה.</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {config.roles.map((r) => (
          <div key={r.id} className="flex items-center gap-1 bg-slate-100 rounded-full pr-3 pl-1 py-1">
            <input
              defaultValue={r.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && act(() => api.updateRole(r.id, e.target.value.trim()))}
              className="bg-transparent text-sm w-24 outline-none text-slate-700"
            />
            <button onClick={() => act(() => api.deleteRole(r.id))} title="מחק תפקיד" className="w-5 h-5 rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="תפקיד חדש…" className="input max-w-xs" />
        <button onClick={add} disabled={busy} className="btn-soft">הוסף תפקיד</button>
      </div>
      {error && <div className="mt-3 rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}
    </section>
  );
}

function AutomationSection({ config, onSaved }: { config: Config; onSaved: () => void }) {
  const [a, setA] = useState<Automation>(config.automation);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      await api.updateAutomation(a);
      onSaved();
      setMsg('נשמר');
      setTimeout(() => setMsg(null), 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold mb-1">אוטומציה — בקשת זמינות</h2>
      <p className="text-sm text-slate-500 mb-4">
        מתי לשלוח אוטומטית לעובדים את בקשת הזמינות לשבוע הבא, ומה תוכן ההודעה. השתמש ב-<span className="font-mono">{'{שם}'}</span> לשם העובד.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-4 items-end">
        <label className="block">
          <span className="block text-sm text-slate-600 mb-1">תוכן ההודעה</span>
          <textarea value={a.autoMessage} onChange={(e) => setA({ ...a, autoMessage: e.target.value })} rows={3} className="input resize-none" />
        </label>
        <label className="block">
          <span className="block text-sm text-slate-600 mb-1">יום שליחה</span>
          <select value={a.autoSendDay} onChange={(e) => setA({ ...a, autoSendDay: Number(e.target.value) })} className="input">
            {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm text-slate-600 mb-1">שעה</span>
          <IlTime value={a.autoSendTime} onChange={(v) => setA({ ...a, autoSendTime: v })} className="input" />
        </label>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? 'שומר…' : 'שמור אוטומציה'}</button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
    </section>
  );
}
