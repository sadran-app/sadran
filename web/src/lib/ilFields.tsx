// Locale-proof Israeli-format inputs. Native <input type="date"/"time"> render
// in the *browser's* locale (mm/dd/yyyy + AM/PM on a US machine), which we can't
// control. These text fields always show dd/mm/yyyy and 24-hour HH:MM, while
// storing the canonical ISO value ('YYYY-MM-DD' / 'HH:MM').

import { useEffect, useState } from 'react';

function isoToIl(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}
function ilToIso(il: string): string {
  const m = il.trim().replace(/[.\-]/g, '/').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const d = m[1]!.padStart(2, '0');
  const mo = m[2]!.padStart(2, '0');
  const y = m[3]!;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return '';
  return `${y}-${mo}-${d}`;
}
function normTime(s: string): string {
  const m = s.trim().match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return '';
  const h = Math.min(23, parseInt(m[1]!, 10));
  const mi = Math.min(59, parseInt(m[2]!, 10));
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

interface FieldProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}

/** dd/mm/yyyy date field. `value`/`onChange` use ISO 'YYYY-MM-DD' (empty allowed). */
export function IlDate({ value, onChange, className, placeholder = 'יום/חודש/שנה' }: FieldProps) {
  const [text, setText] = useState(isoToIl(value));
  useEffect(() => setText(isoToIl(value)), [value]);

  const commit = () => {
    if (!text.trim()) return onChange('');
    const iso = ilToIso(text);
    if (iso) {
      onChange(iso);
      setText(isoToIl(iso));
    } else {
      setText(isoToIl(value)); // invalid → revert to last good value
    }
  };

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      inputMode="numeric"
      dir="ltr"
      className={className}
    />
  );
}

/** 24-hour HH:MM time field. */
export function IlTime({ value, onChange, className, placeholder = 'שעה:דקה' }: FieldProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const commit = () => {
    const t = normTime(text);
    if (t) {
      onChange(t);
      setText(t);
    } else {
      setText(value); // invalid → revert
    }
  };

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      inputMode="numeric"
      dir="ltr"
      className={className}
    />
  );
}
