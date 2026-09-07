import { useEffect, useState } from 'react';
import { api, DAY_NAMES, LOAD_LEVELS, type ForecastResult } from '../lib/api';

// Smart staffing recommendation, learned from the org's own published history and
// scaled by the expected busyness of each shift. Lives in Settings, by the demand
// editor, and applies straight to it.
export function ForecastPanel({ onApplied }: { onApplied: () => void }) {
  const [data, setData] = useState<ForecastResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.getForecast().then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 1800); };
  const diffs = (data?.slots ?? []).filter((s) => s.recommended !== s.current);

  const apply = async (items: { slotId: string; count: number }[]) => {
    if (!items.length) return;
    setBusy(true);
    try {
      const r = await api.applyForecast(items);
      flash(`עודכנו ${r.updated} דרישות ✓`);
      await load();
      onApplied();
    } finally { setBusy(false); }
  };

  // set expected busyness of a shift → recommendations rescale live (no demand change)
  const setLoad = async (shiftId: string, level: number) => {
    setData((d) => d && ({ ...d, loads: d.loads.map((l) => (l.shiftId === shiftId ? { ...l, level } : l)) }));
    setBusy(true);
    try { await api.setForecastLoad([{ shiftId, level }]); await load(); } finally { setBusy(false); }
  };

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold">חיזוי ביקוש — המלצת איוש חכמה</h2>
        {diffs.length > 0 && (
          <button onClick={() => apply(diffs.map((s) => ({ slotId: s.slotId, count: s.recommended })))} disabled={busy} className="btn-primary text-sm whitespace-nowrap">
            החל את כל ההמלצות ({diffs.length})
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-4">
        {data ? `סמן עומס צפוי לכל משמרת, והמערכת ממליצה על איוש לפי ${data.publishedWeeks} שבועות שפורסמו — משוקלל לפי עדכניות ומנורמל לעומס.` : 'טוען המלצות…'}
      </p>

      {data && data.publishedWeeks < 2 && (
        <div className="mb-3 rounded-lg bg-slate-50 border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
          עדיין אין מספיק סידורים מפורסמים להמלצה מבוססת — אבל אפשר כבר לסמן עומס צפוי, והמערכת תלמד ככל שתפרסם.
        </div>
      )}

      {data && data.loads.length === 0 && (
        <div className="text-sm text-slate-400">לא הוגדרו עדיין משמרות עם דרישות איוש.</div>
      )}

      <div className="space-y-2.5">
        {(data?.loads ?? []).map((shift) => {
          const slots = (data?.slots ?? []).filter((s) => s.shiftId === shift.shiftId);
          return (
            <div key={shift.shiftId} className="border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-medium">
                  יום {DAY_NAMES[shift.dayIndex]} · {shift.label} <span className="text-slate-400" dir="ltr">{shift.startTime}–{shift.endTime}</span>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  עומס צפוי
                  <select
                    value={shift.level}
                    onChange={(e) => setLoad(shift.shiftId, Number(e.target.value))}
                    disabled={busy}
                    className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white"
                  >
                    {LOAD_LEVELS.map((l) => <option key={l.level} value={l.level}>{l.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="space-y-1">
                {slots.map((s) => {
                  const changed = s.recommended !== s.current;
                  const up = s.recommended > s.current;
                  return (
                    <div key={s.slotId} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <span className="text-slate-700">{s.roleName}</span>
                        <span className="text-slate-400 text-xs mr-1.5">
                          {s.weeksOfData >= 2 ? `ממוצע ${s.avgFilled} · ${s.weeksOfData} שב׳` : 'אין היסטוריה'}
                          {s.swaps > 0 ? ` · ${s.swaps} נטישות` : ''}{s.forced > 0 ? ` · ${s.forced} כפייה` : ''}
                        </span>
                        {s.signals.filter((x) => !x.includes('אין מספיק')).map((sig, i) => (
                          <div key={i} className="text-[11px] text-amber-600">• {sig}</div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {changed ? (
                          <>
                            <span className="text-slate-400">{s.current}</span>
                            <span className={up ? 'text-emerald-600' : 'text-red-500'}>→</span>
                            <span className={`font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`}>{s.recommended}</span>
                            <button onClick={() => apply([{ slotId: s.slotId, count: s.recommended }])} disabled={busy} className="text-xs px-2.5 py-1 rounded-md border border-slate-300 hover:bg-slate-50">החל</button>
                          </>
                        ) : (
                          <span className="text-slate-500">{s.current} <span className="text-emerald-500">✓</span></span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {msg && <div className="text-sm text-emerald-600 mt-3">{msg}</div>}
    </section>
  );
}
