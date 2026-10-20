import { CONFIG, clickupOn } from './config';
import { engine } from './engine';
import * as jibble from './jibble';
import * as clickup from './clickup';
import * as mock from './mock';
import { addDays, mondayOf, startOfDay, todayStr } from './time';
import type { JibbleEntry, PersonWeek, WeekDay, WeekReport } from './types';

// Past weeks don't change, so keep them for an hour; the current week for 5 minutes
const cache = new Map<string, { at: number; ttl: number; data: Promise<WeekReport> }>();

export function getWeek(weekStart: string, fresh = false) {
  const start = mondayOf(weekStart);
  const hit = cache.get(start);
  if (!fresh && hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const current = start === mondayOf(todayStr());
  const data = buildWeek(start);
  cache.set(start, { at: Date.now(), ttl: current ? 5 * 60e3 : 60 * 60e3, data });
  data.catch(() => cache.delete(start));
  return data;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

async function buildWeek(weekStart: string): Promise<WeekReport> {
  const e = engine();
  if (!e.updatedAt) await e.poll();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const now = Date.now();
  const from = startOfDay(weekStart).getTime() - 12 * 3600e3; // night shifts that belong to Monday
  const to = Math.min(now, startOfDay(addDays(weekStart, 7)).getTime() + 12 * 3600e3);
  const errors: string[] = [];

  const roster = e.roster();
  const linked = roster.filter((r) => r.person);
  const cuIds = [...new Set(linked.filter((r) => r.cu && !r.jibbleOnly).map((r) => r.cu!.id))];

  const [entries, cuEntries] = await Promise.all([
    from < to ? (CONFIG.mock ? mock.getEntriesBetween(new Date(from).toISOString(), new Date(to).toISOString()) : jibble.getEntriesBetween(new Date(from).toISOString(), new Date(to).toISOString())) : Promise.resolve([] as JibbleEntry[]),
    (async () => {
      if (!clickupOn() || !cuIds.length || from >= to) return null;
      try {
        return CONFIG.mock ? await mock.getClickupEntriesBetween(startOfDay(weekStart).getTime(), to) : await clickup.getEntriesBetween(startOfDay(weekStart).getTime(), to, cuIds);
      } catch (err) {
        errors.push(`ClickUp: ${(err as Error).message}`);
        return null;
      }
    })(),
  ]);

  // ClickUp minutes per user per day, and per task over the week
  const cuDay = new Map<string, number>(); // `${uid}|${date}`
  const cuTasks = new Map<number, Map<string, { name: string; url: string | null; minutes: number }>>();
  for (const x of cuEntries || []) {
    const uid = Number(x.user?.id);
    const start = Number(x.start);
    const dur = Number(x.duration);
    const end = dur < 0 || !Number(x.end) ? now : Number(x.end);
    const min = Math.max(0, end - start) / 60e3;
    const date = todayStr(new Date(start));
    if (!uid || !min || !dates.includes(date)) continue;
    cuDay.set(`${uid}|${date}`, (cuDay.get(`${uid}|${date}`) || 0) + min);
    const t = clickup.entryTask(x);
    if (!cuTasks.has(uid)) cuTasks.set(uid, new Map());
    const m = cuTasks.get(uid)!;
    const cur = m.get(t.name) || { ...t, minutes: 0 };
    cur.minutes += min;
    m.set(t.name, cur);
  }

  const byPerson = new Map<string, JibbleEntry[]>();
  for (const x of entries) {
    if (!dates.includes(x.belongsToDate)) continue;
    if (!byPerson.has(x.personId)) byPerson.set(x.personId, []);
    byPerson.get(x.personId)!.push(x);
  }

  const people: PersonWeek[] = linked.map(({ member, person, cu, jibbleOnly }) => {
    const mine = byPerson.get(person!.id) || [];
    const acts = new Map<string, { activity: string | null; project: string | null; minutes: number }>();
    const useCu = !!cu && !jibbleOnly && cuEntries !== null;

    const days: (WeekDay | null)[] = dates.map((date) => {
      const list = mine.filter((x) => x.belongsToDate === date).sort((a, b) => a.time.localeCompare(b.time));
      if (!list.some((x) => x.type === 'In')) return null;
      const dayStart = startOfDay(date).getTime();
      // A day left open (no clock-out) ends at midnight, or now for today
      const cap = Math.max(Math.min(now, startOfDay(addDays(date, 1)).getTime()), new Date(list.at(-1)!.time).getTime());
      let worked = 0;
      let breaks = 0;
      list.forEach((x, i) => {
        if (x.type === 'Out') return;
        const a = new Date(x.time).getTime();
        const b = i + 1 < list.length ? new Date(list[i + 1].time).getTime() : cap;
        const min = Math.max(0, b - a) / 60e3;
        if (x.type === 'StartBreak') { breaks += min; return; }
        worked += min;
        const key = `${x.activity?.name || ''}\u0000${x.project?.name || ''}`;
        const cur = acts.get(key) || { activity: x.activity?.name || null, project: x.project?.name || null, minutes: 0 };
        cur.minutes += min;
        acts.set(key, cur);
      });
      const firstIn = list.find((x) => x.type === 'In')!;
      const last = list.at(-1)!;
      return {
        date,
        firstIn: Math.round((new Date(firstIn.time).getTime() - dayStart) / 60e3),
        lastOut: last.type === 'Out' ? Math.round((new Date(last.time).getTime() - dayStart) / 60e3) : null,
        worked: Math.round(worked),
        breaks: Math.round(breaks),
        clickup: useCu ? Math.round(cuDay.get(`${cu!.id}|${date}`) || 0) : null,
      };
    });

    const present = days.filter(Boolean) as WeekDay[];
    const sum = (f: (d: WeekDay) => number) => present.reduce((t, d) => t + f(d), 0);
    const totalWorked = sum((d) => d.worked);
    const totalBreak = sum((d) => d.breaks);
    const totalClickup = useCu ? sum((d) => d.clickup || 0) : null;
    return {
      name: member.name,
      department: member.department,
      jibbleName: person!.name,
      days,
      daysPresent: present.length,
      avgIn: avg(present.map((d) => d.firstIn!).filter((x) => x !== null)),
      avgOut: avg(present.map((d) => d.lastOut).filter((x): x is number => x !== null)),
      totalWorked,
      avgWorked: present.length ? Math.round(totalWorked / present.length) : 0,
      daysOnTarget: present.filter((d) => d.worked >= CONFIG.workTargetMin).length,
      totalBreak,
      avgBreak: present.length ? Math.round(totalBreak / present.length) : 0,
      daysOverBreak: present.filter((d) => d.breaks > CONFIG.breakAllowanceMin).length,
      totalClickup,
      avgClickup: totalClickup !== null && present.length ? Math.round(totalClickup / present.length) : null,
      activities: [...acts.values()].map((a) => ({ ...a, minutes: Math.round(a.minutes) })).filter((a) => a.minutes > 0).sort((a, b) => b.minutes - a.minutes),
      tasks: useCu ? [...(cuTasks.get(cu!.id)?.values() || [])].map((t) => ({ ...t, minutes: Math.round(t.minutes) })).sort((a, b) => b.minutes - a.minutes).slice(0, 10) : [],
    };
  });

  return {
    weekStart,
    dates,
    generatedAt: new Date().toISOString(),
    timezone: CONFIG.timezone,
    clickup: clickupOn(),
    mock: CONFIG.mock,
    settings: { workTargetMin: CONFIG.workTargetMin, breakAllowanceMin: CONFIG.breakAllowanceMin },
    departments: e.departments(),
    people,
    notFound: roster.filter((r) => !r.person).map((r) => r.member.name),
    errors,
  };
}

// ───────────────────────── CSV for the weekly meeting ─────────────────────────
const hmm = (m: number | null) => (m === null ? '' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`);
const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function weekCsv(w: WeekReport) {
  const dayNames = w.dates.map((d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const head = [
    'Name', 'Department', 'Days in', 'Avg clock-in', 'Avg clock-out', 'Avg worked / day', 'Total worked', `Days ≥ ${hmm(w.settings.workTargetMin)}`,
    'Avg break / day', 'Total break', `Days over ${hmm(w.settings.breakAllowanceMin)} break`, 'Avg ClickUp / day', 'Total ClickUp',
    ...dayNames.map((d) => `Worked ${d}`), 'Top Jibble activity', 'Top ClickUp task',
  ];
  const rows = w.people.map((p) => [
    p.name, p.department, p.daysPresent, hmm(p.avgIn), hmm(p.avgOut), hmm(p.avgWorked), hmm(p.totalWorked), p.daysOnTarget,
    hmm(p.avgBreak), hmm(p.totalBreak), p.daysOverBreak, hmm(p.avgClickup), hmm(p.totalClickup),
    ...p.days.map((d) => (d ? hmm(d.worked) : '')),
    p.activities[0] ? `${p.activities[0].activity || 'No activity'}${p.activities[0].project ? ` (${p.activities[0].project})` : ''}` : '',
    p.tasks[0]?.name || '',
  ]);
  return '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'; // BOM so Excel reads UTF-8
}
