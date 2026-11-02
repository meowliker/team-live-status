# Team Live

> **New to this project?** Read [`CLAUDE.md`](CLAUDE.md) first: how it works, where data lives, how to deploy and change it.

One link that shows your team live:

- **Working now**: who is clocked in on Jibble, and the **task their ClickUp timer is running on** (with how long it has been running).
- **Pool**: people someone has added by hand with **＋ Add to pool** (on anyone who is working), and anyone running a ClickUp timer on a task named **Pool** (any task name starting with "Pool"; change the word with `POOL_TASK_WORD`). Split by department, with **Assign** and **Remove from pool** buttons. Flags anyone idle in the pool for 15+ minutes. Set `AUTO_POOL=on` to go back to adding everyone clocked in with no ClickUp timer automatically.
- **On break**: from Jibble, with long-break warnings.
- **Needs attention**: blank or frozen screens (from Jibble screenshots), or a ClickUp timer left running during a break or after clock-out.
- **Offline**: clocked out (with the time) or not in today.
- **Daily**: any day's report (Today, Yesterday, ‹ › or pick a date): clock-in, clock-out, worked time vs 7h, ClickUp tracked time, breaks vs 1h 30m, a colour timeline, and each person's Jibble activities and ClickUp tasks. **Download CSV** for that day.
- **ClickUp timers off the clock**: if someone's ClickUp timer keeps running while they are on a Jibble break or after they clock out, that time is taken off their ClickUp hours everywhere (board, daily, weekly, CSV) and flagged, with the task, times and reason.
- **Click anyone's name** to see their day: clock-in, worked time, breaks, a timeline, time per Jibble activity/project (the activity picked at clock-in) and time per ClickUp task.
- **Weekly**: pick any week (this week, last week, or step back) to see each person's days in, average clock-in and clock-out, average worked time and days on target, average breaks and days over the allowance, ClickUp time per day and coverage, a bar per day, and their Jibble activities and top ClickUp tasks. **Download CSV** for a spreadsheet, or **Print**. Built from Jibble and ClickUp history, so past weeks work too.
- **Slack** (optional): when someone lands in *Needs attention* they get a Slack DM saying what's wrong and how to fix it; if it isn't fixed after 10 minutes they get a reminder and the managers in `team.config.ts` (`SLACK_MANAGERS`) are told; when it clears, "✅ Sorted" is posted in the same threads. When someone joins the pool, it's posted in `#creatives` with **@here** (set `SLACK_POOL_MENTION=channel` for @channel); if they're still free after 15 minutes, a reminder follows in the thread, then "✅ Assigned by …". Set it up: see *Slack setup* below.
- Live feed, browser alerts, department filters, light and dark mode. Works on phones.

## Team list
Edit `team.config.ts`. Names are matched to Jibble; a first name is enough if it is unique.
Add `clickup: false` to someone who doesn't use ClickUp: they are tracked from Jibble only and show under "Working now" while clocked in.

## Linking people (Settings page)
Open **⚙ Settings** on the board (`/settings`). It lists everyone on the team with the Jibble person and ClickUp member they are linked to.
- **Auto** matches by name and email. Pick a person from the list to link them by hand instead.
- **Not on ClickUp** stops the "Not linked to ClickUp" warning for people who don't use ClickUp.
- The bottom of the page lists Jibble people and ClickUp members that aren't linked to anyone, to help find spelling differences.

Links are saved to `mapping.json` in the data folder (see below).

## Where data is saved
Nothing is stored in a database. People, clock-ins, breaks, screenshots and timers are read live from Jibble and ClickUp every minute and kept in memory.
A few small files are saved in the data folder (`DATA_DIR`, default `.data/`):
- `mapping.json`: links set on the Settings page
- `pool.json`: Free/Busy choices and who assigned whom from the pool
- `shots.json`: today's screenshot checks, so a restart doesn't re-download them

The live feed is kept in memory only and starts empty after a restart.
On Railway, attach a **Volume** to the service so these files survive redeploys. When a volume is attached the app saves to it automatically (or set `DATA_DIR` to the mount path). Without one, they are wiped on every deploy.

## Run it
Needs Node.js 20+.

```bash
npm install
npm run mock          # demo with fake data → http://localhost:3000
cp .env.example .env  # fill in the keys
npm run build && npm start
```

## Slack setup
1. Go to **api.slack.com/apps** → **Create New App** → **From scratch**, name it "Team Live", pick your workspace.
2. **OAuth & Permissions** → **Bot Token Scopes**: add `chat:write`, `im:write`, `users:read`, `users:read.email`.
3. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`).
4. In Railway → **Variables**, add `SLACK_BOT_TOKEN` with that token (and `SLACK_POOL_CHANNEL` if the channel isn't `#creatives`).
5. In Slack, open the creatives channel and type `/invite @Team Live`.

People are found in Slack by their Jibble email. If someone's Slack email is different, add `slack: 'their@email'` to their line in `team.config.ts`. The board shows a yellow note for anyone it can't find.

## Notes
- It runs as an always-on server: it keeps polling in the background and saves picks to `.data/`. Host it somewhere that stays on (Railway, Render paid, a VPS, or an office PC), not Vercel's free serverless.
- Each minute it makes one Jibble call, one ClickUp call for today's time entries and one per linked person for their running timer (about 22 for 21 people), inside ClickUp's 100-a-minute limit.
- Missed-break time is an estimate, because Jibble takes a screenshot about every 10 minutes.
