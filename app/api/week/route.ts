import { getWeek, weekCsv } from '@/lib/week';
import { mondayOf, todayStr } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/week?start=YYYY-MM-DD (any day of the week; defaults to this week) &format=csv &fresh=1
export async function GET(req: Request) {
  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return Response.json({ error: 'start must be YYYY-MM-DD' }, { status: 400 });
  const week = mondayOf(start || todayStr());
  if (week > mondayOf(todayStr())) return Response.json({ error: 'That week hasn’t started yet' }, { status: 400 });
  try {
    const data = await getWeek(week, url.searchParams.get('fresh') === '1');
    if (url.searchParams.get('format') === 'csv') {
      return new Response(weekCsv(data), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="team-week-${week}.csv"`, 'Cache-Control': 'no-store' },
      });
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
