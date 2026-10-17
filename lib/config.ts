const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
const on = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : !['0', 'false', 'off', 'no'].includes(v.toLowerCase()));

export const CONFIG = {
  mock: on(process.env.MOCK, false),
  timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  pollMs: num(process.env.POLL_SECONDS, 60) * 1000,
  // On Railway with a volume attached, save to the volume by default so data survives redeploys
  dataDir: process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '.data',

  jibbleId: process.env.JIBBLE_CLIENT_ID || '',
  jibbleSecret: process.env.JIBBLE_CLIENT_SECRET || '',

  clickupToken: process.env.CLICKUP_TOKEN || '',
  clickupTeamId: process.env.CLICKUP_TEAM_ID || '',

  screenshotChecks: on(process.env.SCREENSHOT_CHECKS, true),
  awayMin: num(process.env.AWAY_MINUTES, 20),
  noShotMin: num(process.env.NO_SCREENSHOT_MINUTES, 30),
  frozenMin: num(process.env.FROZEN_MINUTES, 30),

  breakAllowanceMin: num(process.env.BREAK_ALLOWANCE_MINUTES, 90),
  longBreakMin: num(process.env.LONG_BREAK_MINUTES, 45),
  workTargetMin: num(process.env.WORK_TARGET_MINUTES, 420),
  poolIdleAlertMin: num(process.env.POOL_IDLE_ALERT_MINUTES, 15),
};

export const clickupOn = () => CONFIG.mock || !!(CONFIG.clickupToken && CONFIG.clickupTeamId);
export const jibbleOn = () => CONFIG.mock || !!(CONFIG.jibbleId && CONFIG.jibbleSecret);
