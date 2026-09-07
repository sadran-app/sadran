import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '../components/ui';
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

// The dd/mm date of a given weekday within the cycle's week (weekStartDate = Sunday, UTC).
function dayDate(weekStartISO: string | undefined, day: number): string {
  if (!weekStartISO) return '';
  const d = new Date(weekStartISO);
  d.setUTCDate(d.getUTCDate() + day);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// A readable weekly grid: a big days header row across the top, and under each day
// the shifts with their assigned employees. Built as a real styled .xlsx (exceljs is
// dynamically imported so it never bloats the main bundle).
async function exportScheduleXlsx(cycle: CycleView, config: Config, orgName: string) {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const week = dayDate(cycle.cycle.weekStartDate, 0);
  const ws = wb.addWorksheet('סידור', { views: [{ rightToLeft: true, showGridLines: false }] });

  const BRAND = 'FF0D9488', BRAND_DK = 'FF0F766E', INK = 'FF0F172A', MUTED = 'FF64748B', LIGHT = 'FFF1F5F9', WHITE = 'FFFFFFFF';
  const thin = { style: 'thin' as const, color: { argb: 'FFE2E8F0' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const days = [0, 1, 2, 3, 4, 5, 6];
  const N = days.length;

  type Line = { text: string; kind: 'shift' | 'emp' | 'empty'; forced?: boolean };
  const shiftsByDay = days.map((day) => config.shifts.filter((s) => s.dayIndex === day).sort((a, b) => a.order - b.order || a.startTime.localeCompare(b.startTime)));
  const maxGroups = Math.max(1, ...shiftsByDay.map((s) => s.length));

  // Lines for the g-th shift of a given day (its header + employees), or [] if that
  // day has no such shift. Grouping by shift index keeps the morning blocks (and the
  // evening blocks) ALIGNED across the whole week. Employee line: start time, then name.
  const groupLines = (dayIdx: number, g: number): Line[] => {
    const shift = shiftsByDay[dayIdx]?.[g];
    if (!shift) return [];
    const out: Line[] = [{ text: `${shift.label}   ${shift.startTime}–${shift.endTime}`, kind: 'shift' }];
    const asgs = cycle.assignments
      .filter((a) => a.shiftId === shift.id)
      .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.employeeName.localeCompare(b.employeeName));
    if (asgs.length) for (const a of asgs) out.push({ text: `${a.startTime}    ${a.employeeName}`, kind: 'emp', forced: a.forced });
    else out.push({ text: '— טרם שובץ —', kind: 'empty' });
    return out;
  };

  // title
  ws.mergeCells(1, 1, 1, N);
  const title = ws.getCell(1, 1);
  title.value = `סידור עבודה שבועי${orgName ? ' — ' + orgName : ''}${week ? '    (שבוע ' + week + ')' : ''}`;
  title.font = { name: 'Arial', size: 16, bold: true, color: { argb: WHITE } };
  title.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_DK } };
  ws.getRow(1).height = 32;

  // big days header
  const HDR = 2;
  days.forEach((day, i) => {
    const c = ws.getCell(HDR, i + 1);
    const date = dayDate(cycle.cycle.weekStartDate, day);
    c.value = `${DAY_NAMES[day]}${date ? '\n' + date : ''}`;
    c.font = { name: 'Arial', size: 14, bold: true, color: { argb: WHITE } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WEEKEND_DAYS.includes(day) ? BRAND_DK : BRAND } };
    c.border = border;
  });
  ws.getRow(HDR).height = 42;

  // body — one ALIGNED block per shift index (all mornings, then a 2-row gap, then all
  // evenings, …). Each block is as tall as the busiest day's shift that week.
  const styleCell = (row: number, col: number, line?: Line) => {
    const c = ws.getCell(row, col);
    c.border = border;
    if (!line) { c.value = ''; return; }
    c.value = line.text;
    // readingOrder RTL: without it a cell that STARTS with a number (the time) is
    // auto-detected as LTR and the time jumps to the wrong side. Forcing RTL keeps
    // the time first (rightmost), then the name.
    c.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, indent: 1, readingOrder: 'rtl' };
    if (line.kind === 'shift') { c.font = { name: 'Arial', size: 11.5, bold: true, color: { argb: INK } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; }
    else if (line.kind === 'emp') c.font = { name: 'Arial', size: 11, color: { argb: INK } };
    else c.font = { name: 'Arial', size: 10, italic: true, color: { argb: MUTED } };
  };
  const GAP = 2; // clean blank rows between shift blocks
  let curRow = HDR + 1;
  for (let g = 0; g < maxGroups; g++) {
    const linesPerDay = days.map((_, i) => groupLines(i, g));
    const blockH = Math.max(1, ...linesPerDay.map((l) => l.length));
    for (let r = 0; r < blockH; r++) {
      days.forEach((_, i) => styleCell(curRow + r, i + 1, linesPerDay[i]?.[r]));
      ws.getRow(curRow + r).height = 19;
    }
    curRow += blockH + (g < maxGroups - 1 ? GAP : 0);
  }

  for (let i = 1; i <= N; i++) ws.getColumn(i).width = 27;

  // footer note
  const fr = curRow + 1;
  ws.mergeCells(fr, 1, fr, N);
  const foot = ws.getCell(fr, 1);
  foot.value = `⚠ כפוי = שיבוץ בכפייה, דורש אישור   ·   הופק ${new Date().toLocaleDateString('he-IL')} ע״י סַדְרָן`;
  foot.font = { name: 'Arial', size: 9, italic: true, color: { argb: MUTED } };
  foot.alignment = { horizontal: 'center' };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `סידור-${week || new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

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

  // 2.4a — per-day coverage (required vs missing) for the heatmap headers
  const coverageByDay = useMemo(() => {
    const m = new Map<number, { required: number; missing: number; pct: number }>();
    for (const s of config.shifts) {
      const cur = m.get(s.dayIndex) ?? { required: 0, missing: 0, pct: 100 };
      for (const sl of s.slots) {
        cur.required += sl.count;
        cur.missing += missingBySlot.get(sl.id) ?? 0;
      }
      m.set(s.dayIndex, cur);
    }
    for (const c of m.values()) c.pct = c.required > 0 ? Math.round(((c.required - c.missing) / c.required) * 100) : 100;
    return m;
  }, [config.shifts, missingBySlot]);

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

  const generate = (optimize = false) =>
    act(async () => {
      const r = await api.generate(optimize);
      // if the user asked to optimize but the solver was unavailable, the server fell back to greedy
      const note = optimize && r.engine !== 'optimal' ? ' (מנוע אופטימלי לא זמין — נוצר במנוע הרגיל)' : '';
      setMessage(`נוצר סידור: ${r.assigned} שיבוצים${note}${r.warnings.length ? ` · ${r.warnings.join(' · ')}` : ''}`);
    });
  const publish = () => act(() => api.publish(), 'הסידור פורסם — הודעות נשלחו לעובדים.');
  const openNext = () =>
    act(async () => {
      const r = await api.openNext();
      setMessage(`נפתח סידור חדש לשבוע ${new Date(r.weekStartDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}. אספו זמינות והריצו "צור סידור".`);
    });
  const reset = () => {
    if (!window.confirm('האם אתה בטוח שברצונך למחוק את כל המשובצים לסידור הנוכחי?')) return;
    act(() => api.resetSchedule(), 'הסידור אופס — אפשר למלא מחדש.');
  };
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

  // 2.2a — start this week from last week's schedule
  const copyPrev = () =>
    act(async () => {
      const r = await api.copyPrevious();
      setMessage(r.copied ? `הועתקו ${r.copied} שיבוצים מהשבוע הקודם${r.skipped ? ` · ${r.skipped} דולגו (לא זמינים/חוקיים לשבוע זה)` : ''}` : 'אין שיבוצים להעתקה מהשבוע הקודם.');
    });
  // 2.3 — pin / unpin
  const toggleLock = (a: Assignment) => act(() => api.lockAssignment(a.id, !a.locked));
  // 2.1 — drag & drop between seats
  const [dragId, setDragId] = useState<string | null>(null);
  // optimal-engine toggle: ON → "צור סידור" runs the math brain (auto-falls back to the
  // regular engine if it's unavailable); OFF → the regular engine only.
  const [optimal, setOptimal] = useState(false);
  const dropOn = (slotId: string) => {
    const id = dragId;
    setDragId(null);
    if (!id) return;
    act(async () => {
      try {
        const r = await api.moveAssignment(id, slotId, false);
        if (r.warning?.length) setMessage('הועבר עם אזהרה: ' + r.warning.join(' · '));
      } catch (e) {
        if (window.confirm(`לא ניתן להעביר לשיבוץ הזה:\n${(e as Error).message}\n\nלהעביר בכל זאת (כפייה)?`)) {
          await api.moveAssignment(id, slotId, true);
          setMessage('הועבר בכפייה — חריגה מהכללים.');
        }
      }
    });
  };
  // 2.6 — per-day manager note
  const saveNote = (dayIndex: number, text: string) => {
    if ((cycle?.cycle.dayNotes?.[dayIndex] ?? '') === text.trim()) return; // unchanged
    act(() => api.setDayNote(dayIndex, text));
  };

  const status = cycle?.cycle.status;
  const dayNotes = cycle?.cycle.dayNotes ?? {};
  const forcedList = (cycle?.assignments ?? []).filter((a) => a.forced);

  if (config.shifts.length === 0) {
    return (
      <EmptyState
        icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-8 h-8"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" /></svg>}
        title="בונים את לוח המשמרות"
        hint="עדיין לא הוגדרו משמרות. עברו ללשונית ההגדרות, הגדירו את מבנה המשמרות והדרישות לכל יום — ואז נוכל ליצור סידור אוטומטי."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        {/* build controls — uniform sizes */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => generate(optimal)} disabled={busy} className="btn-primary">צור סידור</button>
          {cycle && cycle.assignments.length === 0 && (
            <button onClick={copyPrev} disabled={busy} className="btn-soft" title="התחל את השבוע מהעתקת הסידור של השבוע הקודם">שכפל שבוע קודם</button>
          )}
          {cycle && cycle.assignments.length > 0 && (
            <button onClick={reset} disabled={busy} className="btn-soft !text-red-600 hover:!border-red-300" title="מחיקת כל השיבוצים">אפס סידור</button>
          )}
          {status === 'published' && (
            <button onClick={openNext} disabled={busy} className="btn-soft" title="פתיחת סידור לשבוע הבא">פתח שבוע הבא ←</button>
          )}
          {cycle && cycle.assignments.length > 0 && (
            <button onClick={() => exportScheduleXlsx(cycle, config, config.org.name).catch(() => {})} className="btn-soft" title="ייצוא הסידור לאקסל">ייצוא</button>
          )}
          {cycle && cycle.assignments.length > 0 && (
            <button onClick={() => window.print()} className="btn-soft" title="הדפסת הסידור">הדפסה</button>
          )}
        </div>

        {/* status + dominant publish (far left in RTL) */}
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            {cycle && (
              <div className="text-sm text-slate-500">
                שבוע {new Date(cycle.cycle.weekStartDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}
                {status && ` · ${status === 'collecting' ? 'איסוף' : status === 'proposed' ? 'טיוטה' : 'פורסם'}`}
              </div>
            )}
            {cycle && cycle.gaps.length > 0 && (
              <div className="text-xs text-red-600 font-semibold">{cycle.gaps.reduce((s, g) => s + g.missing, 0)} משבצות ללא איוש</div>
            )}
          </div>
          <button
            onClick={publish}
            disabled={busy || !cycle?.assignments.length}
            className="btn-success !px-6 !py-3 text-base shadow-pop gap-2"
            title="פרסום הסידור ושליחתו לעובדים בוואטסאפ"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-5 h-5"><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            פרסם סידור
          </button>
        </div>
      </div>

      <div className="print:hidden">
        <OptimalToggle value={optimal} onChange={setOptimal} disabled={busy} />
      </div>

      {message && <div className="rounded-xl bg-ink text-white text-sm px-4 py-2.5">{message}</div>}

      {/* 2.4b — live labour cost of the current draft vs the weekly budget */}
      {cycle?.cost && cycle.assignments.length > 0 && <CostBar cost={cycle.cost} />}

      {avStatus && (() => {
        const done = avStatus.employees.filter((e) => e.responded).length;
        const total = avStatus.employees.length;
        const missing = avStatus.employees.filter((e) => !e.responded);
        return (
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
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

      {/* 2.4a — coverage heatmap legend */}
      <div className="flex items-center gap-3 text-[11px] text-slate-400 print:hidden">
        <span>מפת כיסוי:</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-emerald-300" />מאויש</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-300" />חסר</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-sky-300" />עודף</span>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ direction: 'rtl' }}>
          {DAY_NAMES.map((dname, day) => {
            const cov = coverageByDay.get(day);
            return (
            <div key={day} className="min-w-[190px] flex-1">
              <div className={`rounded-t-2xl px-3 py-2 text-center font-semibold text-sm ${WEEKEND_DAYS.includes(day) ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-600'}`}>
                <div className="flex items-center justify-center gap-1.5">
                  {dname}
                  {cov && cov.required > 0 && (
                    <span className={`text-[10px] font-bold px-1.5 rounded-full ${cov.pct >= 100 ? 'bg-emerald-100 text-emerald-700' : cov.pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{cov.pct}%</span>
                  )}
                </div>
                {cycle && <span className="block text-[11px] font-normal opacity-70">{dayDate(cycle.cycle.weekStartDate, day)}</span>}
              </div>
              <div className="bg-white rounded-b-2xl border-x border-b border-slate-100 shadow-soft p-2 space-y-3 min-h-[120px]">
                <NoteField value={dayNotes[day] ?? ''} onSave={(text) => saveNote(day, text)} />
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
                        const isDropTarget = dragId !== null;
                        // 2.4a — colour the seat by staffing health
                        const tint = missing > 0 ? 'bg-red-50 border-red-300'
                          : cells.length > sl.count ? 'bg-sky-50 border-sky-300'
                          : cells.length > 0 ? 'bg-emerald-50 border-emerald-300'
                          : 'border-slate-200';
                        return (
                          <div
                            key={sl.id}
                            className={`mb-1.5 rounded-md transition pr-1.5 border-r-2 ${isDropTarget ? 'ring-1 ring-dashed ring-brand/40 bg-brand-light/30 border-brand/40' : tint}`}
                            onDragOver={(e) => { if (dragId) e.preventDefault(); }}
                            onDrop={() => dropOn(sl.id)}
                          >
                            <div className="text-[10px] text-slate-500 font-medium">{roleName[sl.roleId]} · {sl.startTime} · {cells.length}/{sl.count}</div>
                            <div className="flex flex-col gap-1 mt-0.5">
                              {cells.map((a) => {
                                const endT = a.endTime ?? s.endTime;
                                const partial = a.startTime !== sl.startTime || endT !== s.endTime;
                                return (
                                  <Chip key={a.id} name={a.employeeName} tier={s.colorTier} forced={a.forced} locked={a.locked} hours={partial ? `${a.startTime}–${endT}` : undefined} onRemove={() => remove(a.id)} onVacate={() => vacate(a.id)} onToggleLock={() => toggleLock(a)} onDragStart={() => setDragId(a.id)} onDragEnd={() => setDragId(null)} />
                                );
                              })}
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
            );
          })}
        </div>
      </div>

      {forcedList.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-red-700 font-semibold">⚠ שיבוצים בכפייה ({forcedList.length}) — דורשים אישור</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">לא נמצא מועמד זמין רגיל, אז המערכת מילאה את המשמרות האלה בכפייה — <b>תוך שמירה מלאה על חוקי העבודה</b> (מנוחה, שעות, עוצר קטינים). עבור עליהן ואשר.</p>
          <ul className="space-y-2">
            {forcedList.map((a) => {
              const shift = config.shifts.find((s) => s.id === a.shiftId);
              return (
                <li key={a.id} className="text-sm border-b border-red-100 last:border-0 pb-2">
                  <div className="flex justify-between items-baseline gap-2 flex-wrap">
                    <span className="font-medium text-red-800">{a.employeeName}</span>
                    <span className="text-xs text-slate-500">{DAY_NAMES[a.dayIndex]} · {shift?.label} · {a.startTime} · {roleName[a.roleId]}</span>
                  </div>
                  {a.forceReason && <div className="text-xs text-slate-600 mt-0.5">{a.forceReason}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

function Chip({ name, tier, forced, locked, hours, onRemove, onVacate, onToggleLock, onDragStart, onDragEnd }: { name: string; tier: number; forced?: boolean; locked?: boolean; hours?: string; onRemove: () => void; onVacate: () => void; onToggleLock: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const cls = forced ? 'bg-red-100 text-red-800 border-red-400 ring-1 ring-red-300' : TIER_STYLE[tier % TIER_STYLE.length];
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs cursor-grab active:cursor-grabbing ${cls} ${locked ? 'ring-1 ring-brand/60' : ''}`}
      title="גרור כדי להעביר למשמרת אחרת"
    >
      <span className="truncate flex items-center gap-1">
        {locked && <span title="מקובע — יישאר גם ביצירת סידור מחדש">📌</span>}
        {forced && <span title="שובץ בכפייה — דורש אישור">⚠</span>}
        {name}
        {hours && <span className="text-[10px] font-medium opacity-70" dir="ltr" title="שעות חלקיות — זמינות העובד מכסה רק חלק מהמשמרת">{hours}</span>}
      </span>
      <span className="flex gap-1 items-center print:hidden">
        <button title={locked ? 'שחרר קיבוע' : 'קבע — לא יזוז ביצירה מחדש'} onClick={onToggleLock} className={`transition ${locked ? 'opacity-100 text-brand-dark' : 'opacity-0 group-hover:opacity-100 hover:text-brand-dark'}`}>{locked ? '📌' : '📍'}</button>
        <button title="נפל ממשמרת" onClick={onVacate} className="opacity-0 group-hover:opacity-100 hover:text-slate-900 transition">↔</button>
        <button title="הסר" onClick={onRemove} className="opacity-0 group-hover:opacity-100 hover:text-red-700 transition">✕</button>
      </span>
    </div>
  );
}

// iOS-style switch: ON → "צור סידור" uses the optimal (math-brain) engine, which
// auto-falls back to the regular engine if unavailable; OFF → regular engine only.
function OptimalToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      title="מנוע אופטימלי (מוח מתמטי) — מאזן הוגנות והעדפות בצורה הטובה ביותר. אם אינו זמין, המערכת חוזרת אוטומטית למנוע הרגיל."
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-black/[0.09] transition hover:border-black/[0.16] select-none disabled:opacity-50"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(23,18,14,0.06)' }}
    >
      <span dir="ltr" className={`relative inline-block w-[40px] h-[22px] rounded-full transition-colors duration-200 ${value ? 'bg-brand' : 'bg-black/[0.18]'}`}>
        <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all duration-200 ${value ? 'left-[21px]' : 'left-[3px]'}`} style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }} />
      </span>
      <span className={`text-sm font-semibold transition-colors ${value ? 'text-brand-dark' : 'text-slate-500'}`}>סידור אופטימלי</span>
    </button>
  );
}

// 2.4b — live labour-cost bar for the current draft vs the weekly budget.
function CostBar({ cost }: { cost: { labor: number; hours: number; budget: number } }) {
  const { labor, hours, budget } = cost;
  const pct = budget > 0 ? Math.round((labor / budget) * 100) : 0;
  const over = budget > 0 && labor > budget;
  return (
    <div className="card p-3 flex flex-wrap items-center gap-3 print:hidden">
      <div className="text-sm whitespace-nowrap">
        <span className="text-slate-500">עלות הטיוטה:</span> <b className="text-ink">₪{labor.toLocaleString('he-IL')}</b>
        <span className="text-slate-400"> · {hours} שעות</span>
        {budget > 0 && <span className={over ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}> · {pct}% מתקציב ₪{budget.toLocaleString('he-IL')}</span>}
      </div>
      {budget > 0 ? (
        <div className="flex-1 min-w-[120px] h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      ) : (
        <span className="text-[11px] text-slate-400">הגדר תקציב שבועי בלשונית "דוחות" כדי לראות התקדמות מול יעד</span>
      )}
    </div>
  );
}

// 2.6 — compact per-day manager note; saves on blur / Enter.
function NoteField({ value, onSave }: { value: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onSave(text)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="+ הערה ליום…"
      className={`w-full text-[11px] rounded-md px-2 py-1 border transition print:border-0 print:px-0 ${value ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-transparent border-transparent hover:border-slate-200 text-slate-500'}`}
    />
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
