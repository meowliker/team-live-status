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

/** Midnight at the start of a date (YYYY-MM-DD) in the team's timezone */
export function startOfDay(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMs(new Date(guess), CONFIG.timezone));
}

/** Midnight today in the team's timezone */
export const startOfToday = () => startOfDay(todayStr());

/** Calendar maths on YYYY-MM-DD strings */
export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function mondayOf(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export const minutesSince = (iso: string | number | Date) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60e3));
