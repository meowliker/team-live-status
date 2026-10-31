// ClickUp time that ran while the person was on a Jibble break, or after they clocked out, doesn't count.
import type { ClickupSpan, OffClockSpan, Segment, TaskTime } from './types';

export type Span = { from: number; to: number };
export type OffSpan = Span & { reason: OffClockSpan['reason'] };

/** Milliseconds of `a` inside any of `spans` (spans must not overlap each other) */
export const overlapMs = (a: Span, spans: Span[]) =>
  spans.reduce((t, b) => t + Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)), 0);

/**
 * When someone is off the clock in Jibble: their breaks, and from each clock-out until they
 * clock in again (or `end`: now for today, midnight for past days).
 * `entries` are one day's Jibble entries in time order.
 */
export function offClockSpans(segments: Segment[], entries: { type: string; time: string }[], end: number): OffSpan[] {
  const t = (iso: string) => new Date(iso).getTime();
  const out: OffSpan[] = segments.filter((x) => x.kind === 'break').map((x) => ({ from: t(x.from), to: t(x.to), reason: 'break' }));
  entries.forEach((e, i) => {
    if (e.type !== 'Out') return;
    const to = i + 1 < entries.length ? t(entries[i + 1].time) : end;
    if (to > t(e.time)) out.push({ from: t(e.time), to, reason: 'out' });
  });
  return out;
}

/** ClickUp entries minus the time they ran off the clock: tracked total, per task, and what was removed */
export function removeOffClockTime(entries: ClickupSpan[], off: OffSpan[]) {
  const tasks = new Map<string, { name: string; url: string | null; ms: number }>();
  const offClock: OffClockSpan[] = [];
  let kept = 0;
  let removed = 0;
  for (const e of entries) {
    const ov = overlapMs(e, off);
    kept += e.to - e.from - ov;
    removed += ov;
    const t = tasks.get(e.task) || { name: e.task, url: e.url, ms: 0 };
    t.ms += e.to - e.from - ov;
    tasks.set(e.task, t);
    for (const b of off) {
      const from = Math.max(e.from, b.from);
      const to = Math.min(e.to, b.to);
      if (to - from >= 60e3) offClock.push({ task: e.task, from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - from) / 60e3), reason: b.reason });
    }
  }
  return {
    trackedMin: Math.round(kept / 60e3),
    removedMin: Math.round(removed / 60e3),
    tasks: [...tasks.values()].map((t): TaskTime => ({ name: t.name, url: t.url, minutes: Math.round(t.ms / 60e3), running: false })).filter((t) => t.minutes > 0).sort((a, b) => b.minutes - a.minutes),
    offClock: offClock.sort((a, b) => a.from.localeCompare(b.from)),
  };
}
