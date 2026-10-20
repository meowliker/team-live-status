import { CONFIG } from './config';
import type { JibbleEntry, JibblePerson } from './types';

// Jibble API: https://docs.api.jibble.io/
const IDENTITY = 'https://identity.prod.jibble.io/connect/token';
const WORKSPACE = 'https://workspace.prod.jibble.io/v1';
const TRACKING = 'https://time-tracking.prod.jibble.io/v1';

let token: string | null = null;

async function getToken() {
  if (token) return token;
  const res = await fetch(IDENTITY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CONFIG.jibbleId, client_secret: CONFIG.jibbleSecret }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Jibble login failed (${res.status}). Check JIBBLE_CLIENT_ID / JIBBLE_CLIENT_SECRET.`);
  token = (await res.json()).access_token as string;
  return token;
}

async function get(url: string, retry = true): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` }, cache: 'no-store' });
  if (res.status === 401 && retry) {
    token = null;
    return get(url, false);
  }
  if (!res.ok) throw new Error(`Jibble ${res.status} on ${url.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function getAll<T = any>(url: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const page: any = await get(next);
    out.push(...page.value);
    next = page['@odata.nextLink'];
  }
  return out;
}

const q = (params: Record<string, string>) => '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export async function getPeople(): Promise<JibblePerson[]> {
  const people = await getAll<any>(`${WORKSPACE}/People` + q({ $select: 'id,fullName,email,status', $filter: "status eq 'Joined'" }));
  return people.map((p) => ({ id: p.id, name: p.fullName, email: p.email?.toLowerCase() || null }));
}

const entries = (filter: string) =>
  getAll<JibbleEntry>(
    `${TRACKING}/TimeEntries` +
      q({
        $select: 'id,personId,type,time,belongsToDate',
        $expand: 'activity($select=name),project($select=name)',
        $filter: `${filter} and status eq 'Active'`,
        $orderby: 'time asc',
      }),
  );

/** All time entries over the last 36h, oldest first. In = working, StartBreak = on break, Out = clocked out */
export const getRecentEntries = () => entries(`time ge ${new Date(Date.now() - 36 * 3600e3).toISOString()}`);

/** Time entries between two moments, oldest first (for the weekly report) */
export const getEntriesBetween = (fromIso: string, toIso: string) => entries(`time ge ${fromIso} and time lt ${toIso}`);

export async function getScreenshotsSince(sinceIso: string) {
  return getAll<{ id: string; personId: string; time: string; url: string }>(
    `${TRACKING}/Screenshots` + q({ $select: 'id,personId,time,url,status', $filter: `time ge ${sinceIso} and status eq 'Active'`, $orderby: 'time asc' }),
  );
}

/**
 * blank: the image is almost one flat colour (locked screen, black, sleeping display)
 * sig: tiny greyscale thumbnail used to spot screens that don't change between screenshots
 */
export async function analyze(url: string) {
  const sharp = (await import('sharp')).default;
  let res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401 || res.status === 403) res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` }, cache: 'no-store' });
  if (!res.ok) throw new Error(`screenshot download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { channels } = await sharp(buf).resize(96, 96, { fit: 'fill' }).greyscale().stats();
  const sig = await sharp(buf).greyscale().resize(48, 27, { fit: 'fill' }).raw().toBuffer();
  return { blank: channels[0].stdev < 4, sig: sig.toString('base64') };
}

/** Average per-pixel difference between two thumbnails (0 = identical, normal work is 3+) */
export function sigDiff(a: string, b: string) {
  const x = Buffer.from(a, 'base64');
  const y = Buffer.from(b, 'base64');
  if (x.length !== y.length) return 255;
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return d / x.length;
}
