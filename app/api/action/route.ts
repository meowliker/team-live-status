import { engine } from '@/lib/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One endpoint for every button on the board: refresh, pick, release, mode
export async function POST(req: Request) {
  const e = engine();
  const body = await req.json().catch(() => ({}));
  let error: string | null = null;
  switch (body.action) {
    case 'refresh':
      break;
    case 'pick':
      error = e.pickPerson(String(body.personId), String(body.by || ''));
      break;
    case 'release':
      error = e.release(String(body.personId));
      break;
    case 'mode':
      error = ['auto', 'free', 'busy'].includes(body.mode) ? e.setMode(String(body.personId), body.mode) : 'Bad mode';
      break;
    default:
      error = 'Unknown action';
  }
  if (error) return Response.json({ error }, { status: 400 });
  await e.poll();
  return Response.json({ ok: true });
}
