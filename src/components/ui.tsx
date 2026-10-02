import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type { ISODate } from '../types';
import { cls } from '../lib/id';

export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string; className?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cls('seg', className)}>
      {options.map((o) => (
        <button key={o.value} title={o.title} className={cls(o.value === value && 'on', o.className)} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A button that opens the native date picker. */
export function DateButton({ value, onPick, title = 'Pick a date', children, className }: {
  value?: ISODate | null;
  onPick: (d: ISODate) => void;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className={cls('date-btn', className)}>
      <button
        type="button"
        className="icon-btn"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          try {
            ref.current?.showPicker();
          } catch {
            ref.current?.focus();
          }
        }}
      >
        {children ?? <CalendarDays size={14} />}
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        value={value ?? ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => e.target.value && onPick(e.target.value)}
      />
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** Enter-to-submit that respects Chinese/Japanese IME composition. */
export const isSubmitKey = (e: React.KeyboardEvent) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229;

/** Text input that saves on blur / Enter, so typing doesn't create a history entry per keystroke. */
export function BlurInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => isSubmitKey(e) && (e.target as HTMLInputElement).blur()}
    />
  );
}
