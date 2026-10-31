export type JibblePerson = { id: string; name: string; email: string | null };
export type JibbleEntry = {
  personId: string;
  type: 'In' | 'StartBreak' | 'Out';
  time: string;
  belongsToDate: string;
  activity?: { name: string } | null;
  project?: { name: string } | null;
};
export type Shot = { id: string; personId: string; time: string; blank: boolean; sig?: string };

export type ClickupMember = { id: number; email: string | null; username: string | null };
export type Timer = { task: string; url: string | null; status: string | null; startedAt: string };
export type TaskTime = { name: string; url: string | null; minutes: number; running: boolean };
/** One stretch of ClickUp timer time (ms since epoch) */
export type ClickupSpan = { from: number; to: number; task: string; url: string | null };
/** ClickUp timer time that ran while off the clock in Jibble: on a break or after clock-out (removed from ClickUp hours) */
export type OffClockSpan = { task: string; from: string; to: string; minutes: number; reason: 'break' | 'out' };
export type TimerInfo = { running: Timer | null; trackedTodayMin: number; tasks?: TaskTime[]; entries?: ClickupSpan[] };

export type Segment = { kind: 'work' | 'break'; from: string; to: string; activity?: string | null; project?: string | null };
/** Time on one Jibble activity + project today */
export type ActivityTime = { activity: string | null; project: string | null; minutes: number; current: boolean };
export type Overlay = { kind: 'away' | 'frozen' | 'nodata'; from: string; to: string; shots?: number; ongoing?: boolean };
export type DayReport = {
  firstIn: string | null;
  lastOut: string | null;
  worked: number;
  breakLogged: number;
  missed: number;
  untracked: number;
  frozen: number;
  realWorked: number;
  totalBreak: number;
  overBreak: number;
  segments: Segment[];
  overlays: Overlay[];
  activities: ActivityTime[];
};

export type PersonRow = {
  id: string;
  name: string;
  department: string;
  jibbleName: string;
  state: 'working' | 'break' | 'out';
  since: string | null;
  inToday: boolean;
  mode: 'auto' | 'free' | 'busy';
  pick: { by: string; at: string } | null;
  inPool: boolean;
  poolVia: 'hand' | 'clickup' | 'auto' | null; // added by someone, ClickUp timer on a "pool" task, or AUTO_POOL
  poolSince: string | null;
  clickupLinked: boolean;
  jibbleOnly: boolean;
  timer: Timer | null;
  trackedTodayMin: number | null;
  clickupTasks: TaskTime[] | null;
  clickupOffClock: { minutes: number; spans: OffClockSpan[] } | null;
  timerWhileOff: boolean;
  away: { since: string; minutes: number } | null;
  frozen: { since: string; minutes: number; shots: number } | null;
  noScreenshots: number | null;
  blankStreak: number;
  day: DayReport | null;
};

export type BoardEvent = { time: string; name: string; text: string; kind: string };

export type BoardState = {
  updatedAt: string | null;
  errors: string[];
  notices: string[];
  mock: boolean;
  clickup: boolean;
  screenshots: boolean;
  timezone: string;
  autoPool: boolean;
  settings: { awayMin: number; frozenMin: number; breakAllowanceMin: number; workTargetMin: number; longBreakMin: number; poolIdleAlertMin: number };
  departments: string[];
  people: PersonRow[];
  events: BoardEvent[];
};

/** Manual links set on the Settings page, keyed by roster name. Missing = match automatically. */
export type Mapping = Record<string, { jibble?: string; clickup?: number | 'none' }>;

export type SettingsState = {
  mock: boolean;
  clickup: boolean;
  updatedAt: string | null;
  errors: string[];
  storage: { dir: string; persistent: boolean | null };
  roster: {
    name: string;
    department: string;
    jibble: { id: string | null; name: string | null; manual: boolean };
    clickup: { id: number | null; name: string | null; manual: boolean; none: boolean; locked: boolean };
  }[];
  jibblePeople: JibblePerson[];
  clickupMembers: ClickupMember[];
};

/** One person's day inside the weekly report. Times of day are minutes after midnight (team timezone). */
export type WeekDay = {
  date: string;
  firstIn: number | null;
  lastOut: number | null;
  worked: number;
  breaks: number;
  clickup: number | null; // ClickUp time, minus anything that ran during a break
  clickupOffClock: number | null; // ClickUp time removed because it ran during a break
  offClock: OffClockSpan[];
  segments: Segment[];
  activities: { activity: string | null; project: string | null; minutes: number }[];
  tasks: { name: string; url: string | null; minutes: number }[];
};

export type PersonWeek = {
  name: string;
  department: string;
  jibbleName: string;
  days: (WeekDay | null)[]; // one per date in the week, null = not in
  daysPresent: number;
  avgIn: number | null;
  avgOut: number | null;
  totalWorked: number;
  avgWorked: number;
  daysOnTarget: number;
  totalBreak: number;
  avgBreak: number;
  daysOverBreak: number;
  totalClickup: number | null;
  avgClickup: number | null;
  totalClickupOffClock: number | null;
  activities: { activity: string | null; project: string | null; minutes: number }[];
  tasks: { name: string; url: string | null; minutes: number }[];
};

export type WeekReport = {
  weekStart: string;
  dates: string[];
  generatedAt: string;
  timezone: string;
  clickup: boolean;
  mock: boolean;
  settings: { workTargetMin: number; breakAllowanceMin: number };
  departments: string[];
  people: PersonWeek[];
  notFound: string[];
  errors: string[];
};
