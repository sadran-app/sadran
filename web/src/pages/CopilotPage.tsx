import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface Msg { role: 'user' | 'bot'; text: string }

// Floating copilot: a pill button bottom-right that opens a small chat popup.
export function CopilotWidget() {
  const [open, setOpen] = useState(false);
  const [chips, setChips] = useState<string[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'bot', text: 'שלום! אני העוזר החכם שלך 🤖\nשאל אותי כל דבר על העובדים והסידור, או בחר שאלה למטה.' },
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && chips.length === 0) api.copilotSuggestions().then((r) => setChips(r.suggestions)).catch(() => {});
  }, [open, chips.length]);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy, open]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setText('');
    setBusy(true);
    try {
      const r = await api.askCopilot(question);
      setMsgs((m) => [...m, { role: 'bot', text: r.answer }]);
      if (r.suggestions) setChips(r.suggestions);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 md:right-6 z-40 w-[min(92vw,380px)] h-[min(70vh,560px)] bg-white rounded-2xl shadow-pop border border-slate-200 flex flex-col overflow-hidden animate-fade-in">
          <header className="px-4 py-3 border-b border-slate-100 flex items-center gap-2.5 bg-gradient-to-l from-violet-500 to-indigo-600 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" strokeLinecap="round" /></svg>
            <div className="flex-1">
              <div className="font-semibold text-sm">התייעצות עם AI</div>
              <div className="text-[11px] opacity-80">על סמך הנתונים שלך · חינם</div>
            </div>
            <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center">✕</button>
          </header>

          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2" style={{ background: '#f7f8fa' }}>
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === 'user' ? 'self-end bg-ink text-white' : 'self-start bg-white border border-slate-100 text-slate-800'}`}>{m.text}</div>
            ))}
            {busy && <div className="self-start text-xs text-slate-400 px-2">חושב…</div>}
            <div ref={endRef} />
          </div>

          {chips.length > 0 && (
            <div className="px-2.5 py-2 border-t border-slate-100 flex gap-1.5 flex-wrap">
              {chips.map((c) => (
                <button key={c} onClick={() => ask(c)} className="text-[11px] px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-100">{c}</button>
              ))}
            </div>
          )}

          <div className="p-2.5 border-t border-slate-100 flex items-center gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask(text)} placeholder="שאל את הקופיילוט…" className="flex-1 border border-slate-200 rounded-full px-3.5 py-1.5 text-sm outline-none focus:border-violet-400" />
            <button onClick={() => ask(text)} disabled={busy || !text.trim()} className="w-9 h-9 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-50 shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-4 md:right-6 z-40 flex items-center gap-2 pr-4 pl-3 py-3 rounded-full text-white shadow-pop bg-gradient-to-l from-violet-500 to-indigo-600 hover:brightness-105 active:scale-95 transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" strokeLinecap="round" /></svg>
        <span className="text-sm font-medium hidden sm:inline">{open ? 'סגור' : 'התייעץ עם AI'}</span>
      </button>
    </>
  );
}
