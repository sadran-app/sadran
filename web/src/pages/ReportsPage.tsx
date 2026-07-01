import { useEffect, useState } from 'react';
import { api, type OrgReport } from '../lib/api';

export function ReportsPage() {
  const [data, setData] = useState<OrgReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getReports().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="rounded-md bg-red-100 text-red-800 px-4 py-2 text-sm">{error}</div>;
  if (!data) return <div className="text-slate-500">טוען דוחות…</div>;

  const s = data.summary;
  const cards: { label: string; value: string; tone: string }[] = [
    { label: 'עובדים פעילים', value: String(s.activeEmployees), tone: 'text-slate-900' },
    { label: 'שבועות עם נתונים', value: String(s.weeks), tone: 'text-slate-900' },
    { label: 'סה״כ משמרות', value: String(s.totalShifts), tone: 'text-sky-700' },
    { label: 'סה״כ שעות', value: String(s.totalHours), tone: 'text-violet-700' },
    { label: 'עלות שכר', value: '₪' + s.totalLaborCost.toLocaleString(), tone: 'text-emerald-700' },
    { label: 'אחוז כיסוי', value: s.coverageRate + '%', tone: s.coverageRate >= 90 ? 'text-emerald-700' : 'text-amber-600' },
    { label: 'חוסרים פתוחים', value: String(s.openGaps), tone: s.openGaps > 0 ? 'text-red-600' : 'text-emerald-700' },
    { label: 'קטינים', value: String(s.minors), tone: 'text-slate-900' },
    { label: 'החלפות שבוצעו', value: String(s.totalSwaps), tone: 'text-slate-900' },
    { label: 'ממוצע שעות לעובד', value: String(s.avgHoursPerEmployee), tone: 'text-slate-900' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className={`text-2xl font-bold ${c.tone}`}>{c.value}</div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">פירוט לפי עובד</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b text-right">
                <th className="py-2 font-medium">עובד</th>
                <th className="py-2 font-medium">תפקידים</th>
                <th className="py-2 font-medium text-center">גיל</th>
                <th className="py-2 font-medium text-center">משמרות</th>
                <th className="py-2 font-medium text-center">שעות</th>
                <th className="py-2 font-medium text-center">ממוצע/שבוע</th>
                <th className="py-2 font-medium text-center">סופ״ש</th>
                <th className="py-2 font-medium text-center">סגירות</th>
                <th className="py-2 font-medium text-center">עלות שכר</th>
                <th className="py-2 font-medium text-center">הפיל</th>
                <th className="py-2 font-medium text-center">כיסה</th>
                <th className="py-2 font-medium">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <tr key={e.id} className={`border-b last:border-0 ${e.active ? '' : 'opacity-50'}`}>
                  <td className="py-2 font-medium text-slate-800">{e.name}</td>
                  <td className="py-2 text-slate-500">{e.roleNames.join(' · ')}</td>
                  <td className="py-2 text-center">{e.age ?? '—'}</td>
                  <td className="py-2 text-center font-semibold">{e.shifts}</td>
                  <td className="py-2 text-center">{e.hours}</td>
                  <td className="py-2 text-center">{e.avgShiftsPerWeek}</td>
                  <td className="py-2 text-center">{e.weekendShifts}</td>
                  <td className="py-2 text-center">{e.closingShifts}</td>
                  <td className="py-2 text-center">₪{e.laborCost.toLocaleString()}</td>
                  <td className="py-2 text-center">{e.swapOuts || '—'}</td>
                  <td className="py-2 text-center">{e.swapIns || '—'}</td>
                  <td className="py-2">
                    <div className="flex gap-1 flex-wrap">
                      {!e.active && <Tag color="slate">לא פעיל</Tag>}
                      {e.isMinor && <Tag color="amber">קטין</Tag>}
                      {e.belowMin && e.active && <Tag color="red">מתחת למינ׳</Tag>}
                      {e.optInStatus === 'pending' && <Tag color="sky">ממתין לאישור</Tag>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tag({ color, children }: { color: 'slate' | 'amber' | 'red' | 'sky'; children: React.ReactNode }) {
  const map = {
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    sky: 'bg-sky-100 text-sky-700',
  };
  return <span className={`text-[11px] px-2 py-0.5 rounded-full ${map[color]}`}>{children}</span>;
}
