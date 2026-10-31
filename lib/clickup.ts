import { CONFIG } from './config';
import { startOfToday } from './time';
import type { ClickupMember, ClickupSpan, TaskTime, Timer, TimerInfo } from './types';

const API = 'https://api.clickup.com/api/v2';

async function get(path: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: CONFIG.clickupToken }, cache: 'no-store' });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

let membersCache: { at: number; list: ClickupMember[] } | null = null;

/** Everyone in the ClickUp workspace (cached for 10 minutes) */
export async function getMembers(): Promise<ClickupMember[]> {
  if (membersCache && Date.now() - membersCache.at < 10 * 60e3) return membersCache.list;
  const { teams } = await get('/team');
  const team = (teams || []).find((t: any) => String(t.id) === String(CONFIG.clickupTeamId));
  if (!team) throw new Error(`ClickUp workspace ${CONFIG.clickupTeamId} not found for this token. Check CLICKUP_TEAM_ID.`);
  const list: ClickupMember[] = (team.members || []).map((m: any) => ({
    id: m.user.id,
    email: m.user.email?.toLowerCase() || null,
    username: m.user.username || null,
  }));
  membersCache = { at: Date.now(), list };
  return list;
}

const toTimer = (e: any): Timer => {
  const task = e.task && typeof e.task === 'object' ? e.task : null;
  return {
    task: task?.name || e.description || 'Timer running (no task)',
    url: task?.id ? `https://app.clickup.com/t/${task.id}` : e.task_url || null,
    status: task?.status?.status || null,
    startedAt: new Date(Number(e.start)).toISOString(),
  };
};

/** The timer running right now for one person, or null. Other people's need an Owner/Admin token. */
async function getCurrent(userId: number) {
  const { data } = await get(`/team/${CONFIG.clickupTeamId}/time_entries/current?assignee=${userId}`);
  return data?.id ? data : null;
}

/**
 * Today's time entries for the whole team in one call, to sum each person's tracked time.
 * The date-range list doesn't reliably include timers that are still running, so each
 * linked person's running timer is also read from the "current timer" endpoint.
 * Needs a token from a Workspace Owner/Admin to see other people's timers.
 */
export async function getTimers(memberIds: number[]): Promise<Map<number, TimerInfo>> {
  const out = new Map<number, TimerInfo>();
  if (!memberIds.length) return out;
  const sot = startOfToday().getTime();
  const now = Date.now();
  const params = new URLSearchParams({
    start_date: String(sot - 24 * 3600e3), // include timers started yesterday that are still running
    end_date: String(now + 60e3),
    assignee: memberIds.join(','),
  });
  const { data } = await get(`/team/${CONFIG.clickupTeamId}/time_entries?${params}`);
  const info = (uid: number) => {
    if (!out.has(uid)) out.set(uid, { running: null, trackedTodayMin: 0 });
    return out.get(uid)!;
  };
  const counted = new Set<string>();
  const perTask = new Map<number, Map<string, TaskTime>>();
  const spans = new Map<number, ClickupSpan[]>();
  const add = (uid: number, start: number, end: number, e: any) => {
    const min = Math.max(0, end - Math.max(start, sot)) / 60e3;
    info(uid).trackedTodayMin += min;
    if (min <= 0) return;
    const t = toTimer(e);
    if (!spans.has(uid)) spans.set(uid, []);
    spans.get(uid)!.push({ from: Math.max(start, sot), to: end, task: t.task, url: t.url });
    if (!perTask.has(uid)) perTask.set(uid, new Map());
    const tasks = perTask.get(uid)!;
    const cur = tasks.get(t.task) || { name: t.task, url: t.url, minutes: 0, running: false };
    cur.minutes += min;
    tasks.set(t.task, cur);
  };

  for (const e of data || []) {
    const uid = Number(e.user?.id);
    if (!uid) continue;
    const start = Number(e.start);
    const dur = Number(e.duration);
    const running = dur < 0 || !Number(e.end); // running timers have a negative duration and no end
    add(uid, start, running ? now : Number(e.end) || start + dur, e);
    counted.add(String(e.id));
    if (running) info(uid).running = toTimer(e);
  }

  // Running timers, a few people at a time
  const queue = [...memberIds];
  const failures: string[] = [];
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const uid = queue.shift()!;
      try {
        const e = await getCurrent(uid);
        if (!e) {
          if (out.has(uid)) out.get(uid)!.running = null; // this endpoint wins over the list
          continue;
        }
        if (!counted.has(String(e.id))) add(uid, Number(e.start), now, e);
        info(uid).running = toTimer(e);
      } catch (err) { failures.push((err as Error).message); }
    }
  }));
  if (failures.length) console.warn(`ClickUp running timers: ${failures.length} failed, e.g. ${failures[0]}`);
  if (failures.length === memberIds.length) throw new Error(failures[0]);

  for (const [uid, v] of out) {
    v.trackedTodayMin = Math.round(v.trackedTodayMin);
    v.entries = spans.get(uid) || [];
    v.tasks = [...(perTask.get(uid)?.values() || [])]
      .map((t) => ({ ...t, minutes: Math.round(t.minutes), running: !!v.running && v.running.task === t.name }))
      .sort((a, b) => b.minutes - a.minutes);
  }
  return out;
}

/** Raw time entries for these people between two moments (for the weekly report) */
export async function getEntriesBetween(startMs: number, endMs: number, memberIds: number[]): Promise<any[]> {
  if (!memberIds.length) return [];
  const params = new URLSearchParams({ start_date: String(startMs), end_date: String(endMs), assignee: memberIds.join(',') });
  const { data } = await get(`/team/${CONFIG.clickupTeamId}/time_entries?${params}`);
  return data || [];
}

/** Task name and link of a ClickUp time entry */
export const entryTask = (e: any) => {
  const t = toTimer(e);
  return { name: t.task, url: t.url };
};

