# Smart Schedule (Planner)

A rethink of the “one column per day” Google Sheet: same fast left-right day view, plus a sticky-note
inbox, repeating tasks, long-horizon reminders, milestone flowcharts, and an edit history that never
loses anything. Runs as a **Mac app (Electron)** and on your **phone (served by your own Google Sheet)**,
with the data kept in the Sheet.

## Why: the problems with a plain day-column sheet

| Sheet problem | What Planner does |
|---|---|
| Colours don't really say how important something is | Importance is one question — *“what happens if this slips a week?”* (Could / Should / Must). A **hard deadline** escalates the colour automatically (yellow 3 days out, red the day before), so a “could” due tomorrow still turns red. Column ⇅ button sorts a day by importance and deadline. |
| Copying unfinished things forward by hand | Unfinished tasks **carry to today automatically**, so nothing gets lost and nothing has to be copied. |
| Ideas on a sticky never get done unless scheduled | The yellow **Sticky** is a plain text box: Enter saves. New tasks start as Must (change the default in Settings). If you typed a date (`tmr 9am`, `fri`, `in 6 months`, `明天`) it's scheduled immediately; otherwise it waits on the sticky until you **Plan** it (one-tap Today / Tmr / Weekend / Next wk, drag onto a day, park as an idea, or turn it into a project). Plan opens on your first launch each day if anything is waiting. On the Mac, **⌘⇧Space** opens a floating sticky from any app. |
| Recurring things (bills, meds, classes) | `pay rent every month on the 25th`, `gym every mon, wed and fri`, `每周一 健身`. Each day's copy is checked off on its own. |
| Long-horizon things (a renewal 6 months out) | `passport renewal in 6 months` → lands on the right day with an automatic reminder 2 weeks before. The **Ahead** view lists everything months out, reminders, deadlines, repeating tasks, and what you're waiting on. |
| Multi-step things and outreach | **Projects**: a flowchart of steps (chains and branches). A step unlocks when the one before it is done, and finishing a step asks you when you'll do the next. Optional **yes/no tracker** per project (waiting / yes / no / no reply) with follow-up dates that appear on the calendar. |
| Dragging on the phone overwrote a cell; reverting lost other edits | Days hold items, not cells: dropping *moves* a task and nothing is ever replaced. **⌘Z** undoes, and **History** can restore any single item to any earlier version without rolling back anything else. Deleted things go to Trash. Sync merges **per task**, so the phone and laptop can't clobber each other's edits, and the Sheet keeps every overwritten version in `_app_history`. |

## Run it

```bash
npm install
npm run dev          # Electron + hot reload
npm start            # build, then run the app
npm run dist         # make a .dmg in release/ (unsigned; right-click → Open the first time)
npm test             # parser/recurrence/import tests + Apps Script sync simulation
```

Data lives in `~/Library/Application Support/Planner/data.json`. A dated copy is written to
`backups/` once a day (last 60 kept), and `data.session-start.json` holds the state the app started with.

## Connect your Google Sheet (≈5 min)

