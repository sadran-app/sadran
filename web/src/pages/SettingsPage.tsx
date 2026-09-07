import { useEffect, useState } from 'react';
import { api, DAY_NAMES, WEEKEND_DAYS, type Automation, type Config, type DemandTemplate, type Shift } from '../lib/api';
import { IlTime } from '../lib/ilFields';
import { ForecastPanel } from './ForecastPanel';

export function SettingsPage({ config, onSaved }: { config: Config; onSaved: () => void }) {
  const [rules, setRules] = useState(config.laborRules);
  const [savingRules, setSavingRules] = useState(false);
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

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

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    const ids = dayShifts.map((s) => s.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    act(() => api.reorderShifts(day, ids));
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

      <ForecastPanel onApplied={onSaved} />

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
            <div
              key={s.id}
              draggable
              onDragStart={() => setDragId(s.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropOn(s.id)}
              onDragEnd={() => setDragId(null)}
              className={`border rounded-lg p-4 transition ${dragId === s.id ? 'opacity-40 ring-2 ring-brand/40' : ''}`}
            >
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <span className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 select-none text-lg leading-none" title="גרור לסידור מחדש">⠿</span>
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
                    <th className="py-1 font-medium">בכירות מינ׳</th>
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
                      <td className="py-1.5">
                        <select
                          value={sl.minLevel ?? 1}
                          onChange={(e) => act(() => api.updateSlot(sl.id, { minLevel: Number(e.target.value) }))}
                          className="border border-slate-300 rounded-md px-2 py-1"
                          title="רמת הבכירות המינימלית הנדרשת לאיוש המשבצת"
                        >
                          <option value={1}>כל אחד (1)</option>
                          <option value={2}>מנוסה+ (2)</option>
                          <option value={3}>בכיר (3)</option>
                        </select>
                      </td>
                      <td className="py-1.5 text-left">
                        <button onClick={() => act(() => api.deleteSlot(sl.id))} className="text-red-500 hover:text-red-700">✕</button>
                      </td>
                    </tr>
                  ))}
                  {s.slots.length === 0 && (
                    <tr><td colSpan={5} className="py-2 text-slate-400 text-sm">אין דרישות עדיין.</td></tr>
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

      <BulkDemandSection config={config} onSaved={onSaved} />
      <TemplatesSection onSaved={onSaved} />
    </div>
  );
}

