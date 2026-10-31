// Slack messages:
// - "Needs attention": tell the person once, remind them after SLACK_REMIND_MINUTES and tell the managers at the
//   same time, and reply "sorted" in the same threads when it clears.
// - Pool: when someone joins the pool, post in the pool channel tagging the people who hand out work, and reply
//   in the thread when they're assigned or leave the pool.
import { SLACK_MANAGERS, SLACK_POOL_TAG_DEPARTMENTS } from '../team.config';
import { CONFIG } from './config';
import * as slack from './slack';
import type { PersonRow } from './types';

type Kind = 'away' | 'frozen' | 'noshots' | 'timerBreak' | 'timerOut';
type Issue = { kind: Kind; minutes: number; message: string; label: string };
type Where = { channel: string; ts: string };
type Open = { startedAt: number; sentAt: number; dm: Where; reminded: boolean; label: string; managers: Where[] };
type State = { open: Record<string, Open>; quietUntil: Record<string, number>; pool: Record<string, Where> };

const COOLDOWN_MIN = 15; // after a problem clears, don't message about the same thing again for this long

/** What the person sees, per problem. Mirrors the "Needs attention" rules on the board. */
function issuesOf(p: PersonRow): Issue[] {
  const n = p.name.split(' ')[0];
  const out: Issue[] = [];
  if (p.state === 'working' && p.away) {
    out.push({ kind: 'away', minutes: p.away.minutes, label: 'blank screen with no break logged',
      message: `👋 Hi ${n}, your screen has been blank or locked for *${p.away.minutes} min* but Jibble still shows you as working. If you've stepped away, please *start a break in Jibble*. If you're back, just carry on and this will clear.` });
  } else if (p.state === 'working' && p.frozen) {
    out.push({ kind: 'frozen', minutes: p.frozen.minutes, label: 'screen frozen (no change on screen)',
      message: `👋 Hi ${n}, your screen hasn't changed for *${p.frozen.minutes} min* (${p.frozen.shots} identical screenshots). Is everything OK? If you're on a call or reading, no worries. If you've stepped away, please *start a break in Jibble*.` });
  } else if (p.state === 'working' && p.noScreenshots) {
    out.push({ kind: 'noshots', minutes: p.noScreenshots, label: 'no Jibble screenshots (tracker may be off)',
      message: `⚠️ Hi ${n}, we haven't received a Jibble screenshot for *${p.noScreenshots} min*. Your Jibble app may be closed or paused. Please *check Jibble desktop is open and tracking*.` });
  }
  if (p.timerWhileOff && p.timer) {
    const task = p.timer.task;
    out.push(p.state === 'break'
      ? { kind: 'timerBreak', minutes: 0, label: `ClickUp timer running on break (“${task}”)`,
        message: `⏱ Hi ${n}, you're on a break in Jibble but your ClickUp timer is still running on *“${task}”*. Please *stop the timer* (this time won't count toward your ClickUp hours).` }
      : { kind: 'timerOut', minutes: 0, label: `ClickUp timer running after clock-out (“${task}”)`,
        message: `⏱ Hi ${n}, you've clocked out of Jibble but your ClickUp timer is still running on *“${task}”*. Please *stop it* so your hours stay accurate.` });
  }
  return out;
}

export class SlackAlerts {
  state: State;
  constructor(private load: () => State | null, private save: (s: State) => void) {
    this.state = { open: {}, quietUntil: {}, pool: {}, ...load() };
  }

  /**
   * Called after every poll. `people` are the board rows; `emails` maps a person id to the email used to
   * find them in Slack. Returns notices for the board (e.g. someone who couldn't be found in Slack).
   */
  async run(people: PersonRow[], emails: Map<string, string | null>, event: (name: string, text: string) => void) {
    if (!slack.slackOn()) return [];
    const now = Date.now();
    const notices: string[] = [];
    const missing: string[] = [];
    const s = this.state;
    let changed = false;
    const userOf = async (p: { id: string; name: string }) => {
      const email = emails.get(p.id);
      const id = email ? await slack.userByEmail(email) : null;
      if (!id && !missing.includes(p.name)) missing.push(p.name);
      return id;
    };

    const failed = (what: string) => (e: unknown) => {
      const msg = `Slack (${what}): ${(e as Error).message}`;
      if (!notices.includes(msg)) notices.push(msg);
    };

    for (const p of people) {
      try { changed = (await this.pool(p, people, userOf, event)) || changed; }
      catch (e) { failed(`pool message in ${CONFIG.slackPoolChannel}; is the bot invited to that channel?`)(e); }
      try { changed = (await this.attention(p, people, userOf, event, now)) || changed; }
      catch (e) { failed(`message to ${p.name}`)(e); }
    }

    // Forget people who left the board, and old cool-downs
    for (const key of Object.keys(s.open)) if (!people.some((p) => key.startsWith(`${p.id}|`))) { delete s.open[key]; changed = true; }
    for (const id of Object.keys(s.pool)) if (!people.some((p) => p.id === id)) { delete s.pool[id]; changed = true; }
    for (const [key, until] of Object.entries(s.quietUntil)) if (until < now) { delete s.quietUntil[key]; changed = true; }
    if (changed) this.save(s);
    if (missing.length) notices.push(`Slack: couldn't find ${missing.join(', ')} by email, so they weren't messaged. Use the same email in Slack and Jibble, or add their Slack email as \`slack\` in team.config.ts.`);
    return notices;
  }

