import { FIELDS, setField, setsDayCsv, withSets, reportText, type Field } from '@/lib/sets';
import { getWeek } from '@/lib/week';
import { mondayOf, todayStr } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

// GET /api/sets?date=YYYY-MM-DD&format=csv  → that day's sheet as CSV
// GET /api/sets?date=YYYY-MM-DD&preview=1   → the Slack message that would be posted for that day
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') || todayStr();
  if (!isDate(date) || mondayOf(date) > mondayOf(todayStr())) return Response.json({ error: 'Bad date' }, { status: 400 });
  try {
    if (url.searchParams.get('preview') === '1') return Response.json(await reportText(date, false), { headers: { 'Cache-Control': 'no-store' } });
    const w = withSets(await getWeek(date));
    return new Response(setsDayCsv(w, date), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sets-${date}.csv"`, 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

// POST { date, name, field, value } → saves one cell of the sets sheet
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!isDate(b.date) || typeof b.name !== 'string' || !b.name || !FIELDS.includes(b.field)) return Response.json({ error: 'Bad request' }, { status: 400 });
  const row = setField(b.date, b.name, b.field as Field, String(b.value ?? ''));
  return Response.json({ ok: true, row });
}