1. Open the spreadsheet you want to use → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs). Save.
3. Pick **setup** in the function dropdown → **Run** → approve the permission prompt. The log prints your **sync token**.
4. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL ending in `/exec`.
5. In Planner → **Settings**: paste the URL and token → **Test connection**.
6. Settings now shows the two directions separately:
   - **App → Sheet (automatic):** every change is written within seconds (toggle it off to sync only on *Sync now*).
   - **Sheet → App (one-time import):** pick a tab and date range, press **Preview** to see what will be created, then **Import**.
     Tick **Keep this tab linked** to have the app keep writing your changes back into that same tab afterwards (same layout and colours,
     only for days from the import's start date; a backup copy of the tab is saved first).
     This also works **without any setup** from a downloaded file: Google Sheets → File → Download → Microsoft Excel (.xlsx).

   The import It reads row 1 as dates and colours as
   red = must, yellow = should, green = done, grey = obsolete, and merges copies marked “(cont.)” into one task. Your original tab is only read, never changed.

The script adds three tabs and leaves your others alone:
- `_app_data` (hidden): one row per task, which is the synced data.
- `_app_history` (hidden): every version that was ever overwritten.
- `Calendar (app)`: a read-only, colour-coded day-column view in your familiar layout, rebuilt on each sync.
  It's for glancing in the Sheets app. Edits there aren't read back (it warns you if you try).

“Anyone” access means the URL plus the token is what protects your data, so treat the token like a password.
If it leaks, run `rotateToken()` in the script editor and paste the new token into each device.

## Phone

The same app runs on your phone, served by your Apps Script (nothing else to host):

```bash
npx @google/clasp login                  # once; first enable “Google Apps Script API” at script.google.com/home/usersettings
echo '{"scriptId":"<Project Settings → Script ID>","rootDir":"."}' > apps-script/.clasp.json
npm run gas:push                         # builds the phone UI into apps-script/Index.html and uploads it with Code.gs
```

Then in the script editor: **Deploy → Manage deployments → ✎ → Version: New version → Deploy** (the /exec URL stays the same).
Open the `/exec` URL on your phone, enter the token in **More → Sync token**, and use **Share → Add to Home Screen**.
On a phone, the Days tab swipes one day at a time and the Sticky tab has one-tap scheduling buttons.

*No clasp?* Create an HTML file named `Index` in the script editor and paste in the contents of `apps-script/Index.html`.

## Quick-capture cheat sheet

| Type | Gets |
|---|---|
| a `?` anywhere | your local AI answers it — open the task to read |
| `today` `tmr` `fri` `on mon` `next tue` `this weekend` `next week` | that day |
| `10/15` `Oct 15` `in 3 days` `in 6 months` `by 10/10` (sets a deadline) | that day |
| `9am` `7:55AM` `14:00` `at noon` | time (and a reminder 10 min before) |
| `every day` `every weekday` `every mon, wed and fri` `every 2 weeks` `every month` `every 25th` | repeating |
| `今天` `明天` `后天` `周五` `下周三` `3个月后` `下午3点` `每天` `每周一` `每月15号` | Chinese equivalents |
| `Spanish L# every mon, wed and fri` · `Vitamin D #42 every day` | numbered repeats: L1, L2, L3… / Vitamin D 42, 43, 44… |
| Pasting a numbered list | one note per number; `- sub-bullets` become that note's notes (and its steps if you make it a project) |

## Local AI

Settings → **Local AI**: point it at Ollama (`http://localhost:11434/v1`) or LM Studio (`http://localhost:1234/v1`),
press **Connect & test**, pick a model. Any task containing `?` then gets a short answer (✨ on the card, spinning while
it's thinking; the answer sits at the top of the task panel with *ask again* / *remove*). Requests go only to the URL you set. Questions are answered **one at a time, in order** — click the AI pill in the top bar to see the queue, cancel items, or clear it. Only tasks you type or rename are sent; imported, restored or synced tasks never are (use *Ask AI* on one if you want it).
Long titles (over 100 characters) are shortened on the calendar; the full text is kept in the notes.

## Shortcuts

`⌘⇧Space` floating sticky (any app; change it in Settings) · `N` jot on the sticky · `T` today · `[` `]` week back/forward · `G` go to any date · pinch or `⌘+` `⌘−` `⌘0` to zoom the days ·
`P` plan · double-click a title to rename · ⌘/Shift-click cards to multi-select · `⌫` delete selection · `⌘Z` / `⇧⌘Z` undo/redo · click the bars on the right edge of a card to cycle Could → Should → Must · right-click a card for status, move, delete · drag a card onto the sticky to unschedule it · select several cards → **Add to project…** to chain them as steps in time order.
In Plan: `1`–`4` pick a day, `L` decide later.

## Layout

- `src/` is the UI (React + TypeScript + Zustand), shared by desktop and phone.
  - `lib/parse.ts`: quick-capture language. `lib/recurrence.ts`, `lib/priority.ts`: rules. `lib/sync.ts`: sync client.
  - `store.ts`: data, undo/redo, per-item history. `actions.ts`: every domain operation.
- `electron/` is the window, the floating sticky, global shortcut, disk storage and backups.
- `apps-script/` is the Google Sheets backend (`Code.gs`) and its offline test harness.
