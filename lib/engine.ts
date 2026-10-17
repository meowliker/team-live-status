import fs from 'node:fs';
import path from 'node:path';
import { TEAM, DEPARTMENTS, type Member } from '../team.config';
import { CONFIG, clickupOn, jibbleOn } from './config';
import * as jibble from './jibble';
import * as clickup from './clickup';
import * as mock from './mock';
import { startOfToday, todayStr } from './time';
import type { BoardEvent, BoardState, ClickupMember, DayReport, JibbleEntry, JibblePerson, Overlay, PersonRow, Segment, Shot, TimerInfo } from './types';

const norm = (n: string | null | undefined) => (n || '').toLowerCase().replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim();
const ms = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime();

// ───────────────────────── persisted state ─────────────────────────
type Pool = { modes: Record<string, 'free' | 'busy'>; picks: Record<string, { by: string; at: string }> };
const file = (n: string) => path.join(CONFIG.dataDir, n);
const readJson = <T,>(n: string, d: T): T => {
  try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; }
};
const writeJson = (n: string, v: unknown) => {
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    fs.writeFileSync(file(n), JSON.stringify(v));
  } catch (e) { console.warn(`could not save ${n}: ${(e as Error).message}`); }
};

// ───────────────────────── roster matching ─────────────────────────
function matchRoster(people: JibblePerson[]) {
  const used = new Set<string>();
  const matched: { member: Member; person: JibblePerson }[] = [];
  const missing: string[] = [];
  const keys = (m: Member) => [m.name, ...(m.aliases || [])].map(norm);
  // pass 1: exact name / alias / email
  const pending: Member[] = [];
  for (const m of TEAM) {
    const k = keys(m);
    const p = people.find((x) => !used.has(x.id) && (k.includes(norm(x.name)) || (x.email && k.includes(norm(x.email)))));
    if (p) { used.add(p.id); matched.push({ member: m, person: p }); } else pending.push(m);
  }
  // pass 2: Jibble name starts with the roster name (e.g. "Chirayu" -> "Chirayu Sharma"), only if unique
  for (const m of pending) {
    const k = keys(m);
    const hits = people.filter((x) => !used.has(x.id) && k.some((key) => norm(x.name).startsWith(key + ' ')));
    if (hits.length === 1) { used.add(hits[0].id); matched.push({ member: m, person: hits[0] }); } else missing.push(m.name);
  }
  return { matched, missing };
}

function matchClickup(member: Member, person: JibblePerson, members: ClickupMember[]) {
  const keys = [member.name, ...(member.aliases || []), person.name].map(norm);
  return (
    (person.email && members.find((c) => c.email === person.email)) ||
    members.find((c) => keys.includes(norm(c.username)) || (c.email && keys.includes(norm(c.email)))) ||
    (() => {
      const hits = members.filter((c) => keys.some((k) => norm(c.username).startsWith(k + ' ') || k.startsWith(norm(c.username) + ' ')));
      return hits.length === 1 ? hits[0] : null;
    })() ||
    null
  );
}

// ───────────────────────── screenshot analysis ─────────────────────────
function frozenRuns(list: Shot[], segEnd: string): Overlay[] {
  const same = (a: Shot, b: Shot) => !a.blank && !b.blank && !!a.sig && !!b.sig && jibble.sigDiff(a.sig, b.sig) < 1.5;
  const runs: Overlay[] = [];
  for (let i = 0; i < list.length - 1; i++) {
    if (!same(list[i], list[i + 1])) continue;
    let j = i + 1;
    while (j + 1 < list.length && same(list[j], list[j + 1])) j++;
    const to = list[j + 1]?.time || segEnd;
    if (ms(list[i].time, to) >= CONFIG.frozenMin * 60e3) runs.push({ kind: 'frozen', from: list[i].time, to, shots: j - i + 1, ongoing: !list[j + 1] });
    i = j;
  }
  return runs;
}

class Engine {
  pool: Pool = readJson<Pool>('pool.json', { modes: {}, picks: {} });
  shots = new Map<string, Shot[]>();
  seenShots = new Set<string>();
  lastShotFetch: number | null = null;
  people: PersonRow[] = [];
  prev = new Map<string, PersonRow>();
  poolSince = new Map<string, string>();
  events: BoardEvent[] = [];
  errors: string[] = [];
  notices: string[] = [];
  updatedAt: string | null = null;
  lastTimers = new Map<number, TimerInfo>();
  running: Promise<void> | null = null;
  timer: NodeJS.Timeout | null = null;

