import { importCsv } from '@/lib/sets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST the old Google Sheet as CSV text (File → Download → Comma-separated values)
export async function POST(req: Request) {
  const text = await req.text();
  if (!text.trim()) return Response.json({ error: 'The file is empty' }, { status: 400 });
  if (text.length > 5_000_000) return Response.json({ error: 'The file is too big (max 5 MB)' }, { status: 400 });
  try {
    return Response.json(importCsv(text));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
