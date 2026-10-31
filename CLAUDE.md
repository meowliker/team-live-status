# Team Live: Project Memory

Read this first. It explains what the app does, how it's built, where data lives, how to change it, and why things are the way they are.

## What it is

A single web page that shows a team **live**: who is working, on break, free to assign, or offline, plus daily and weekly reports. It combines two tools the team already uses:

- **Jibble** (time clock): clock-in / break / clock-out, the activity and project picked at clock-in, and periodic screenshots.
- **ClickUp** (task tracker): which task each person's ClickUp timer is running on, and time tracked per task.

**Live URL:** https://team-live-status-production.up.railway.app (hosted on Railway, auto-deploys from `main`)
**Repo:** https://github.com/meowliker/team-live-status

## What users see

| Area | What it shows |
|---|---|
| **Live board** (`/`) | Tiles (Working / In pool / On break / Needs attention / Offline), department filter chips, and panels: **Pool** (people added by hand with **＋ Add to pool**, split by department, with **Assign** and **Remove from pool**), **Needs attention**, **On break**, **Assigned from pool**, **Working now** (with the running ClickUp task), **Offline**, and a **Live feed** of changes. Browser notifications are optional. |
| **Daily** tab | Any date (Today / Yesterday / ‹ › / date picker). Today is the live report: clock-in/out, worked vs target, ClickUp tracked, breaks vs allowance, missed-break and frozen-screen flags, colour timeline. Past days are rebuilt from Jibble + ClickUp history (no screenshot flags) and each row expands to that day's Jibble activities and ClickUp tasks. **Download CSV** per day. |
| **Weekly** tab | Pick a week (This week / Last week / ‹ ›). Team averages, then per person: days in, avg clock-in/out, avg worked per day and days on target, avg break and days over allowance, ClickUp per day and coverage, and a bar per day. Click a row for day-by-day numbers, Jibble activities and top ClickUp tasks. **Download CSV** and **Print**. |
| **Person panel** | Click any name or avatar: their day, timeline, time per Jibble activity + project, and time per ClickUp task. |
| **Settings** (`/settings`) | Link each team member to a Jibble person and a ClickUp member by hand (overrides auto matching), or mark them "Not on ClickUp". Lists unlinked Jibble/ClickUp accounts. Warns if data would be wiped on redeploy. |

## Tech stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**. No UI library and no database.
- **sharp** analyses Jibble screenshots (blank and frozen screen detection).
- Plain CSS in `app/globals.css` using CSS variables ("aurora glass" theme: dark by default, light when the device asks for it). Font: Plus Jakarta Sans from Google Fonts (`app/layout.tsx`).
- Node 20+. Runs as a **long-lived server** (`next start`) because a background poller runs inside it. **Do not deploy to serverless** (e.g. Vercel free): the poller and in-memory state need a process that stays on.

## Project structure

```
team.config.ts          ← THE TEAM LIST (names, departments, aliases, clickup:false)
proxy.ts                ← Optional password (HTTP Basic auth) for every page and API
instrumentation.ts      ← Starts the background poller when the server boots
lib/
  config.ts             ← All env vars and their defaults
  engine.ts             ← The core: polls Jibble + ClickUp, matches people, computes states,
                          pool, alerts, day reports, live feed; persists small JSON files
  jibble.ts             ← Jibble API client (OAuth client-credentials), entries, screenshots, image analysis
  clickup.ts            ← ClickUp API client: members, today's timers (+ running timer per person), ranges
  week.ts               ← Week/day history builder (a week of Jibble + ClickUp history) + weekly and daily CSV
  overlap.ts            ← Removes ClickUp time that ran off the clock (Jibble breaks, after clock-out)
  time.ts               ← Timezone-aware date helpers (team timezone, not server/browser timezone)
  types.ts              ← Shared types (BoardState, PersonRow, DayReport, WeekReport, …)
  mock.ts               ← Fake data for demo mode (MOCK=1), including past days for the weekly report
app/
  page.tsx → Board.tsx  ← Live board, today's live report (used by Daily) and tabs (client component, polls /api/state every 15s)
  PersonPanel.tsx       ← Side panel opened by clicking a name
  WeekReport.tsx        ← Weekly tab UI
  DailyReport.tsx       ← Daily tab: date navigation; today = live report, past days from /api/week
  format.ts             ← Display helpers (durations, times, initials, avatar gradients)
  settings/             ← Settings page (Jibble/ClickUp linking)
  api/state             ← GET: full board state
  api/action            ← POST: refresh | pick | release | mode (free/busy/auto)
  api/settings          ← GET/POST: manual Jibble/ClickUp links
  api/week              ← GET ?start=YYYY-MM-DD [&format=csv [&day=YYYY-MM-DD]] [&fresh=1]: weekly report, or one day's CSV
```

## How it works

