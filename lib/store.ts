// Small JSON files in the data folder (DATA_DIR). There is no database.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config';

const file = (n: string) => path.join(CONFIG.dataDir, n);

export const readJson = <T,>(n: string, d: T): T => {
  try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; }
};

export const writeJson = (n: string, v: unknown) => {
  try {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    fs.writeFileSync(file(n), JSON.stringify(v));
  } catch (e) { console.warn(`could not save ${n}: ${(e as Error).message}`); }
};
