// Demo data so the board can be tried without any keys: `npm run mock`
import { TEAM } from '../team.config';
import { addDays, startOfDay, todayStr } from './time';
import type { ClickupMember, JibbleEntry, JibblePerson, Shot, TimerInfo } from './types';

const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
const activities = [['Video editing', 'Bloom Little'], ['Ad scripts', 'Phonics'], ['Meetings', null], ['Design', 'Math Mats']] as const;
const act = (i: number) => ({ activity: { name: activities[i % 4][0] }, project: activities[i % 4][1] ? { name: activities[i % 4][1]! } : null });
const tasks = ['Reel v3 – Phonics', 'UGC ad #4 – Bloom Little', 'Art Therapy hook test', 'Landing page – Math Mats', 'Static ads batch 12', 'Crochet guide pages', 'Weekly payout recon', 'Interview scheduling'];

const people: JibblePerson[] = TEAM.map((m, i) => ({
  id: `p${i}`,
  name: m.name.includes(' ') ? m.name : `${m.name} Demo`, // tests first-name matching
  email: `${m.name.split(' ')[0].toLowerCase()}@example.com`,
}));

// [jibble state, minutes in that state, trailing blank screenshots, timer running?]
type Sc = ['In' | 'StartBreak' | 'Out', number, number, boolean];
const scenario: Sc[] = TEAM.map((_, i): Sc => {
  const r = i % 7;
  if (r === 0) return ['In', 95, 0, true];
  if (r === 1) return ['In', 40, 0, false];
  if (r === 2) return ['StartBreak', 12 + i, 0, i % 2 === 0];
  if (r === 3) return ['In', 130, i === 3 ? 3 : 0, true];
  if (r === 4) return ['In', 70, 0, true];
  if (r === 5) return ['Out', 300, 0, false];
  return ['In', 25, 0, false];
});

let emitted = false;

export const getPeople = async () => people;

export async function getRecentEntries(): Promise<JibbleEntry[]> {
  if (Math.random() < 0.3) {
    const i = Math.floor(Math.random() * scenario.length);
    if (scenario[i][0] !== 'Out') {
      scenario[i][0] = scenario[i][0] === 'In' ? 'StartBreak' : 'In';
      scenario[i][1] = 0;
    }
  }
  if (Math.random() < 0.3) {
    const i = Math.floor(Math.random() * scenario.length);
    if (scenario[i][0] === 'In') scenario[i][3] = !scenario[i][3];
  }
  const today = todayStr();
  return people.flatMap((p, i) => {
    const latest: JibbleEntry = { personId: p.id, type: scenario[i][0], time: min(scenario[i][1]), belongsToDate: today };
    return scenario[i][0] === 'In' ? [{ ...latest, ...act(i + 1), time: min(scenario[i][1] + 60) }, { ...latest, type: 'StartBreak' as const, time: min(scenario[i][1] + 15) }, { ...latest, ...act(i) }] : [{ ...latest, ...act(i), type: 'In' as const, time: min(scenario[i][1] + 150) }, latest];
  });
}

export async function getNewShots(): Promise<Shot[]> {
  if (emitted) return [];
  emitted = true;
  const out: Shot[] = [];
  people.forEach((p, i) => {
    const [, since, blanks] = scenario[i];
    const count = Math.floor(since / 10);
    for (let k = count; k >= 1; k--) out.push({ id: `${p.id}-${k}`, personId: p.id, time: min(k * 10 - 3), blank: k <= blanks });
  });
  return out;
}

export const getMembers = async (): Promise<ClickupMember[]> => people.map((p, i) => ({ id: 1000 + i, email: p.email, username: p.name }));

