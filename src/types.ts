export type ISODate = string; // YYYY-MM-DD in local time

/** How much it hurts if this slips — the only question importance answers. */
export type Importance = 'must' | 'should' | 'could';
export type DaySort = 'manual' | 'time' | 'importance' | 'importance-time';
export type Status = 'open' | 'doing' | 'waiting' | 'done' | 'dropped';

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  byWeekday?: number[]; // 0 = Sun … 6 = Sat (weekly only)
  until?: ISODate;
}

interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  device?: string;
}

export interface Task extends Base {
  type: 'task';
  title: string;
  notes?: string;
  /** Scheduled day. null = still on the sticky (inbox). */
  date: ISODate | null;
  /** HH:MM — a task with a time is an appointment and is never carried over. */
  time?: string;
  importance: Importance;
  status: Status;
  doneAt?: number;
  deadline?: ISODate;
  /** Local datetime YYYY-MM-DDTHH:MM */
  remindAt?: string;
  remindFired?: boolean;
  /** First day this was planned for — used to show how long it has been carried. */
  firstScheduled?: ISODate;
  /** retired: ideas are ordinary sticky notes now; kept so older data still loads */
  someday?: boolean;
  projectId?: string;
  parentId?: string | null;
  order: number;
  recurrence?: Recurrence;
  /** Per-occurrence state of a recurring series. 'moved' = this day's copy lives elsewhere (hidden here, keeps its number) */
  completions?: Record<ISODate, 'done' | 'dropped' | 'deleted' | 'moved'>;
  seriesId?: string;
  /** stays on its own day — not auto-carried to today (imported history). Cleared when you reschedule it. */
  stay?: boolean;
  /** repeating tasks only: show a running number on each day (start = first day's number) */
  numbering?: { start: number };
  /** Answer from the local LLM when the task contains a "?" */
  ai?: { status: 'queued' | 'pending' | 'done' | 'error'; question: string; answer?: string; confidence?: 'high' | 'medium' | 'low'; at: number; model?: string };
}

export type Outcome = 'pending' | 'yes' | 'no' | 'silent';
export interface TrackerEntry {
  id: string;
  name: string;
  outcome: Outcome;
  note?: string;
  followUp?: ISODate;
}

export interface Project extends Base {
  type: 'project';
  title: string;
  notes?: string;
  color: string;
  status: 'active' | 'paused' | 'done';
  order: number;
  tracker?: { label: string; entries: TrackerEntry[] };
}

export type Entity = Task | Project;

export interface HistoryEntry {
  hid: string;
  ts: number;
  id: string;
  label: string;
  before: Entity | null;
  after: Entity;
  source: 'local' | 'remote';
  device?: string;
}

export interface Settings {
  deviceId: string;
  deviceName: string;
  syncUrl: string;
  syncToken: string;
  cursor: number;
  lastSyncAt?: number;
  lastSyncError?: string;
  morningPlanning: boolean;
  lastPlanDay?: ISODate;
  captureShortcut: string;
  /** ask before deleting several tasks at once */
  confirmBatchDelete?: boolean;
  /** push/pull with the sheet automatically (otherwise only on “Sync now”) */
  autoSync?: boolean;
  /** how far the day timeline reaches (display only — tasks outside are untouched) */
  rangeBackDays?: number;
  rangeFwdDays?: number;
  /** day-column zoom, 0.5–1.5 (1 = 100%) */
  timelineZoom?: number;
  /** how cards are ordered inside each day (display only — manual order is always kept) */
  daySort?: DaySort;
  /** heads-up levels for timed tasks, in minutes before (default 120 / 60 / 30 / 1) */
  alertLevels?: { minutes: number; on: boolean }[];
  alertsCollapsed?: boolean;
  tracksCollapsed?: boolean;
  /** sticky folded into a thin strip on the left of the Days view */
  stickyCollapsed?: boolean;
  defaultImportance: Importance;
  llmEnabled: boolean;
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio) */
  llmUrl: string;
  llmModel: string;
  /** Short context sent with every AI question, e.g. where the user lives */
  llmAbout?: string;
}

/** Something drawn in a day column. */
export type DayItem =
  | { kind: 'task'; key: string; task: Task }
  | { kind: 'occ'; key: string; task: Task; date: ISODate; state?: 'done' | 'dropped' }
  | { kind: 'follow'; key: string; project: Project; entry: TrackerEntry };