  /** Announces someone joining the pool, and follows up in the thread when they leave it. Returns true if state changed. */
  private async pool(p: PersonRow, people: PersonRow[], userOf: UserOf, event: Event) {
    const s = this.state;
    const posted = s.pool[p.id];
    if (!CONFIG.slackPoolChannel || p.inPool === !!posted) return false;
    if (p.inPool) {
      // Tag the strategists and media buyers who are in today (all of them if nobody is)
      const tag = people.filter((x) => SLACK_POOL_TAG_DEPARTMENTS.includes(x.department) && x.id !== p.id);
      const inToday = tag.filter((x) => x.state !== 'out');
      const ids = [...new Set((await Promise.all((inToday.length ? inToday : tag).map(userOf))).filter((x): x is string => !!x))];
      const via = p.poolVia === 'clickup' ? ' (their ClickUp timer is on a Pool task)' : '';
      s.pool[p.id] = await slack.post(CONFIG.slackPoolChannel, `🟦 *${p.name}* (${p.department}) is free and ready for a task${via}. ${ids.map(slack.mention).join(' ')} can someone assign them?`);
      event(p.name, `was posted in ${CONFIG.slackPoolChannel} as free to assign`);
    } else {
      const why = p.pick ? `✅ Assigned by ${p.pick.by}.` : p.state === 'out' ? '✅ Clocked out, no longer in the pool.' : '✅ No longer in the pool.';
      await slack.post(CONFIG.slackPoolChannel, why, posted);
      delete s.pool[p.id];
    }
    return true;
  }

  /** "Needs attention" messages for one person. Returns true if state changed. */
  private async attention(p: PersonRow, people: PersonRow[], userOf: UserOf, event: Event, now: number) {
    const s = this.state;
    let changed = false;
    const issues = issuesOf(p);
    const active = new Set(issues.map((i) => `${p.id}|${i.kind}`));

    // Problems that cleared: say so in the same threads
    for (const key of Object.keys(s.open).filter((k) => k.startsWith(`${p.id}|`) && !active.has(k))) {
      const o = s.open[key];
      const took = Math.round((now - o.startedAt) / 60e3);
      await slack.dm('', '✅ Sorted, thanks!', o.dm).catch(() => {});
      for (const m of o.managers) await slack.dm('', `✅ ${p.name} fixed it (${took} min in total).`, m).catch(() => {});
      delete s.open[key];
      s.quietUntil[key] = now + COOLDOWN_MIN * 60e3;
      changed = true;
    }

    for (const issue of issues) {
      const key = `${p.id}|${issue.kind}`;
      const o = s.open[key];
      if (!o) {
        // New problem: message the person (unless the same thing just cleared a few minutes ago)
        if ((s.quietUntil[key] || 0) > now) continue;
        const user = await userOf(p);
        if (!user) continue;
        s.open[key] = { startedAt: now - issue.minutes * 60e3, sentAt: now, dm: await slack.dm(user, issue.message), reminded: false, label: issue.label, managers: [] };
        event(p.name, `was messaged on Slack: ${issue.label}`);
        changed = true;
      } else if (!o.reminded && now - o.sentAt >= CONFIG.slackRemindMin * 60e3) {
        // Still not fixed: remind them, and tell the managers
        const took = Math.round((now - o.startedAt) / 60e3);
        await slack.dm('', `Just a reminder: ${issue.label} is still showing (${took} min). Could you take a look?`, o.dm);
        for (const name of SLACK_MANAGERS) {
          if (name === p.name) continue; // don't tell a manager about their own alert
          const m = people.find((x) => x.name === name);
          const user = m ? await userOf(m) : null;
          if (!user) continue;
          o.managers.push(await slack.dm(user, `⚠️ *${p.name}* (${p.department}): ${issue.label} for *${took} min*, not fixed after a reminder.`));
        }
        o.reminded = true;
        event(p.name, `was reminded on Slack${o.managers.length ? ` and ${SLACK_MANAGERS.join(', ')} told` : ''}: ${issue.label}`);
        changed = true;
      }
    }
    return changed;
  }
}

type UserOf = (p: { id: string; name: string }) => Promise<string | null>;
type Event = (name: string, text: string) => void;
