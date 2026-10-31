'use client';

import { useEffect } from 'react';
import type { BoardState, PersonRow } from '@/lib/types';
import { dur, fm, hm, initials } from './format';

const STATE = { working: ['Working', 'work'], break: ['On break', 'break'], out: ['Offline', 'out'] } as const;

/** Everything about one person today: opened by clicking their name */
export default function PersonPanel({ p, data, color, onClose }: { p: PersonRow; data: BoardState; color: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const S = data.settings;
  const d = p.day;
  const [label, c] = p.inPool ? ['In pool', 'pool'] : STATE[p.state];
  const actTotal = d ? Math.max(1, ...d.activities.map((a) => a.minutes)) : 1;
  const taskTotal = p.clickupTasks?.length ? Math.max(1, ...p.clickupTasks.map((t) => t.minutes)) : 1;

  // Timeline from first clock-in to now (or last clock-out)
  const start = d?.segments[0] ? new Date(d.segments[0].from).getTime() : 0;
  const end = d?.segments.length ? Math.max(new Date(d.segments.at(-1)!.to).getTime(), start + 3600e3) : 0;
  const pct = (iso: string) => ((new Date(iso).getTime() - start) / (end - start)) * 100;

  return (
    <div className="sheet-bg" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={`${p.name} today`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <div className="av lg" style={{ background: color, ['--c' as string]: `var(--${c})` }}>{initials(p.name)}<i /></div>
          <div className="who-t">
            <div className="nm big">{p.name}</div>
            <div className="dept">{p.department}{p.jibbleName !== p.name ? ` · ${p.jibbleName} in Jibble` : ''}</div>
          </div>
          <span className="pill" style={{ ['--c' as string]: `var(--${c})` }}>{label}{p.since && p.state !== 'out' ? ` · ${dur(p.since)}` : ''}</span>
          <button className="x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!d ? (
          <div className="empty">{p.name} hasn’t clocked in today.</div>
        ) : (
          <>
            <div className="stats">
              <div><span>Clock-in</span><b>{d.firstIn ? hm(d.firstIn) : '–'}</b>{d.lastOut && <small>out {hm(d.lastOut)}</small>}</div>
              <div><span>Worked</span><b>{fm(d.realWorked)}</b><small>of {fm(S.workTargetMin)}</small></div>
              <div className={d.overBreak ? 'amber' : ''}><span>Breaks</span><b>{fm(d.totalBreak)}</b><small>of {fm(S.breakAllowanceMin)}</small></div>
              {p.trackedTodayMin !== null && <div><span>ClickUp</span><b>{fm(p.trackedTodayMin)}</b><small className={p.clickupOnBreak ? 'bad' : ''}>{p.clickupOnBreak ? `−${fm(p.clickupOnBreak.minutes)} on break` : 'tracked'}</small></div>}
            </div>

            <div className="bar">
              {d.segments.map((x, i) => (
                <span key={i} className={x.kind} title={`${x.kind === 'work' ? x.activity || 'Working' : 'Break'} ${hm(x.from)}–${hm(x.to)}`}
                  style={{ left: `${pct(x.from)}%`, width: `${Math.max(0.4, pct(x.to) - pct(x.from))}%` }} />
              ))}
            </div>
            <div className="axis2"><span>{hm(d.segments[0].from)}</span><span>{hm(new Date(end).toISOString())}</span></div>

            <h3>Tasks in Jibble <small>activity picked at clock-in</small></h3>
            {d.activities.length ? (
              <div className="tasks">
                {d.activities.map((a, i) => (
                  <div className="trow" key={i}>
                    <div className="tname">
                      <b>{a.activity || 'No activity selected'}</b>
                      {a.project && <span>{a.project}</span>}
                      {a.current && p.state === 'working' && <em>now</em>}
                    </div>
                    <div className="tbar"><i style={{ width: `${(a.minutes / actTotal) * 100}%` }} /></div>
                    <b className="tmin">{fm(a.minutes)}</b>
                  </div>
                ))}
              </div>
            ) : <div className="empty">No work time yet.</div>}

            {p.clickupTasks && (
              <>
                <h3>ClickUp tasks <small>from their timers today</small></h3>
                {p.clickupTasks.length ? (
                  <div className="tasks">
                    {p.clickupTasks.map((t, i) => (
                      <div className="trow" key={i}>
                        <div className="tname">
                          {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer"><b>{t.name}</b></a> : <b>{t.name}</b>}
                          {t.running && <em>running</em>}
                        </div>
                        <div className="tbar cu"><i style={{ width: `${(t.minutes / taskTotal) * 100}%` }} /></div>
                        <b className="tmin">{fm(t.minutes)}</b>
                      </div>
                    ))}
                  </div>
                ) : <div className="empty">No ClickUp time tracked today.</div>}
                {p.clickupOnBreak && <div className="removed">{p.clickupOnBreak.spans.map((x, i) => (
                  <div key={i}>Removed {fm(x.minutes)}: “{x.task}” ran {hm(x.from)}–{hm(x.to)} during a break</div>
                ))}</div>}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
