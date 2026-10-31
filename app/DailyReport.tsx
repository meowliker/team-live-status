'use client';

import { useEffect, useState } from 'react';
import type { WeekDay, WeekReport as Week } from '@/lib/types';
import { DEPT_COLORS, fm, hm, initials } from './format';

const shift = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const label = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Per-day report for any date: today is the live report, earlier days come from Jibble + ClickUp history */
export default function DailyReport({ dept, deptColor, timezone, today }: { dept: string; deptColor: Map<string, string>; timezone: string; today: React.ReactNode }) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const [date, setDate] = useState(todayStr);
  const isToday = date >= todayStr;
  const csv = `/api/week?${new URLSearchParams({ start: date, format: 'csv', day: date })}`;

  return (
    <>
      <div className="panel daybar">
        <div className="week-nav">
          <button className="btn sm" onClick={() => setDate(shift(date, -1))} aria-label="Previous day">‹</button>
          <div>
            <h2>{isToday ? 'Today' : label(date)}</h2>
            <div className="hint">{isToday ? `${label(todayStr)} · live` : 'From Jibble and ClickUp history'}</div>
          </div>
          <button className="btn sm" disabled={isToday} onClick={() => setDate(shift(date, 1) >= todayStr ? todayStr : shift(date, 1))} aria-label="Next day">›</button>
        </div>
        <div className="grow" />
        <button className={`chip ${isToday ? 'on' : ''}`} onClick={() => setDate(todayStr)}>Today</button>
        <button className={`chip ${date === shift(todayStr, -1) ? 'on' : ''}`} onClick={() => setDate(shift(todayStr, -1))}>Yesterday</button>
        <input className="datepick" type="date" value={date} max={todayStr} onChange={(e) => e.target.value && setDate(e.target.value > todayStr ? todayStr : e.target.value)} aria-label="Pick a date" />
        <a className="btn" href={csv} download>⬇ Download CSV</a>
      </div>
      {isToday ? today : <PastDay date={date} dept={dept} deptColor={deptColor} />}
    </>
  );
}

