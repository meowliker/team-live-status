import { NextResponse, type NextRequest } from 'next/server';

// Optional password: set DASHBOARD_PASSWORD (and optionally DASHBOARD_USER) to protect the link.
export function proxy(req: NextRequest) {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return NextResponse.next();
  const user = process.env.DASHBOARD_USER || 'team';
  const expected = 'Basic ' + btoa(`${user}:${pass}`);
  if (req.headers.get('authorization') === expected) return NextResponse.next();
  return new NextResponse('Login required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Team Live", charset="UTF-8"' } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
