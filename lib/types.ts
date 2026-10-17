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
export type TimerInfo = { running: Timer | null; trackedTodayMin: number };

export type Segment = { kind: 'work' | 'break'; from: string; to: string };
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
  poolSince: string | null;
  clickupLinked: boolean;
  timer: Timer | null;
  trackedTodayMin: number | null;
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
  settings: { awayMin: number; frozenMin: number; breakAllowanceMin: number; workTargetMin: number; longBreakMin: number; poolIdleAlertMin: number };
  departments: string[];
  people: PersonRow[];
  events: BoardEvent[];
};
