import type { ReactNode } from 'react';

/** Shimmering placeholder block. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Generic content skeleton while a screen loads. */
export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

/** Centered brand spinner for full-screen waits. */
export function Spinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-9 h-9 rounded-full border-[3px] border-brand/25 border-t-brand animate-spin" />
    </div>
  );
}

/** Friendly empty state with an optional call-to-action. */
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card ledger p-10 sm:p-14 text-center flex flex-col items-center gap-2.5 animate-scale-in">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-light to-pine-light text-brand-dark flex items-center justify-center mb-1 ring-1 ring-black/[0.04]">
        {icon ?? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-8 h-8"><path d="M12 3v18M3 12h18" strokeLinecap="round" /></svg>
        )}
      </div>
      <h3 className="text-xl font-display font-extrabold text-ink text-balance">{title}</h3>
      {hint && <p className="text-sm text-slate-500 max-w-md leading-relaxed">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
