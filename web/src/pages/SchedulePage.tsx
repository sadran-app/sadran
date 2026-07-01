import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  DAY_NAMES,
  WEEKEND_DAYS,
  type Assignment,
  type AvailabilityStatus,
  type Candidate,
  type Config,
  type CycleView,
  type Shift,
  type ShiftSlot,
} from '../lib/api';

const TIER_STYLE = [
  'bg-sky-100 text-sky-800 border-sky-200',
  'bg-violet-100 text-violet-800 border-violet-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-teal-100 text-teal-800 border-teal-200',
];

export function SchedulePage({ config }: { config: Config }) {
  const [cycle, setCycle] = useState<CycleView | null>(null);
  const [avStatus, setAvStatus] = useState<AvailabilityStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ slot: ShiftSlot; shift: Shift } | null>(null);

  const load = async () => {
    const [c, av] = await Promise.all([api.getCycle(), api.availabilityStatus()]);
    setCycle(c);
    setAvStatus(av);
  };
  useEffect(() => {
    load();
  }, []);

  const roleName = useMemo(() => Object.fromEntries(config.roles.map((r) => [r.id, r.name])), [config.roles]);
  const shiftsByDay = useMemo(() => {
    const m = new Map<number, Shift[]>();
    for (const s of config.shifts) {
      const list = m.get(s.dayIndex) ?? [];
      list.push(s);
      m.set(s.dayIndex, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.order - b.order);
    return m;
  }, [config.shifts]);

  const assignmentsBySlot = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of cycle?.assignments ?? []) {
      const list = m.get(a.slotId) ?? [];
      list.push(a);
      m.set(a.slotId, list);
    }
    return m;
  }, [cycle]);

  const missingBySlot = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of cycle?.gaps ?? []) m.set(g.slotId, g.missing);
    return m;
  }, [cycle]);

  const busyRef = useRef(false);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busyRef.current) return; // guard against double-clicks (e.g. rapid "צור סידור")
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await load();
      if (ok) setMessage(ok);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const generate = () =>
    act(async () => {
      const r = await api.generate();
      setMessage(`נוצר סידור: ${r.assigned} שיבוצים${r.warnings.length ? ` · ${r.warnings.join(' · ')}` : ''}`);
    });
  const publish = () => act(() => api.publish(), 'הסידור פורסם — הודעות נשלחו לעובדים.');
  const sendAvail = () =>
    act(async () => {
      const r = await api.sendAvailability();
      setMessage(r.sent > 0 ? `נשלחו ${r.sent} בקשות זמינות למי שטרם הזין.` : 'כל העובדים כבר הזינו זמינות 🎉');
    });
  const remove = (id: string) => act(() => api.deleteAssignment(id));
  const vacate = (id: string) =>
    act(async () => {
      const r = await api.vacate(id);
      setMessage(`המשמרת נפתחה להחלפה — ${r.notified} זכאים קיבלו הודעה.`);
    });
  const addPick = (employeeId: string, force = false) => {
    if (!picker) return;
    const slotId = picker.slot.id;
    act(async () => {
      const r = await api.addAssignment({ employeeId, slotId, force });
      setPicker(null);
      if (r.warning?.length) setMessage('שובץ בכפייה — שים לב: ' + r.warning.join(' · '));
    });
  };

  const status = cycle?.cycle.status;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={busy} className="btn-primary">צור סידור</button>
          <button onClick={publish} disabled={busy || !cycle?.assignments.length} className="btn-success">פרסם</button>
          {cycle && (
            <span className="text-sm text-slate-500">
              שבוע {new Date(cycle.cycle.weekStartDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
              {status && ` · ${status === 'collecting' ? 'איסוף' : status === 'proposed' ? 'טיוטה' : 'פורסם'}`}
            </span>
          )}
        </div>
        {cycle && cycle.gaps.length > 0 && (
          <span className="text-sm text-red-600 font-medium">{cycle.gaps.reduce((s, g) => s + g.missing, 0)} משבצות חסרות</span>
        )}
      </div>

      {message && <div className="rounded-xl bg-ink text-white text-sm px-4 py-2.5">{message}</div>}

      {avStatus && (() => {
        const done = avStatus.employees.filter((e) => e.responded).length;
        const total = avStatus.employees.length;
        const missing = avStatus.employees.filter((e) => !e.responded);
        return (
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold text-ink">{done}/{total}</span> עובדים הזינו זמינות לשבוע זה
              {missing.length > 0 && (
                <span className="text-slate-500"> · טרם: {missing.slice(0, 5).map((e) => e.name).join(', ')}{missing.length > 5 ? ` +${missing.length - 5}` : ''}</span>
              )}
            </div>
            <button onClick={sendAvail} disabled={busy} className="btn-soft">שלח בקשת זמינות למי שטרם</button>
          </div>
        );
      })()}

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ direction: 'rtl' }}>
          {DAY_NAMES.map((dname, day) => (
            <div key={day} className="min-w-[190px] flex-1">
              <div className={`rounded-t-2xl px-3 py-2 text-center font-semibold text-sm ${WEEKEND_DAYS.includes(day) ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-600'}`}>
                {dname}
              </div>
              <div className="bg-white rounded-b-2xl border-x border-b border-slate-100 shadow-soft p-2 space-y-3 min-h-[120px]">
                {(shiftsByDay.get(day) ?? []).map((s) => (
                  <div key={s.id}>
                    <div className="text-xs text-slate-500 font-medium border-b pb-1 mb-1">
                      {s.label} · {s.startTime}–{s.endTime}
                    </div>
                    {s.slots
                      .slice()
                      .sort((a, b) => a.startTime.localeCompare(b.startTime))
                      .map((sl) => {
                        const cells = assignmentsBySlot.get(sl.id) ?? [];
                        const missing = missingBySlot.get(sl.id) ?? 0;
                        return (
                          <div key={sl.id} className="mb-1.5">
                            <div className="text-[10px] text-slate-400">{roleName[sl.roleId]} · {sl.startTime} · {cells.length}/{sl.count}</div>
                            <div className="flex flex-col gap-1 mt-0.5">
                              {cells.map((a) => (
                                <Chip key={a.id} name={a.employeeName} tier={s.colorTier} onRemove={() => remove(a.id)} onVacate={() => vacate(a.id)} />
                              ))}
                              {missing > 0 && (
                                <button onClick={() => setPicker({ slot: sl, shift: s })} className="text-[11px] rounded-md border border-dashed border-red-300 bg-red-50 text-red-600 py-1 hover:bg-red-100">
                                  חסר {missing} +
                                </button>
                              )}
                              {missing <= 0 && (
                                <button onClick={() => setPicker({ slot: sl, shift: s })} className="text-[11px] text-slate-400 hover:text-slate-600">+</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    {s.slots.length === 0 && <div className="text-[11px] text-slate-300">—</div>}
                  </div>
                ))}
                {(shiftsByDay.get(day) ?? []).length === 0 && <div className="text-xs text-slate-300 text-center pt-4">אין משמרות</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {picker && (
        <AddPicker
          slot={picker.slot}
          shift={picker.shift}
          roleName={roleName[picker.slot.roleId] ?? ''}
          dayName={DAY_NAMES[picker.shift.dayIndex]}
          onClose={() => setPicker(null)}
          onPick={addPick}
        />
      )}
    </div>
  );
}

function Chip({ name, tier, onRemove, onVacate }: { name: string; tier: number; onRemove: () => void; onVacate: () => void }) {
  return (
    <div className={`group flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs ${TIER_STYLE[tier % TIER_STYLE.length]}`}>
      <span className="truncate">{name}</span>
      <span className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
        <button title="נפל ממשמרת" onClick={onVacate} className="hover:text-slate-900">↔</button>
        <button title="הסר" onClick={onRemove} className="hover:text-red-700">✕</button>
      </span>
    </div>
  );
}

function AddPicker({
  slot,
  shift,
  roleName,
  dayName,
  onClose,
  onPick,
}: {
  slot: ShiftSlot;
  shift: Shift;
  roleName: string;
  dayName: string;
  onClose: () => void;
  onPick: (employeeId: string, force?: boolean) => void;
}) {
  const [cands, setCands] = useState<Candidate[] | null>(null);
  useEffect(() => {
    api.candidates(slot.id).then(setCands).catch(() => setCands([]));
  }, [slot.id]);

  const eligible = (cands ?? []).filter((c) => c.ok);
  const blocked = (cands ?? []).filter((c) => !c.ok);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-10" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-pop w-96 max-h-[75vh] overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-1">הוספה — {dayName} · {shift.label} · {slot.startTime} ({roleName})</h3>
        <p className="text-xs text-slate-500 mb-3">המערכת בדקה זמינות, מנוחה, שעות, כפילויות ותפקיד.</p>

        {cands === null && <p className="text-sm text-slate-400">בודק זכאות…</p>}

        {eligible.length > 0 && (
          <>
            <div className="text-xs font-semibold text-emerald-700 mb-1">זכאים ({eligible.length})</div>
            <ul className="space-y-1 mb-3">
              {eligible.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                  <span>{c.name}{c.isMinor && <span className="text-xs text-slate-400"> · קטין</span>}</span>
                  <button onClick={() => onPick(c.id)} className="text-white bg-emerald-600 rounded-md px-3 py-1 text-xs hover:bg-emerald-700">שבץ</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {blocked.length > 0 && (
          <>
            <div className="text-xs font-semibold text-slate-500 mb-1">אי אפשר לשבץ ({blocked.length})</div>
            <ul className="space-y-1.5">
              {blocked.map((c) => (
                <li key={c.id} className="border-b last:border-0 py-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{c.name}{c.isMinor && <span className="text-xs"> · קטין</span>}</span>
                    <button onClick={() => onPick(c.id, true)} className="text-amber-600 hover:underline text-xs" title="שיבוץ בכפייה למרות החריגה">כפה בכל זאת</button>
                  </div>
                  <div className="text-[11px] text-red-500 mt-0.5">{c.reasons.join(' · ')}</div>
                </li>
              ))}
            </ul>
          </>
        )}

        {cands && cands.length === 0 && <p className="text-sm text-slate-400">אין עובדים עם התפקיד הזה.</p>}
        <button onClick={onClose} className="mt-3 text-sm text-slate-500 hover:text-slate-800">סגור</button>
      </div>
    </div>
  );
}