  constructor() {
    const cache = readJson<any>('shots.json', null);
    if (cache?.date === todayStr() && cache.version === 3) {
      for (const s of cache.shots as Shot[]) {
        this.seenShots.add(s.id);
        if (!this.shots.has(s.personId)) this.shots.set(s.personId, []);
        this.shots.get(s.personId)!.push(s);
      }
      this.lastShotFetch = cache.lastShotFetch;
    }
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), CONFIG.mock ? 10e3 : CONFIG.pollMs);
  }

  savePool() { writeJson('pool.json', this.pool); }

  pushEvent(name: string, text: string, kind: string) {
    this.events.unshift({ time: new Date().toISOString(), name, text, kind });
    this.events.length = Math.min(this.events.length, 200);
  }

  poll() {
    return (this.running ??= this.doPoll().finally(() => { this.running = null; }));
  }

  async fetchNewShots(personIds: Set<string>): Promise<Shot[]> {
    if (!CONFIG.screenshotChecks) return [];
    if (CONFIG.mock) return mock.getNewShots();
    const sot = startOfToday().getTime();
    const since = this.lastShotFetch && this.lastShotFetch > sot ? new Date(this.lastShotFetch - 20 * 60e3) : new Date(sot);
    const fetchedAt = Date.now();
    const list = (await jibble.getScreenshotsSince(since.toISOString())).filter((s) => !this.seenShots.has(s.id) && personIds.has(s.personId));
    const out: Shot[] = [];
    const queue = [...list];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const s = queue.shift()!;
        if (!s.url) continue;
        try { out.push({ id: s.id, personId: s.personId, time: s.time, ...(await jibble.analyze(s.url)) }); }
        catch (e) { console.warn(`screenshot ${s.id}: ${(e as Error).message}`); }
      }
    }));
    this.lastShotFetch = fetchedAt;
    return out;
  }

  awayInfo(personId: string, workingSince: string) {
    const list = (this.shots.get(personId) || []).filter((s) => new Date(s.time) >= new Date(workingSince));
    const now = Date.now();
    let awaySince: string | null = null;
    for (let i = list.length - 1; i >= 0 && list[i].blank; i--) awaySince = list[i].time;
    const lastShot = list.at(-1)?.time || null;
    const awayMin = awaySince ? Math.round((now - new Date(awaySince).getTime()) / 60e3) : 0;
    const noShotMin = Math.round((now - new Date(lastShot || workingSince).getTime()) / 60e3);
    const frozen = frozenRuns(list, new Date(now).toISOString()).find((r) => r.ongoing) || null;
    return {
      frozen: frozen ? { since: frozen.from, minutes: Math.round((now - new Date(frozen.from).getTime()) / 60e3), shots: frozen.shots || 0 } : null,
      away: awaySince && awayMin >= CONFIG.awayMin ? { since: awaySince, minutes: awayMin } : null,
      blankStreak: awaySince ? list.filter((s) => new Date(s.time) >= new Date(awaySince!)).length : 0,
      noScreenshots: !awaySince && noShotMin >= CONFIG.noShotMin ? noShotMin : null,
    };
  }

  dayReport(entries: JibbleEntry[], personShots: Shot[], now: string): DayReport {
    const segments: Segment[] = [];
    entries.forEach((e, i) => {
      if (e.type === 'Out') return;
      segments.push({ kind: e.type === 'StartBreak' ? 'break' : 'work', from: e.time, to: entries[i + 1]?.time || now });
    });
    const overlays: Overlay[] = [];
    if (CONFIG.screenshotChecks) {
      for (const seg of segments.filter((x) => x.kind === 'work')) {
        const list = personShots.filter((s) => new Date(s.time) >= new Date(seg.from) && new Date(s.time) < new Date(seg.to));
        for (let i = 0; i < list.length; i++) {
          if (!list[i].blank) continue;
          let j = i;
          while (j < list.length && list[j].blank) j++;
          const from = list[i].time;
          const to = list[j]?.time || seg.to;
          if (ms(from, to) >= CONFIG.awayMin * 60e3) overlays.push({ kind: 'away', from, to, shots: j - i });
          i = j;
        }
        overlays.push(...frozenRuns(list, seg.to));
        const points = [seg.from, ...list.map((s) => s.time), seg.to];
        for (let k = 0; k < points.length - 1; k++) {
          const afterBlank = k > 0 && list[k - 1].blank;
          if (!afterBlank && ms(points[k], points[k + 1]) >= CONFIG.noShotMin * 60e3) overlays.push({ kind: 'nodata', from: points[k], to: points[k + 1] });
        }
      }
    }
    const sum = (arr: { from: string; to: string }[]) => Math.round(arr.reduce((t, x) => t + ms(x.from, x.to), 0) / 60e3);
    const worked = sum(segments.filter((x) => x.kind === 'work'));
    const breakLogged = sum(segments.filter((x) => x.kind === 'break'));
    const missed = sum(overlays.filter((x) => x.kind === 'away'));
    return {
      firstIn: entries.find((e) => e.type === 'In')?.time || null,
      lastOut: entries.at(-1)?.type === 'Out' ? entries.at(-1)!.time : null,
      worked, breakLogged, missed,
      untracked: sum(overlays.filter((x) => x.kind === 'nodata')),
      frozen: sum(overlays.filter((x) => x.kind === 'frozen')),
      realWorked: worked - missed,
      totalBreak: breakLogged + missed,
      overBreak: Math.max(0, breakLogged + missed - CONFIG.breakAllowanceMin),
      segments, overlays,
    };
  }

  async doPoll() {
    const errors: string[] = [];
    const notices: string[] = [];
    try {
      if (!jibbleOn()) throw new Error('Jibble keys are missing. Add JIBBLE_CLIENT_ID and JIBBLE_CLIENT_SECRET (or run in demo mode).');
      const all = CONFIG.mock ? await mock.getPeople() : await jibble.getPeople();
      const { matched, missing } = matchRoster(all);
      if (missing.length) notices.push(`Not found in Jibble: ${missing.join(', ')}. Fix the name in team.config.ts (add an alias).`);
      const ids = new Set(matched.map((m) => m.person.id));

      // ClickUp: members + running timers (one call per poll)
      let members: ClickupMember[] = [];
      let timers: Map<number, TimerInfo> | null = null;
      if (clickupOn()) {
        try {
          members = CONFIG.mock ? await mock.getMembers() : await clickup.getMembers();
        } catch (e) { errors.push((e as Error).message); }
      }
      const link = new Map(matched.map(({ member, person }) => [person.id, members.length ? matchClickup(member, person, members) : null]));
      const unlinked = matched.filter(({ person }) => clickupOn() && members.length && !link.get(person.id)).map(({ member }) => member.name);
      if (unlinked.length) notices.push(`Not linked to ClickUp: ${unlinked.join(', ')}. Use the same email in Jibble and ClickUp, or add their ClickUp name as an alias.`);

      const [entries, newShots] = await Promise.all([
        CONFIG.mock ? mock.getRecentEntries() : jibble.getRecentEntries(),
        this.fetchNewShots(ids).catch((e) => { errors.push(`Screenshots: ${(e as Error).message}`); return [] as Shot[]; }),
        (async () => {
          if (!clickupOn() || !members.length) return;
          try {
            const memberIds = [...link.values()].filter(Boolean).map((c) => c!.id);
            timers = CONFIG.mock ? await mock.getTimers() : await clickup.getTimers(memberIds);
            this.lastTimers = timers;
          } catch (e) {
            errors.push(`${(e as Error).message} (showing last known timers)`);
            timers = this.lastTimers;
          }
        })(),
      ]);

      const today = todayStr();
      const sot = startOfToday();
      const latest = new Map<string, JibbleEntry>();
      const todays = new Map<string, JibbleEntry[]>();
      for (const e of entries) {
        latest.set(e.personId, e);
        if (e.belongsToDate === today) {
          if (!todays.has(e.personId)) todays.set(e.personId, []);
          todays.get(e.personId)!.push(e);
        }
      }

      for (const s of newShots) {
        this.seenShots.add(s.id);
        if (!this.shots.has(s.personId)) this.shots.set(s.personId, []);
        this.shots.get(s.personId)!.push(s);
      }
      for (const [id, list] of this.shots) {
        list.sort((a, b) => ms(b.time, a.time));
        this.shots.set(id, list.filter((s) => new Date(s.time) >= sot));
      }
      if (newShots.length && !CONFIG.mock) writeJson('shots.json', { version: 3, date: today, lastShotFetch: this.lastShotFetch, shots: [...this.shots.values()].flat() });

      const nowIso = new Date().toISOString();
      const next = new Map<string, PersonRow>();
      const tmap = timers as Map<number, TimerInfo> | null;

      this.people = matched.map(({ member, person: p }) => {
        const e = latest.get(p.id);
        const state: PersonRow['state'] = !e || e.type === 'Out' ? 'out' : e.type === 'StartBreak' ? 'break' : 'working';
        const since = e?.time || null;
        const cu = link.get(p.id) || null;
        const t = cu && tmap ? tmap.get(cu.id) || { running: null, trackedTodayMin: 0 } : null;
        const timer = t?.running || null;

        if (state === 'out' && (this.pool.modes[p.id] || this.pool.picks[p.id])) {
          delete this.pool.modes[p.id];
          delete this.pool.picks[p.id];
          this.savePool();
        }
        const mode = (this.pool.modes[p.id] || 'auto') as PersonRow['mode'];
        const pick = this.pool.picks[p.id] || null;
        const timerKnown = !!(cu && tmap);
        const inPool = state === 'working' && !pick && (mode === 'free' || (mode === 'auto' && (timerKnown ? !timer : !clickupOn())));
        if (inPool && !this.poolSince.has(p.id)) this.poolSince.set(p.id, this.prev.size ? nowIso : (since || nowIso));
        if (!inPool) this.poolSince.delete(p.id);

        const away = state === 'working' && CONFIG.screenshotChecks ? this.awayInfo(p.id, since!) : { away: null, frozen: null, noScreenshots: null, blankStreak: 0 };
        const row: PersonRow = {
          id: p.id,
          name: member.name,
          department: member.department,
          jibbleName: p.name,
          state, since,
          inToday: !!todays.get(p.id)?.length,
          mode, pick, inPool,
          poolSince: this.poolSince.get(p.id) || null,
          clickupLinked: !!cu,
          timer,
          trackedTodayMin: t ? t.trackedTodayMin : null,
          timerWhileOff: !!timer && state !== 'working',
          ...away,
          day: todays.has(p.id) ? this.dayReport(todays.get(p.id)!, this.shots.get(p.id) || [], nowIso) : null,
        };

        const before = this.prev.get(p.id);
        if (before) {
          if (before.state !== state) {
            const txt = { working: before.state === 'break' ? 'is back from break' : 'clocked in', break: 'went on break', out: 'clocked out' }[state];
            this.pushEvent(member.name, txt, state);
          }
          if (before.timer?.task !== timer?.task) {
            if (timer) this.pushEvent(member.name, `started timer: ${timer.task}`, 'timer');
            else if (before.timer) this.pushEvent(member.name, `stopped timer: ${before.timer.task}`, 'timer');
          }
          if (!before.inPool && inPool) this.pushEvent(member.name, 'joined the pool', 'pool');
          if (!before.frozen && row.frozen) this.pushEvent(member.name, `screen hasn't changed for ${row.frozen.minutes} min`, 'alert');
          if (!before.away && row.away) this.pushEvent(member.name, `looks away: blank screen ${row.away.minutes} min without a break`, 'alert');
        }
        next.set(p.id, row);
        return row;
      });
      this.prev = next;
      this.updatedAt = nowIso;
    } catch (e) {
      errors.push((e as Error).message);
      console.error((e as Error).message);
    }
    this.errors = errors;
    this.notices = notices;
  }

  state(): BoardState {
    const used = new Set(TEAM.map((m) => m.department));
    return {
      updatedAt: this.updatedAt,
      errors: this.errors,
      notices: this.notices,
      mock: CONFIG.mock,
      clickup: clickupOn(),
      screenshots: CONFIG.screenshotChecks,
      timezone: CONFIG.timezone,
      settings: {
        awayMin: CONFIG.awayMin, frozenMin: CONFIG.frozenMin, breakAllowanceMin: CONFIG.breakAllowanceMin,
        workTargetMin: CONFIG.workTargetMin, longBreakMin: CONFIG.longBreakMin, poolIdleAlertMin: CONFIG.poolIdleAlertMin,
      },
      departments: [...DEPARTMENTS.filter((d) => used.has(d)), ...[...used].filter((d) => !DEPARTMENTS.includes(d))],
      people: this.people,
      events: this.events.slice(0, 60),
    };
  }

  find(id: string) { return this.people.find((p) => p.id === id); }

  setMode(id: string, mode: 'auto' | 'free' | 'busy') {
    const p = this.find(id);
    if (!p) return 'Unknown person';
    if (mode === 'auto') delete this.pool.modes[id];
    else this.pool.modes[id] = mode;
    this.savePool();
    this.pushEvent(p.name, mode === 'free' ? 'was marked free' : mode === 'busy' ? 'was marked busy' : 'set back to auto (ClickUp timer)', 'pool');
    return null;
  }

  pickPerson(id: string, by: string) {
    const p = this.find(id);
    if (!p || !by.trim()) return 'Bad request';
    if (this.pool.picks[id]) return `Already picked by ${this.pool.picks[id].by}`;
    this.pool.picks[id] = { by: by.trim().slice(0, 40), at: new Date().toISOString() };
    this.savePool();
    this.pushEvent(p.name, `was picked by ${by.trim()}`, 'pick');
    return null;
  }

  release(id: string) {
    const p = this.find(id);
    if (!p) return 'Unknown person';
    delete this.pool.picks[id];
    this.savePool();
    this.pushEvent(p.name, 'was released back to the pool', 'pool');
    return null;
  }
}

const g = globalThis as unknown as { __teamEngine?: Engine };
export function engine() {
  if (!g.__teamEngine) {
    g.__teamEngine = new Engine();
    g.__teamEngine.start();
  }
  return g.__teamEngine;
}
