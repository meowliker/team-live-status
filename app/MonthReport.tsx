'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MonthReport as Month, PersonMonth, PointsRule } from '@/lib/types';
import { DEPT_COLORS, fm, initials } from './format';

// minutes after midnight → "9:41 AM"
const clock = (m: number | null) => {
  if (m === null) return '–';
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(Math.round(m % 60)).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const day = (d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const monthName = (m: string) => day(`${m}-01`, { month: 'long', year: 'numeric' });
const shiftMonth = (m: string, n: number) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7);
const RULES: Record<PointsRule, string> = { frozen: 'Screen frozen', noshots: 'No screenshots', behind: 'Behind on ClickUp', manual: 'ClickUp added by hand', other: 'Taken by hand' };

type SortKey = 'name' | 'daysPresent' | 'avgIn' | 'avgWorked' | 'totalWorked' | 'avgBreak' | 'avgClickup' | 'sets' | 'points';
const COLS: [SortKey, string][] = [['daysPresent', 'Days'], ['avgIn', 'Avg in / out'], ['avgWorked', 'Avg worked'], ['totalWorked', 'Total worked'], ['avgBreak', 'Avg break'], ['avgClickup', 'ClickUp / day'], ['sets', 'Sets'], ['points', 'Points']];
const sortVal = (p: PersonMonth, k: Exclude<SortKey, 'name'>) =>
  k === 'sets' ? (p.setsSummary?.days ? p.setsSummary.total : null) : k === 'points' ? p.points?.score ?? null : p[k];

/** The month report: totals and averages per person, sets, points and a week-by-week breakdown */
export default function MonthReport({ dept, deptColor }: { dept: string; deptColor: Map<string, string> }) {
  const [month, setMonth] = useState<string | null>(null); // null = this month
  const [data, setData] = useState<Month | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['avgWorked', -1]);
  const [open, setOpen] = useState<string | null>(null);
  const latest = useRef(0); // a slow month must not overwrite the one picked after it

  const load = useCallback(async (fresh = false) => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ ...(month ? { month } : {}), ...(fresh ? { fresh: '1' } : {}) });
      const r = await fetch(`/api/month?${qs}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the month');
      if (id !== latest.current) return;
      setData(d);
    } catch (e) {
      if (id !== latest.current) return;
      setError((e as Error).message);
    }
    setLoading(false);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => {
    const list = (data?.people || []).filter((p) => dept === 'All' || p.department === dept);
    const [k, dir] = sort;
    return [...list].sort((a, b) => {
      if (k === 'name') return a.name.localeCompare(b.name) * dir;
      const x = sortVal(a, k) ?? -1, y = sortVal(b, k) ?? -1; // people with no value sort last
      return x === y ? a.name.localeCompare(b.name) : (x - y) * dir;
    });
  }, [data, dept, sort]);

  if (!data) return <div className="panel"><div className="empty">{error ? `⚠️ ${error}` : 'Loading the month… the first time can take a little while.'}</div></div>;

  const S = data.settings;
  const nowMonth = new Date().toLocaleDateString('en-CA', { timeZone: data.timezone }).slice(0, 7);
  const thisMonth = data.month === nowMonth;
  const go = (m: string) => setMonth(m >= nowMonth ? null : m);
  const present = people.filter((p) => p.daysPresent);
  const team = (f: (p: PersonMonth) => number | null) => {
    const xs = present.map(f).filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const sum = (f: (p: PersonMonth) => number) => people.reduce((t, p) => t + f(p), 0);
  const tracked = present.filter((p) => p.totalClickup !== null);
  const coverage = tracked.length ? Math.round((tracked.reduce((t, p) => t + p.totalClickup!, 0) / Math.max(1, tracked.reduce((t, p) => t + p.totalWorked, 0))) * 100) : null;
  const setsTotal = sum((p) => p.setsSummary?.total || 0);
  const setsHit = sum((p) => p.setsSummary?.hitDays || 0);
  const setsTarget = sum((p) => p.setsSummary?.targetDays || 0);
  const pointsTaken = sum((p) => p.points?.taken || 0);
  const byRule = (Object.keys(RULES) as PointsRule[]).map((r) => [r, sum((p) => p.points?.byRule[r] || 0)] as const).filter(([, n]) => n);
  const maxDay = Math.max(S.workTargetMin, ...people.flatMap((p) => p.days.map((d) => d?.worked || 0)));
  const cols = COLS.filter(([k]) => k !== 'avgClickup' || data.clickup);
  const toggleSort = (k: SortKey) => setSort(([ck, dir]) => [k, ck === k ? (dir === 1 ? -1 : 1) : k === 'name' || k === 'avgIn' || k === 'points' ? 1 : -1]);
  const arrow = (k: SortKey) => (sort[0] === k ? (sort[1] === 1 ? ' ↑' : ' ↓') : '');

  // Highlights for the report
  const top = (f: (p: PersonMonth) => number, n = 3) => people.filter((p) => f(p) > 0).sort((a, b) => f(b) - f(a)).slice(0, n);
  const highlights: [string, string[]][] = [
    ['Most sets made', top((p) => p.setsSummary?.total || 0).map((p) => `${p.name}: ${p.setsSummary!.total}`)],
    ['Most hours worked', top((p) => p.totalWorked).map((p) => `${p.name}: ${fm(p.totalWorked)}`)],
    ['Below the daily hours target on average', present.filter((p) => p.avgWorked < S.workTargetMin).sort((a, b) => a.avgWorked - b.avgWorked).map((p) => `${p.name}: ${fm(p.avgWorked)} a day`)],
    ['Most points lost', top((p) => p.points?.taken || 0).map((p) => `${p.name}: −${p.points!.taken}`)],
  ];

  return (
    <div className="panel week month">
      <div className="week-h">
        <div className="week-nav">
          <button className="btn sm" onClick={() => go(shiftMonth(data.month, -1))} aria-label="Previous month">‹</button>
          <div>
            <h2>{monthName(data.month)}</h2>
            <div className="hint">{thisMonth ? `This month so far (${day(data.dates[0])} – ${day(data.dates[data.dates.length - 1])})` : 'Monthly report'} · averages are per day they clocked in</div>
          </div>
          <button className="btn sm" disabled={thisMonth} onClick={() => go(shiftMonth(data.month, 1))} aria-label="Next month">›</button>
        </div>
        <div className="grow" />
        <button className={`chip ${thisMonth ? 'on' : ''}`} onClick={() => setMonth(null)}>This month</button>
        <button className={`chip ${data.month === shiftMonth(nowMonth, -1) ? 'on' : ''}`} onClick={() => setMonth(shiftMonth(nowMonth, -1))}>Last month</button>
        <a className="btn" href={`/api/month?month=${data.month}&format=csv`} download>⬇ Download CSV</a>
        <button className="btn" onClick={() => window.print()}>🖨 Print</button>
        <button className="btn" disabled={loading} onClick={() => load(true)}>{loading ? '⟳ Loading…' : '⟳'}</button>
      </div>

      {data.errors.map((e) => <div key={e} className="banner err">⚠️ {e}</div>)}
      {error && <div className="banner err">⚠️ {error}</div>}
      {data.notFound.length > 0 && <div className="banner warn">Not found in Jibble (not in this report): {data.notFound.join(', ')}</div>}

      <div className="wtiles">
        <div><span>Avg worked / day</span><b>{present.length ? fm(team((p) => p.avgWorked)!) : '–'}</b><small>target {fm(S.workTargetMin)}</small></div>
        <div><span>Avg clock-in</span><b>{clock(team((p) => p.avgIn))}</b><small>out {clock(team((p) => p.avgOut))}</small></div>
        <div><span>Avg break / day</span><b>{present.length ? fm(team((p) => p.avgBreak)!) : '–'}</b><small>allowance {fm(S.breakAllowanceMin)}</small></div>
        {data.clickup && <div><span>ClickUp coverage</span><b>{coverage !== null ? `${coverage}%` : '–'}</b><small>of worked time tracked</small></div>}
        <div><span>Sets made</span><b>{setsTotal}</b><small>{setsTarget ? `${setsHit}/${setsTarget} daily targets hit` : 'no targets recorded'}</small></div>
        <div><span>Points lost</span><b>{pointsTaken}</b><small>{byRule.length ? byRule.map(([r, n]) => `${RULES[r]} ${n}`).join(' · ') : 'none this month'}</small></div>
      </div>

      <div className="mhigh">
        {highlights.map(([title, lines]) => (
          <div key={title}>
            <h3>{title}</h3>
            {lines.length ? <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="muted">Nobody</p>}
          </div>
        ))}
      </div>

      <div className="wtable-wrap">
        <table className="wtable">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('name')}>Person{arrow('name')}</th>
              {cols.map(([k, l]) => <th key={k} className="sortable num" onClick={() => toggleSort(k)}>{l}{arrow(k)}</th>)}
              <th>Worked each day</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const isOpen = open === p.name;
              const s = p.setsSummary;
              return (
                <Fragment key={p.name}>
                  <tr className={`wrow ${isOpen ? 'open' : ''} ${p.daysPresent ? '' : 'absent'}`} onClick={() => setOpen(isOpen ? null : p.name)}>
                    <td>
                      <div className="who">
                        <div className="av" style={{ background: deptColor.get(p.department) || DEPT_COLORS[0] }}>{initials(p.name)}</div>
                        <div className="who-t"><div className="nm">{p.name}</div><div className="dept">{p.department}</div></div>
                        <span className="caret">{isOpen ? '▾' : '▸'}</span>
                      </div>
                    </td>
                    <td className="num"><b>{p.daysPresent}</b></td>
                    <td className="num">{clock(p.avgIn)}<small>out {clock(p.avgOut)}</small></td>
                    <td className="num">
                      <b className={p.daysPresent && p.avgWorked < S.workTargetMin ? 'amber' : ''}>{p.daysPresent ? fm(p.avgWorked) : '–'}</b>
                      {p.daysPresent > 0 && <small>{p.daysOnTarget}/{p.daysPresent} on target</small>}
                    </td>
                    <td className="num"><b>{p.daysPresent ? fm(p.totalWorked) : '–'}</b></td>
                    <td className="num">
                      <b className={p.avgBreak > S.breakAllowanceMin ? 'amber' : ''}>{p.daysPresent ? fm(p.avgBreak) : '–'}</b>
                      {p.daysOverBreak > 0 && <small className="amber">{p.daysOverBreak} day{p.daysOverBreak > 1 ? 's' : ''} over</small>}
                    </td>
                    {data.clickup && (
                      <td className="num">
                        {p.avgClickup === null ? <span className="muted">{p.totalClickup === null ? 'Jibble only' : '–'}</span> : <>
                          <b>{fm(p.avgClickup)}</b>
                          {p.totalWorked > 0 && <small>{Math.round((p.totalClickup! / p.totalWorked) * 100)}% of worked</small>}
                          {p.totalClickupOffClock ? <small className="bad" title="Ran on a Jibble break or after clock-out">−{fm(p.totalClickupOffClock)} off the clock</small> : null}
                        </>}
                      </td>
                    )}
                    <td className="num">
                      {s?.days ? <>
                        <b>{s.total}</b>
                        <small>avg {s.avg}/day</small>
                        {s.targetDays > 0 && <small className={s.hitDays < s.targetDays ? 'amber' : ''}>{s.hitDays}/{s.targetDays} target hit</small>}
                      </> : <span className="muted">–</span>}
                    </td>
                    <td className="num">
                      {p.points ? <>
                        <b className={p.points.taken ? 'amber' : ''}>{p.points.score}</b>
                        {p.points.taken > 0 && <small className="bad">−{p.points.taken}</small>}
                      </> : <span className="muted">–</span>}
                    </td>
                    <td>
                      <div className="spark mspark">
                        {p.days.map((d, i) => (
                          <div key={i} title={`${day(data.dates[i], { weekday: 'short', day: 'numeric', month: 'short' })}: ${d ? fm(d.worked) : 'not in'}`}>
                            <i className={d ? (d.worked >= S.workTargetMin ? 'ok' : 'low') : 'off'} style={{ height: `${d ? Math.max(8, (d.worked / maxDay) * 100) : 8}%` }} />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="wdetail">
                      <td colSpan={cols.length + 2}><Detail p={p} data={data} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Click a person for their week-by-week numbers, points, Jibble activities and ClickUp tasks. Times are in {data.timezone}.
      </div>
    </div>
  );
}

function Detail({ p, data }: { p: PersonMonth; data: Month }) {
  const actMax = Math.max(1, ...p.activities.map((a) => a.minutes));
  const taskMax = Math.max(1, ...p.tasks.map((t) => t.minutes));
  const taken = p.points?.deductions || [];
  return (
    <div className="wd">
      <div>
        <table className="dtable">
          <thead><tr><th>Week</th><th className="num">Days</th><th className="num">Worked</th><th className="num">Avg / day</th><th className="num">Avg break</th>{data.clickup && <th className="num">ClickUp</th>}<th className="num">Sets</th></tr></thead>
          <tbody>
            {p.weeks.map((w) => (
              <tr key={w.from} className={w.daysPresent ? '' : 'absent'}>
                <td>{day(w.from)} – {day(w.to)}</td>
                <td className="num">{w.daysPresent}</td>
                <td className="num"><b>{w.daysPresent ? fm(w.totalWorked) : '–'}</b></td>
                <td className="num"><span className={w.daysPresent && w.avgWorked < data.settings.workTargetMin ? 'amber' : ''}>{w.daysPresent ? fm(w.avgWorked) : '–'}</span></td>
                <td className="num"><span className={w.avgBreak > data.settings.breakAllowanceMin ? 'amber' : ''}>{w.daysPresent ? fm(w.avgBreak) : '–'}</span></td>
                {data.clickup && <td className="num">{w.totalClickup === null ? '–' : fm(w.totalClickup)}</td>}
                <td className="num">{w.sets === null ? <span className="muted">–</span> : <>{w.sets}{w.targetDays > 0 && <small> {w.hitDays}/{w.targetDays} hit</small>}</>}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Month</td>
              <td className="num">{p.daysPresent}</td>
              <td className="num"><b>{fm(p.totalWorked)}</b></td>
              <td className="num">{p.daysPresent ? fm(p.avgWorked) : '–'}</td>
              <td className="num">{p.daysPresent ? fm(p.avgBreak) : '–'}</td>
              {data.clickup && <td className="num">{p.totalClickup === null ? '–' : fm(p.totalClickup)}</td>}
              <td className="num"><b>{p.setsSummary?.days ? p.setsSummary.total : '–'}</b></td>
            </tr>
          </tbody>
        </table>
        <h3>Points this month</h3>
        {taken.length ? <ul className="mpoints">{taken.map((d) => (
          <li key={d.id} className={d.restored ? 'restored' : ''}>
            <b>{day(d.date)} · {RULES[d.rule]}</b> {d.detail}{d.note ? ` (note: ${d.note})` : ''}{d.restored ? ` (restored by ${d.restored.by})` : ''}
          </li>
        ))}</ul> : <div className="empty">No points taken.</div>}
      </div>
      <div>
        <h3>Jibble activities this month</h3>
        {p.activities.length ? <div className="tasks">{p.activities.map((a, i) => (
          <div className="trow" key={i}>
            <div className="tname"><b>{a.activity || 'No activity selected'}</b>{a.project && <span>{a.project}</span>}</div>
            <div className="tbar"><i style={{ width: `${(a.minutes / actMax) * 100}%` }} /></div>
            <b className="tmin">{fm(a.minutes)}</b>
          </div>
        ))}</div> : <div className="empty">No work time this month.</div>}
        {p.totalClickup !== null && <>
          <h3>Top ClickUp tasks</h3>
          {p.tasks.length ? <div className="tasks">{p.tasks.map((t, i) => (
            <div className="trow" key={i}>
              <div className="tname">{t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer"><b>{t.name}</b></a> : <b>{t.name}</b>}</div>
              <div className="tbar cu"><i style={{ width: `${(t.minutes / taskMax) * 100}%` }} /></div>
              <b className="tmin">{fm(t.minutes)}</b>
            </div>
          ))}</div> : <div className="empty">No ClickUp time this month.</div>}
        </>}
      </div>
    </div>
  );
}
