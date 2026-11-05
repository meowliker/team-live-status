// The sets sheet: what each person was assigned and made per day (typed on the Sets tab, or counted from
// ClickUp), weekly totals, importing the old Google Sheet, and the 7 PM Slack post about missed targets.
import { SETS_TEAM, TEAM } from '../team.config';
import { CONFIG } from './config';
import { engine, isQuietTask } from './engine';
import * as slack from './slack';
import { readJson, writeJson } from './store';
import { addDays, todayStr } from './time';
import { getWeek } from './week';
import type { PersonWeek, SetDay, SetRow, SetsSummary, SetTask, WeekDay, WeekReport } from './types';

/** On the Sets tab: the names in SETS_TEAM (team.config.ts), or everyone if it's empty */
export const onSets = (name: string) => !SETS_TEAM.length || SETS_TEAM.includes(name);

// ───────────────────────── storage (sets.json) ─────────────────────────
type SetsFile = { days: Record<string, Record<string, SetRow>>; reported: Record<string, string> };
// Kept on globalThis: Next loads this module separately for the API routes and the 7 PM timer, and both must share it
const g = globalThis as unknown as { __sets?: SetsFile; __setsReport?: NodeJS.Timeout };
const load = () => (g.__sets ??= { days: {}, reported: {}, ...readJson<Partial<SetsFile>>('sets.json', {}) } as SetsFile);
const save = () => writeJson('sets.json', load());

export const FIELDS = ['assigned', 'made', 'middle', 'carry', 'video', 'status', 'hit', 'reason'] as const;
export type Field = (typeof FIELDS)[number];

/** Saves one cell of the sheet. An empty value clears it. */
export function setField(date: string, name: string, field: Field, value: string): SetRow {
  const days = load().days;
  const row = ((days[date] ||= {})[name] ||= {});
  const v = value.trim().slice(0, 500);
  if (v) row[field] = v;
  else delete row[field];
  if (!Object.keys(row).length) delete days[date][name];
  if (!Object.keys(days[date]).length) delete days[date];
  save();
  return row;
}

/** The number in a cell: "5 + shoot" → 5, "1 + 1 ai automation" → 2, "reworks + 1 (4 sets in 1)" → 1, "pool" → null */
export function num(text?: string): number | null {
  if (!text) return null;
  const xs = text.replace(/\([^)]*\)/g, ' ').match(/\d+(\.\d+)?/g);
  return xs ? xs.reduce((t, x) => t + Number(x), 0) : null;
}

const notDone = (s?: string) => !!s && /not\s*done/i.test(s);

/** One person's day with the numbers worked out */
export function dayOf(date: string, name: string, clickup: SetTask[] | null): SetDay {
  const days = load().days;
  const row = days[date]?.[name] || {};
  const typed = num(row.made);
  const madeNum = typed ?? (clickup ? clickup.length : null);
  const a = num(row.assigned), m = num(row.middle);
  const target = a === null && m === null ? null : (a || 0) + (m || 0);
  const autoHit = notDone(row.status) ? false : target === null || madeNum === null ? null : madeNum >= target;
  const isHit = row.hit === 'yes' ? true : row.hit === 'no' ? false : autoHit;
  // carry forward from the last day before this one that has this person in the sheet (Friday → Monday)
  let carriedIn: number | null = null;
  for (let i = 1; i <= 7; i++) {
    const prev = days[addDays(date, -i)]?.[name];
    if (prev) { carriedIn = num(prev.carry); break; }
  }
  return { ...row, date, clickup, madeNum, target, carryNum: num(row.carry), autoHit, isHit, carriedIn };
}

