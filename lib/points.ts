// Points (KPI): everyone starts each month on POINTS_START and loses 1 point each time the app sees a problem:
// - frozen:  the Jibble screen didn't change for FROZEN_MINUTES (faked or stagnant screen)          (live)
// - noshots: no Jibble screenshots for NO_SCREENSHOT_MINUTES while clocked in (tracker closed)      (live)
// - behind:  at the end of the day, Jibble time minus ClickUp time ≥ CLICKUP_GAP_MINUTES             (next morning)
// - manual:  ClickUp time added by hand afterwards instead of with the timer                         (next morning)
// Every point keeps a note of what was seen. A manager can restore it (genuine) and add their own note.
import { TEAM } from '../team.config';
import { CONFIG } from './config';
import { engine } from './engine';
import { readJson, writeJson } from './store';
import { addDays, todayStr } from './time';
import { getWeek } from './week';
import type { Deduction, PointsPerson, PointsRule, PointsState } from './types';

type PointsFile = { deductions: Deduction[]; checked: Record<string, string> };
// On globalThis: Next loads this module separately for the API routes and the background timer
const g = globalThis as unknown as { __points?: PointsFile; __pointsTimer?: NodeJS.Timeout };
const load = () => (g.__points ??= { deductions: [], checked: {}, ...readJson<Partial<PointsFile>>('points.json', {}) } as PointsFile);
const save = () => writeJson('points.json', load());

export const RULE_LABELS: Record<PointsRule, string> = {
  frozen: 'Screen frozen',
  noshots: 'No screenshots',
  behind: 'Behind on ClickUp',
  manual: 'ClickUp time added by hand',
  other: 'Taken by hand',
};

const on = (r: PointsRule) => CONFIG.pointsRules.includes(r);
const fm = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: CONFIG.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Takes a point, unless this exact problem was already counted. Returns true if a point was taken. */
function take(d: Omit<Deduction, 'id' | 'at'>) {
  const f = load();
  if (f.deductions.some((x) => x.key === d.key)) return false;
  f.deductions.push({ ...d, id: newId(), at: new Date().toISOString() });
  save();
  try { engine().pushEvent(d.name, `−1 point (${RULE_LABELS[d.rule].toLowerCase()}): ${d.detail}`, 'alert'); } catch {}
  return true;
}

/** Live rules, from the board as it is right now */
function checkLive() {
  const today = todayStr();
  for (const p of engine().people) {
    if (p.state !== 'working') continue;
    if (on('frozen') && p.frozen) {
      take({ key: `${p.name}|frozen|${p.frozen.since}`, name: p.name, date: today, rule: 'frozen',
        detail: `Jibble screen didn't change for ${p.frozen.minutes} min (${p.frozen.shots} identical screenshots) from ${clock(p.frozen.since)}` });
    }
    if (on('noshots') && p.noShotsSince && p.noScreenshots) {
      take({ key: `${p.name}|noshots|${p.noShotsSince}`, name: p.name, date: today, rule: 'noshots',
        detail: `No Jibble screenshots for ${p.noScreenshots} min since ${clock(p.noShotsSince)} while clocked in (Jibble app closed or paused?)` });
    }
  }
}

/** End-of-day rules for one finished day, from Jibble + ClickUp history */
export async function checkDay(date: string) {
  if (!on('behind') && !on('manual')) return 0;
  const w = await getWeek(date, true);
  const i = w.dates.indexOf(date);
  let n = 0;
  for (const p of w.people) {
    const d = p.days[i];
    if (!d || d.clickup === null) continue; // not in, or not on ClickUp
    const gap = d.worked - d.clickup;
    if (on('behind') && gap >= CONFIG.clickupGapMin) {
      n += +take({ key: `${p.name}|behind|${date}`, name: p.name, date, rule: 'behind',
        detail: `Worked ${fm(d.worked)} on Jibble but tracked only ${fm(d.clickup)} on ClickUp (${fm(gap)} not tracked)` });
    }
    if (on('manual')) for (const e of d.manual || []) {
      n += +take({ key: `${p.name}|manual|${e.id}`, name: p.name, date, rule: 'manual',
        detail: `${fm(e.minutes)} on “${e.task}” (${clock(e.from)}–${clock(e.to)}) was added by hand at ${new Date(e.addedAt).toLocaleString('en-GB', { timeZone: CONFIG.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}, not recorded with the timer` });
    }
  }
  return n;
}

