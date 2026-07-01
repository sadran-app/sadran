import { useEffect, useState } from 'react';
import { api, DAY_NAMES, type Config, type OutboxMessage, type SwapView } from '../lib/api';

export function SwapsPage({ config: _config }: { config: Config }) {
  const [swaps, setSwaps] = useState<SwapView[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [eligible, setEligible] = useState<Record<string, { id: string; name: string }[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [s, o] = await Promise.all([api.getSwaps(), api.getOutbox()]);
    setSwaps(s);
    setOutbox(o);
    // preload eligible lists for open swaps (so the manager can record who claimed)
    const open = s.filter((x) => x.status === 'open');
    const entries = await Promise.all(
      open.map(async (x) => [x.id, await api.eligibleFor(x.assignment.id)] as const),
    );
    setEligible(Object.fromEntries(entries));
  };
  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel: Record<string, string> = {
    open: 'פתוחה',
    claimed: 'נתפסה — ממתין לאישור',
    approved: 'אושרה',
    rejected: 'נדחתה',
  };
  const statusStyle: Record<string, string> = {
    open: 'bg-amber-100 text-amber-700',
    claimed: 'bg-sky-100 text-sky-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-slate-100 text-slate-500',
  };

  const active = swaps.filter((s) => s.status === 'open' || s.status === 'claimed');
  const history = swaps.filter((s) => s.status === 'approved' || s.status === 'rejected');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-100 text-red-800 px-4 py-2 text-sm">{error}</div>}

        <section className="card p-5">
          <h2 className="text-lg font-semibold mb-3">בקשות החלפה פעילות</h2>
          {active.length === 0 && <p className="text-sm text-slate-400">אין בקשות פתוחות.</p>}
          <ul className="space-y-3">
            {active.map((s) => (
              <li key={s.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm">
                    <span className="font-medium">{s.assignment.holderName}</span> נפל/ה ממשמרת:{' '}
                    {DAY_NAMES[s.assignment.dayIndex]} · {s.assignment.blockLabel} {s.assignment.waveTime} (
                    {s.assignment.roleName})
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle[s.status]}`}>
                    {statusLabel[s.status]}
                  </span>
                </div>

                {s.status === 'open' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-500">מי לקח? (זכאים):</span>
                    {(eligible[s.id] ?? []).map((e) => (
                      <button
                        key={e.id}
                        disabled={busy}
                        onClick={() => act(() => api.claim(s.id, e.id))}
                        className="text-xs bg-slate-100 hover:bg-slate-200 rounded-md px-2 py-1"
                      >
                        {e.name}
                      </button>
                    ))}
                    {(eligible[s.id] ?? []).length === 0 && (
                      <span className="text-xs text-red-500">אין עובד זכאי פנוי</span>
                    )}
                  </div>
                )}

                {s.status === 'claimed' && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      נתפסה ע״י <span className="font-medium">{s.claimedByName}</span>
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={busy}
                        onClick={() => act(() => api.approve(s.id))}
                        className="text-sm bg-emerald-600 text-white rounded-md px-3 py-1 disabled:opacity-50"
                      >
                        אשר
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => act(() => api.reject(s.id))}
                        className="text-sm bg-slate-200 rounded-md px-3 py-1 disabled:opacity-50"
                      >
                        דחה
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {history.length > 0 && (
          <section className="card p-5">
            <h2 className="text-lg font-semibold mb-3">היסטוריה</h2>
            <ul className="space-y-2 text-sm">
              {history.map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span>
                    {DAY_NAMES[s.assignment.dayIndex]} · {s.assignment.waveTime} ({s.assignment.roleName})
                    {s.claimedByName && ` → ${s.claimedByName}`}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusStyle[s.status]}`}>
                    {statusLabel[s.status]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="card p-5 h-fit">
        <h2 className="text-lg font-semibold mb-3">Outbox (MockChannel)</h2>
        <p className="text-xs text-slate-500 mb-3">מה שהיה נשלח ב-WhatsApp. שלח ידנית בינתיים.</p>
        <ul className="space-y-2 max-h-[70vh] overflow-y-auto">
          {outbox.map((m) => (
            <li key={m.id} className="border rounded-md p-2">
              <div className="text-[10px] uppercase text-slate-400">{m.kind}</div>
              <div className="text-xs whitespace-pre-wrap">{m.body}</div>
            </li>
          ))}
          {outbox.length === 0 && <li className="text-sm text-slate-400">אין הודעות עדיין.</li>}
        </ul>
      </aside>
    </div>
  );
}