function summary(days: SetDay[], upTo: string): SetsSummary {
  const done = days.filter((d) => d.date <= upTo && d.madeNum !== null && (d.madeNum > 0 || d.target !== null || num(d.made) !== null));
  const total = done.reduce((t, d) => t + d.madeNum!, 0);
  const video: Record<string, number> = {};
  for (const d of days) if (d.video && d.date <= upTo) video[d.video] = (video[d.video] || 0) + 1;
  return {
    total,
    days: done.length,
    avg: done.length ? Math.round((total / done.length) * 10) / 10 : null,
    targetDays: days.filter((d) => d.date <= upTo && d.target !== null).length,
    hitDays: days.filter((d) => d.date <= upTo && d.target !== null && d.isHit === true).length,
    carry: days.reduce((t, d) => t + (d.date <= upTo ? d.carryNum || 0 : 0), 0),
    video,
  };
}

/** Adds the sets sheet to a weekly report (done per request, so edits show straight away even on a cached week) */
export function withSets(w: WeekReport): WeekReport {
  const today = todayStr();
  return {
    ...w,
    setsReport: { time: CONFIG.setsReportTime, channel: CONFIG.setsReportChannel, on: slack.slackOn() && !!CONFIG.setsReportTime && !!CONFIG.setsReportChannel, sent: Object.fromEntries(w.dates.filter((d) => load().reported[d]).map((d) => [d, load().reported[d]])) },
    people: w.people.map((p) => {
      if (!onSets(p.name)) return p;
      const sets = w.dates.map((d, i) => {
        const s = dayOf(d, p.name, p.cuSets ? p.cuSets[d] || [] : null);
        return s.isHit === false ? { ...s, autoReason: sentence(autoReason(p.days[i], s)) || undefined } : s;
      });
      return { ...p, sets, setsSummary: summary(sets, today) };
    }),
  };
}

// ───────────────────────── 7 PM Slack post ─────────────────────────
const fm = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
const sentence = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : t;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A reason worked out from the day's Jibble and ClickUp data, for when nobody typed one */
function autoReason(d: WeekDay | null, s: SetDay): string {
  if (!d) return 'was not clocked in on Jibble';
  const out: string[] = [];
  const mid = num(s.middle);
  if (mid) out.push(`${plural(mid, 'additional set')} assigned during the day`);
  const sum = (f: (name: string) => boolean) => d.tasks.filter((t) => f(t.name)).reduce((t, x) => t + x.minutes, 0);
  const quiet = d.tasks.filter((t) => isQuietTask(t.name));
  const quietMin = quiet.reduce((t, x) => t + x.minutes, 0);
  if (quietMin >= 20) out.push(`${fm(quietMin)} spent on ${quiet.map((t) => `“${t.name}”`).slice(0, 2).join(' and ')}`);
  const poolMin = sum((n) => /^\W*pool\b/i.test(n));
  if (poolMin >= 30) out.push(`${fm(poolMin)} in the pool waiting for work`);
  const researchMin = sum((n) => /research/i.test(n));
  if (researchMin >= 60) out.push(`${fm(researchMin)} on research`);
  if (d.worked < CONFIG.workTargetMin) out.push(`worked ${fm(d.worked)} of the ${fm(CONFIG.workTargetMin)} target`);
  if (d.breaks > CONFIG.breakAllowanceMin) out.push(`${fm(d.breaks)} of breaks (allowance ${fm(CONFIG.breakAllowanceMin)})`);
  return out.join('; ');
}

/** The message for one day, or null when everyone with a target met it */
export async function reportText(date: string, fresh = true): Promise<{ text: string; missed: string[] } | null> {
  const w = withSets(await getWeek(date, fresh));
  const i = w.dates.indexOf(date);
  const missed = w.people.filter((p) => p.sets).map((p) => ({ p, s: p.sets![i], d: p.days[i] })).filter(({ s }) => s.isHit === false);
  if (!missed.length) return null;
  const when = new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const lines = missed.map(({ p, s, d }) => {
    const made = s.madeNum ?? 0;
    const carry = s.carryNum ?? (s.target !== null ? Math.max(0, s.target - made) : null);
    const what = s.target !== null
      ? `completed ${made} of ${plural(s.target, 'set')}${carry ? `; ${plural(carry, 'set')} carried forward to the next working day` : ''}`
      : `marked as not done${s.assigned ? ` (assigned: ${s.assigned})` : ''}`;
    const typed = s.reason?.trim();
    const auto = typed ? '' : autoReason(d, s);
    const why = typed ? `Reason: ${sentence(typed)}` : auto ? `Reason (from ${date === todayStr() ? "today's" : "the day's"} Jibble and ClickUp data): ${sentence(auto)}` : 'Reason: Not provided.';
    return `• *${p.name}* (${p.department}): ${what}.\n      ${why}`;
  });
  const text = [
    `📋 *Daily Target Report: ${when}*`,
    `The following team member${missed.length === 1 ? ' did' : 's did'} not meet ${date === todayStr() ? "today's" : 'the'} set target:`,
    '',
    ...lines,
    '',
    'Kindly take note and plan the next working day accordingly.',
  ].join('\n');
  return { text, missed: missed.map(({ p }) => p.name) };
}

