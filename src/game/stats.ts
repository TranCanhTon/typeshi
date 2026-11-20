// Run records and personal bests (v2 Part F). Pure logic: no DOM, no storage.
// main.ts builds a RunRecord when a run ends, compares it with the saved bests
// for that mode and hands both to the results screen.

import type { EnemyKind, Game, KeyStat, Mode } from './game';
import { wpmOf } from './game';

/** One point of the WPM-per-wave chart. */
export interface WaveRecord {
  wave: number;
  /** Typing WPM in this wave (null when no word was typed in it). */
  wpm: number | null;
  accuracy: number;
  typos: number;
  bonus: number;
  cleared: boolean;
}

/** Everything saved about one run. */
export interface RunRecord {
  v: 1;
  /** Date.now() when the run ended. */
  date: number;
  mode: Mode;
  won: boolean;
  /** Wave the run ended on. */
  wave: number;
  score: number;
  typingWpm: number;
  typingRawWpm: number;
  runWpm: number;
  runRawWpm: number;
  accuracy: number;
  bestCombo: number;
  wavesCleared: number;
  /** Seconds survived. */
  time: number;
  kills: Record<EnemyKind, number>;
  spitsBroken: number;
  timesBlinded: number;
  /** Seconds from a label appearing to its first letter: average and fastest (0 = no words started). */
  reactionAvg: number;
  reactionBest: number;
  /** Correct letters inside words (decides whether WPM, accuracy and reaction can set a best). */
  typingChars: number;
  keys: Record<string, KeyStat>;
  typoWords: string[];
  waves: WaveRecord[];
}

export function buildRecord(game: Game, date: number): RunRecord {
  const s = game.stats;
  return {
    v: 1,
    date,
    mode: game.mode,
    won: game.won,
    wave: game.wave,
    score: game.score,
    typingWpm: game.typingWpm(),
    typingRawWpm: game.typingRawWpm(),
    runWpm: game.runWpm,
    runRawWpm: game.runRawWpm,
    accuracy: game.accuracy,
    bestCombo: s.bestCombo,
    wavesCleared: s.wavesCleared,
    time: s.time,
    kills: { ...s.killsByKind },
    spitsBroken: s.spitsBroken,
    timesBlinded: s.timesBlinded,
    reactionAvg: game.reactionAvg,
    reactionBest: s.reactionCount > 0 ? s.reactionBest : 0,
    typingChars: s.typingCorrect,
    keys: structuredClone(s.keys),
    typoWords: [...s.typoWords],
    waves: s.waves.map((w) => ({
      wave: w.wave,
      wpm: w.typingTime > 0 ? wpmOf(w.typingCorrect, w.typingTime) : null,
      accuracy: w.correctKeys + w.typos > 0 ? w.correctKeys / (w.correctKeys + w.typos) : 1,
      typos: w.typos,
      bonus: w.bonus,
      cleared: w.cleared,
    })),
  };
}

// ---------------------------------------------------------------------------
// Personal bests
// ---------------------------------------------------------------------------

export type PbField = 'score' | 'typingWpm' | 'runWpm' | 'accuracy' | 'bestCombo' | 'wavesCleared' | 'time' | 'reactionAvg';

/** Which fields keep a best, which way is better, and which need enough typing to count. */
export const PB_FIELDS: readonly { field: PbField; lowerIsBetter: boolean; needsTyping: boolean }[] = [
  { field: 'score', lowerIsBetter: false, needsTyping: false },
  { field: 'typingWpm', lowerIsBetter: false, needsTyping: true },
  { field: 'runWpm', lowerIsBetter: false, needsTyping: true },
  { field: 'accuracy', lowerIsBetter: false, needsTyping: true },
  { field: 'bestCombo', lowerIsBetter: false, needsTyping: false },
  { field: 'wavesCleared', lowerIsBetter: false, needsTyping: false },
  { field: 'time', lowerIsBetter: false, needsTyping: false },
  { field: 'reactionAvg', lowerIsBetter: true, needsTyping: true },
];

/** Best value per field for one mode, plus how many runs it has seen. */
export interface Bests {
  runs: number;
  values: Partial<Record<PbField, number>>;
}

export interface PbResult {
  /** The bests after this run (to save). */
  bests: Bests;
  /** The bests before this run (for "best N" under each number). */
  previous: Bests;
  /** Fields this run beat. Empty on the first run in a mode (nothing to beat). */
  beaten: PbField[];
  firstRun: boolean;
}

/**
 * Compare a run with the saved bests of its mode. A best has to be strictly
 * beaten. WPM, accuracy and reaction time only count with at least `minChars`
 * correct letters in words.
 */
export function compareBests(prev: Bests | null, rec: RunRecord, minChars: number): PbResult {
  const previous: Bests = prev ? { runs: prev.runs, values: { ...prev.values } } : { runs: 0, values: {} };
  const firstRun = previous.runs === 0;
  const bests: Bests = { runs: previous.runs + 1, values: { ...previous.values } };
  const beaten: PbField[] = [];
  for (const { field, lowerIsBetter, needsTyping } of PB_FIELDS) {
    if (needsTyping && rec.typingChars < minChars) continue;
    const v = rec[field];
    if (!Number.isFinite(v)) continue;
    const old = previous.values[field];
    const better = old === undefined || (lowerIsBetter ? v < old : v > old);
    if (!better) continue;
    bests.values[field] = v;
    if (!firstRun) beaten.push(field);
  }
  return { bests, previous, beaten, firstRun };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export interface KeyAccuracy {
  key: string;
  hits: number;
  misses: number;
  accuracy: number;
}

/** Accuracy of one key (1 when it was never pressed). */
export function keyAccuracy(k: KeyStat | undefined): number {
  const n = k ? k.hits + k.misses : 0;
  return n > 0 ? k!.hits / n : 1;
}

/**
 * The `n` keys with the lowest accuracy, among keys with at least one miss and
 * `minAttempts` attempts. Ties: more misses first, then alphabetical.
 */
export function worstKeys(keys: Record<string, KeyStat>, n: number, minAttempts: number): KeyAccuracy[] {
  return Object.entries(keys)
    .filter(([, k]) => k.misses > 0 && k.hits + k.misses >= minAttempts)
    .map(([key, k]) => ({ key, hits: k.hits, misses: k.misses, accuracy: keyAccuracy(k) }))
    .sort((a, b) => a.accuracy - b.accuracy || b.misses - a.misses || a.key.localeCompare(b.key))
    .slice(0, n);
}
