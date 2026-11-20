// Word picker. Pure logic, no Three.js.
//
// Difficulty (GAME_SPEC section 5) = length + rare letters + awkward bigrams.
// The picker never returns a word whose first letter is already taken by a
// zombie on screen (GAME_SPEC section 2).

import type { Rng } from '../game/rng';

const RARE = new Set(['j', 'q', 'x', 'z', 'k', 'v', 'w', 'y', 'b', 'p']);
const AWKWARD = new Set([
  'xy', 'yx', 'qu', 'zz', 'pp', 'mn', 'nm', 'ct', 'tc', 'bt', 'pt', 'ph', 'gh', 'kn', 'wr',
  'sc', 'sq', 'ps', 'rh', 'hm', 'mb', 'lk', 'rk', 'nk', 'xt', 'yz', 'zy', 'ae', 'ue', 'ui',
]);
/** Bigrams typed with the same finger on QWERTY (slow and error prone). */
const SAME_FINGER = new Set([
  'ed', 'de', 'ce', 'ec', 'ny', 'yn', 'un', 'nu', 'mu', 'um', 'br', 'rb', 'gr', 'rg', 'ft', 'tf',
  'lo', 'ol', 'ki', 'ik', 'sw', 'ws', 'aq', 'qa', 'za', 'az', 'hn', 'nh', 'ju', 'uj', 'my', 'ym',
]);

export function wordDifficulty(word: string): number {
  let d = word.length;
  for (const ch of word) if (RARE.has(ch)) d += 0.75;
  for (let i = 0; i < word.length - 1; i++) {
    const bg = word.slice(i, i + 2);
    if (AWKWARD.has(bg)) d += 0.75;
    if (SAME_FINGER.has(bg)) d += 0.5;
    if (bg[0] === bg[1]) d += 0.25;
  }
  return d;
}

export interface PickOptions {
  /** First letters already on screen. */
  usedFirstLetters: ReadonlySet<string>;
  /** Prefer words at or below this difficulty (falls back to any word if none fit). */
  maxDifficulty?: number;
}

export class WordPicker {
  private recent: string[] = [];
  private scored: Map<readonly string[], { word: string; diff: number }[]> = new Map();

  constructor(private rng: Rng, private recentMemory = 25) {}

  /** Returns null when no word in the list has a free first letter (the spawn must wait). */
  pick(list: readonly string[], opts: PickOptions): string | null {
    const all = this.scoredList(list);
    const free = all.filter((w) => !opts.usedFirstLetters.has(w.word[0]));
    if (free.length === 0) return null;
    const fresh = free.filter((w) => !this.recent.includes(w.word));
    let pool = fresh.length > 0 ? fresh : free;
    if (opts.maxDifficulty !== undefined) {
      const easy = pool.filter((w) => w.diff <= opts.maxDifficulty!);
      if (easy.length > 0) pool = easy;
    }
    const word = this.rng.pick(pool).word;
    this.recent.push(word);
    if (this.recent.length > this.recentMemory) this.recent.shift();
    return word;
  }

  private scoredList(list: readonly string[]): { word: string; diff: number }[] {
    let s = this.scored.get(list);
    if (!s) {
      s = list.map((word) => ({ word, diff: wordDifficulty(word) }));
      this.scored.set(list, s);
    }
    return s;
  }
}