let busy = false;
let retryAt = 0;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    checkLive();
    // Yesterday's ClickUp checks, once, after 00:30 (team time) so late finishers are counted
    const f = load();
    const yesterday = addDays(todayStr(), -1);
    const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: CONFIG.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (!f.checked[yesterday] && nowHm >= '00:30' && Date.now() >= retryAt) {
      try {
        await checkDay(yesterday);
        f.checked[yesterday] = new Date().toISOString();
        for (const d of Object.keys(f.checked)) if (d < addDays(yesterday, -60)) delete f.checked[d];
        save();
      } catch (e) {
        console.warn(`points: ${(e as Error).message}`);
        retryAt = Date.now() + 10 * 60e3;
      }
    }
  } catch (e) {
    console.warn(`points: ${(e as Error).message}`);
  } finally {
    busy = false;
  }
}

export function startPoints() {
  if (g.__pointsTimer) return;
  g.__pointsTimer = setInterval(() => { tick(); }, 60e3);
}

// ───────────────────────── reading and editing ─────────────────────────
export function summary(month: string): PointsState {
  const f = load();
  const e = engine();
  const people: PointsPerson[] = TEAM.map((m) => {
    const ds = f.deductions.filter((d) => d.name === m.name && d.date.startsWith(month)).sort((a, b) => b.at.localeCompare(a.at));
    const active = ds.filter((d) => !d.restored);
    const byRule: PointsPerson['byRule'] = {};
    for (const d of active) byRule[d.rule] = (byRule[d.rule] || 0) + 1;
    return { name: m.name, department: m.department, score: CONFIG.pointsStart - active.length, taken: active.length, restored: ds.length - active.length, byRule, deductions: ds };
  });
  const checked = Object.keys(f.checked).sort();
  return {
    month,
    start: CONFIG.pointsStart,
    rules: CONFIG.pointsRules,
    settings: { frozenMin: CONFIG.frozenMin, noShotMin: CONFIG.noShotMin, clickupGapMin: CONFIG.clickupGapMin, manualLagMin: CONFIG.manualEntryLagMin },
    lastDailyCheck: checked.at(-1) || null,
    departments: e.departments(),
    people,
  };
}

/** Restore a point (genuine), undo that, change the note, or take a point by hand */
export function edit(b: { action: string; id?: string; name?: string; note?: string; by?: string; date?: string }): string | null {
  const f = load();
  const by = (b.by || '').trim().slice(0, 60) || 'someone';
  if (b.action === 'take') {
    if (!TEAM.some((m) => m.name === b.name)) return 'Unknown person';
    const note = (b.note || '').trim().slice(0, 500);
    if (!note) return 'Add a reason';
    const date = b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : todayStr();
    f.deductions.push({ id: newId(), key: `${b.name}|other|${newId()}`, name: b.name!, date, at: new Date().toISOString(), rule: 'other', detail: note, addedBy: by });
    save();
    return null;
  }
  const d = f.deductions.find((x) => x.id === b.id);
  if (!d) return 'Not found';
  if (b.action === 'restore') d.restored = { by, at: new Date().toISOString() };
  else if (b.action === 'unrestore') delete d.restored;
  else if (b.action === 'note') {
    const note = (b.note || '').trim().slice(0, 500);
    if (note) d.note = note;
    else delete d.note;
  } else if (b.action === 'delete' && d.rule === 'other') f.deductions.splice(f.deductions.indexOf(d), 1);
  else return 'Bad action';
  save();
  return null;
}
