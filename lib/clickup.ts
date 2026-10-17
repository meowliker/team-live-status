import { CONFIG } from './config';
import { startOfToday } from './time';
import type { ClickupMember, TimerInfo } from './types';

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

/**
 * One call for the whole team: today's time entries. A negative duration means
 * that timer is running right now. Also sums each person's tracked time today.
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
  for (const e of data || []) {
    const uid = Number(e.user?.id);
    if (!uid) continue;
    const info = out.get(uid) || { running: null, trackedTodayMin: 0 };
    const start = Number(e.start);
    const dur = Number(e.duration);
    const running = dur < 0;
    const end = running ? now : Number(e.end) || start + dur;
    info.trackedTodayMin += Math.max(0, end - Math.max(start, sot)) / 60e3;
    if (running) {
      const task = e.task && typeof e.task === 'object' ? e.task : null;
      info.running = {
        task: task?.name || e.description || 'Timer running (no task)',
        url: task?.id ? `https://app.clickup.com/t/${task.id}` : e.task_url || null,
        status: task?.status?.status || null,
        startedAt: new Date(start).toISOString(),
      };
    }
    out.set(uid, info);
  }
  for (const v of out.values()) v.trackedTodayMin = Math.round(v.trackedTodayMin);
  return out;
}