1. **Boot:** `instrumentation.ts` creates the singleton `Engine` (`lib/engine.ts`, stored on `globalThis`) and starts polling every `POLL_SECONDS` (default 60s; 10s in demo mode).
2. **Each poll** (`Engine.doPoll`):
   - Jibble: people (`status eq 'Joined'`), time entries from the last 36h, and new screenshots since the last fetch (each downloaded once and analysed with sharp: *blank* = near-flat image, *signature* = tiny greyscale thumbnail for frozen detection).
   - ClickUp: workspace members (cached 10 min), today's time entries in **one** call, plus **one call per linked person** to `/time_entries/current`. The date-range list doesn't reliably include running timers, so the current-timer endpoint is the source of truth for "is a timer running".
   - Match team members to Jibble people, then to ClickUp members (see *Matching* below).
   - Build a `PersonRow` per person: state (`working` / `break` / `out` from the latest Jibble entry), running timer, pool status, alerts, and the day report (segments, overlays, activities, ClickUp tasks).
   - Compare with the previous poll to push **live feed events**.
3. **Browser:** `Board.tsx` fetches `/api/state` every 15s and renders it. Buttons POST to `/api/action`.

### Key rules

- **Pool** = clocked in (working) **and** not assigned **and** either added by hand (`mode: free` in `pool.json`) **or** running a ClickUp timer on a task whose name *starts with* `POOL_TASK_WORD` (default "pool", any case, so "Pool" or "POOL - waiting" but not "Swimming pool ad"). People in via a Pool timer can't be removed by hand; they leave when they switch task or are assigned. `AUTO_POOL=on` also restores the old rule (*Auto* + no ClickUp timer running). Releasing an assigned person puts them back in the pool; clocking out clears it. `PersonRow.poolVia` says why someone is in the pool.
- **ClickUp time off the clock** (during a logged Jibble break, or after a clock-out until the next clock-in or end of day) is removed from ClickUp hours (live board, Daily, Weekly, CSV) and listed with task, times and reason (`lib/overlap.ts`). Not removed: missed (blank-screen) breaks, and time before the day's first clock-in. A live-feed alert fires when someone goes on break or clocks out with a timer running.
- **Needs attention** = working and (blank screen ≥ `AWAY_MINUTES` without a break, **or** screen frozen ≥ `FROZEN_MINUTES`, **or** no screenshots ≥ `NO_SCREENSHOT_MINUTES`), **or** a ClickUp timer still running while on break or clocked out.
- **Missed break** = a run of blank screenshots during work time ≥ `AWAY_MINUTES`. This is an estimate, because Jibble takes a screenshot roughly every 10 minutes.
- **Worked** = Jibble work time minus missed-break time. **Total break** = logged breaks + missed breaks.
- When someone clocks out, their Free/Busy choice and pool assignment are cleared.
- **Jibble "tasks"** = the activity and project picked at clock-in. Each `In` entry starts a work segment carrying that activity/project.

### Matching people (Jibble ↔ roster ↔ ClickUp)

1. **Settings-page links win** (`mapping.json`).
2. Otherwise Jibble is matched by exact name, alias, or email; then by "Jibble name starts with roster name + space" if that's unique (so "Nitin" matches "Nitin Sharma").
3. ClickUp is matched by Jibble email, then username/email vs name and aliases, then a unique prefix match.
4. `clickup: false` in `team.config.ts`, or "Not on ClickUp" in Settings, means Jibble only: no ClickUp checks and no warning.

The board shows banners for "Not found in Jibble" and "Not linked to ClickUp". Fix these on the Settings page or with an alias in `team.config.ts`.

## Where data lives

There is **no database**. Everything comes live from Jibble and ClickUp and is held in memory. A few small JSON files are written to `DATA_DIR`:

| File | Contents |
|---|---|
| `mapping.json` | Manual links from the Settings page |
| `pool.json` | Free/Busy modes and who assigned whom from the pool |
| `shots.json` | Today's analysed screenshots, so a restart doesn't re-download them |

- `DATA_DIR` defaults to the Railway volume (`RAILWAY_VOLUME_MOUNT_PATH`) when one is attached, otherwise `.data/`.
- **On Railway, attach a Volume** or these files are wiped on every deploy. The Settings page shows a red warning if they aren't on a volume.
- The **live feed** is memory only and starts empty after a restart.
- The **weekly report** isn't stored. It's rebuilt from Jibble and ClickUp history when requested and cached in memory (5 min for the current week, 1 hour for past weeks).

## Configuration (environment variables)

See `.env.example`. **Never commit real keys.** `.env` is gitignored, and on Railway the keys are set in the service's **Variables** tab.

