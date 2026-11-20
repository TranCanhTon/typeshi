import { describe, expect, it } from 'vitest';
import { compareBests, worstKeys, type RunRecord } from './stats';

function rec(over: Partial<RunRecord> = {}): RunRecord {
  return {
    v: 1, date: 0, mode: 'waves', won: false, wave: 3, score: 1000, typingWpm: 60, typingRawWpm: 62, runWpm: 30, runRawWpm: 31,
    accuracy: 0.95, bestCombo: 20, wavesCleared: 2, time: 90, kills: { walker: 10, runner: 1, bisk: 0, hunter: 0 },
    spitsBroken: 0, timesBlinded: 0, reactionAvg: 1.2, reactionBest: 0.6, typingChars: 200, keys: {}, typoWords: [], waves: [],
    ...over,
  };
}

describe('personal bests', () => {
  it('the first run in a mode sets the bests but shows no badges', () => {
    const r = compareBests(null, rec(), 50);
    expect(r.firstRun).toBe(true);
    expect(r.beaten).toEqual([]);
    expect(r.bests.runs).toBe(1);
    expect(r.bests.values).toMatchObject({ score: 1000, typingWpm: 60, reactionAvg: 1.2 });
  });

  it('only strictly better values are new bests; lower reaction time is better', () => {
    const first = compareBests(null, rec(), 50).bests;
    const r = compareBests(first, rec({ score: 1000, typingWpm: 70, reactionAvg: 1.0, accuracy: 0.9 }), 50);
    expect(r.beaten.sort()).toEqual(['reactionAvg', 'typingWpm']);
    expect(r.bests.values.accuracy).toBe(0.95);
    expect(r.previous.values.typingWpm).toBe(60);
  });

  it('WPM, accuracy and reaction need enough typing to count', () => {
    const first = compareBests(null, rec(), 50).bests;
    const r = compareBests(first, rec({ typingChars: 10, accuracy: 1, typingWpm: 200, score: 5000 }), 50);
    expect(r.beaten).toEqual(['score']);
  });
});

describe('worst keys', () => {
  it('lowest accuracy first, needs a miss and enough tries', () => {
    const keys = { a: { hits: 9, misses: 1 }, b: { hits: 3, misses: 1 }, c: { hits: 20, misses: 0 }, d: { hits: 1, misses: 1 }, e: { hits: 6, misses: 4 } };
    expect(worstKeys(keys, 5, 4).map((k) => k.key)).toEqual(['e', 'b', 'a']);
    expect(worstKeys(keys, 1, 1).map((k) => k.key)).toEqual(['d']);
  });
});