export async function getTimers(): Promise<Map<number, TimerInfo>> {
  const map = new Map<number, TimerInfo>();
  people.forEach((_, i) => {
    const running = scenario[i][3];
    map.set(1000 + i, {
      trackedTodayMin: 60 + ((i * 37) % 240),
      tasks: [
        { name: tasks[i % tasks.length], url: 'https://app.clickup.com', minutes: 40 + ((i * 37) % 120), running },
        { name: tasks[(i + 3) % tasks.length], url: 'https://app.clickup.com', minutes: 20 + ((i * 17) % 80), running: false },
      ],
      running: running ? { task: tasks[i % tasks.length], url: 'https://app.clickup.com', status: 'in progress', startedAt: min(10 + ((i * 13) % 80)) } : null,
    });
  });
  return map;
}

// ── past days for the weekly report ──
const rnd = (...k: (string | number)[]) => {
  let h = 2166136261;
  for (const c of k.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};
const datesBetween = (fromIso: string, toIso: string) => {
  const out: string[] = [];
  for (let d = todayStr(new Date(fromIso)); d <= todayStr(new Date(toIso)); d = addDays(d, 1)) out.push(d);
  return out;
};
const workDay = (i: number, date: string) => {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  return date < todayStr() && (dow >= 1 && dow <= 5 ? rnd(i, date, 'off') > 0.08 : dow === 6 && i % 5 === 0);
};
// [in, break start, back, out] in ms for one person's past day
const dayPlan = (i: number, date: string) => {
  const t0 = startOfDay(date).getTime() + (9 * 60 + rnd(i, date, 'in') * 90) * 60e3;
  const t1 = t0 + (210 + rnd(i, date, 'a') * 60) * 60e3;
  const t2 = t1 + (30 + rnd(i, date, 'b') * 50) * 60e3;
  const t3 = t2 + (200 + rnd(i, date, 'c') * 90) * 60e3;
  return [t0, t1, t2, t3];
};

export async function getEntriesBetween(fromIso: string, toIso: string): Promise<JibbleEntry[]> {
  const out: JibbleEntry[] = [];
  for (const date of datesBetween(fromIso, toIso)) {
    if (date === todayStr()) { out.push(...(await getRecentEntries()).filter((e) => e.belongsToDate === date)); continue; }
    people.forEach((p, i) => {
      if (!workDay(i, date)) return;
      const [t0, t1, t2, t3] = dayPlan(i, date);
      const iso = (t: number) => new Date(t).toISOString();
      out.push(
        { personId: p.id, type: 'In', time: iso(t0), belongsToDate: date, ...act(i + Math.floor(rnd(i, date, 'x') * 3)) },
        { personId: p.id, type: 'StartBreak', time: iso(t1), belongsToDate: date },
        { personId: p.id, type: 'In', time: iso(t2), belongsToDate: date, ...act(i + 1) },
        { personId: p.id, type: 'Out', time: iso(t3), belongsToDate: date },
      );
    });
  }
  return out.filter((e) => e.time >= fromIso && e.time < toIso).sort((a, b) => a.time.localeCompare(b.time));
}

export async function getClickupEntriesBetween(startMs: number, endMs: number): Promise<any[]> {
  const out: any[] = [];
  for (const date of datesBetween(new Date(startMs).toISOString(), new Date(endMs).toISOString())) {
    people.forEach((_, i) => {
      if (!workDay(i, date)) return;
      const [t0, t1, t2, t3] = dayPlan(i, date);
      [[t0 + 10 * 60e3, t1 - 5 * 60e3], [t2 + 5 * 60e3, t3 - (20 + rnd(i, date, 'gap') * 60) * 60e3]].forEach(([a, b], k) => {
        const name = tasks[(i + k + Math.floor(rnd(i, date, 't') * 4)) % tasks.length];
        out.push({ id: `${i}-${date}-${k}`, user: { id: 1000 + i }, start: String(a), end: String(b), duration: String(b - a), task: { id: `t${name.length}`, name } });
      });
    });
  }
  return out.filter((e) => Number(e.start) >= startMs && Number(e.start) < endMs);
}

