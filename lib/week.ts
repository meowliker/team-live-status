import { CONFIG, clickupOn } from './config';
import { engine } from './engine';
import * as jibble from './jibble';
import * as clickup from './clickup';
import * as mock from './mock';
import { addDays, mondayOf, startOfDay, todayStr } from './time';
import type { ClickupSpan, JibbleEntry, PersonWeek, Segment, WeekDay, WeekReport } from './types';
import { offClockSpans, removeOffClockTime } from './overlap';

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

  // ClickUp timer stretches per user per day (by the day the timer started)
  const cuSpans = new Map<string, ClickupSpan[]>(); // `${uid}|${date}`
  for (const x of cuEntries || []) {
    const uid = Number(x.user?.id);
    const start = Number(x.start);
    const dur = Number(x.duration);
    const end = dur < 0 || !Number(x.end) ? now : Number(x.end);
    const date = todayStr(new Date(start));
    if (!uid || end <= start || !dates.includes(date)) continue;
    const key = `${uid}|${date}`;
    if (!cuSpans.has(key)) cuSpans.set(key, []);
    const t = clickup.entryTask(x);
    cuSpans.get(key)!.push({ from: start, to: end, task: t.name, url: t.url });
  }

  const byPerson = new Map<string, JibbleEntry[]>();
  for (const x of entries) {
    if (!dates.includes(x.belongsToDate)) continue;
    if (!byPerson.has(x.personId)) byPerson.set(x.personId, []);
    byPerson.get(x.personId)!.push(x);
  }

  const people: PersonWeek[] = linked.map(({ member, person, cu, jibbleOnly }) => {
    const mine = byPerson.get(person!.id) || [];
    const useCu = !!cu && !jibbleOnly && cuEntries !== null;

    const days: (WeekDay | null)[] = dates.map((date) => {
      const list = mine.filter((x) => x.belongsToDate === date).sort((a, b) => a.time.localeCompare(b.time));
      if (!list.some((x) => x.type === 'In')) return null;
      const dayStart = startOfDay(date).getTime();
      // A day left open (no clock-out) ends at midnight, or now for today
      const cap = Math.max(Math.min(now, startOfDay(addDays(date, 1)).getTime()), new Date(list.at(-1)!.time).getTime());
      const segments: Segment[] = [];
      list.forEach((x, i) => {
        if (x.type === 'Out') return;
        const to = i + 1 < list.length ? list[i + 1].time : new Date(cap).toISOString();
        segments.push(x.type === 'StartBreak'
          ? { kind: 'break', from: x.time, to }
          : { kind: 'work', from: x.time, to, activity: x.activity?.name || null, project: x.project?.name || null });
      });
      const len = (x: Segment) => Math.max(0, new Date(x.to).getTime() - new Date(x.from).getTime()) / 60e3;
      const acts = new Map<string, { activity: string | null; project: string | null; minutes: number }>();
      for (const x of segments.filter((x) => x.kind === 'work')) {
        const key = `${x.activity || ''}\u0000${x.project || ''}`;
        const cur = acts.get(key) || { activity: x.activity || null, project: x.project || null, minutes: 0 };
        cur.minutes += len(x);
        acts.set(key, cur);
      }
      const cuDay = useCu ? removeOffClockTime(cuSpans.get(`${cu!.id}|${date}`) || [], offClockSpans(segments, list, cap)) : null;
      const firstIn = list.find((x) => x.type === 'In')!;
      const last = list.at(-1)!;
      return {
        date,
        firstIn: Math.round((new Date(firstIn.time).getTime() - dayStart) / 60e3),
        lastOut: last.type === 'Out' ? Math.round((new Date(last.time).getTime() - dayStart) / 60e3) : null,
        worked: Math.round(segments.filter((x) => x.kind === 'work').reduce((t, x) => t + len(x), 0)),
        breaks: Math.round(segments.filter((x) => x.kind === 'break').reduce((t, x) => t + len(x), 0)),
        clickup: cuDay ? cuDay.trackedMin : null,
        clickupOffClock: cuDay ? cuDay.removedMin : null,
        offClock: cuDay ? cuDay.offClock : [],
        segments,
        activities: [...acts.values()].map((a) => ({ ...a, minutes: Math.round(a.minutes) })).filter((a) => a.minutes > 0).sort((a, b) => b.minutes - a.minutes),
        tasks: cuDay ? cuDay.tasks.map(({ name, url, minutes }) => ({ name, url, minutes })) : [],
      };
    });

    const present = days.filter(Boolean) as WeekDay[];
    const sum = (f: (d: WeekDay) => number) => present.reduce((t, d) => t + f(d), 0);
    const totalWorked = sum((d) => d.worked);
    const totalBreak = sum((d) => d.breaks);
    const totalClickup = useCu ? sum((d) => d.clickup || 0) : null;
    const merge = <T extends { minutes: number }>(items: T[], key: (x: T) => string) => {
      const m = new Map<string, T>();
      for (const x of items) {
        const cur = m.get(key(x));
        m.set(key(x), cur ? { ...cur, minutes: cur.minutes + x.minutes } : { ...x });
      }
      return [...m.values()].sort((a, b) => b.minutes - a.minutes);
    };
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
      totalClickupOffClock: useCu ? sum((d) => d.clickupOffClock || 0) : null,
      activities: merge(present.flatMap((d) => d.activities), (a) => `${a.activity || ''}\u0000${a.project || ''}`),
      tasks: useCu ? merge(present.flatMap((d) => d.tasks), (t) => t.name).slice(0, 10) : [],
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

const topActivity = (a: { activity: string | null; project: string | null } | undefined) =>
  a ? `${a.activity || 'No activity'}${a.project ? ` (${a.project})` : ''}` : '';
const csv = (rows: (string | number)[][]) => '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\n') + '\n'; // BOM so Excel reads UTF-8

export function weekCsv(w: WeekReport) {
  const dayNames = w.dates.map((d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const head = [
    'Name', 'Department', 'Days in', 'Avg clock-in', 'Avg clock-out', 'Avg worked / day', 'Total worked', `Days ≥ ${hmm(w.settings.workTargetMin)}`,
    'Avg break / day', 'Total break', `Days over ${hmm(w.settings.breakAllowanceMin)} break`, 'Avg ClickUp / day', 'Total ClickUp', 'ClickUp removed (ran on break or after clock-out)',
    ...dayNames.map((d) => `Worked ${d}`), 'Top Jibble activity', 'Top ClickUp task',
  ];
  return csv([head, ...w.people.map((p) => [
    p.name, p.department, p.daysPresent, hmm(p.avgIn), hmm(p.avgOut), hmm(p.avgWorked), hmm(p.totalWorked), p.daysOnTarget,
    hmm(p.avgBreak), hmm(p.totalBreak), p.daysOverBreak, hmm(p.avgClickup), hmm(p.totalClickup), hmm(p.totalClickupOffClock),
    ...p.days.map((d) => (d ? hmm(d.worked) : '')),
    topActivity(p.activities[0]), p.tasks[0]?.name || '',
  ])]);
}

/** One row per person for a single day */
export function dayCsv(w: WeekReport, date: string) {
  const i = w.dates.indexOf(date);
  const head = ['Date', 'Name', 'Department', 'Clock-in', 'Clock-out', 'Worked', 'Break', 'ClickUp', 'ClickUp removed (ran on break or after clock-out)', 'Jibble activities', 'ClickUp tasks'];
  return csv([head, ...w.people.map((p) => {
    const d = p.days[i];
    if (!d) return [date, p.name, p.department, 'Not in', '', '', '', '', '', '', ''];
    return [
      date, p.name, p.department, hmm(d.firstIn), hmm(d.lastOut), hmm(d.worked), hmm(d.breaks), hmm(d.clickup), hmm(d.clickupOffClock),
      d.activities.map((a) => `${topActivity(a)} ${hmm(a.minutes)}`).join('; '),
      d.tasks.map((t) => `${t.name} ${hmm(t.minutes)}`).join('; '),
    ];
  })]);
}
