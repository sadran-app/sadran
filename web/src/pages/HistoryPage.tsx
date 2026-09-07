import { useEffect, useMemo, useState } from 'react';
import { api, DAY_NAMES, WEEKEND_DAYS, type Config, type CycleSummary, type CycleView } from '../lib/api';

const STATUS: Record<string, { label: string; cls: string }> = {
  collecting: { label: 'באיסוף זמינות', cls: 'bg-sky-100 text-sky-700' },
  proposed: { label: 'טיוטה', cls: 'bg-amber-100 text-amber-700' },
  published: { label: 'פורסם', cls: 'bg-emerald-100 text-emerald-700' },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function HistoryPage({ config }: { config: Config }) {
  const [cycles, setCycles] = useState<CycleSummary[]>([]);
  const [detail, setDetail] = useState<CycleView | null>(null);

  const load = () => api.listCycles().then(setCycles);
  useEffect(() => {
    load();
  }, []);

  if (detail) return <WeekView config={config} detail={detail} onBack={() => setDetail(null)} />;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">ארכיון סידורים</h2>
        <p className="text-xs text-slate-400 mt-1">כל הסידורים השבועיים שנוצרו. ליצירת סידור חדש — עבור ללשונית "סידור" ולחץ "צור סידור".</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cycles.map((c) => (
          <button key={c.id} onClick={() => api.getCycleDetail(c.id).then(setDetail)} className="card p-5 text-right hover:shadow-pop transition group">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-ink">שבוע {fmtDate(c.weekStartDate)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[c.status]?.cls ?? 'bg-slate-100 text-slate-600'}`}>
                {STATUS[c.status]?.label ?? c.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <Stat label="משמרות" value={String(c.shifts)} />
              <Stat label="שעות" value={String(c.hours)} />
              <Stat label="עלות שכר" value={'₪' + c.laborCost.toLocaleString()} />
              <Stat label="כיסוי" value={c.coverageRate + '%'} tone={c.coverageRate >= 90 ? 'text-emerald-600' : 'text-amber-600'} />
              {c.gaps > 0 && <Stat label="חוסרים" value={String(c.gaps)} tone="text-red-600" />}
            </div>
            <div className="mt-3 text-xs text-brand opacity-0 group-hover:opacity-100 transition">צפייה בסידור ←</div>
          </button>
        ))}
        {cycles.length === 0 && <p className="text-slate-400">אין עדיין סידורים בארכיון.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className={`font-semibold ${tone ?? 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

// read-only view of one archived week
function WeekView({ config, detail, onBack }: { config: Config; detail: CycleView; onBack: () => void }) {
  const roleName = useMemo(() => Object.fromEntries(config.roles.map((r) => [r.id, r.name])), [config.roles]);
  const shiftsByDay = useMemo(() => {
    const m = new Map<number, typeof config.shifts>();
    for (const s of config.shifts) {
      const list = m.get(s.dayIndex) ?? [];
      list.push(s);
      m.set(s.dayIndex, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.order - b.order);
    return m;
  }, [config.shifts]);
  const bySlot = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of detail.assignments) {
      const list = m.get(a.slotId) ?? [];
      list.push(a.employeeName);
      m.set(a.slotId, list);
    }
    return m;
  }, [detail]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-soft">→ חזרה לארכיון</button>
        <h2 className="text-lg font-semibold">סידור שבוע {fmtDate(detail.cycle.weekStartDate)}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[detail.cycle.status]?.cls}`}>{STATUS[detail.cycle.status]?.label}</span>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ direction: 'rtl' }}>
          {DAY_NAMES.map((dname, day) => (
            <div key={day} className="min-w-[180px] flex-1">
              <div className={`rounded-t-2xl px-3 py-2 text-center font-semibold text-sm ${WEEKEND_DAYS.includes(day) ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-600'}`}>{dname}</div>
              <div className="bg-white rounded-b-2xl border-x border-b border-slate-100 shadow-soft p-2 space-y-3 min-h-[100px]">
                {(shiftsByDay.get(day) ?? []).map((s) => (
                  <div key={s.id}>
                    <div className="text-xs text-slate-500 font-medium border-b pb-1 mb-1">{s.label} · {s.startTime}–{s.endTime}</div>
                    {s.slots.slice().sort((a, b) => a.startTime.localeCompare(b.startTime)).map((sl) => {
                      const names = bySlot.get(sl.id) ?? [];
                      return (
                        <div key={sl.id} className="mb-1.5">
                          <div className="text-[10px] text-slate-400">{roleName[sl.roleId]} · {sl.startTime}</div>
                          {names.map((n, i) => (
                            <div key={i} className="text-xs bg-slate-100 rounded-md px-2 py-1 mt-0.5">{n}</div>
                          ))}
                          {names.length === 0 && <div className="text-[11px] text-red-400 mt-0.5">— חסר —</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