let busy = false;
let retryAt = 0;

/** Once a day after SETS_REPORT_TIME: post who missed their target. Nothing is posted when everyone hit it. */
async function check() {
  if (busy || Date.now() < retryAt || !CONFIG.setsReportTime || !CONFIG.setsReportChannel || !slack.slackOn()) return;
  const today = todayStr();
  const [h, m = '0'] = CONFIG.setsReportTime.split(':');
  const due = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  const nowHm = new Date().toLocaleTimeString('en-GB', { timeZone: CONFIG.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (nowHm < due || load().reported[today]) return;
  busy = true;
  try {
    const r = await reportText(today);
    if (r) {
      await slack.post(CONFIG.setsReportChannel, r.text);
      engine().pushEvent('Sets', `daily target report posted in ${CONFIG.setsReportChannel} (${r.missed.join(', ')})`, 'alert');
    }
    load().reported[today] = new Date().toISOString();
    // keep a month of "already posted" dates
    for (const d of Object.keys(load().reported)) if (d < addDays(today, -31)) delete load().reported[d];
    save();
  } catch (e) {
    console.warn(`sets report: ${(e as Error).message}`);
    retryAt = Date.now() + 10 * 60e3;
  } finally {
    busy = false;
  }
}

export function startSetsReport() {
  if (g.__setsReport) return;
  g.__setsReport = setInterval(() => { check(); }, 60e3);
}

// ───────────────────────── CSV ─────────────────────────
const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const hitText = (s: SetDay) => (s.isHit === null ? '' : s.isHit ? 'Yes' : 'No');

/** The sheet for one day, laid out like the old Google Sheet */
export function setsDayCsv(w: WeekReport, date: string) {
  const i = w.dates.indexOf(date);
  const head = ['Date', 'Name', 'Department', 'Task assigned', 'No. of sets', 'Sets from ClickUp', 'Middle OTD set', 'No. of carry forward sets', 'Video', 'Status', 'Target', 'Target hit', 'Reason'];
  const rows = w.people.filter((p) => p.sets).map((p) => {
    const s = p.sets![i];
    return [date, p.name, p.department, s.assigned, s.made ?? (s.clickup ? s.clickup.length : ''), s.clickup?.map((t) => t.name).join('; '), s.middle, s.carry, s.video, s.status, s.target, hitText(s), s.reason];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "3 Nov", "Nov 3", "3 November 2026", "2026-11-03", "03/11/2026" (day first) → YYYY-MM-DD */
export function parseDate(s: string, today = todayStr()): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  let y: number | null = null, mo: number | null = null, d: number | null = null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/))) [d, mo, y] = [+m[1], +m[2], m[3] ? +m[3] : null];
  else {
    const month = MONTHS.findIndex((x) => t.includes(x));
    const n = t.match(/\d+/g)?.map(Number) || [];
    if (month >= 0 && n.length) [mo, d, y] = [month + 1, n.find((x) => x >= 1 && x <= 31) ?? null, n.find((x) => x > 31) ?? null];
  }
  if (!mo || !d || mo > 12 || d > 31) return null;
  if (y !== null && y < 100) y += 2000;
  const ty = +today.slice(0, 4);
  const iso = (yy: number) => `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (y !== null) return iso(y);
  // no year: this year, or last year if that date is still to come
  return iso(ty) > addDays(today, 1) ? iso(ty - 1) : iso(ty);
}

/** Name on the sets list for a name in the sheet: full name, alias, or a unique first name ("pankaj" → "Pankaj …") */
function rosterName(n: string): string | null {
  const t = n.trim().toLowerCase();
  if (!t) return null;
  const TEAM_ = TEAM.filter((m) => onSets(m.name));
  const exact = TEAM_.find((m) => m.name.toLowerCase() === t || (m.aliases || []).some((a) => a.toLowerCase() === t));
  if (exact) return exact.name;
  const first = TEAM_.filter((m) => m.name.toLowerCase().split(' ')[0] === t.split(' ')[0]);
  if (first.length === 1) return first[0].name;
  const starts = TEAM_.filter((m) => m.name.toLowerCase().startsWith(t) || t.startsWith(m.name.toLowerCase()));
  return starts.length === 1 ? starts[0].name : null;
}

/** Imports the old Google Sheet (File → Download → CSV). Filled cells overwrite what's there; empty cells are left alone. */
export function importCsv(text: string) {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'name'));
  if (h < 0) throw new Error('Couldn’t find the header row (a column called “Name”).');
  const head = rows[h].map((c) => c.trim().toLowerCase());
  const col = (f: (c: string) => boolean) => head.findIndex(f);
  const nameCol = col((c) => c === 'name');
  let dateCol = col((c) => /date|day/.test(c));
  if (dateCol < 0 && nameCol > 0) dateCol = nameCol - 1; // the merged date column has no header
  const cols: Partial<Record<Field, number>> = {
    assigned: col((c) => c.includes('assign') || c === 'task'),
    made: col((c) => /sets?\b/.test(c) && !/carry|middle|otd/.test(c)),
    middle: col((c) => /middle|otd/.test(c)),
    carry: col((c) => c.includes('carry')),
    video: col((c) => c.includes('video')),
    status: col((c) => c === 'status'),
    hit: col((c) => /target|hit/.test(c)),
    reason: col((c) => /reason|note|remark|comment/.test(c)),
  };
  // notes often sit in an untitled column after the last one (e.g. "to learn editing")
  if (cols.reason! < 0) {
    const last = Math.max(nameCol, ...Object.values(cols).filter((i): i is number => i !== undefined));
    const extra = head.findIndex((c, i) => i > last && !c && rows.slice(h + 1).some((r) => r[i]?.trim()));
    cols.reason = extra;
  }
  const days = load().days;
  let date: string | null = null;
  let imported = 0;
  const unknown = new Set<string>();
  const dates = new Set<string>();
  for (const r of rows.slice(h + 1)) {
    if (dateCol >= 0 && r[dateCol]?.trim()) date = parseDate(r[dateCol]) || date; // merged cells: only the first row has the date
    const raw = r[nameCol]?.trim();
    if (!raw || !date) continue;
    const name = rosterName(raw);
    if (!name) { unknown.add(raw); continue; }
    const row = ((days[date] ||= {})[name] ||= {});
    for (const [f, i] of Object.entries(cols) as [Field, number][]) {
      if (i < 0) continue;
      let v = r[i]?.trim();
      if (!v) continue;
      if (f === 'hit') {
        if (/^(yes|y|true|✓|✔|hit|done)$/i.test(v)) v = 'yes';
        else if (/^(no|n|false|✗|✘|x|miss(ed)?|not\s*hit)$/i.test(v)) v = 'no';
        else continue;
      }
      row[f] = v.slice(0, 500);
    }
    if (!Object.keys(row).length) delete days[date][name];
    else { imported++; dates.add(date); }
  }
  save();
  return { imported, days: dates.size, from: [...dates].sort()[0] || null, to: [...dates].sort().at(-1) || null, unknown: [...unknown] };
}
