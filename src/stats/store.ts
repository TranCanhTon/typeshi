// Saving runs and personal bests in localStorage (v2 Part F). If storage is
// unavailable (private window, blocked), runs still show their results; they
// just aren't kept.

import { CONFIG } from '../config';
import type { Mode } from '../game/game';
import type { Bests, RunRecord } from '../game/stats';

/** v1 kept only the endless best score under this key; it seeds the endless bests. */
const LEGACY_BEST_KEY = 'deadkeys.best.endless';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadBests(mode: Mode): Bests | null {
  const saved = read<Bests>(`${CONFIG.stats.pbKey}.${mode}`);
  if (saved && typeof saved.runs === 'number' && saved.values) return saved;
  if (mode === 'endless') {
    const legacy = Number(read<number>(LEGACY_BEST_KEY));
    if (legacy > 0) return { runs: 1, values: { score: legacy } };
  }
  return null;
}

export function saveBests(mode: Mode, bests: Bests): void {
  write(`${CONFIG.stats.pbKey}.${mode}`, bests);
}

/** Add a run to the history (newest last), keeping the last `stats.historySize`. */
export function saveRun(rec: RunRecord): void {
  const runs = read<RunRecord[]>(CONFIG.stats.runsKey);
  const list = Array.isArray(runs) ? runs : [];
  list.push(rec);
  write(CONFIG.stats.runsKey, list.slice(-CONFIG.stats.historySize));
}

export function loadRuns(): RunRecord[] {
  const runs = read<RunRecord[]>(CONFIG.stats.runsKey);
  return Array.isArray(runs) ? runs : [];
}
