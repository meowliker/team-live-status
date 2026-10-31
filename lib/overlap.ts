// ClickUp time that ran while the person was on a Jibble break doesn't count as worked.
import type { ClickupSpan, OnBreakSpan, TaskTime } from './types';

export type Span = { from: number; to: number };

/** Milliseconds of `a` inside any of `spans` (spans must not overlap each other) */
export const overlapMs = (a: Span, spans: Span[]) =>
  spans.reduce((t, b) => t + Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)), 0);

/** ClickUp entries minus the time they ran during breaks: tracked total, per task, and what was removed */
export function removeBreakTime(entries: ClickupSpan[], breaks: Span[]) {
  const tasks = new Map<string, { name: string; url: string | null; ms: number }>();
  const onBreak: OnBreakSpan[] = [];
  let kept = 0;
  let removed = 0;
  for (const e of entries) {
    const ov = overlapMs(e, breaks);
    kept += e.to - e.from - ov;
    removed += ov;
    const t = tasks.get(e.task) || { name: e.task, url: e.url, ms: 0 };
    t.ms += e.to - e.from - ov;
    tasks.set(e.task, t);
    for (const b of breaks) {
      const from = Math.max(e.from, b.from);
      const to = Math.min(e.to, b.to);
      if (to - from >= 60e3) onBreak.push({ task: e.task, from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - from) / 60e3) });
    }
  }
  return {
    trackedMin: Math.round(kept / 60e3),
    removedMin: Math.round(removed / 60e3),
    tasks: [...tasks.values()].map((t): TaskTime => ({ name: t.name, url: t.url, minutes: Math.round(t.ms / 60e3), running: false })).filter((t) => t.minutes > 0).sort((a, b) => b.minutes - a.minutes),
    onBreak: onBreak.sort((a, b) => a.from.localeCompare(b.from)),
  };
}
