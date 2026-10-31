'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonWeek, WeekReport as Week } from '@/lib/types';
import { DEPT_COLORS, fm, initials } from './format';

// minutes after midnight → "9:41 AM"
const clock = (m: number | null) => {
  if (m === null) return '–';
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(Math.round(m % 60)).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
const shift = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

type SortKey = 'name' | 'daysPresent' | 'avgIn' | 'avgOut' | 'avgWorked' | 'avgBreak' | 'avgClickup';
const COLS: [SortKey, string][] = [['daysPresent', 'Days'], ['avgIn', 'Avg in'], ['avgOut', 'Avg out'], ['avgWorked', 'Avg worked'], ['avgBreak', 'Avg break'], ['avgClickup', 'ClickUp / day']];

/** Week-at-a-glance for the weekly meeting: averages per person, from Jibble and ClickUp history */
export default function WeekReport({ dept, deptColor }: { dept: string; deptColor: Map<string, string> }) {
  const [start, setStart] = useState<string | null>(null); // null = this week
  const [data, setData] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['avgWorked', -1]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ ...(start ? { start } : {}), ...(fresh ? { fresh: '1' } : {}) });
      const r = await fetch(`/api/week?${qs}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the week');
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [start]);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => {
    const list = (data?.people || []).filter((p) => dept === 'All' || p.department === dept);
    const [k, dir] = sort;
    return [...list].sort((a, b) => {
      if (k === 'name') return a.name.localeCompare(b.name) * dir;
      const x = a[k] ?? -1, y = b[k] ?? -1; // people with no value sort last
      return x === y ? a.name.localeCompare(b.name) : (x - y) * dir;
    });
  }, [data, dept, sort]);

  if (!data) return <div className="panel"><div className="empty">{error ? `⚠️ ${error}` : 'Loading the week…'}</div></div>;

  const S = data.settings;
  const thisWeek = start === null;
  const present = people.filter((p) => p.daysPresent);
  const team = (f: (p: PersonWeek) => number | null) => {
    const xs = present.map(f).filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const tracked = present.filter((p) => p.totalClickup !== null);
  const coverage = tracked.length ? Math.round((tracked.reduce((t, p) => t + p.totalClickup!, 0) / Math.max(1, tracked.reduce((t, p) => t + p.totalWorked, 0))) * 100) : null;
  const maxDay = Math.max(S.workTargetMin, ...people.flatMap((p) => p.days.map((d) => d?.worked || 0)));
  const csv = `/api/week?${new URLSearchParams({ start: data.weekStart, format: 'csv' })}`;
  const toggleSort = (k: SortKey) => setSort(([ck, dir]) => [k, ck === k ? (dir === 1 ? -1 : 1) : k === 'name' || k === 'avgIn' ? 1 : -1]);
  const arrow = (k: SortKey) => (sort[0] === k ? (sort[1] === 1 ? ' ↑' : ' ↓') : '');

  return (
    <div className="panel week">
      <div className="week-h">
        <div className="week-nav">
          <button className="btn sm" onClick={() => setStart(shift(data.weekStart, -7))} aria-label="Previous week">‹</button>
          <div>
            <h2>{day(data.dates[0], { day: 'numeric', month: 'short' })} – {day(data.dates[6], { day: 'numeric', month: 'short', year: 'numeric' })}</h2>
            <div className="hint">{thisWeek ? 'This week so far' : 'Week report'} · averages are per day they clocked in</div>
          </div>
          <button className="btn sm" disabled={thisWeek} onClick={() => { const next = shift(data.weekStart, 7); setStart(next >= mondayISO() ? null : next); }} aria-label="Next week">›</button>
        </div>
        <div className="grow" />
        <button className={`chip ${thisWeek ? 'on' : ''}`} onClick={() => setStart(null)}>This week</button>
        <button className={`chip ${!thisWeek && data.weekStart === shift(mondayISO(), -7) ? 'on' : ''}`} onClick={() => setStart(shift(mondayISO(), -7))}>Last week</button>
        <a className="btn" href={csv} download>⬇ Download CSV</a>
        <button className="btn" onClick={() => window.print()}>🖨 Print</button>
        <button className="btn" disabled={loading} onClick={() => load(true)}>{loading ? '⟳ Loading…' : '⟳'}</button>
      </div>

      {data.errors.map((e) => <div key={e} className="banner err">⚠️ {e}</div>)}
      {error && <div className="banner err">⚠️ {error}</div>}
      {data.notFound.length > 0 && <div className="banner warn">Not found in Jibble (not in this report): {data.notFound.join(', ')}</div>}

      <div className="wtiles">
        <div><span>Avg worked / day</span><b>{team((p) => p.avgWorked) !== null ? fm(team((p) => p.avgWorked)!) : '–'}</b><small>target {fm(S.workTargetMin)}</small></div>
        <div><span>Avg clock-in</span><b>{clock(team((p) => p.avgIn))}</b><small>out {clock(team((p) => p.avgOut))}</small></div>
        <div><span>Avg break / day</span><b>{team((p) => p.avgBreak) !== null ? fm(team((p) => p.avgBreak)!) : '–'}</b><small>allowance {fm(S.breakAllowanceMin)}</small></div>
        {data.clickup && <div><span>ClickUp coverage</span><b>{coverage !== null ? `${coverage}%` : '–'}</b><small>of worked time tracked</small></div>}
        <div><span>People in</span><b>{present.length}</b><small>of {people.length}</small></div>
      </div>

      <div className="wtable-wrap">
        <table className="wtable">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('name')}>Person{arrow('name')}</th>
              {COLS.filter(([k]) => k !== 'avgClickup' || data.clickup).map(([k, l]) => (
                <th key={k} className="sortable num" onClick={() => toggleSort(k)}>{l}{arrow(k)}</th>
              ))}
              <th>Worked each day</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const isOpen = open === p.name;
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
                    <td className="num">{clock(p.avgIn)}</td>
                    <td className="num">{clock(p.avgOut)}</td>
                    <td className="num">
                      <b className={p.daysPresent && p.avgWorked < S.workTargetMin ? 'amber' : ''}>{p.daysPresent ? fm(p.avgWorked) : '–'}</b>
                      {p.daysPresent > 0 && <small>{p.daysOnTarget}/{p.daysPresent} on target</small>}
                    </td>
                    <td className="num">
                      <b className={p.avgBreak > S.breakAllowanceMin ? 'amber' : ''}>{p.daysPresent ? fm(p.avgBreak) : '–'}</b>
                      {p.daysOverBreak > 0 && <small className="amber">{p.daysOverBreak} day{p.daysOverBreak > 1 ? 's' : ''} over</small>}
                    </td>
                    {data.clickup && (
                      <td className="num">
                        {p.avgClickup === null ? <span className="muted">Jibble only</span> : <>
                          <b>{fm(p.avgClickup)}</b>
                          {p.totalWorked > 0 && <small>{Math.round((p.totalClickup! / p.totalWorked) * 100)}% of worked</small>}
                          {p.totalClickupOffClock ? <small className="bad" title="Ran on a Jibble break or after clock-out">−{fm(p.totalClickupOffClock)} off the clock</small> : null}
                        </>}
                      </td>
                    )}
                    <td>
                      <div className="spark">
                        {p.days.map((d, i) => (
                          <div key={i} title={`${day(data.dates[i], { weekday: 'long', day: 'numeric', month: 'short' })}: ${d ? fm(d.worked) : 'not in'}`}>
                            <i className={d ? (d.worked >= S.workTargetMin ? 'ok' : 'low') : 'off'} style={{ height: `${d ? Math.max(8, (d.worked / maxDay) * 100) : 8}%` }} />
                            <span>{day(data.dates[i], { weekday: 'narrow' })}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="wdetail">
                      <td colSpan={data.clickup ? 8 : 7}>
                        <Detail p={p} data={data} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Click a person for their day-by-day numbers, Jibble activities and ClickUp tasks. Times are in {data.timezone}.
      </div>
    </div>
  );
}

const mondayISO = () => {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - dow)).toISOString().slice(0, 10);
};

function Detail({ p, data }: { p: PersonWeek; data: Week }) {
  const actMax = Math.max(1, ...p.activities.map((a) => a.minutes));
  const taskMax = Math.max(1, ...p.tasks.map((t) => t.minutes));
  return (
    <div className="wd">
      <table className="dtable">
        <thead><tr><th>Day</th><th className="num">In</th><th className="num">Out</th><th className="num">Worked</th><th className="num">Break</th>{data.clickup && <th className="num">ClickUp</th>}</tr></thead>
        <tbody>
          {p.days.map((d, i) => (
            <tr key={i} className={d ? '' : 'absent'}>
              <td>{day(data.dates[i], { weekday: 'short', day: 'numeric', month: 'short' })}</td>
              {d ? <>
                <td className="num">{clock(d.firstIn)}</td>
                <td className="num">{d.lastOut !== null ? clock(d.lastOut) : '–'}</td>
                <td className="num"><b className={d.worked < data.settings.workTargetMin ? 'amber' : ''}>{fm(d.worked)}</b></td>
                <td className="num"><span className={d.breaks > data.settings.breakAllowanceMin ? 'amber' : ''}>{fm(d.breaks)}</span></td>
                {data.clickup && <td className="num">{d.clickup === null ? '–' : fm(d.clickup)}{d.clickupOffClock ? <small className="bad"> −{fm(d.clickupOffClock)}</small> : null}</td>}
              </> : <td colSpan={data.clickup ? 5 : 4} className="muted">Not in</td>}
            </tr>
          ))}
          <tr className="total">
            <td>Total</td><td /><td />
            <td className="num"><b>{fm(p.totalWorked)}</b></td>
            <td className="num">{fm(p.totalBreak)}</td>
            {data.clickup && <td className="num">{p.totalClickup === null ? '–' : fm(p.totalClickup)}{p.totalClickupOffClock ? <small className="bad"> −{fm(p.totalClickupOffClock)}</small> : null}</td>}
          </tr>
        </tbody>
      </table>
      <div>
        <h3>Jibble activities this week</h3>
        {p.activities.length ? <div className="tasks">{p.activities.map((a, i) => (
          <div className="trow" key={i}>
            <div className="tname"><b>{a.activity || 'No activity selected'}</b>{a.project && <span>{a.project}</span>}</div>
            <div className="tbar"><i style={{ width: `${(a.minutes / actMax) * 100}%` }} /></div>
            <b className="tmin">{fm(a.minutes)}</b>
          </div>
        ))}</div> : <div className="empty">No work time this week.</div>}
        {p.totalClickup !== null && <>
          <h3>Top ClickUp tasks</h3>
          {p.tasks.length ? <div className="tasks">{p.tasks.map((t, i) => (
            <div className="trow" key={i}>
              <div className="tname">{t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer"><b>{t.name}</b></a> : <b>{t.name}</b>}</div>
              <div className="tbar cu"><i style={{ width: `${(t.minutes / taskMax) * 100}%` }} /></div>
              <b className="tmin">{fm(t.minutes)}</b>
            </div>
          ))}</div> : <div className="empty">No ClickUp time this week.</div>}
        </>}
      </div>
    </div>
  );
}
