import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChatMessage, type Conversation } from '../lib/api';

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '');
const initials = (n: string) => n.trim().slice(0, 2);

// Floating chat launcher (bottom-left) — a compact WhatsApp-style panel: conversation
// list, tap into a thread. Read-only WhatsApp archive; mirrors the copilot pattern.
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const loadConvos = useCallback(() => api.chatConversations().then(setConvos).catch(() => {}), []);
  useEffect(() => { loadConvos(); const t = setInterval(loadConvos, 15000); return () => clearInterval(t); }, [loadConvos]);

  const loadThread = useCallback((id: string) => api.chatThread(id).then(setThread).catch(() => setThread([])), []);
  useEffect(() => {
    if (!open || !selected) return;
    loadThread(selected);
    const t = setInterval(() => { loadThread(selected); loadConvos(); }, 7000); // keep the archive fresh
    return () => clearInterval(t);
  }, [open, selected, loadThread, loadConvos]);
  useEffect(() => { if (open && selected) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread, open, selected]);

  const list = convos.filter((c) => c.name.includes(search.trim()));
  const current = convos.find((c) => c.employeeId === selected) ?? null;
  const totalUnread = convos.reduce((s, c) => s + c.unread, 0);
  const bubble = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );

  return (
    <>
      {open && (
        <div className="fixed bottom-24 left-4 md:left-6 z-40 w-[min(92vw,380px)] h-[min(70vh,560px)] bg-white rounded-2xl shadow-pop border border-black/[0.08] flex flex-col overflow-hidden animate-fade-in">
          <header className="px-3.5 py-3 flex items-center gap-2.5 bg-gradient-to-l from-pine to-pine-dark text-white">
            {current && (
              <button onClick={() => setSelected(null)} title="חזרה" className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center text-lg leading-none">→</button>
            )}
            <span className="shrink-0">{current ? (
              <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">{initials(current.name)}</span>
            ) : bubble}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{current ? current.name : 'היסטוריית שיחות'}</div>
              <div className="text-[11px] opacity-80 truncate">{current ? <span dir="ltr">{current.phone}</span> : 'וואטסאפ · תיעוד לצפייה'}</div>
            </div>
            <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center">✕</button>
          </header>

          {!current ? (
            <>
              <div className="p-2.5 border-b border-black/[0.06]">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש עובד…" className="w-full border border-black/[0.1] rounded-xl px-3 py-2 text-sm outline-none focus:border-pine" />
              </div>
              <div className="flex-1 overflow-y-auto">
                {list.map((c) => (
                  <button key={c.employeeId} onClick={() => setSelected(c.employeeId)} className="w-full text-right px-3 py-2.5 flex items-center gap-3 border-b border-black/[0.04] hover:bg-black/[0.03] transition">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pine to-pine-dark text-white flex items-center justify-center text-xs font-bold shrink-0">{initials(c.name)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm text-ink truncate">{c.name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{time(c.lastAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 truncate">{c.lastDir === 'out' ? '↩ ' : ''}{c.lastBody ?? 'אין הודעות'}</span>
                        {c.unread > 0 && <span className="text-[10px] bg-pine text-white rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center shrink-0">{c.unread}</span>}
                      </div>
                    </div>
                  </button>
                ))}
                {list.length === 0 && <p className="text-sm text-slate-400 text-center pt-8">אין שיחות.</p>}
              </div>
            </>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5" style={{ background: '#eef1f2' }}>
                {thread.map((m) => (
                  <div key={m.id} className={`max-w-[78%] rounded-xl px-3 py-1.5 text-sm ${m.direction === 'out' ? 'self-end bg-pine-light text-pine-dark' : 'self-start bg-white text-slate-800 border border-black/[0.05]'}`}>
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`text-[10px] mt-0.5 text-left ${m.direction === 'out' ? 'text-pine' : 'text-slate-400'}`}>{time(m.createdAt)}{m.direction === 'out' && m.failed ? ' · נכשל' : ''}</div>
                  </div>
                ))}
                {thread.length === 0 && <div className="text-center text-slate-400 text-sm pt-8">אין עדיין הודעות בשיחה זו.</div>}
                <div ref={endRef} />
              </div>
              <div className="px-3 py-2 border-t border-black/[0.06] text-center text-[11px] text-slate-400 bg-white">
                תיעוד שיחות בלבד — ההודעות מגיעות ונשלחות דרך וואטסאפ
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 left-4 md:left-6 z-40 flex items-center gap-2 pr-4 pl-3 py-3 rounded-full text-white shadow-pop bg-gradient-to-l from-pine to-pine-dark hover:brightness-105 active:scale-95 transition"
      >
        {bubble}
        <span className="text-sm font-medium hidden sm:inline">{open ? 'סגור' : 'היסטוריית שיחות'}</span>
        {!open && totalUnread > 0 && (
          <span className="absolute -top-1 left-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ring-2 ring-white">{totalUnread}</span>
        )}
      </button>
    </>
  );
}