| Variable | Purpose |
|---|---|
| `JIBBLE_CLIENT_ID`, `JIBBLE_CLIENT_SECRET` | Jibble API credentials (Settings → Integrations → API Credentials). Create them from an **Owner/Admin** account so everyone is visible. |
| `CLICKUP_TOKEN` | ClickUp personal token (`pk_…`). **Must belong to a Workspace Owner/Admin**, otherwise other people's timers return `403 TIMEENTRY_059`. |
| `CLICKUP_TEAM_ID` | Number in the ClickUp URL: `app.clickup.com/<this>/…` |
| `DASHBOARD_USER`, `DASHBOARD_PASSWORD` | Login for the whole app (Basic auth in `proxy.ts`). If no password is set, the app is public. |
| `TIMEZONE` | Team timezone for "today", day boundaries and weeks (default `Asia/Kolkata`) |
| `POLL_SECONDS` | Poll interval (default 60) |
| `SCREENSHOT_CHECKS` | `off` disables blank/frozen screenshot checks |
| `AWAY_MINUTES`, `NO_SCREENSHOT_MINUTES`, `FROZEN_MINUTES` | Alert thresholds |
| `BREAK_ALLOWANCE_MINUTES` (90), `LONG_BREAK_MINUTES` (45), `WORK_TARGET_MINUTES` (420), `POOL_IDLE_ALERT_MINUTES` (15) | Report and alert thresholds |
| `DATA_DIR` | Where JSON files are saved (see above) |
| `AUTO_POOL` | `off` (default): the pool is filled by hand (and by Pool timers). `on`: anyone clocked in with no ClickUp timer joins automatically |
| `POOL_TASK_WORD` | A running ClickUp timer on a task whose name starts with this word puts the person in the pool (default `pool`; empty turns it off) |
| `MOCK=1` | Demo mode with fake data, no keys needed |

## Running it

```bash
npm install
npm run mock                 # demo with fake data → http://localhost:3000
cp .env.example .env         # fill in the keys
npm run dev                  # dev server with real data
npm run build && npm start   # production
npx tsc --noEmit             # typecheck (there is no test suite or linter configured)
```

## Deploying (Railway)

- The Railway service is connected to this GitHub repo and **redeploys automatically on every push to `main`**. Railway runs `npm run build` and `npm start`, and Next uses Railway's `PORT`.
- One-time setup: set the environment variables, add a **Volume** (e.g. mounted at `/data`), and generate a domain.
- Workflow used so far: make changes on a branch, open a PR, merge to `main`, and Railway deploys it.

## Common changes

| Task | How |
|---|---|
| Add a person | Add `{ name, department }` to `TEAM` in `team.config.ts`. Use `aliases: ['their Jibble email or full name']` if the name differs, and `clickup: false` if they don't use ClickUp. |
| Remove a person | Delete their line from `team.config.ts`. Empty departments disappear automatically. |
| Reorder department lanes | `DEPARTMENTS` in `team.config.ts` (departments not listed go at the end) |
| Fix someone not found or not linked | Settings page (no deploy needed, but needs the volume), or an alias in `team.config.ts` |
| Change thresholds or timezone | Environment variables on Railway (no code change) |
| Change the look | `app/globals.css`: colour tokens at the top (`:root` and the light-mode block) |

## Decisions and gotchas

- **Running ClickUp timers:** the date-range `time_entries` list can omit running timers, so `/time_entries/current?assignee=` is called per person and **wins over the list**. That's about 1 + N ClickUp calls per minute, which is inside ClickUp's 100/min limit for ~20 people. Watch this if the team grows a lot (more than ~80 people).
- **ClickUp token must be Owner/Admin**, or the board shows `ClickUp 403 … TIMEENTRY_059` and everyone lands in the pool.
- **Jibble API fields used:** `TimeEntries` with `$select=id,personId,type,time,belongsToDate` and `$expand=activity($select=name),project($select=name)`; `People` with `id,fullName,email,status`; `Screenshots`. Adding unverified fields to `$select` can break every Jibble call, so test carefully.
- **Timezones:** everything "per day" uses the team timezone via `lib/time.ts`, never the server's. Clock times shown in the browser use the viewer's local time.
- **A day without a clock-out** is counted up to midnight (or now for today) in the weekly report.
- **Weekly averages** are per day the person clocked in, so days off don't pull them down.
- **Single instance only:** state lives in one process. Don't scale the Railway service to more than one replica.
- **Security:** set `DASHBOARD_PASSWORD`. Anyone with the login can assign people, change Free/Busy and edit Settings. There is no read-only role yet.

## Change history

1. Initial board: live states, pool, alerts, today's report.
2. Settings page for manual Jibble/ClickUp links; data folder defaults to the Railway volume.
3. Running ClickUp timers read from the current-timer endpoint (fixed people with a running timer showing as idle).
4. `clickup: false` (Jibble-only people) and roster changes.
5. Person panel (Jibble activities + ClickUp tasks per day) and the new aurora theme.
6. Weekly tab with averages, CSV and print.
7. ClickUp time during Jibble breaks removed and flagged; pool made manual (`AUTO_POOL`); Daily tab for any date with per-day CSV.
8. ClickUp time after clock-out removed too; a ClickUp timer on a "Pool" task puts the person in the pool (`POOL_TASK_WORD`).

## Ideas not built yet

- Read-only login for viewers who shouldn't assign people or edit Settings.
- Editing the team list from the Settings page (it's code-only today).
- Saving daily snapshots so the weekly report can include missed-break and frozen-screen totals (these come from screenshots and aren't rebuilt for past weeks).
