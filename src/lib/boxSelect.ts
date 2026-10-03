import { useEffect } from 'react';
import { S } from '../store';

const START_PX = 6; // movement before a press becomes a box (a plain click still adds a task)
const NOT_FROM = '[data-card], button, input, textarea, select, a, .day-head, .menu, .sel-bar, .add-row';

/**
 * Drag on empty space to draw a box; every card it touches (day columns and the
 * projects strip) joins the multi-selection. ⌘/Shift adds to what's already selected.
 */
export function useBoxSelect(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !(e.target instanceof Element) || e.target.closest(NOT_FROM)) return;
      const x0 = e.clientX;
      const y0 = e.clientY;
      const base = e.metaKey || e.ctrlKey || e.shiftKey ? S().ui.multi ?? [] : [];
      let box: HTMLDivElement | null = null;
      let last = '';

      const move = (m: MouseEvent) => {
        if (!box) {
          if (Math.hypot(m.clientX - x0, m.clientY - y0) < START_PX) return;
          box = document.createElement('div');
          box.className = 'select-box';
          document.body.appendChild(box);
          document.body.classList.add('boxing');
          window.getSelection()?.removeAllRanges();
        }
        m.preventDefault();
        const l = Math.min(x0, m.clientX);
        const t = Math.min(y0, m.clientY);
        const r = Math.max(x0, m.clientX);
        const b = Math.max(y0, m.clientY);
        Object.assign(box.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
        const hit = new Set(base);
        root.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
          const c = el.getBoundingClientRect();
          if (c.right > l && c.left < r && c.bottom > t && c.top < b) hit.add(el.dataset.key!);
        });
        const next = [...hit];
        const sig = next.join(',');
        if (sig !== last) {
          last = sig;
          S().setUI({ multi: next.length ? next : undefined, selectedId: undefined, occDate: undefined });
        }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        if (!box) return;
        box.remove();
        document.body.classList.remove('boxing');
        // the click that ends a drag must not open "add a task"
        const swallow = (c: MouseEvent) => c.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    root.addEventListener('mousedown', onDown);
    return () => root.removeEventListener('mousedown', onDown);
  }, [ref]);
}
