import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, CalendarRange, Cloud, CloudOff, GitBranch, History, Loader2, Trophy, Redo2, Settings as Cog, Sparkles, StickyNote, Undo2, Pin, X,
} from 'lucide-react';
import type { Task } from './types';
import { S, useStore, type View } from './store';
import { desk, isCaptureWindow } from './lib/bridge';
import { useIsMobile, useToday } from './lib/hooks';
import { cls } from './lib/id';
import { fmtDay, fmtTime, localDateTime, parseLocalDateTime, todayISO } from './lib/date';
import { occursOn } from './lib/recurrence';
import { isClosed } from './lib/priority';
import { syncConfigured, syncNow } from './lib/sync';
import { cancelAsk, checkLlm, clearQueue, resumeQueue } from './lib/llm';
import { deleteSelection, capture, carryOver, isInbox, jumpTo, planQueue, tasks } from './actions';
import { Timeline } from './components/Timeline';
import { StickyInbox } from './components/StickyInbox';
import { TaskDrawer } from './components/TaskDrawer';
import { PlanModal } from './components/PlanModal';
import { ProjectsView } from './components/Projects';
import { Upcoming } from './components/Upcoming';
import { HistoryView } from './components/HistoryView';
import { Achievements } from './components/Achievements';
import { SettingsView } from './components/Settings';
import { ContextMenu } from './components/ItemCard';
import { DeleteRepeatDialog } from './components/DeleteRepeatDialog';
import { BatchDeleteDialog, SelectionBar } from './components/BatchSelect';
import { isSubmitKey } from './components/ui';
import { DateNav } from './components/DateNav';
import { AlertsDock } from './components/AlertsDock';

export function App() {
  const loaded = useStore((s) => s.loaded);
  useEffect(() => {
    if (!isCaptureWindow) void S().load();
  }, []);
  if (isCaptureWindow) return <CaptureWindow />;
  if (!loaded) return null;
  return <Shell />;
}

const NAV: { view: View; label: string; icon: typeof CalendarDays }[] = [
  { view: 'timeline', label: 'Days', icon: CalendarDays },
  { view: 'projects', label: 'Projects', icon: GitBranch },
  { view: 'upcoming', label: 'Ahead', icon: CalendarRange },
  { view: 'wins', label: 'Wins', icon: Trophy },
  { view: 'history', label: 'History', icon: History },
  { view: 'settings', label: 'Settings', icon: Cog },
];
const MOBILE_NAV: { view: View; label: string; icon: typeof CalendarDays }[] = [
  { view: 'timeline', label: 'Days', icon: CalendarDays },
  { view: 'sticky', label: 'Sticky', icon: StickyNote },
  { view: 'projects', label: 'Projects', icon: GitBranch },
  { view: 'upcoming', label: 'Ahead', icon: CalendarRange },
  { view: 'wins', label: 'Wins', icon: Trophy },
  { view: 'settings', label: 'More', icon: Cog },
];

