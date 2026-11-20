'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Deduction, PointsPerson, PointsRule, PointsState } from '@/lib/types';
import { DEPT_COLORS, initials } from './format';

const RULES: Record<PointsRule, { label: string; c: string }> = {
  frozen: { label: 'Screen frozen', c: 'var(--picked)' },
  noshots: { label: 'No screenshots', c: 'var(--break)' },
  behind: { label: 'Behind on ClickUp', c: 'var(--alert)' },
  manual: { label: 'Time added by hand', c: 'var(--pool)' },
  other: { label: 'Taken by hand', c: 'var(--muted)' },
};
const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 15));
  return d.toISOString().slice(0, 7);
};
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** KPI points: everyone starts the month on the same score and loses 1 point per problem the app sees */
export default function PointsBoard({ dept, deptColor, timezone, me }: { dept: string; deptColor: Map<string, string>; timezone: string; me: string }) {
  const thisMonth = new Date().toLocaleDateString('en-CA', { timeZone: timezone }).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<PointsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/points?month=${month}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load points');
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);
  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 30e3); return () => clearInterval(t); }, [load]);

  const act = async (body: Record<string, string | undefined>) => {
    const r = await fetch('/api/points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, by: me || undefined }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || 'Could not save');
    load();
  };

  if (!data) return <div className="panel"><div className="empty">{error ? `⚠️ ${error}` : 'Loading points…'}</div></div>;

  const people = data.people.filter((p) => dept === 'All' || p.department === dept)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  const taken = people.reduce((t, p) => t + p.taken, 0);
  const restored = people.reduce((t, p) => t + p.restored, 0);
  const avg = people.length ? people.reduce((t, p) => t + p.score, 0) / people.length : data.start;
  const ruleTotals = (Object.keys(RULES) as PointsRule[]).map((r) => [r, people.reduce((t, p) => t + (p.byRule[r] || 0), 0)] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const S = data.settings;
  const cls = (score: number) => (score >= data.start - 2 ? 'good' : score >= data.start - 7 ? 'mid' : 'low');

  return (
    <div className="panel week">
      <div className="week-h">
        <div className="week-nav">
          <button className="btn sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <div>
            <h2>Points · {monthLabel(month)}</h2>
            <div className="hint">Everyone starts the month on {data.start}. −1 for each problem below. Restore a point when it was genuine.</div>
          </div>
          <button className="btn sm" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        </div>
        <div className="grow" />
        <button className={`chip ${month === thisMonth ? 'on' : ''}`} onClick={() => setMonth(thisMonth)}>This month</button>
        <button className={`chip ${month === shiftMonth(thisMonth, -1) ? 'on' : ''}`} onClick={() => setMonth(shiftMonth(thisMonth, -1))}>Last month</button>
      </div>
      {error && <div className="banner err" onClick={() => setError(null)}>⚠️ {error}</div>}

      <div className="wtiles">
        <div><span>Team average</span><b>{avg.toFixed(1)}</b><small>out of {data.start}</small></div>
        <div><span>Points taken</span><b>{taken}</b><small>{restored ? `${restored} restored as genuine` : 'this month'}</small></div>
        <div><span>Most common</span><b style={{ fontSize: 16 }}>{ruleTotals[0] ? RULES[ruleTotals[0][0]].label : '–'}</b><small>{ruleTotals.map(([r, n]) => `${RULES[r].label} ${n}`).join(' · ') || 'nothing yet'}</small></div>
        <div><span>Full score</span><b>{people.filter((p) => p.taken === 0).length}</b><small>of {people.length} people</small></div>
      </div>

      <div className="rules">
        {data.rules.includes('frozen') && <span><i style={{ background: RULES.frozen.c }} />{RULES.frozen.label}: same Jibble screenshot for {S.frozenMin}+ min</span>}
        {data.rules.includes('noshots') && <span><i style={{ background: RULES.noshots.c }} />{RULES.noshots.label}: no Jibble screenshots for {S.noShotMin}+ min while clocked in</span>}
        {data.rules.includes('behind') && <span><i style={{ background: RULES.behind.c }} />{RULES.behind.label}: {S.clickupGapMin}+ min more on Jibble than on ClickUp that day</span>}
        {data.rules.includes('manual') && <span><i style={{ background: RULES.manual.c }} />{RULES.manual.label}: ClickUp time typed in afterwards instead of using the timer</span>}
        <span className="muted">Shoots and meetings on ClickUp don't count. ClickUp checks run the next morning{data.lastDailyCheck ? ` (last: ${dayLabel(data.lastDailyCheck)})` : ''}.</span>
      </div>

      <div className="plist">
        {people.map((p) => (
          <PersonPoints key={p.name} p={p} start={data.start} cls={cls(p.score)} color={deptColor.get(p.department) || DEPT_COLORS[0]} open={open === p.name}
            toggle={() => setOpen(open === p.name ? null : p.name)} act={act} month={month} thisMonth={thisMonth} />
        ))}
      </div>
    </div>
  );
}

function PersonPoints({ p, start, cls, color, open, toggle, act, month, thisMonth }: {
  p: PointsPerson; start: number; cls: string; color: string; open: boolean; toggle: () => void;
  act: (b: Record<string, string | undefined>) => void; month: string; thisMonth: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className={`prow ${open ? 'open' : ''}`}>
      <button className="phead" onClick={toggle}>
        <div className="who">
          <div className="av" style={{ background: color }}>{initials(p.name)}</div>
          <div className="who-t"><div className="nm">{p.name}</div><div className="dept">{p.department}</div></div>
        </div>
        <div className="pchips">
          {(Object.keys(p.byRule) as PointsRule[]).map((r) => (
            <span key={r} className="flag" style={{ ['--c' as string]: RULES[r].c }}>{RULES[r].label} −{p.byRule[r]}</span>
          ))}
          {p.restored > 0 && <span className="flag" style={{ ['--c' as string]: 'var(--work)' }}>{p.restored} restored</span>}
        </div>
        <div className={`pscore ${cls}`}>
          <b>{p.score}</b>
          <small>{p.taken ? `−${p.taken}` : 'full'}</small>
        </div>
        <span className="caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="pbody">
          {p.deductions.length ? p.deductions.map((d) => <DeductionRow key={d.id} d={d} act={act} />) : <div className="empty">No points taken in this month.</div>}
          {month === thisMonth && (
            <form className="ptake" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { act({ action: 'take', name: p.name, note: reason }); setReason(''); } }}>
              <input className="setin wide" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Take 1 point from ${p.name.split(' ')[0]} by hand: reason…`} />
              <button className="btn sm" disabled={!reason.trim()}>−1 point</button>
            </form>
          )}
          <div className="hint">Score this month: {start} − {p.taken} = {p.score}</div>
        </div>
      )}
    </div>
  );
}

function DeductionRow({ d, act }: { d: Deduction; act: (b: Record<string, string | undefined>) => void }) {
  const when = new Date(d.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <div className={`ded ${d.restored ? 'restored' : ''}`}>
      <div className="ded-main">
        <span className="flag" style={{ ['--c' as string]: RULES[d.rule].c }}>{RULES[d.rule].label}</span>
        <span className="ded-pts">{d.restored ? '0' : '−1'}</span>
        <div className="ded-t">
          <div>{d.detail}</div>
          <small className="muted">{dayLabel(d.date)} · noted {when}{d.addedBy ? ` · by ${d.addedBy}` : ''}{d.restored ? ` · restored by ${d.restored.by}` : ''}</small>
        </div>
      </div>
      <div className="ded-acts">
        <input key={d.note || ''} className="setin wide" defaultValue={d.note || ''} placeholder="Note (e.g. why it was genuine)"
          onBlur={(e) => { if (e.target.value.trim() !== (d.note || '')) act({ action: 'note', id: d.id, note: e.target.value }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {d.restored
          ? <button className="btn sm" onClick={() => act({ action: 'unrestore', id: d.id })}>Undo restore</button>
          : <button className="btn sm good" onClick={() => act({ action: 'restore', id: d.id })}>✓ Genuine, restore point</button>}
        {d.rule === 'other' && <button className="btn sm" onClick={() => act({ action: 'delete', id: d.id })}>Delete</button>}
      </div>
    </div>
  );
}
