// Demo data so the board can be tried without any keys: `npm run mock`
import { TEAM } from '../team.config';
import { todayStr } from './time';
import type { ClickupMember, JibbleEntry, JibblePerson, Shot, TimerInfo } from './types';

const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
const tasks = ['Reel v3 – Phonics', 'UGC ad #4 – Bloom Little', 'Art Therapy hook test', 'Landing page – Math Mats', 'Static ads batch 12', 'Crochet guide pages', 'Weekly payout recon', 'Interview scheduling'];

const people: JibblePerson[] = TEAM.map((m, i) => ({
  id: `p${i}`,
  name: m.name.includes(' ') ? m.name : `${m.name} Demo`, // tests first-name matching
  email: `${m.name.split(' ')[0].toLowerCase()}@example.com`,
}));

// [jibble state, minutes in that state, trailing blank screenshots, timer running?]
type Sc = ['In' | 'StartBreak' | 'Out', number, number, boolean];
const scenario: Sc[] = TEAM.map((_, i): Sc => {
  const r = i % 7;
  if (r === 0) return ['In', 95, 0, true];
  if (r === 1) return ['In', 40, 0, false];
  if (r === 2) return ['StartBreak', 12 + i, 0, i % 2 === 0];
  if (r === 3) return ['In', 130, i === 3 ? 3 : 0, true];
  if (r === 4) return ['In', 70, 0, true];
  if (r === 5) return ['Out', 300, 0, false];
  return ['In', 25, 0, false];
});

let emitted = false;

export const getPeople = async () => people;

export async function getRecentEntries(): Promise<JibbleEntry[]> {
  if (Math.random() < 0.3) {
    const i = Math.floor(Math.random() * scenario.length);
    if (scenario[i][0] !== 'Out') {
      scenario[i][0] = scenario[i][0] === 'In' ? 'StartBreak' : 'In';
      scenario[i][1] = 0;
    }
  }
  if (Math.random() < 0.3) {
    const i = Math.floor(Math.random() * scenario.length);
    if (scenario[i][0] === 'In') scenario[i][3] = !scenario[i][3];
  }
  const today = todayStr();
  return people.flatMap((p, i) => {
    const latest: JibbleEntry = { personId: p.id, type: scenario[i][0], time: min(scenario[i][1]), belongsToDate: today };
    return scenario[i][0] === 'In' ? [{ ...latest, time: min(scenario[i][1] + 60) }, { ...latest, type: 'StartBreak' as const, time: min(scenario[i][1] + 15) }, latest] : [{ ...latest, type: 'In' as const, time: min(scenario[i][1] + 150) }, latest];
  });
}

export async function getNewShots(): Promise<Shot[]> {
  if (emitted) return [];
  emitted = true;
  const out: Shot[] = [];
  people.forEach((p, i) => {
    const [, since, blanks] = scenario[i];
    const count = Math.floor(since / 10);
    for (let k = count; k >= 1; k--) out.push({ id: `${p.id}-${k}`, personId: p.id, time: min(k * 10 - 3), blank: k <= blanks });
  });
  return out;
}

export const getMembers = async (): Promise<ClickupMember[]> => people.map((p, i) => ({ id: 1000 + i, email: p.email, username: p.name }));

export async function getTimers(): Promise<Map<number, TimerInfo>> {
  const map = new Map<number, TimerInfo>();
  people.forEach((_, i) => {
    const running = scenario[i][3];
    map.set(1000 + i, {
      trackedTodayMin: 60 + ((i * 37) % 240),
      running: running ? { task: tasks[i % tasks.length], url: 'https://app.clickup.com', status: 'in progress', startedAt: min(10 + ((i * 13) % 80)) } : null,
    });
  });
  return map;
}
