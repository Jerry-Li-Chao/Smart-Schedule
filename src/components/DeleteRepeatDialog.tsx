import { useEffect } from 'react';
import { Repeat, X } from 'lucide-react';
import { S, useStore } from '../store';
import { fmtDay } from '../lib/date';
import { describeRecurrence } from '../lib/recurrence';
import { deleteRepeating, getTask } from '../actions';

/** Asked whenever a repeating task is deleted: just this day, this day onward, or the whole series. */
export function DeleteRepeatDialog() {
  const ask = useStore((s) => s.ui.deleteAsk);
  const close = () => S().setUI({ deleteAsk: undefined });
  useEffect(() => {
    if (!ask) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [ask]);
  const t = getTask(ask?.id);
  if (!ask || !t?.recurrence) return null;
  const run = (scope: 'one' | 'future' | 'all') => {
    close();
    deleteRepeating(t, ask.date, scope);
  };
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal confirm">
        <div className="confirm-head">
          <Repeat size={16} />
          <b>Delete a repeating task</b>
          <span className="spacer" />
          <button className="icon-btn" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="confirm-body">
          <div className="confirm-title">{t.title}</div>
          <div className="small muted">{describeRecurrence(t.recurrence, t.date!)}</div>
          <div className="confirm-options">
            {ask.date && (
              <button className="btn big" autoFocus onClick={() => run('one')}>
                <b>Only {fmtDay(ask.date)}</b>
                <span className="muted small">Every other day stays as it is</span>
              </button>
            )}
            {ask.date && ask.date > t.date! && (
              <button className="btn big" onClick={() => run('future')}>
                <b>{fmtDay(ask.date)} and every one after</b>
                <span className="muted small">Past days (and what you checked off) are kept</span>
              </button>
            )}
            <button className="btn big danger" autoFocus={!ask.date} onClick={() => run('all')}>
              <b>The whole series</b>
              <span className="muted small">Removes every day, past and future</span>
            </button>
          </div>
          <div className="tiny muted">You can undo any of these with ⌘Z or from History → Trash.</div>
        </div>
      </div>
    </div>
  );
}
