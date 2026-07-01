import { useEffect, useState } from 'react';
import { api, type Business } from '../lib/api';

export function AdminPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [form, setForm] = useState({ businessName: '', managerName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; email: string } | null>(null);

  const load = () => api.listBusinesses().then(setBusinesses).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const r = await api.createBusiness({ ...form, businessName: form.businessName.trim(), managerName: form.managerName.trim(), email: form.email.trim() });
      setCreated({ name: r.name, email: r.managerEmail });
      setForm({ businessName: '', managerName: '', email: '', password: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: Business) => {
    if (!confirm(`למחוק את "${b.name}" וכל הנתונים שלו? פעולה זו בלתי הפיכה.`)) return;
    await api.deleteBusiness(b.id);
    await load();
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
      <section className="card p-5 h-fit">
        <h2 className="text-lg font-semibold mb-1">פתיחת עסק חדש</h2>
        <p className="text-sm text-slate-500 mb-4">כל עסק/סניף מקבל חשבון נפרד. מלא את הפרטים ומסור למנהל את האימייל והסיסמה להתחברות.</p>
        <form onSubmit={create} className="space-y-3">
          <Field label="שם העסק / הסניף"><input value={form.businessName} onChange={set('businessName')} className="input" required /></Field>
          <Field label="שם המנהל"><input value={form.managerName} onChange={set('managerName')} className="input" required /></Field>
          <Field label="אימייל להתחברות"><input type="email" value={form.email} onChange={set('email')} className="input text-right" dir="ltr" required /></Field>
          <Field label="סיסמה ראשונית"><input value={form.password} onChange={set('password')} className="input" minLength={6} required /></Field>
          {error && <div className="rounded-xl bg-red-50 border border-red-100 text-red-700 px-3 py-2 text-sm">{error}</div>}
          {created && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-3 py-2 text-sm">
              נפתח "{created.name}"! מסור למנהל: <span className="font-mono" dir="ltr">{created.email}</span> והסיסמה שהזנת.
            </div>
          )}
          <button type="submit" disabled={busy} className="btn-accent w-full">{busy ? 'פותח…' : 'פתח עסק וצור חשבון'}</button>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold mb-3">עסקים במערכת ({businesses.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b text-right">
                <th className="py-2 font-medium">עסק</th>
                <th className="py-2 font-medium">מנהל</th>
                <th className="py-2 font-medium">אימייל</th>
                <th className="py-2 font-medium text-center">עובדים</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="py-2.5 font-medium text-slate-800">{b.name}</td>
                  <td className="py-2.5 text-slate-600">{b.managerName}</td>
                  <td className="py-2.5 text-slate-500 font-mono" dir="ltr">{b.managerEmail}</td>
                  <td className="py-2.5 text-center">{b.employees}</td>
                  <td className="py-2.5 text-left">
                    <button onClick={() => remove(b)} className="text-red-500 hover:text-red-700 text-xs">מחק</button>
                  </td>
                </tr>
              ))}
              {businesses.length === 0 && <tr><td colSpan={5} className="py-4 text-slate-400">אין עדיין עסקים.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
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