// 2.5 — set a role requirement across many shifts at once ("every morning 2 waiters").
function BulkDemandSection({ config, onSaved }: { config: Config; onSaved: () => void }) {
  const [roleId, setRoleId] = useState(config.roles[0]?.id ?? '');
  const [count, setCount] = useState(2);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const labels = [...new Set(config.shifts.map((s) => s.label))];
  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.bulkDemand({ roleId, count, label: label || undefined, dayIndexes: days.length ? days : undefined });
      setMsg(`עודכן: ${r.created} נוספו · ${r.updated} עודכנו · ${r.removed} הוסרו (${r.shiftsMatched} משמרות)`);
      onSaved();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold mb-1">דרישות חוזרות (הגדרה מהירה)</h2>
      <p className="text-sm text-slate-500 mb-4">קבע דרישת תפקיד על הרבה משמרות בבת אחת — למשל "כל בוקר 2 מלצרים". סינון לפי שם משמרת ו/או ימים. כמות 0 מסירה את הדרישה.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Labeled label="תפקיד">
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5">
            {config.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Labeled>
        <Labeled label="כמות"><div className="w-20"><Num value={count} onChange={setCount} /></div></Labeled>
        <Labeled label="משמרת (הכל אם ריק)">
          <select value={label} onChange={(e) => setLabel(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5">
            <option value="">כל המשמרות</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Labeled>
      </div>
      <div className="mt-3">
        <div className="text-sm text-slate-600 mb-1">ימים (הכל אם לא נבחר)</div>
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES.map((dn, d) => (
            <button key={d} onClick={() => setDays((cur) => cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d])}
              className={`px-3 py-1 rounded-full text-sm border transition ${days.includes(d) ? 'bg-brand text-white border-brand' : WEEKEND_DAYS.includes(d) ? 'bg-brand-light text-brand-dark border-brand-light' : 'bg-white text-slate-600 border-slate-200'}`}>{dn}</button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={apply} disabled={busy || !roleId} className="btn-primary">החל</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </section>
  );
}

// 2.2b — save/apply named demand templates ("סידור קיץ").
function TemplatesSection({ onSaved }: { onSaved: () => void }) {
  const [templates, setTemplates] = useState<DemandTemplate[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.getTemplates().then(setTemplates).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true); setMsg(null);
    try { await api.saveTemplate(name.trim()); setName(''); await load(); setMsg('התבנית נשמרה.'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async (id: string) => {
    if (!window.confirm('להחיל את התבנית? זה יחליף את כל דרישות האיוש הנוכחיות.')) return;
    setBusy(true); setMsg(null);
    try { const r = await api.applyTemplate(id); await load(); onSaved(); setMsg(`הוחלו ${r.applied} דרישות${r.unmatched ? ` · ${r.unmatched} לא נמצאו התאמה` : ''}.`); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const del = async (id: string) => { setBusy(true); try { await api.deleteTemplate(id); await load(); } finally { setBusy(false); } };

  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold mb-1">תבניות דרישות</h2>
      <p className="text-sm text-slate-500 mb-4">שמור את מבנה הדרישות הנוכחי בשם ("סידור קיץ", "עומס חגים") והחל אותו בלחיצה בעתיד.</p>
      <div className="flex items-center gap-2 mb-3">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="שם התבנית…" className="input max-w-xs" />
        <button onClick={save} disabled={busy || !name.trim()} className="btn-soft">שמור מצב נוכחי</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
      {templates === null ? <p className="text-sm text-slate-400">טוען…</p> : templates.length === 0 ? (
        <p className="text-sm text-slate-400">אין תבניות שמורות עדיין.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <span className="text-sm"><b>{t.name}</b> <span className="text-slate-400">· {t.items} דרישות</span></span>
              <span className="flex gap-2">
                <button onClick={() => apply(t.id)} disabled={busy} className="text-sm text-brand-dark hover:underline">החל</button>
                <button onClick={() => del(t.id)} disabled={busy} className="text-sm text-red-500 hover:underline">מחק</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      <label className="flex items-center gap-2 text-sm mb-4 font-medium text-slate-700">
        <input type="checkbox" checked={a.autoSendEnabled} onChange={(e) => setA({ ...a, autoSendEnabled: e.target.checked })} />
        הפעל שליחה אוטומטית שבועית (במועד שנקבע למטה)
      </label>
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
      <div className="mt-4 pt-4 border-t border-slate-100">
        <label className="flex items-center gap-2 text-sm mb-2 font-medium text-slate-700">
          <input type="checkbox" checked={a.welcomeEnabled} onChange={(e) => setA({ ...a, welcomeEnabled: e.target.checked })} />
          שלח ברכת הצטרפות אוטומטית לעובד חדש (בוואטסאפ)
        </label>
        <textarea
          value={a.welcomeMessage}
          onChange={(e) => setA({ ...a, welcomeMessage: e.target.value })}
          rows={2}
          disabled={!a.welcomeEnabled}
          className="input resize-none disabled:opacity-50"
          placeholder="נוסח ברכת ההצטרפות…"
        />
        <p className="text-xs text-slate-400 mt-1">השתמש ב-<span className="font-mono">{'{שם}'}</span> לשם העובד. נשלח ברגע שמוסיפים עובד עם מספר טלפון.</p>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={busy} className="btn-primary">{busy ? 'שומר…' : 'שמור אוטומציה'}</button>
        {msg && <span className="text-sm text-emerald-600">{msg}</span>}
      </div>
    </section>
  );
}
