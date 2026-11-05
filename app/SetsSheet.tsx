'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonWeek, SetDay, WeekReport as Week } from '@/lib/types';
import { DEPT_COLORS, initials } from './format';

const shift = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const label = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const clock12 = (hhmm: string) => {
  const [h, m = '0'] = hhmm.split(':').map((x) => x.trim());
  const H = Number(h);
  return `${H % 12 || 12}:${m.padStart(2, '0')} ${H < 12 ? 'AM' : 'PM'}`;
};

type Field = 'assigned' | 'made' | 'middle' | 'carry' | 'video' | 'status' | 'hit' | 'reason';

/** The daily sets sheet: assigned in the morning meeting, sets made (typed or counted from ClickUp), evening check */
export default function SetsSheet({ dept, deptColor, timezone }: { dept: string; deptColor: Map<string, string>; timezone: string }) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const [date, setDate] = useState(todayStr);
  const [data, setData] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'info' | 'err' | 'warn'; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const isToday = date >= todayStr;

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/week?${new URLSearchParams({ start: date, ...(fresh ? { fresh: '1' } : {}) })}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load the sets');
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => { setData(null); setPreview(undefined); load(); }, [load]);
  // pick up what others typed, and new ClickUp sets
  useEffect(() => { const t = setInterval(() => load(), 60e3); return () => clearInterval(t); }, [load]);

  const save = async (name: string, field: Field, value: string) => {
    setData((w) => w && ({ ...w, people: w.people.map((p) => p.name !== name ? p : { ...p, sets: p.sets!.map((s) => (s.date === date ? { ...s, [field]: value || undefined } : s)) }) }));
    const r = await fetch('/api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, name, field, value }) });
    if (!r.ok) setMsg({ kind: 'err', text: `Couldn’t save ${name}’s ${field}: ${(await r.json().catch(() => ({}))).error || r.status}` });
    load();
  };

  const importFile = async (f: File) => {
    setMsg({ kind: 'info', text: `Importing ${f.name}…` });
    const r = await fetch('/api/sets/import', { method: 'POST', body: await f.text() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg({ kind: 'err', text: `Import failed: ${d.error || r.status}` });
    setMsg({
      kind: d.unknown?.length ? 'warn' : 'info',
      text: `Imported ${d.imported} rows over ${d.days} days${d.from ? ` (${d.from} to ${d.to})` : ''}.${d.unknown?.length ? ` Not on the sets list, so skipped: ${d.unknown.join(', ')}.` : ''}`,
    });
    load();
  };

  const showPreview = async () => {
    const r = await fetch(`/api/sets?${new URLSearchParams({ date, preview: '1' })}`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    setPreview(d?.text ?? null);
  };

  const i = data ? data.dates.indexOf(date) : -1;
  const people: { p: PersonWeek; s: SetDay }[] = data && i >= 0
    ? data.people.filter((p) => p.sets && (dept === 'All' || p.department === dept)).map((p) => ({ p, s: p.sets![i] }))
    : [];
  const withTarget = people.filter(({ s }) => s.target !== null);
  const hit = withTarget.filter(({ s }) => s.isHit === true).length;
  const missed = people.filter(({ s }) => s.isHit === false);
  const made = people.reduce((t, { s }) => t + (s.madeNum || 0), 0);
  const carry = people.reduce((t, { s }) => t + (s.carryNum || 0), 0);
  const rep = data?.setsReport;
  const sentAt = rep?.sent[date];

  return (
    <>
      <div className="panel daybar">
        <div className="week-nav">
          <button className="btn sm" onClick={() => setDate(shift(date, -1))} aria-label="Previous day">‹</button>
          <div>
            <h2>Sets · {isToday ? 'Today' : label(date)}</h2>
            <div className="hint">{isToday ? label(todayStr) : 'Past day'} · everyone can edit · saved as you type</div>
          </div>
          <button className="btn sm" disabled={isToday} onClick={() => setDate(shift(date, 1) >= todayStr ? todayStr : shift(date, 1))} aria-label="Next day">›</button>
        </div>
        <div className="grow" />
        <button className={`chip ${isToday ? 'on' : ''}`} onClick={() => setDate(todayStr)}>Today</button>
        <button className={`chip ${date === shift(todayStr, -1) ? 'on' : ''}`} onClick={() => setDate(shift(todayStr, -1))}>Yesterday</button>
        <input className="datepick" type="date" value={date} max={todayStr} onChange={(e) => e.target.value && setDate(e.target.value > todayStr ? todayStr : e.target.value)} aria-label="Pick a date" />
        <a className="btn" href={`/api/sets?${new URLSearchParams({ date, format: 'csv' })}`} download>⬇ CSV</a>
        <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import sheet</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
        <button className="btn" disabled={loading} onClick={() => load(true)} title="Count the sets again from ClickUp">{loading ? '⟳ Loading…' : '⟳ Recount'}</button>
      </div>

      {msg && <div className={`banner ${msg.kind}`} onClick={() => setMsg(null)}>{msg.text} <span className="muted">(click to hide)</span></div>}
      {error && <div className="banner err">⚠️ {error}</div>}

      {!data ? <div className="panel"><div className="empty">{error ? '' : 'Loading the sets…'}</div></div> : (
        <div className="panel">
          {data.errors.map((e) => <div key={e} className="banner err">⚠️ {e}</div>)}
          <div className="wtiles">
            <div><span>Sets made</span><b>{made}</b><small>{data.clickup ? 'typed, or counted from ClickUp' : 'typed'}</small></div>
            <div><span>Targets hit</span><b>{withTarget.length ? `${hit}/${withTarget.length}` : '–'}</b><small>{missed.length ? `missed: ${missed.map(({ p }) => p.name.split(' ')[0]).join(', ')}` : 'of people with a number assigned'}</small></div>
            <div><span>Carry forward</span><b>{carry}</b><small>sets to the next working day</small></div>
            <div>
              <span>Slack report</span>
              <b style={{ fontSize: 16 }}>{!rep?.on ? 'Off' : sentAt ? 'Posted' : isToday ? clock12(rep.time) : '–'}</b>
              <small>{!rep?.on ? 'needs Slack set up' : sentAt ? `${new Date(sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} in ${rep.channel}` : isToday ? `to ${rep.channel}, only if someone missed` : 'not posted that day'}</small>
              <button className="btn sm" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={showPreview}>Preview message</button>
            </div>
          </div>
          {preview !== undefined && (
            <div className="setprev">
              <div className="ph"><h3>Slack message for this day</h3><button className="btn sm" onClick={() => setPreview(undefined)}>Close</button></div>
              {preview ? <pre>{preview.replace(/\*/g, '').replace(/_/g, '')}</pre> : <div className="empty">Everyone with a target met it, so nothing would be posted.</div>}
            </div>
          )}

          <div className="wtable-wrap">
            <table className="wtable sets">
              <thead>
                <tr>
                  <th>Person</th><th>Task assigned</th><th>No. of sets</th><th>Middle OTD</th><th>Carry fwd</th><th>Video</th><th>Status</th><th>Target hit</th><th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {people.map(({ p, s }) => <Row key={p.name} p={p} s={s} color={deptColor.get(p.department) || DEPT_COLORS[0]} save={(f, v) => save(p.name, f, v)} />)}
                {!people.length && <tr><td colSpan={9} className="muted">Nobody {dept === 'All' ? '' : `in ${dept} `}is on the sets list (SETS_TEAM in team.config.ts).</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            Numbers are read from the text, so “5 + shoot” counts as 5 and “1 + 1 ai automation” as 2; “pool” or “research” has no target. Target = assigned + middle OTD.
            {data.clickup && ' If “No. of sets” is empty, it’s the ClickUp tasks named with a number that are in review or done, counted on the last day the person tracked time on them.'}
            {' '}Import your Google Sheet with File → Download → CSV, then ⬆ Import sheet.
          </div>
        </div>
      )}
    </>
  );
}

function Cell({ value, placeholder, onSave, wide, narrow }: { value?: string; placeholder?: string; onSave: (v: string) => void; wide?: boolean; narrow?: boolean }) {
  return (
    <input
      key={value || ''}
      className={`setin ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}`}
      defaultValue={value || ''}
      placeholder={placeholder}
      onBlur={(e) => { if (e.target.value.trim() !== (value || '')) onSave(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Pick({ value, options, onSave, auto }: { value?: string; options: [string, string][]; onSave: (v: string) => void; auto?: string }) {
  return (
    <select className="setin" value={value || ''} onChange={(e) => onSave(e.target.value)}>
      <option value="">{auto ?? '–'}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Row({ p, s, color, save }: { p: PersonWeek; s: SetDay; color: string; save: (f: Field, v: string) => void }) {
  const cu = s.clickup;
  const suggestCarry = s.isHit === false && s.target !== null && s.madeNum !== null ? Math.max(0, s.target - s.madeNum) : null;
  const autoLabel = 'Auto';
  return (
    <tr className={s.isHit === false ? 'missed' : ''}>
      <td>
        <div className="who">
          <div className="av" style={{ background: color }}>{initials(p.name)}</div>
          <div className="who-t"><div className="nm">{p.name}</div><div className="dept">{p.department}</div></div>
        </div>
      </td>
      <td>
        <Cell value={s.assigned} placeholder="e.g. 2" onSave={(v) => save('assigned', v)} />
        {s.carriedIn ? <small className="amber">+{s.carriedIn} carried from last day</small> : null}
      </td>
      <td>
        <Cell value={s.made} placeholder={cu ? `${cu.length} (ClickUp)` : 'e.g. 2'} onSave={(v) => save('made', v)} />
        {cu && cu.length > 0 && (
          <small className="setlist" title={cu.map((t) => `${t.name} (${t.status})`).join('\n')}>
            ClickUp: {cu.slice(0, 4).map((t, k) => <span key={k}>{k ? ', ' : ''}{t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer">{t.name}</a> : t.name}</span>)}{cu.length > 4 ? ` +${cu.length - 4}` : ''}
          </small>
        )}
      </td>
      <td><Cell narrow value={s.middle} onSave={(v) => save('middle', v)} /></td>
      <td><Cell narrow value={s.carry} placeholder={suggestCarry ? String(suggestCarry) : ''} onSave={(v) => save('carry', v)} /></td>
      <td><Pick value={s.video} options={[['Ai', 'Ai'], ['Non Ai', 'Non Ai'], ['50-50', '50-50']]} onSave={(v) => save('video', v)} /></td>
      <td><Pick value={s.status} options={[['Done', 'Done'], ['Not done', 'Not done']]} onSave={(v) => save('status', v)} /></td>
      <td>
        <span className={`hitb ${s.isHit === null ? '' : s.isHit ? 'yes' : 'no'}`}>
          {s.target !== null ? `${s.madeNum ?? 0}/${s.target}` : s.madeNum ? String(s.madeNum) : '–'} {s.isHit === null ? '' : s.isHit ? '✓' : '✗'}
        </span>
        <Pick value={s.hit} auto={autoLabel} options={[['yes', 'Yes (override)'], ['no', 'No (override)']]} onSave={(v) => save('hit', v)} />
      </td>
      <td><Cell wide value={s.reason} placeholder={s.isHit === false ? (s.autoReason ? `Auto: ${s.autoReason}` : 'Why was it missed?') : ''} onSave={(v) => save('reason', v)} /></td>
    </tr>
  );
}