function Shell() {
  const today = useToday();
  const view = useStore((s) => s.ui.view);
  const planOpen = useStore((s) => s.ui.planOpen);
  const drawerOpen = useStore((s) => !!s.ui.selectedId && s.entities[s.ui.selectedId]?.type === 'task' && !s.entities[s.ui.selectedId]?.deleted);
  const entities = useStore((s) => s.entities);
  const mobile = useIsMobile();
  const inbox = useMemo(() => Object.values(entities).filter((e): e is Task => e.type === 'task' && isInbox(e)), [entities]);
  const queueLen = useMemo(() => planQueue().length, [entities]); // eslint-disable-line react-hooks/exhaustive-deps

  // unfinished tasks follow you to today; first open of the day offers a plan
  useEffect(() => {
    carryOver(today);
    const st = S();
    if (st.settings.morningPlanning && st.settings.lastPlanDay !== today) {
      st.setSettings({ lastPlanDay: today });
      if (planQueue().length) st.setUI({ planOpen: true });
    }
  }, [today]);

  useSyncLoop();
  useReminders();
  const llmKey = useStore((s) => `${s.settings.llmEnabled}|${s.settings.llmUrl}|${s.settings.llmModel}`);
  useEffect(() => {
    void checkLlm();
    const iv = setInterval(() => void checkLlm(), 30_000);
    window.addEventListener('focus', checkLlm);
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', checkLlm);
    };
  }, [llmKey]);
  useEffect(() => resumeQueue(), []);

  // Electron: quick-capture window, dock badge, menu commands
  useEffect(() => {
    desk?.onCapture((text) => capture(text));
  }, []);
  useEffect(() => {
    desk?.pushInbox(inbox.map((t) => ({ id: t.id, title: t.title })));
    desk?.setBadge(inbox.length);
  }, [inbox]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing && !desk) {
        e.preventDefault();
        if (e.shiftKey) S().redo();
        else S().undo();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0') && S().ui.view === 'timeline') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('tl-zoom', { detail: e.key === '0' ? 'reset' : e.key === '-' ? -0.1 : 0.1 }));
        return;
      }
      if (typing || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !document.querySelector('.modal-bg')) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape' && S().ui.multi?.length) return S().setUI({ multi: undefined });
      if (mod) return;
      if (e.key === 't') jumpTo(todayISO());
      else if (e.key === 'p') S().setUI({ planOpen: true });
      else if (e.key === 'n' || e.key === 'i') {
        e.preventDefault();
        focusSticky();
      } else if (e.key === '[') window.dispatchEvent(new CustomEvent('tl-scroll', { detail: -7 }));
      else if (e.key === ']') window.dispatchEvent(new CustomEvent('tl-scroll', { detail: 7 }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    desk?.onMenu((cmd) => {
      const el = document.activeElement;
      const editing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (cmd === 'undo') editing ? document.execCommand('undo') : S().undo();
      else if (cmd === 'redo') editing ? document.execCommand('redo') : S().redo();
      else if (cmd === 'today') jumpTo(todayISO());
      else if (cmd === 'plan') S().setUI({ planOpen: true });
      else if (cmd === 'new') focusSticky();
      else if (cmd === 'sync') void syncNow();
      else if (cmd === 'zoom-in' || cmd === 'zoom-out' || cmd === 'zoom-reset')
        window.dispatchEvent(new CustomEvent('tl-zoom', { detail: cmd === 'zoom-reset' ? 'reset' : cmd === 'zoom-in' ? 0.1 : -0.1 }));
    });
  }, []);

  return (
    <div className={cls('app', desk && 'electron', desk?.platform === 'darwin' && 'mac', mobile && 'mobile', drawerOpen && 'drawer-open')}>
      {!mobile && (
        <nav className="rail">
          {NAV.map(({ view: v, label, icon: Icon }) => (
            <button key={v} className={cls('rail-btn', view === v && 'on')} title={label} onClick={() => S().setUI({ view: v, selectedId: undefined, multi: undefined })}>
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
      <main className="main">
        <TopBar today={today} queueLen={queueLen} />
        <div className="content">
          {view === 'timeline' && (
            <div className="tl-layout">
              {!mobile && <StickyInbox today={today} collapsible />}
              <Timeline today={today} />
            </div>
          )}
          {view === 'sticky' && <StickyInbox today={today} />}
          {view === 'projects' && <ProjectsView today={today} />}
          {view === 'upcoming' && <Upcoming today={today} />}
          {view === 'wins' && <Achievements today={today} />}
          {view === 'history' && <HistoryView />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
      {mobile && (
        <nav className="tabbar">
          {MOBILE_NAV.map(({ view: v, label, icon: Icon }) => (
            <button key={v} className={cls(view === v && 'on')} onClick={() => S().setUI({ view: v, selectedId: undefined, multi: undefined })}>
              <Icon size={20} />
              <span>{label}</span>
              {v === 'sticky' && inbox.length > 0 && <i className="badge">{inbox.length}</i>}
            </button>
          ))}
        </nav>
      )}
      <TaskDrawer today={today} />
      {planOpen && <PlanModal today={today} />}
      <ContextMenu />
      {!mobile && <AlertsDock today={today} />}
      <DeleteRepeatDialog />
      <SelectionBar />
      <BatchDeleteDialog />
      <ToastHost />
    </div>
  );
}

function focusSticky() {
  if (S().ui.view !== 'timeline' && S().ui.view !== 'sticky') S().setUI({ view: 'timeline' });
  if (S().settings.stickyCollapsed) S().setSettings({ stickyCollapsed: false });
  setTimeout(() => (document.querySelector('.sticky-input') as HTMLTextAreaElement | null)?.focus(), 30);
}

function TopBar({ today, queueLen }: { today: string; queueLen: number }) {
  const view = useStore((s) => s.ui.view);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const titles: Record<View, string> = { timeline: '', sticky: 'Sticky', projects: 'Projects & milestones', upcoming: 'Looking ahead', wins: 'Achievements', history: 'History', settings: 'Settings' };
  return (
    <header className="topbar">
      {view === 'timeline' ? (
        <DateNav today={today} />
      ) : (
        <div className="tb-title">{titles[view]}</div>
      )}
      <span className="spacer" />
      <button className={cls('btn tiny plan-top', queueLen > 0 && 'pulse')} title="Plan your sticky notes  (P)" onClick={() => S().setUI({ planOpen: true })}>
        <Sparkles size={13} /> Plan{queueLen > 0 ? ` · ${queueLen}` : ''}
      </button>
      <button className="icon-btn" disabled={!canUndo} title="Undo (⌘Z)" onClick={() => S().undo()}>
        <Undo2 size={16} />
      </button>
      <button className="icon-btn" disabled={!canRedo} title="Redo (⇧⌘Z)" onClick={() => S().redo()}>
        <Redo2 size={16} />
      </button>
      <AiBadge />
      <SyncBadge />
    </header>
  );
}

function AiBadge() {
  const enabled = useStore((s) => s.settings.llmEnabled);
  const model = useStore((s) => s.settings.llmModel);
  const llm = useStore((s) => s.ui.llm);
  const q = useStore((s) => s.ui.aiQueue);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && e.target instanceof Node && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);
  const busy = (q?.running ? 1 : 0) + (q?.waiting.length ?? 0);
  const state = !enabled ? 'off' : busy ? 'busy' : llm?.state ?? 'checking';
  const short = model.replace(/:latest$/, '');
  const label = {
    off: 'AI off',
    checking: 'AI…',
    ok: short || 'AI',
    down: 'AI offline',
    busy: `${short} · ${q?.running ? 'answering' : ''}${q?.waiting.length ? `${q?.running ? ', ' : ''}${q.waiting.length} in line` : ''}`,
  }[state];
  const title = {
    off: 'Local AI is off — turn it on in Settings to get suggestions for “?” tasks',
    checking: 'Checking your local AI…',
    ok: `Connected to ${model} on your computer (no internet). Click to see the queue.`,
    down: `Can’t reach your local AI: ${llm?.error ?? ''}. Is Ollama / LM Studio running?`,
    busy: 'Click to see what the AI is working on',
  }[state];
  return (
    <div className="ai-badge-wrap" ref={ref}>
      <button className={cls('status-pill', `s-${state}`)} title={title} onClick={() => (enabled ? setOpen((o) => !o) : S().setUI({ view: 'settings' }))}>
        {state === 'busy' ? <Sparkles size={12} className="spin-slow" /> : <i className="dot" />}
        {label}
      </button>
      {open && <AiQueuePanel close={() => setOpen(false)} />}
    </div>
  );
}

function AiQueuePanel({ close }: { close: () => void }) {
  const q = useStore((s) => s.ui.aiQueue);
  const entities = useStore((s) => s.entities);
  const title = (id: string) => {
    const e = entities[id];
    return e?.type === 'task' ? e.title : '(deleted)';
  };
  const recent = useMemo(
    () =>
      Object.values(entities)
        .filter((e): e is Task => e.type === 'task' && !e.deleted && (e.ai?.status === 'done' || e.ai?.status === 'error'))
        .sort((a, b) => b.ai!.at - a.ai!.at)
        .slice(0, 5),
    [entities],
  );
  const open = (id: string) => {
    S().setUI({ selectedId: id, occDate: undefined });
    close();
  };
  return (
    <div className="ai-queue">
      <div className="aq-head">
        <b>AI queue</b>
        <span className="muted small">one question at a time, in order</span>
        <span className="spacer" />
        {!!q?.waiting.length && (
          <button className="link-btn" onClick={clearQueue}>Clear line</button>
        )}
      </div>
      {q?.running && (
        <div className="aq-row running" onClick={() => open(q.running!)}>
          <Sparkles size={13} className="spin-slow" />
          <span className="aq-title">{title(q.running)}</span>
          <span className="tiny muted">answering…</span>
        </div>
      )}
      {q?.waiting.map((id, i) => (
        <div key={id} className="aq-row" onClick={() => open(id)}>
          <span className="aq-num">{i + 1}</span>
          <span className="aq-title">{title(id)}</span>
          <button className="icon-btn" title="Remove from the line" onClick={(e) => (e.stopPropagation(), cancelAsk(id))}>
            <X size={12} />
          </button>
        </div>
      ))}
      {!q?.running && !q?.waiting.length && <div className="small muted aq-empty">Nothing waiting. Put a “?” in a task you type and it’ll appear here.</div>}
      {recent.length > 0 && (
        <>
          <div className="aq-sub">Recently answered</div>
          {recent.map((t) => (
            <div key={t.id} className="aq-row" onClick={() => open(t.id)}>
              <span className={cls('aq-dot', t.ai!.status === 'error' && 'err')} />
              <span className="aq-title">{t.title}</span>
              {t.ai!.confidence && <span className={cls('conf', `conf-${t.ai!.confidence}`)}>{t.ai!.confidence}</span>}
            </div>
          ))}
        </>
      )}
      <div className="aq-foot tiny muted">
        Only questions you type or rename are sent — imported or synced tasks never are. <a onClick={() => (S().setUI({ view: 'settings' }), close())}>AI settings</a>
      </div>
    </div>
  );
}

function SyncBadge() {
  const syncing = useStore((s) => s.ui.syncing);
  const err = useStore((s) => s.settings.lastSyncError);
  const last = useStore((s) => s.settings.lastSyncAt);
  const pending = useStore((s) => Object.keys(s.dirty).length);
  useStore((s) => s.settings.syncToken + s.settings.syncUrl);
  const on = syncConfigured();
  const state = !on ? 'off' : syncing ? 'busy' : err ? 'down' : last ? 'ok' : 'checking';
  const label = { off: 'Google Sheet off', busy: 'Syncing…', down: 'Sync error', checking: 'Not synced yet', ok: pending ? `Google Sheet · ${pending} to upload` : 'Synced' }[state];
  const title = !on
    ? 'Not backed up to Google Sheets yet — set it up in Settings'
    : err
      ? `Sync problem: ${err}`
      : `Synced with your Google Sheet ${last ? new Date(last).toLocaleTimeString() : ''}${pending ? ` · ${pending} change(s) waiting` : ''}. Click to sync now.`;
  return (
    <button className={cls('status-pill', `s-${state}`)} title={title} onClick={() => (on ? void syncNow() : S().setUI({ view: 'settings' }))}>
      {syncing ? <Loader2 size={12} className="spin" /> : on && !err ? <Cloud size={12} /> : <CloudOff size={12} />}
      {label}
    </button>
  );
}

function ToastHost() {
  const toast = useStore((s) => s.ui.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => S().ui.toast?.id === toast.id && S().setUI({ toast: undefined }), toast.ms ?? 5000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" key={toast.id}>
      <span>{toast.msg}</span>
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          onClick={() => {
            S().setUI({ toast: undefined });
            a.run();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function useSyncLoop() {
  useEffect(() => {
    const auto = () => S().settings.autoSync !== false;
    if (auto()) void syncNow();
    const iv = setInterval(() => auto() && void syncNow(), 60_000);
    const onFocus = () => auto() && void syncNow();
    const onVis = () => document.visibilityState === 'visible' && auto() && void syncNow();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    let t: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((st, prev) => {
      if (st.dirty !== prev.dirty && Object.keys(st.dirty).length && auto()) {
        clearTimeout(t);
        t = setTimeout(() => void syncNow(), 2500);
      }
    });
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      unsub();
    };
  }, []);
}

function notify(title: string, body: string) {
  S().toast(`⏰ ${title}${body ? ` — ${body}` : ''}`, undefined, 15000);
  if (!('Notification' in window)) return;
  const show = () => new Notification(title, { body });
  if (Notification.permission === 'granted') show();
  else if (Notification.permission !== 'denied') void Notification.requestPermission().then((p) => p === 'granted' && show());
}

function useReminders() {
  useEffect(() => {
    const firedOcc = new Set<string>();
    const check = () => {
      const now = new Date();
      const nowStr = localDateTime(now);
      const dayAgo = localDateTime(new Date(now.getTime() - 86400000));
      const due = tasks().filter((t) => t.remindAt && !t.remindFired && t.remindAt <= nowStr && !isClosed(t));
      if (due.length) {
        // don't blast a week of missed reminders after the laptop was closed
        for (const t of due.filter((x) => x.remindAt! >= dayAgo).slice(0, 5))
          notify(t.title, [t.time && fmtTime(t.time), t.date && fmtDay(t.date)].filter(Boolean).join(' · '));
        S().commit('Reminder shown', due.map((t) => ({ ...t, remindFired: true })), { undoable: false });
      }
      const today = todayISO();
      for (const s of tasks()) {
        if (!s.recurrence || !s.time || !s.date || s.completions?.[today] || !occursOn(s.recurrence, s.date, today)) continue;
        const at = parseLocalDateTime(`${today}T${s.time}`).getTime() - 10 * 60000;
        const key = `${s.id}@${today}`;
        if (now.getTime() >= at && now.getTime() - at < 30 * 60000 && !firedOcc.has(key)) {
          firedOcc.add(key);
          notify(s.title, fmtTime(s.time));
        }
      }
    };
    check();
    const iv = setInterval(check, 30_000);
    return () => clearInterval(iv);
  }, []);
}

// ---------- the floating sticky (Electron quick-capture window) ----------
function CaptureWindow() {
  const [v, setV] = useState('');
  const [items, setItems] = useState<{ id: string; title: string }[]>([]);
  const [pinned, setPinned] = useState(false);
  const [flash, setFlash] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    document.body.classList.add('capture-body');
    desk?.onInbox(setItems);
    const focus = () => ref.current?.focus();
    window.addEventListener('focus', focus);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && desk?.hideCapture();
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('keydown', esc);
    };
  }, []);
  const submit = () => {
    if (!v.trim()) return;
    desk?.capture(v);
    setV('');
    setFlash('Saved ✓');
    setTimeout(() => setFlash(''), 1200);
  };
  return (
    <div className="capture">
      <div className="capture-bar">
        <StickyNote size={13} />
        <span>Sticky</span>
        <span className="flash">{flash}</span>
        <span className="spacer" />
        <button
          className={cls('icon-btn', pinned && 'on')}
          title={pinned ? 'Unpin (hide when I click away)' : 'Pin on top of everything'}
          onClick={() => {
            setPinned(!pinned);
            desk?.pinCapture(!pinned);
          }}
        >
          <Pin size={13} />
        </button>
        <button className="icon-btn" title="Hide (Esc)" onClick={() => desk?.hideCapture()}>
          <X size={13} />
        </button>
      </div>
      <textarea
        ref={ref}
        autoFocus
        value={v}
        placeholder={'Jot it down… Enter to save\n“call the dentist tmr 9am”'}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <ol className="capture-list">
        {items.map((i) => (
          <li key={i.id}>{i.title}</li>
        ))}
      </ol>
    </div>
  );
}
