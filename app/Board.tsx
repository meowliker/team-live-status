'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardEvent, BoardState, PersonRow } from '@/lib/types';
import { DEPT_COLORS, ago, dur, fm, hm, initials, mins } from './format';
import PersonPanel from './PersonPanel';


type Filter = 'all' | 'working' | 'pool' | 'break' | 'attention' | 'out';

export default function Board() {
  const [data, setData] = useState<BoardState | null>(null);
  const [failed, setFailed] = useState(false);
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<'live' | 'day'>('live');
  const [dept, setDept] = useState('All');
  const [filter, setFilter] = useState<Filter>('all');
  const [me, setMe] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<NotificationPermission | 'unsupported'>('default');
  const lastEvent = useRef<string | null>(null);

  useEffect(() => {
    try {
      setMe(localStorage.getItem('me') || '');
      setDept(localStorage.getItem('dept') || 'All');
      setTab((localStorage.getItem('tab') as 'live' | 'day') || 'live');
    } catch {}
    setAlerts(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);
  const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

  const notify = useCallback((events: BoardEvent[]) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const fresh = lastEvent.current ? events.filter((e) => e.time > lastEvent.current!) : [];
    for (const e of fresh.slice(0, 5).reverse()) {
      if (['break', 'pool', 'alert', 'out'].includes(e.kind)) new Notification(e.name, { body: e.text });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const d: BoardState = await r.json();
      notify(d.events);
      lastEvent.current = d.events[0]?.time || lastEvent.current || new Date(0).toISOString();
      setData(d);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [notify]);

  useEffect(() => {
    load();
    const a = setInterval(load, 15000);
    const b = setInterval(() => setTick((t) => t + 1), 20000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load]);

  const act = async (body: Record<string, string>) => {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error || 'Something went wrong');
    await load();
  };
  const pick = (id: string) => {
    let who = me.trim();
    if (!who) {
      who = prompt('Your name (who is assigning this person)?')?.trim() || '';
      if (!who) return;
      setMe(who);
      remember('me', who);
    }
    act({ action: 'pick', personId: id, by: who });
  };
  const closePanel = useCallback(() => setOpenId(null), []);
  const refresh = async () => { setBusy(true); await act({ action: 'refresh' }); setBusy(false); };

  const deptColor = useMemo(() => {
    const m = new Map<string, string>();
    data?.departments.forEach((d, i) => m.set(d, DEPT_COLORS[i % DEPT_COLORS.length]));
    return m;
  }, [data?.departments]);

  if (!data) {
    return <div className="wrap"><div className="empty">{failed ? 'Cannot reach the dashboard server.' : 'Loading the team…'}</div></div>;
  }

  const S = data.settings;
  const openPerson = openId ? data.people.find((p) => p.id === openId) || null : null;
  const P = dept === 'All' ? data.people : data.people.filter((p) => p.department === dept);
  const needsAttention = (p: PersonRow) => (p.state === 'working' && !!(p.away || p.frozen || p.noScreenshots)) || p.timerWhileOff;
  const attention = P.filter(needsAttention);
  const pool = P.filter((p) => p.inPool);
  const picked = P.filter((p) => p.pick && p.state !== 'out');
  const onBreak = P.filter((p) => p.state === 'break').sort((a, b) => mins(b.since) - mins(a.since));
  const working = P.filter((p) => p.state === 'working' && !p.inPool && !p.pick);
  const out = P.filter((p) => p.state === 'out').sort((a, b) => Number(b.inToday) - Number(a.inToday));
  const stale = failed || (data.updatedAt ? mins(data.updatedAt) > 5 : true);

  const show = (f: Filter) => filter === 'all' || filter === f;
  const toggle = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));

  // ───────────────────────── card ─────────────────────────
  const Card = ({ p, color, badge, children, actions }: { p: PersonRow; color: string; badge: string; children?: React.ReactNode; actions?: React.ReactNode }) => (
    <div className="card" style={{ ['--c' as string]: `var(--${color})` }}>
      <div className="who">
        <button className="av" style={{ background: deptColor.get(p.department) }} onClick={() => setOpenId(p.id)} aria-label={`Open ${p.name}`}>{initials(p.name)}<i /></button>
        <div className="who-t">
          <button className="nm link" title="See their day" onClick={() => setOpenId(p.id)}>{p.name}</button>
          <div className="dept">{p.department}</div>
        </div>
        <span className="badge">{badge}</span>
      </div>
      {children}
      {actions || p.state === 'working' ? (
        <div className="acts">
          {actions}
          {p.state === 'working' && (
            <select value={p.mode} onChange={(e) => act({ action: 'mode', personId: p.id, mode: e.target.value })} title="Availability">
              <option value="auto">{data.clickup ? 'Auto (ClickUp timer)' : 'Auto'}</option>
              <option value="free">Free</option>
              <option value="busy">Busy</option>
            </select>
          )}
        </div>
      ) : null}
    </div>
  );

  const TaskLine = ({ p }: { p: PersonRow }) =>
    p.timer ? (
      <div className="task" title={`${p.timer.task}${p.timer.status ? ` · ${p.timer.status}` : ''}`}>
        <span>⏱</span>
        {p.timer.url ? <a href={p.timer.url} target="_blank" rel="noopener noreferrer">{p.timer.task}</a> : <a>{p.timer.task}</a>}
        <span className="el">{dur(p.timer.startedAt)}</span>
      </div>
    ) : data.clickup && p.state === 'working' && !p.jibbleOnly ? (
      <div className="task none">{p.clickupLinked ? (p.mode === 'busy' ? 'Marked busy · no timer running' : 'No ClickUp timer running') : 'Not linked to ClickUp'}</div>
    ) : null;

  const Meta = ({ p }: { p: PersonRow }) => (
    <div className="meta">
      {p.day?.firstIn && <span>In <b>{hm(p.day.firstIn)}</b></span>}
      {p.day?.lastOut && <span>Out <b>{hm(p.day.lastOut)}</b></span>}
      {p.trackedTodayMin !== null && p.inToday && <span>ClickUp today <b>{fm(p.trackedTodayMin)}</b></span>}
    </div>
  );

  const Warn = ({ p }: { p: PersonRow }) => (
    <>
      {p.timerWhileOff && <div className="warn amber">⚠️ ClickUp timer still running while {p.state === 'break' ? 'on break' : 'clocked out'}</div>}
      {p.state === 'working' && p.away && <div className="warn">⚠️ Blank screen {dur(p.away.since)} ({p.blankStreak} screenshots), no break logged</div>}
      {p.state === 'working' && !p.away && p.frozen && <div className="warn violet">⚠️ Screen frozen {dur(p.frozen.since)} ({p.frozen.shots} identical screenshots)</div>}
      {p.state === 'working' && !p.away && !p.frozen && p.noScreenshots && <div className="warn">⚠️ No screenshots for {fm(p.noScreenshots)} (tracker off?)</div>}
    </>
  );

  const tiles: [Filter, string, number, string][] = [
    ['working', 'Working', working.length, 'work'],
    ['pool', 'In pool', pool.length, 'pool'],
    ['break', 'On break', onBreak.length, 'break'],
    ['attention', 'Needs attention', attention.length, 'alert'],
    ['out', 'Offline', out.length, 'out'],
  ];

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand">
            <h1>Team Live</h1>
            <span className={`live ${stale ? 'stale' : ''}`}><span className="dot" />{stale ? 'Not updating' : 'Live'}</span>
          </div>
          <span className="clock">{new Date().toLocaleString([], { timeZone: data.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <div className="tabs">
            <button className={tab === 'live' ? 'on' : ''} onClick={() => { setTab('live'); remember('tab', 'live'); }}>Live board</button>
            <button className={tab === 'day' ? 'on' : ''} onClick={() => { setTab('day'); remember('tab', 'day'); }}>Today’s report</button>
          </div>
          <div className="grow" />
          <label className="me">I am <input value={me} placeholder="your name" onChange={(e) => { setMe(e.target.value); remember('me', e.target.value.trim()); }} /></label>
          {alerts !== 'unsupported' && (
            <button className="btn" onClick={async () => setAlerts(await Notification.requestPermission())}>{alerts === 'granted' ? '🔔 Alerts on' : alerts === 'denied' ? '🔕 Blocked' : '🔔 Alerts'}</button>
          )}
          <a className="btn" href="/settings">⚙ Settings</a>
          <button className="btn" disabled={busy} onClick={refresh}>{busy ? '⟳ Refreshing…' : '⟳ Refresh'}</button>
          <span className="clock">{data.updatedAt ? `Updated ${ago(data.updatedAt)}` : 'Loading…'}</span>
        </div>
      </header>

      <div className="wrap">
        {data.mock && <div className="banner info">Demo mode: this is fake data. Add your Jibble and ClickUp keys to switch to your real team.</div>}
        {data.errors.map((e) => <div key={e} className="banner err">⚠️ {e}</div>)}
        {data.notices.map((e) => <div key={e} className="banner warn">{e}</div>)}

        <div className="tiles">
          {tiles.map(([f, l, n, c]) => (
            <button key={f} className={`tile ${filter === f ? 'on' : ''}`} style={{ ['--c' as string]: `var(--${c})` }} onClick={() => { toggle(f); setTab('live'); }}>
              <div className="n">{n}</div>
              <div className="l">{l}</div>
            </button>
          ))}
        </div>

        <div className="chips">
          {['All', ...data.departments].map((d) => {
            const list = d === 'All' ? data.people : data.people.filter((p) => p.department === d);
            const free = list.filter((p) => p.inPool).length;
            return (
              <button key={d} className={`chip ${dept === d ? 'on' : ''}`} onClick={() => { setDept(d); remember('dept', d); }}>
                {d === 'All' ? 'Everyone' : d} {list.length}{free ? <small>· {free} free</small> : null}
              </button>
            );
          })}
        </div>

        <div className="layout">
          <div>
            {tab === 'day' ? (
              <DayReport people={P} data={data} deptColor={deptColor} onOpen={setOpenId} />
            ) : (
              <>
                {show('pool') && (
                  <div className="panel hl">
                    <div className="ph"><h2>🟦 Pool — free to assign</h2><span className="count">{pool.length}</span><span className="hint">Clocked in on Jibble · no ClickUp timer running</span></div>
                    <div className="lanes">
                      {(dept === 'All' ? data.departments : [dept]).map((d) => {
                        const list = pool.filter((p) => p.department === d).sort((a, b) => mins(b.poolSince) - mins(a.poolSince));
                        return (
                          <div className="lane" key={d}>
                            <div className="lane-h">{d}<span className={list.length ? '' : 'zero'}>{list.length ? `${list.length} free` : '0 free'}</span></div>
                            {list.length ? list.map((p) => (
                              <Card key={p.id} p={p} color="pool" badge={`free ${dur(p.poolSince)}`} actions={<button className="btn primary sm" onClick={() => pick(p.id)}>Assign</button>}>
                                {mins(p.poolSince) >= S.poolIdleAlertMin && <div className="warn amber">Idle in pool {dur(p.poolSince)}</div>}
                                <Warn p={p} />
                                <Meta p={p} />
                              </Card>
                            )) : <div className="lane-empty">Nobody free</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(show('break') || show('attention')) && (
                  <div className={filter === 'all' ? 'cols3' : ''}>
                    {show('attention') && (
                      <div className={`panel ${attention.length ? 'alert' : ''}`}>
                        <div className="ph"><h2>⚠️ Needs attention</h2><span className="count">{attention.length}</span></div>
                        {attention.length ? <div className="stack">{attention.map((p) => (
                          <Card key={p.id} p={p} color="alert" badge={p.state === 'working' ? `in ${dur(p.since)}` : p.state}><Warn p={p} /><TaskLine p={p} /></Card>
                        ))}</div> : <div className="empty">All good</div>}
                      </div>
                    )}
                    {show('break') && (
                      <div className="panel">
                        <div className="ph"><h2>☕ On break</h2><span className="count">{onBreak.length}</span></div>
                        {onBreak.length ? <div className="stack">{onBreak.map((p) => (
                          <Card key={p.id} p={p} color={mins(p.since) >= S.longBreakMin ? 'alert' : 'break'} badge={`break ${dur(p.since)}`}>
                            {mins(p.since) >= S.longBreakMin && <div className="warn">Long break (over {fm(S.longBreakMin)})</div>}
                            {p.day && <div className="meta"><span>Break today <b>{fm(p.day.totalBreak)}</b> / {fm(S.breakAllowanceMin)}</span></div>}
                          </Card>
                        ))}</div> : <div className="empty">Nobody on break</div>}
                      </div>
                    )}
                    {filter === 'all' && (
                      <div className="panel">
                        <div className="ph"><h2>🟪 Assigned from pool</h2><span className="count">{picked.length}</span></div>
                        {picked.length ? <div className="stack">{picked.map((p) => (
                          <Card key={p.id} p={p} color="picked" badge={`${dur(p.pick!.at)} ago`} actions={<button className="btn sm" onClick={() => act({ action: 'release', personId: p.id })}>Release</button>}>
                            <div className="meta"><span>Assigned by <b>{p.pick!.by}</b></span></div>
                            <TaskLine p={p} />
                          </Card>
                        ))}</div> : <div className="empty">Nobody assigned yet</div>}
                      </div>
                    )}
                  </div>
                )}

                {show('working') && (
                  <div className="panel">
                    <div className="ph"><h2>🟩 Working now</h2><span className="count">{working.length}</span><span className="hint">Task = their running ClickUp timer</span></div>
                    {working.length ? <div className="grid">{working.map((p) => (
                      <Card key={p.id} p={p} color="work" badge={`in ${dur(p.day?.firstIn || p.since)}`}>
                        <TaskLine p={p} />
                        <Warn p={p} />
                        <Meta p={p} />
                      </Card>
                    ))}</div> : <div className="empty">Nobody working right now</div>}
                  </div>
                )}

                {show('out') && (
                  <div className="panel">
                    <details open={filter === 'out'}>
                      <summary><div className="ph"><h2>⚫ Offline</h2><span className="count">{out.length}</span><span className="hint">Click to {filter === 'out' ? 'hide' : 'show'}</span></div></summary>
                      {out.length ? <div className="grid">{out.map((p) => (
                        <Card key={p.id} p={p} color="out" badge={p.inToday ? `out ${dur(p.since)}` : 'not in today'}>
                          <Warn p={p} />
                          <Meta p={p} />
                        </Card>
                      ))}</div> : <div className="empty">Everyone is in</div>}
                    </details>
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="panel feed">
            <div className="ph"><h2>Live feed</h2></div>
            {data.events.length ? data.events.map((e, i) => (
              <div className="ev" key={i} style={{ ['--c' as string]: `var(--${{ working: 'work', break: 'break', out: 'out', pool: 'pool', pick: 'picked', alert: 'alert', timer: 'work' }[e.kind] || 'muted'})` }}>
                <span className="pip" />
                <div><b>{e.name}</b> {e.text}<div className="t">{ago(e.time)}</div></div>
              </div>
            )) : <div className="empty">Changes show up here as they happen.</div>}
          </aside>
        </div>
      </div>
      {openPerson && <PersonPanel p={openPerson} data={data} color={deptColor.get(openPerson.department) || DEPT_COLORS[0]} onClose={closePanel} />}
    </>
  );
}


function DayReport({ people, data, deptColor, onOpen }: { people: PersonRow[]; data: BoardState; deptColor: Map<string, string>; onOpen: (id: string) => void }) {
  const S = data.settings;
  const rows = people.filter((p) => p.day).sort((a, b) => b.day!.missed + b.day!.frozen - (a.day!.missed + a.day!.frozen) || b.day!.overBreak - a.day!.overBreak);
  if (!rows.length) return <div className="panel"><div className="empty">Nobody has clocked in today yet.</div></div>;
  const now = Date.now();
  const start = Math.min(...rows.map((p) => new Date(p.day!.firstIn || p.day!.segments[0]?.from || now).getTime()));
  const end = Math.max(now, start + 3600e3);
  const pct = (iso: string) => ((new Date(iso).getTime() - start) / (end - start)) * 100;
  const ticks: number[] = [];
  for (let t = new Date(start).setMinutes(0, 0, 0) + 3600e3; t < end; t += 3600e3) ticks.push(t);
  const notIn = people.filter((p) => !p.day);
  const forgot = rows.filter((p) => p.day!.missed > 0);
  const over = rows.filter((p) => p.day!.overBreak > 0);

  return (
    <div className="panel">
      <div className="ph"><h2>Today’s report</h2><span className="count">{rows.length} in today</span>{notIn.length ? <span className="hint">Not in today: {notIn.map((p) => p.name).join(', ')}</span> : null}</div>
      <div className="flags" style={{ marginBottom: 12 }}>
        {data.screenshots && <span className="flag" style={{ ['--c' as string]: 'var(--alert)' }}>Forgot to log a break: {forgot.length}</span>}
        <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>Over {fm(S.breakAllowanceMin)} break: {over.length}</span>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--work)', opacity: 0.75 }} />Working</span>
        <span><i style={{ background: 'var(--break)' }} />Break (logged)</span>
        {data.screenshots && <>
          <span><i style={{ background: 'var(--alert)' }} />Blank screen, no break logged</span>
          <span><i style={{ background: 'var(--picked)' }} />Frozen screen</span>
          <span><i style={{ background: 'repeating-linear-gradient(45deg,var(--out) 0 3px,transparent 3px 6px)' }} />No screenshots</span>
        </>}
      </div>
      {rows.map((p) => {
        const d = p.day!;
        const span = (x: { from: string; to: string }, cls: string, title: string, k: string) => (
          <span key={k} className={cls} title={title} style={{ left: `${pct(x.from)}%`, width: `${Math.max(0.3, pct(x.to) - pct(x.from))}%` }} />
        );
        return (
          <div className="drow" key={p.id}>
            <div className="dhead">
              <div className="who">
                <div className="av" style={{ background: deptColor.get(p.department), ['--c' as string]: `var(--${p.state === 'working' ? 'work' : p.state === 'break' ? 'break' : 'out'})` }}>{initials(p.name)}<i /></div>
                <div className="who-t"><button className="nm link" title="See their day" onClick={() => onOpen(p.id)}>{p.name}</button><div className="dept">{p.department}</div></div>
              </div>
              <span className="num">In <b>{d.firstIn ? hm(d.firstIn) : '–'}</b>{d.lastOut ? <> · Out <b>{hm(d.lastOut)}</b></> : null}</span>
              <span className="num">Worked <b>{fm(d.realWorked)}</b> / {fm(S.workTargetMin)}</span>
              {p.trackedTodayMin !== null && <span className={`num ${d.realWorked - p.trackedTodayMin > 60 ? 'amber' : ''}`}>ClickUp tracked <b>{fm(p.trackedTodayMin)}</b></span>}
              <span className={`num ${d.overBreak ? 'amber' : ''}`}>Break <b>{fm(d.totalBreak)}</b> / {fm(S.breakAllowanceMin)}</span>
              {data.screenshots && <span className={`num ${d.missed ? 'bad' : ''}`}>Missed break <b>{fm(d.missed)}</b></span>}
            </div>
            <div className="bar">
              {d.segments.map((x, i) => span(x, x.kind, `${x.kind === 'work' ? 'Working' : 'Break'} ${hm(x.from)}–${hm(x.to)}`, `s${i}`))}
              {d.overlays.map((x, i) => span(x, x.kind, x.kind === 'away' ? `Blank screen ${hm(x.from)}–${hm(x.to)}, no break logged` : x.kind === 'frozen' ? `Frozen screen ${hm(x.from)}–${hm(x.to)}` : `No screenshots ${hm(x.from)}–${hm(x.to)}`, `o${i}`))}
            </div>
            <div className="axis">{ticks.map((t) => <span key={t} style={{ left: `${((t - start) / (end - start)) * 100}%` }}>{new Date(t).toLocaleTimeString([], { hour: 'numeric' })}</span>)}</div>
            <div className="flags">
              {d.missed > 0 && <span className="flag" style={{ ['--c' as string]: 'var(--alert)' }}>Forgot to log break ~{fm(d.missed)}</span>}
              {d.frozen > 0 && <span className="flag" style={{ ['--c' as string]: 'var(--picked)' }}>Screen frozen {fm(d.frozen)}: check</span>}
              {d.overBreak > 0 && <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>Over break by {fm(d.overBreak)}</span>}
              {p.trackedTodayMin !== null && d.realWorked - p.trackedTodayMin > 60 && <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>{fm(d.realWorked - p.trackedTodayMin)} clocked in without a ClickUp timer</span>}
              {p.state === 'break' && <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>On break now</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
