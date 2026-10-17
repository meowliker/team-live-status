import { CONFIG } from './config';

/** Today's date (YYYY-MM-DD) in the team's timezone */
export const todayStr = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: CONFIG.timezone });

function tzOffsetMs(date: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Midnight today in the team's timezone */
export function startOfToday() {
  const [y, m, d] = todayStr().split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(new Date(guess), CONFIG.timezone));
}

export const minutesSince = (iso: string | number | Date) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60e3));
