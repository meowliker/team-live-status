# Team Live

One link that shows your team live:

- **Working now**: who is clocked in on Jibble, and the **task their ClickUp timer is running on** (with how long it has been running).
- **Pool**: clocked in on Jibble but **no ClickUp timer running**. Split by department, with an **Assign** button. Flags anyone idle in the pool for 15+ minutes.
- **On break**: from Jibble, with long-break warnings.
- **Needs attention**: blank or frozen screens (from Jibble screenshots), or a ClickUp timer left running during a break or after clock-out.
- **Offline**: clocked out (with the time) or not in today.
- **Today's report**: clock-in, clock-out, worked time vs 7h, ClickUp tracked time, breaks vs 1h 30m, and a colour timeline for each person.
- Live feed, browser alerts, department filters, light and dark mode. Works on phones.

## Team list
Edit `team.config.ts`. Names are matched to Jibble; a first name is enough if it is unique.
If the board says someone is "Not found in Jibble" or "Not linked to ClickUp", add their exact Jibble or ClickUp name to `aliases`.

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
- It makes one ClickUp call and one Jibble call per minute, well inside both APIs' limits.
- Missed-break time is an estimate, because Jibble takes a screenshot about every 10 minutes.
