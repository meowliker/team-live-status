# Team Live

One link that shows your team live:

- **Working now**: who is clocked in on Jibble, and the **task their ClickUp timer is running on** (with how long it has been running).
- **Pool**: clocked in on Jibble but **no ClickUp timer running**. Split by department, with an **Assign** button. Flags anyone idle in the pool for 15+ minutes.
- **On break**: from Jibble, with long-break warnings.
- **Needs attention**: blank or frozen screens (from Jibble screenshots), or a ClickUp timer left running during a break or after clock-out.
- **Offline**: clocked out (with the time) or not in today.
- **Today's report**: clock-in, clock-out, worked time vs 7h, ClickUp tracked time, breaks vs 1h 30m, and a colour timeline for each person.
- **Click anyone's name** to see their day: clock-in, worked time, breaks, a timeline, time per Jibble activity/project (the activity picked at clock-in) and time per ClickUp task.
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

## Notes
- It runs as an always-on server: it keeps polling in the background and saves picks to `.data/`. Host it somewhere that stays on (Railway, Render paid, a VPS, or an office PC), not Vercel's free serverless.
- Each minute it makes one Jibble call, one ClickUp call for today's time entries and one per linked person for their running timer (about 22 for 21 people), inside ClickUp's 100-a-minute limit.
- Missed-break time is an estimate, because Jibble takes a screenshot about every 10 minutes.
