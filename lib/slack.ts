import { CONFIG } from './config';

// Slack Web API, as a bot: https://api.slack.com/methods
// Needs a bot token with chat:write, im:write, users:read, users:read.email.

export const slackOn = () => CONFIG.slackDryRun || !!CONFIG.slackToken;

async function api(method: string, params: Record<string, string>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CONFIG.slackToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

// email → Slack user id (null = no Slack account with that email); re-checked every 6 hours
const users = new Map<string, { id: string | null; at: number }>();

export async function userByEmail(email: string): Promise<string | null> {
  const key = email.toLowerCase();
  const hit = users.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.id;
  let id: string | null;
  if (CONFIG.slackDryRun) id = `U_${key}`;
  else {
    try {
      id = (await api('users.lookupByEmail', { email: key })).user.id;
    } catch (e) {
      if (!String((e as Error).message).endsWith('users_not_found')) throw e;
      id = null;
    }
  }
  users.set(key, { id, at: Date.now() });
  return id;
}

// user id → their direct-message channel with the bot
const dms = new Map<string, string>();

type Where = { channel: string; ts: string };

/** Posts in a channel (id or name, e.g. "#creatives"), or replies in a thread. Returns where it went. */
export async function post(channel: string, text: string, thread?: Where): Promise<Where> {
  const to = thread?.channel || channel;
  if (CONFIG.slackDryRun) {
    console.log(`[slack dry-run] → ${to}${thread ? ' (thread)' : ''}: ${text}`);
    return { channel: to, ts: thread?.ts || String(Date.now() / 1000) };
  }
  const data = await api('chat.postMessage', { channel: to, text, ...(thread ? { thread_ts: thread.ts } : {}) });
  return { channel: data.channel as string, ts: (thread?.ts || data.ts) as string };
}

/** Sends a direct message to a user (or a reply in its thread) */
export async function dm(userId: string, text: string, thread?: Where): Promise<Where> {
  if (thread || CONFIG.slackDryRun) return post(`D_${userId}`, text, thread);
  let channel = dms.get(userId);
  if (!channel) {
    channel = (await api('conversations.open', { users: userId })).channel.id as string;
    dms.set(userId, channel);
  }
  return post(channel, text);
}

/** "<@U123>" tags someone in a message */
export const mention = (userId: string) => `<@${userId}>`;
