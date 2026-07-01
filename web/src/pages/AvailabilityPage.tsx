import { useEffect, useState } from 'react';
import { api, DAY_NAMES, WEEKEND_DAYS, type AvailabilityState, type Config, type Employee, type NewEmployee } from '../lib/api';
import { IlDate } from '../lib/ilFields';

const STATE_STYLE: Record<AvailabilityState, string> = {
  ok: 'bg-slate-100 text-slate-500',
  prefer: 'bg-emerald-100 text-emerald-700',
  cant: 'bg-red-100 text-red-700',
};
const STATE_LABEL: Record<AvailabilityState, string> = { ok: 'זמין', prefer: 'מעדיף', cant: 'לא יכול' };
const NEXT: Record<AvailabilityState, AvailabilityState> = { ok: 'prefer', prefer: 'cant', cant: 'ok' };

export function AvailabilityPage({ config }: { config: Config }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = () =>
    api.getEmployees().then((r) => {
      setEmployees(r.employees);
      setSelectedId((cur) => cur ?? r.employees[0]?.id ?? null);
    });
  useEffect(() => {
    load();
  }, []);

  const roleName = Object.fromEntries(config.roles.map((r) => [r.id, r.name]));
  const selected = employees.find((e) => e.id === selectedId) ?? null;

  const stateOf = (emp: Employee, shiftId: string): AvailabilityState =>
    emp.availability.find((a) => a.shiftId === shiftId)?.state ?? 'ok';

  const toggle = (shiftId: string) => {
    if (!selected) return;
    const next = NEXT[stateOf(selected, shiftId)];
    setEmployees((list) =>
      list.map((e) => {
        if (e.id !== selected.id) return e;
        const availability = e.availability.filter((a) => a.shiftId !== shiftId);
        if (next !== 'ok') availability.push({ shiftId, state: next });
        return { ...e, availability };
      }),
    );
  };

  const patchSelected = (patch: Partial<Employee>) =>
    setEmployees((list) => list.map((e) => (e.id === selected?.id ? { ...e, ...patch } : e)));

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateEmployee(selected.id, { minShifts: selected.minShifts, maxShifts: selected.maxShifts, hourlyRate: selected.hourlyRate, phone: selected.phone });
      await api.updateAvailability(selected.id, config.shifts.map((s) => ({ shiftId: s.id, state: stateOf(selected, s.id) })));
      await load();
      setMsg('נשמר');
      setTimeout(() => setMsg(null), 1500);
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
    await api.updateEmployee(selected.id, { active: true });
    await load();
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
      <aside className="card p-2 h-fit">
        <button onClick={() => setAdding(true)} className="btn-primary w-full mb-2">+ הוסף עובד</button>
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
                <span>{e.name}</span>
                <span className="flex gap-1">
                  {e.isMinor && <span className="text-xs opacity-70">קטין</span>}
                  {!e.active && <span className="text-xs opacity-70">מושבת</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
            <div className="flex gap-3 items-center">
              <MiniNum label="מינ׳" value={selected.minShifts} onChange={(v) => patchSelected({ minShifts: v })} />
              <MiniNum label="מקס׳" value={selected.maxShifts} onChange={(v) => patchSelected({ maxShifts: v })} />
              <MiniNum label="₪/שעה" value={selected.hourlyRate} onChange={(v) => patchSelected({ hourlyRate: v })} />
            </div>
          </div>

          <p className="text-sm text-slate-500 mb-3">לחיצה על משמרת מחליפה: זמין → מעדיף → לא יכול.</p>
          <div className="space-y-2">
            {DAY_NAMES.map((dname, day) => {
              const dayShifts = config.shifts.filter((s) => s.dayIndex === day).sort((a, b) => a.order - b.order);
              if (dayShifts.length === 0) return null;
              return (
                <div key={day} className="flex items-center gap-2 flex-wrap">
                  <span className={`w-16 text-sm ${WEEKEND_DAYS.includes(day) ? 'text-amber-600' : 'text-slate-600'}`}>{dname}</span>
                  {dayShifts.map((s) => {
                    const st = stateOf(selected, s.id);
                    return (
                      <button key={s.id} onClick={() => toggle(s.id)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${STATE_STYLE[st]}`}>
                        {s.label} {s.startTime}–{s.endTime} · {STATE_LABEL[st]}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

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

function isMinorDate(d: string): boolean {
  const b = new Date(d);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age < 18;
}
