import { Clock, GripVertical, Signal } from 'lucide-react';
import type { DaySort } from '../types';
import { S, useStore } from '../store';
import { cls } from '../lib/id';

export const SORT_MODES: { mode: DaySort; label: string; tip: string }[] = [
  { mode: 'time', label: 'By time', tip: 'Things with a time come first, in clock order; the rest keep your order.' },
  { mode: 'importance', label: 'By importance', tip: 'Must → Should → Could (a near deadline counts). Finished items sink to the bottom.' },
  { mode: 'importance-time', label: 'Importance, then time', tip: 'Must → Should → Could; within each level, by clock time.' },
  { mode: 'manual', label: 'My order', tip: 'Exactly the order you dragged them into.' },
];

export function SortIcon({ mode, size = 14 }: { mode: DaySort; size?: number }) {
  if (mode === 'time') return <Clock size={size} />;
  if (mode === 'importance') return <Signal size={size} />;
  if (mode === 'manual') return <GripVertical size={size} />;
  return (
    <span className="sort-combo">
      <Signal size={size - 2} />
      <Clock size={size - 4} />
    </span>
  );
}

/** One click cycles the sort mode for every day. Sorting only changes the display — your own order is kept. */
export function SortToggle() {
  const mode = useStore((s) => s.settings.daySort ?? 'time');
  const i = SORT_MODES.findIndex((m) => m.mode === mode);
  const cur = SORT_MODES[i];
  const next = SORT_MODES[(i + 1) % SORT_MODES.length];
  return (
    <button
      className={cls('icon-btn sort-toggle', mode !== 'time' && 'active')}
      data-tip={`Sort: ${cur.label}\n${cur.tip}\nClick → ${next.label}`}
      aria-label={`Sort: ${cur.label}. Click for ${next.label}`}
      onClick={() => {
        S().setSettings({ daySort: next.mode });
        S().toast(`Days sorted: ${next.label} — ${next.tip}`, undefined, 3000);
      }}
    >
      <SortIcon mode={mode} />
    </button>
  );
}