function PastDay({ date, dept, deptColor }: { date: string; dept: string; deptColor: Map<string, string> }) {
  const [data, setData] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/week?start=${date}`, { cache: 'no-store' })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load that day'); return d; })
      .then((d) => live && setData(d))
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [date]);

  if (!data) return <div className="panel"><div className="empty">{error ? `⚠️ ${error}` : 'Loading that day…'}</div></div>;

  const S = data.settings;
  const i = data.dates.indexOf(date);
  const people = data.people.filter((p) => dept === 'All' || p.department === dept);
  const rows = people.filter((p) => p.days[i]).map((p) => ({ p, d: p.days[i] as WeekDay }))
    .sort((a, b) => (b.d.clickupOnBreak || 0) - (a.d.clickupOnBreak || 0) || b.d.breaks - a.d.breaks);
  const notIn = people.filter((p) => !p.days[i]);
  if (!rows.length) return <div className="panel"><div className="empty">Nobody clocked in on this day.</div></div>;

  const t = (iso: string) => new Date(iso).getTime();
  const start = Math.min(...rows.map(({ d }) => t(d.segments[0]?.from)));
  const end = Math.max(...rows.map(({ d }) => t(d.segments.at(-1)!.to)), start + 3600e3);
  const pct = (iso: string) => ((t(iso) - start) / (end - start)) * 100;
  const ticks: number[] = [];
  for (let x = new Date(start).setMinutes(0, 0, 0) + 3600e3; x < end; x += 3600e3) ticks.push(x);
  const span = (x: { from: string; to: string }, cls: string, title: string, k: string) => (
    <span key={k} className={cls} title={title} style={{ left: `${pct(x.from)}%`, width: `${Math.max(0.3, pct(x.to) - pct(x.from))}%` }} />
  );
  const overBreak = rows.filter(({ d }) => d.breaks > S.breakAllowanceMin).length;
  const cuBreak = rows.filter(({ d }) => d.clickupOnBreak).length;

  return (
    <div className="panel">
      <div className="ph"><h2>Report</h2><span className="count">{rows.length} in</span>{notIn.length ? <span className="hint">Not in: {notIn.map((p) => p.name).join(', ')}</span> : null}</div>
      {data.errors.map((e) => <div key={e} className="banner err">⚠️ {e}</div>)}
      <div className="flags" style={{ marginBottom: 12 }}>
        <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>Over {fm(S.breakAllowanceMin)} break: {overBreak}</span>
        {data.clickup && <span className="flag" style={{ ['--c' as string]: 'var(--alert)' }}>ClickUp timer during break: {cuBreak}</span>}
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--work)', opacity: 0.75 }} />Working</span>
        <span><i style={{ background: 'var(--break)' }} />Break</span>
        {data.clickup && <span><i className="cubreak-key" />ClickUp timer during break (removed)</span>}
        <span>Click a name for their Jibble activities and ClickUp tasks</span>
      </div>
      {rows.map(({ p, d }) => {
        const isOpen = open === p.name;
        return (
          <div className="drow" key={p.name}>
            <div className="dhead">
              <div className="who">
                <div className="av" style={{ background: deptColor.get(p.department) || DEPT_COLORS[0] }}>{initials(p.name)}</div>
                <div className="who-t"><button className="nm link" onClick={() => setOpen(isOpen ? null : p.name)}>{p.name} {isOpen ? '▾' : '▸'}</button><div className="dept">{p.department}</div></div>
              </div>
              <span className="num">In <b>{hm(d.segments[0].from)}</b>{d.lastOut !== null ? <> · Out <b>{hm(d.segments.at(-1)!.to)}</b></> : <> · <b className="muted">no clock-out</b></>}</span>
              <span className={`num ${d.worked < S.workTargetMin ? 'amber' : ''}`}>Worked <b>{fm(d.worked)}</b> / {fm(S.workTargetMin)}</span>
              {d.clickup !== null && <span className={`num ${d.worked - d.clickup > 60 ? 'amber' : ''}`}>ClickUp <b>{fm(d.clickup)}</b>{d.clickupOnBreak ? <small className="bad"> −{fm(d.clickupOnBreak)} on break</small> : null}</span>}
              <span className={`num ${d.breaks > S.breakAllowanceMin ? 'amber' : ''}`}>Break <b>{fm(d.breaks)}</b> / {fm(S.breakAllowanceMin)}</span>
            </div>
            <div className="bar">
              {d.segments.map((x, k) => span(x, x.kind, `${x.kind === 'work' ? x.activity || 'Working' : 'Break'} ${hm(x.from)}–${hm(x.to)}`, `s${k}`))}
              {d.onBreak.map((x, k) => span(x, 'cubreak', `ClickUp timer on “${x.task}” ran ${hm(x.from)}–${hm(x.to)} during a break (removed)`, `c${k}`))}
            </div>
            <div className="axis">{ticks.map((x) => <span key={x} style={{ left: `${((x - start) / (end - start)) * 100}%` }}>{new Date(x).toLocaleTimeString([], { hour: 'numeric' })}</span>)}</div>
            <div className="flags">
              {d.breaks > S.breakAllowanceMin && <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>Over break by {fm(d.breaks - S.breakAllowanceMin)}</span>}
              {d.clickupOnBreak ? <span className="flag" style={{ ['--c' as string]: 'var(--alert)' }}>ClickUp ran {fm(d.clickupOnBreak)} during break (removed)</span> : null}
              {d.clickup !== null && d.worked - d.clickup > 60 && <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>{fm(d.worked - d.clickup)} clocked in without a ClickUp timer</span>}
            </div>
            {isOpen && (
              <div className="wd" style={{ marginTop: 12 }}>
                <div>
                  <h3>Jibble activities</h3>
                  {d.activities.length ? <div className="tasks">{d.activities.map((a, k) => (
                    <div className="trow" key={k}>
                      <div className="tname"><b>{a.activity || 'No activity selected'}</b>{a.project && <span>{a.project}</span>}</div>
                      <div className="tbar"><i style={{ width: `${(a.minutes / Math.max(1, d.activities[0].minutes)) * 100}%` }} /></div>
                      <b className="tmin">{fm(a.minutes)}</b>
                    </div>
                  ))}</div> : <div className="empty">No work time.</div>}
                </div>
                {d.clickup !== null && (
                  <div>
                    <h3>ClickUp tasks</h3>
                    {d.tasks.length ? <div className="tasks">{d.tasks.map((x, k) => (
                      <div className="trow" key={k}>
                        <div className="tname">{x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer"><b>{x.name}</b></a> : <b>{x.name}</b>}</div>
                        <div className="tbar cu"><i style={{ width: `${(x.minutes / Math.max(1, d.tasks[0].minutes)) * 100}%` }} /></div>
                        <b className="tmin">{fm(x.minutes)}</b>
                      </div>
                    ))}</div> : <div className="empty">No ClickUp time.</div>}
                    {d.onBreak.length > 0 && <div className="removed">{d.onBreak.map((x, k) => (
                      <div key={k}>Removed {fm(x.minutes)}: “{x.task}” ran {hm(x.from)}–{hm(x.to)} during a break</div>
                    ))}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
