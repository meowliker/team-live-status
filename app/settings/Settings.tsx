'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SettingsState } from '@/lib/types';

type Row = SettingsState['roster'][number];

export default function Settings() {
  const [data, setData] = useState<SettingsState | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'problems'>('all');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      setData(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (name: string, system: 'jibble' | 'clickup', value: string) => {
    setSaving(`${name}:${system}`);
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, system, value: value === '' ? null : system === 'clickup' && value !== 'none' ? Number(value) : value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) alert(d.error || 'Something went wrong');
    else setData(d);
    setSaving(null);
  };

  if (!data) {
    return <div className="wrap"><div className="empty">{failed ? 'Cannot reach the dashboard server.' : 'Loading settings…'}</div></div>;
  }

  const jibbleOwner = new Map(data.roster.filter((r) => r.jibble.id).map((r) => [r.jibble.id!, r.name]));
  const clickupOwner = new Map(data.roster.filter((r) => r.clickup.id !== null).map((r) => [r.clickup.id!, r.name]));
  const problem = (r: Row) => !r.jibble.id || (data.clickup && !r.clickup.id && !r.clickup.none);
  const rows = filter === 'problems' ? data.roster.filter(problem) : data.roster;
  const problems = data.roster.filter(problem).length;
  const spareJibble = data.jibblePeople.filter((p) => !jibbleOwner.has(p.id));
  const spareClickup = data.clickupMembers.filter((c) => !clickupOwner.has(c.id));

  const status = (r: Row) =>
    !r.jibble.id ? <span className="flag" style={{ ['--c' as string]: 'var(--alert)' }}>No Jibble</span>
      : data.clickup && r.clickup.none ? <span className="flag" style={{ ['--c' as string]: 'var(--out)' }}>Jibble only</span>
      : data.clickup && !r.clickup.id ? <span className="flag" style={{ ['--c' as string]: 'var(--break)' }}>No ClickUp</span>
      : <span className="flag" style={{ ['--c' as string]: 'var(--work)' }}>Linked</span>;

  return (
    <>
      <header className="top">
        <div className="top-in">
          <div className="brand"><h1>Team Live</h1><span className="clock">Settings</span></div>
          <div className="grow" />
          <a className="btn" href="/">← Back to board</a>
        </div>
      </header>

      <div className="wrap">
        {data.mock && <div className="banner info">Demo mode: these are fake people.</div>}
        {data.storage.persistent === false && (
          <div className="banner err">
            ⚠️ Settings are saved to <b>{data.storage.dir}</b>, which Railway wipes on every redeploy. Add a Volume to this service (any mount path, e.g. /data) and they will be kept.
          </div>
        )}
        {data.errors.map((e) => <div key={e} className="banner err">⚠️ {e}</div>)}

        <div className="panel">
          <div className="ph">
            <h2>Team mapping</h2>
            <span className="count">{data.roster.length}</span>
            <span className="hint">“Auto” matches by name and email. Pick someone to link them by hand. Changes save straight away.</span>
          </div>
          <div className="chips">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Everyone {data.roster.length}</button>
            <button className={`chip ${filter === 'problems' ? 'on' : ''}`} onClick={() => setFilter('problems')}>Needs fixing {problems}</button>
          </div>

          <div className="maprow maphead">
            <span>Team member</span><span>Jibble</span>{data.clickup && <span>ClickUp</span>}<span>Status</span>
          </div>
          {rows.length ? rows.map((r) => (
            <div className="maprow" key={r.name}>
              <div className="who-t">
                <div className="nm">{r.name}</div>
                <div className="dept">{r.department}</div>
              </div>
              <label className="field">
                <span className="lbl">Jibble</span>
                <select
                  value={r.jibble.manual ? r.jibble.id || '' : ''}
                  disabled={saving === `${r.name}:jibble`}
                  onChange={(e) => save(r.name, 'jibble', e.target.value)}
                >
                  <option value="">{r.jibble.manual ? 'Auto (match by name)' : `Auto: ${r.jibble.name || 'no match found'}`}</option>
                  {data.jibblePeople.map((p) => {
                    const owner = jibbleOwner.get(p.id);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.email ? ` · ${p.email}` : ''}{owner && owner !== r.name ? ` (now: ${owner})` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              {data.clickup && (
                <label className="field">
                  <span className="lbl">ClickUp</span>
                  <select
                    value={r.clickup.none ? 'none' : r.clickup.manual && r.clickup.id !== null ? String(r.clickup.id) : ''}
                    disabled={saving === `${r.name}:clickup` || !data.clickupMembers.length || r.clickup.locked}
                    title={r.clickup.locked ? 'Set to Jibble only in team.config.ts' : undefined}
                    onChange={(e) => save(r.name, 'clickup', e.target.value)}
                  >
                    <option value="">{r.clickup.manual ? 'Auto (match by email / name)' : `Auto: ${r.clickup.name || 'no match found'}`}</option>
                    <option value="none">Not on ClickUp</option>
                    {data.clickupMembers.map((c) => {
                      const owner = clickupOwner.get(c.id);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.username || c.email}{c.username && c.email ? ` · ${c.email}` : ''}{owner && owner !== r.name ? ` (now: ${owner})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}
              <div className="mapstatus">{status(r)}{r.clickup.locked ? <span className="manual">set in team.config.ts</span> : (r.jibble.manual || r.clickup.manual) && <span className="manual">set by hand</span>}</div>
            </div>
          )) : <div className="empty">Everyone is linked.</div>}
        </div>

        <div className="cols2">
          <div className="panel">
            <div className="ph"><h2>In Jibble, not on the team list</h2><span className="count">{spareJibble.length}</span></div>
            {spareJibble.length ? <div className="spare">{spareJibble.map((p) => <div key={p.id}><b>{p.name}</b>{p.email && <span> · {p.email}</span>}</div>)}</div> : <div className="empty">Nobody</div>}
            <div className="hint">Only people who have joined the Jibble workspace show here. To add someone to the board, add them to team.config.ts.</div>
          </div>
          {data.clickup && (
            <div className="panel">
              <div className="ph"><h2>In ClickUp, not linked</h2><span className="count">{spareClickup.length}</span></div>
              {spareClickup.length ? <div className="spare">{spareClickup.map((c) => <div key={c.id}><b>{c.username || c.email}</b>{c.username && c.email && <span> · {c.email}</span>}</div>)}</div> : <div className="empty">Nobody</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
