// The monthly report: the weekly reports that touch the month, cut to the month's own days,
// plus the sets sheet and the points for that month.
import { summary as pointsSummary, RULE_LABELS } from './points';
import { summary as setsSummary, withSets } from './sets';
import { addDays, mondayOf, todayStr } from './time';
import { csv, getWeek, hmm, topActivity, totals } from './week';
import type { MonthReport, PersonMonth, PointsRule, WeekReport } from './types';

export async function getMonth(month: string, fresh = false): Promise<MonthReport> {
  const today = todayStr();
  const dates: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month) && d <= today; d = addDays(d, 1)) dates.push(d);
  const inMonth = new Set(dates);

  // One week at a time, so a month doesn't hit Jibble and ClickUp with everything at once
  const weeks: WeekReport[] = [];
  for (let w = mondayOf(dates[0]); w <= dates[dates.length - 1]; w = addDays(w, 7)) {
    weeks.push(withSets(await getWeek(w, fresh)));
  }
  const latest = weeks[weeks.length - 1];
  const points = pointsSummary(month);
  const names = [...new Set(weeks.flatMap((w) => w.people.map((p) => p.name)))];

  const people: PersonMonth[] = names.map((name) => {
    const slices = weeks.map((w) => {
      const p = w.people.find((x) => x.name === name);
      const keep = w.dates.map((d, i) => [d, i] as const).filter(([d]) => inMonth.has(d));
      return {
        p,
        from: keep[0][0],
        to: keep[keep.length - 1][0],
        days: keep.map(([, i]) => p?.days[i] ?? null),
        sets: p?.sets ? keep.map(([, i]) => p.sets![i]) : null,
      };
    });
    const p = [...slices].reverse().find((s) => s.p)!.p!;
    const useCu = slices.some((s) => s.p && s.p.totalClickup !== null);
    const days = slices.flatMap((s) => s.days);
    const sets = slices.flatMap((s) => s.sets || []);
    return {
      name,
      department: p.department,
      jibbleName: p.jibbleName,
      days,
      ...totals(days, useCu),
      setsSummary: slices.some((s) => s.sets) ? setsSummary(sets, today) : undefined,
      weeks: slices.map((s) => {
        const t = totals(s.days, useCu);
        const st = s.sets ? setsSummary(s.sets, today) : null;
        return {
          from: s.from, to: s.to,
          daysPresent: t.daysPresent, totalWorked: t.totalWorked, avgWorked: t.avgWorked, avgBreak: t.avgBreak, totalClickup: t.totalClickup,
          sets: st?.days ? st.total : null, targetDays: st?.targetDays || 0, hitDays: st?.hitDays || 0,
        };
      }),
      points: points.people.find((x) => x.name === name) || null,
    };
  });

  return {
    month,
    dates,
    generatedAt: new Date().toISOString(),
    timezone: latest.timezone,
    clickup: latest.clickup,
    settings: latest.settings,
    departments: latest.departments,
    pointsStart: points.start,
    people,
    notFound: latest.notFound,
    errors: [...new Set(weeks.flatMap((w) => w.errors))],
  };
}

export function monthCsv(m: MonthReport) {
  const rules = Object.keys(RULE_LABELS) as PointsRule[];
  const day = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const head = [
    'Name', 'Department', 'Days in', 'Avg clock-in', 'Avg clock-out', 'Avg worked / day', 'Total worked', `Days ≥ ${hmm(m.settings.workTargetMin)}`,
    'Avg break / day', 'Total break', `Days over ${hmm(m.settings.breakAllowanceMin)} break`, 'Avg ClickUp / day', 'Total ClickUp', 'ClickUp removed (ran on break or after clock-out)',
    'Sets made', 'Avg sets / day', 'Days target hit', 'Carry forward sets',
    'Points score', 'Points taken', 'Points restored', ...rules.map((r) => `Points: ${RULE_LABELS[r]}`),
    ...(m.people[0]?.weeks || []).flatMap((w) => [`Worked ${day(w.from)} – ${day(w.to)}`, `Sets ${day(w.from)} – ${day(w.to)}`]),
    'Top Jibble activity', 'Top ClickUp task',
  ];
  return csv([head, ...m.people.map((p) => {
    const s = p.setsSummary, pt = p.points;
    return [
      p.name, p.department, p.daysPresent, hmm(p.avgIn), hmm(p.avgOut), hmm(p.avgWorked), hmm(p.totalWorked), p.daysOnTarget,
      hmm(p.avgBreak), hmm(p.totalBreak), p.daysOverBreak, hmm(p.avgClickup), hmm(p.totalClickup), hmm(p.totalClickupOffClock),
      s?.total ?? '', s?.avg ?? '', s ? `${s.hitDays}/${s.targetDays}` : '', s?.carry ?? '',
      pt?.score ?? '', pt?.taken ?? '', pt?.restored ?? '', ...rules.map((r) => pt?.byRule[r] || 0),
      ...p.weeks.flatMap((w) => [hmm(w.totalWorked), w.sets ?? '']),
      topActivity(p.activities[0]), p.tasks[0]?.name || '',
    ];
  })]);
}
