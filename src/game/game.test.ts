import { describe, expect, it } from 'vitest';
import { CONFIG, currentLayout } from '../config';
import { ENGLISH_200, HARD_WORDS } from '../words/lists';
import { WordPicker, wordDifficulty } from '../words/picker';
import { Game, type GameEvent, type Mode } from './game';
import { waveParams } from './waves';
import { buildPath, computeLayout, STREETS, type Street } from './layout';
import { createRng } from './rng';

const cfg = CONFIG.game;

function makeGame(normal: readonly string[] = ENGLISH_200, hard: readonly string[] = HARD_WORDS, seed = 7): Game {
  const rng = createRng(seed);
  return new Game(cfg, rng.fork('game'), new WordPicker(rng.fork('words')), { normal, hard }, currentLayout(), CONFIG.layout.spawnWeights);
}

/** Spawn a zombie and put it in the alley, labelled and targetable. */
function spawnEmerged(g: Game): void {
  expect(g.trySpawn('walker')).toBe(true);
  const z = g.zombies[g.zombies.length - 1];
  z.x = 0;
  z.z = -10;
  z.path = [{ x: 0, z: cfg.killZ + 0.5 }];
  z.emerged = true;
  z.labelled = true;
  // free the entry lanes so the next spawn has room
  z.laneX = 0;
}

function typeWord(g: Game, word: string): void {
  for (const ch of word) g.key(ch);
}

function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});

describe('word lists and picker', () => {
  it('lists are lowercase a-z and hard words are long', () => {
    for (const w of [...ENGLISH_200, ...HARD_WORDS]) expect(w).toMatch(/^[a-z]+$/);
    for (const w of HARD_WORDS) expect(w.length).toBeGreaterThanOrEqual(8);
    expect(ENGLISH_200.length).toBeGreaterThanOrEqual(200);
  });

  it('hard words score harder than normal words on average', () => {
    const avg = (l: readonly string[]) => l.reduce((s, w) => s + wordDifficulty(w), 0) / l.length;
    expect(avg(HARD_WORDS)).toBeGreaterThan(avg(ENGLISH_200) + 3);
  });

  it('never returns a word with a used first letter', () => {
    const p = new WordPicker(createRng(1));
    const used = new Set('abcdefghijklm');
    for (let i = 0; i < 200; i++) {
      const w = p.pick(ENGLISH_200, { usedFirstLetters: used });
      expect(w).not.toBeNull();
      expect(used.has(w![0])).toBe(false);
    }
  });

  it('returns null when every first letter is taken', () => {
    const p = new WordPicker(createRng(1));
    expect(p.pick(['cat', 'cow'], { usedFirstLetters: new Set('c') })).toBeNull();
  });
});

describe('spawning', () => {
  it('no two zombies on screen share a first letter', () => {
    const g = makeGame();
    for (let t = 0; t < 600 * 60; t++) {
      g.update(1 / 60);
      const firsts = g.zombies.map((z) => z.word[0]);
      expect(new Set(firsts).size).toBe(firsts.length);
      // keep the run alive by removing anything close
      for (const z of [...g.zombies]) if (z.z > -3) typeWord(g, z.word.slice(z.typed));
      if (g.over) break;
    }
    expect(g.stats.kills).toBeGreaterThan(50);
  });

  it('the spawn waits when no word with a free first letter exists', () => {
    const g = makeGame(['apple', 'axe'], ['abandoned']);
    expect(g.trySpawn('walker')).toBe(true);
    expect(g.trySpawn('walker')).toBe(false);
    expect(g.trySpawn('hunter')).toBe(false);
    expect(g.zombies.length).toBe(1);
  });

  it('hunters get hard words', () => {
    const g = makeGame();
    expect(g.trySpawn('hunter')).toBe(true);
    expect(HARD_WORDS).toContain(g.zombies[0].word);
  });

  it('zombies get a label (and become targetable) exactly at labelDistance', () => {
    const g = makeGame();
    g.trySpawn('walker');
    const z = g.zombies[0];
    g.key(z.word[0]);
    expect(g.lockedId).toBeNull();
    expect(g.stats.typos).toBe(1);
    let seenUnlabelledInAlley = false;
    for (let i = 0; i < 60 * 60 && !z.labelled; i++) {
      g.update(1 / 60);
      if (z.emerged && !z.labelled) seenUnlabelledInAlley = true;
    }
    expect(seenUnlabelledInAlley).toBe(true);
    const d = Math.hypot(z.x, cfg.playerZ - z.z);
    expect(d).toBeLessThanOrEqual(cfg.labelDistance);
    expect(d).toBeGreaterThan(cfg.labelDistance - 0.1);
    g.key(z.word[0]);
    expect(g.lockedId).toBe(z.id);
  });
});

describe('spacing', () => {
  it('within each street, new zombies spawn at least spacing.side apart, then the spawn waits', () => {
    const g = makeGame();
    while (g.trySpawn('walker'));
    for (const street of STREETS) {
      const lat = g.zombies.filter((z) => z.street === street).map((z) => z.lateral);
      expect(lat.length).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < lat.length; i++)
        for (let j = i + 1; j < lat.length; j++) expect(Math.abs(lat[i] - lat[j])).toBeGreaterThanOrEqual(cfg.spacing.side - 1e-9);
    }
    expect(g.trySpawn('walker')).toBe(false);
  });

  it('lanes free up once their zombies have walked spacing.depth', () => {
    const g = makeGame();
    (g as unknown as { spawnTimer: number }).spawnTimer = 1e9; // only our own spawns
    while (g.trySpawn('walker'));
    const n = g.zombies.length;
    for (let i = 0; i < 60 * 30 && g.zombies.some((z) => z.travelled < cfg.spacing.depth); i++) {
      for (const z of g.zombies) z.slowTimer = 0;
      g.update(1 / 60);
    }
    expect(g.trySpawn('walker')).toBe(true);
    expect(g.zombies.length).toBe(n + 1);
  });

  it('zombies walking close together ease apart sideways', () => {
    const g = makeGame();
    spawnEmerged(g);
    spawnEmerged(g);
    const [a, b] = g.zombies;
    a.x = a.laneX = 0;
    b.x = b.laneX = 0.1;
    b.z = a.z - 0.3;
    a.path = [{ x: 0, z: cfg.killZ + 0.5 }];
    b.path = [{ x: 0.1, z: cfg.killZ + 0.5 }];
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(cfg.spacing.side * 0.8);
  });
});

describe('typing', () => {
  it('locks on with the first letter and kills when the word is done', () => {
    const g = makeGame();
    spawnEmerged(g);
    const z = g.zombies[0];
    g.drainEvents();
    g.key(z.word[0]);
    expect(g.lockedId).toBe(z.id);
    expect(types(g.drainEvents())).toEqual(['lock', 'shot']);
    typeWord(g, z.word.slice(1));
    const ev = g.drainEvents();
    expect(ev.filter((e) => e.type === 'shot').length).toBe(z.word.length - 1);
    expect(ev[ev.length - 1].type).toBe('kill');
    expect(g.zombies.length).toBe(0);
    expect(g.lockedId).toBeNull();
    expect(g.combo).toBe(z.word.length);
  });

  it('stays locked: other zombies cannot be targeted until the word is done', () => {
    const g = makeGame();
    spawnEmerged(g);
    spawnEmerged(g);
    const [a, b] = g.zombies;
    g.key(a.word[0]);
    g.key(b.word[0]); // wrong for a (unless it happens to match a's next letter)
    expect(g.lockedId).toBe(a.id);
  });

  it('a typo resets the combo, is not consumed, and costs no score', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    g.key('h');
    g.key('o');
    const score = g.score;
    g.key('x');
    expect(g.combo).toBe(0);
    expect(g.score).toBe(score);
    expect(g.zombies[0].typed).toBe(2);
    const typo = g.drainEvents().find((e) => e.type === 'typo');
    expect(typo).toMatchObject({ expected: 'u', key: 'x' });
    typeWord(g, 'use');
    expect(g.zombies.length).toBe(0);
    expect(g.stats.missedWords).toEqual(['house']);
  });

  it('a key matching no zombie is a typo with no target', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    g.drainEvents();
    g.key('q');
    expect(g.drainEvents()).toEqual([{ type: 'typo', id: null, key: 'q', expected: null }]);
  });

  it('ignores space and other non-letters', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    g.key(' ');
    g.key('1');
    expect(g.stats.typos).toBe(0);
  });

  it('score uses the combo multiplier tiers', () => {
    const g = makeGame();
    expect(g.multiplier).toBe(1);
    g.combo = 10;
    expect(g.multiplier).toBe(2);
    g.combo = 24;
    expect(g.multiplier).toBe(2);
    g.combo = 100;
    expect(g.multiplier).toBe(5);
  });
});

describe('movement and death', () => {
  it('each hit slows the zombie down for a moment', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    const z = g.zombies[0];
    g.update(0.1);
    expect(z.speed).toBeCloseTo(z.baseSpeed);
    g.key('h');
    g.update(0.1);
    expect(z.speed).toBeCloseTo(z.baseSpeed * cfg.walker.slowFactor);
    g.update(cfg.walker.slowTime);
    expect(z.speed).toBeCloseTo(z.baseSpeed);
  });

  it('a zombie crossing the kill line ends the run', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    for (let i = 0; i < 60 * 60 && !g.over; i++) g.update(1 / 60);
    expect(g.over).toBe(true);
    expect(types(g.drainEvents())).toContain('gameover');
    const t = g.time;
    g.update(1);
    expect(g.time).toBe(t);
  });

  it('zombies spawned in later waves walk faster', () => {
    const g = makeGame();
    g.trySpawn('walker');
    g.wave = 8;
    g.trySpawn('walker');
    const [a, b] = g.zombies;
    expect(b.baseSpeed / a.baseSpeed).toBeCloseTo(Math.pow(1.04, 7), 6);
  });
});

describe('wpm', () => {
  /** Lock and finish one word with a key every `gap` seconds starting at `t0`. Returns the time of the last key. */
  function typeAt(g: Game, word: string, t0: number, gap: number): number {
    let t = t0;
    for (const ch of word) {
      g.key(ch, t);
      t += gap;
    }
    return t - gap;
  }

  it('Typing WPM equals the keystroke rate, whatever the word length', () => {
    // 100 WPM = 500 chars/min = one key every 0.12 s
    for (const words of [['the', 'of', 'dead'], ['barricade'], ['us', 'it', 'go', 'an']]) {
      const g = makeGame(words, ['abandoned']);
      const zs = words.map(() => (spawnEmerged(g), g.zombies[g.zombies.length - 1]));
      let t = 10;
      for (const z of zs) t = typeAt(g, z.word, t, 0.12) + 2; // 2 s of waiting between words
      expect(g.typingWpm()).toBeCloseTo(100, 5);
      expect(g.stats.wordsTyped).toBe(words.length);
    }
  });

  it('waiting time does not count toward Typing WPM, but does toward Run WPM', () => {
    const g = makeGame(['house', 'zebra'], ['abandoned']);
    spawnEmerged(g);
    spawnEmerged(g);
    const [a, b] = g.zombies;
    g.time = 30; // half a minute of run time, almost all of it waiting
    typeAt(g, a.word, 100, 0.12);
    typeAt(g, b.word, 200, 0.12); // 100 s gap between words
    expect(g.stats.typingTime).toBeCloseTo(0.96, 6); // 2 words x 4 gaps x 0.12 s
    expect(g.typingWpm()).toBeCloseTo(100, 5);
    expect(g.runWpm).toBeCloseTo(10 / 5 / 0.5, 6); // 10 correct chars over 30 s
  });

  it('raw WPM includes typos, net does not', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    let t = 0;
    for (const ch of 'hoxuse') g.key(ch, (t += 0.12)); // one typo inside the word
    g.time = 60;
    expect(g.stats.typingCorrect).toBe(4);
    expect(g.stats.typingKeys).toBe(5);
    expect(g.typingRawWpm()).toBeGreaterThan(g.typingWpm());
    expect(g.runRawWpm).toBeGreaterThan(g.runWpm);
  });

  it('a word in progress counts live', () => {
    const g = makeGame(['house'], ['abandoned']);
    spawnEmerged(g);
    g.key('h', 1);
    g.key('o', 1.12);
    expect(g.typingTimeAt(1.12)).toBeCloseTo(0.12, 6);
    expect(g.typingWpm(1.12)).toBeCloseTo(100, 5);
  });
});

describe('waves', () => {
  /** Run a game with a bot typing at `wpm` (no typos, 0.3 s to switch words) until `seconds` or the end. */
  function runBot(wpm: number, seconds: number, mode: Mode, seed = 11) {
    const rng = createRng(seed);
    const g = new Game(cfg, rng.fork('game'), new WordPicker(rng.fork('words')), { normal: ENGLISH_200, hard: HARD_WORDS }, currentLayout(), CONFIG.layout.spawnWeights, mode);
    const gap = 60 / (wpm * 5);
    const dt = 1 / 120;
    let nextKey = 0;
    let peakAlive = 0;
    const events: GameEvent[] = [];
    const overMax: number[] = [];
    while (g.time < seconds && !g.over) {
      g.update(dt);
      events.push(...g.drainEvents());
      peakAlive = Math.max(peakAlive, g.zombies.length);
      if (g.zombies.length > g.params.maxAlive) overMax.push(g.wave);
      const locked = g.locked;
      if (locked) {
        if (g.time >= nextKey) {
          g.key(locked.word[locked.typed], nextKey);
          nextKey += gap;
          if (!g.locked) nextKey = g.time + 0.3;
        }
      } else if (g.time >= nextKey) {
        const target = g.zombies.filter((z) => z.labelled).sort((a, b) => b.z - a.z)[0];
        if (target) {
          g.key(target.word[0], g.time);
          nextKey = g.time + gap;
        }
      }
      events.push(...g.drainEvents());
    }
    return { g, events, peakAlive, overMax };
  }

  it('wave formula: wave 1 is 5 zombies every 2.5 s, max 3, then the ramp', () => {
    const W = cfg.waves;
    const w1 = waveParams(W, 1);
    expect(w1).toMatchObject({ size: 5, interval: 2.5, maxAlive: 3, speed: 1, hunterMax: 1 });
    const w2 = waveParams(W, 2);
    expect(w2.size).toBe(7);
    expect(w2.interval).toBeCloseTo(2.5 * 0.93, 9);
    expect(w2.maxAlive).toBe(3);
    expect(waveParams(W, 3).maxAlive).toBe(4);
    expect(waveParams(W, 11).maxAlive).toBe(8);
    expect(waveParams(W, 30).maxAlive).toBe(8); // cap
    expect(waveParams(W, 40).interval).toBe(0.8); // floor
    expect(waveParams(W, 5).speed).toBeCloseTo(Math.pow(1.04, 4), 9);
    expect(waveParams(W, 30).speed).toBe(1.8); // cap
    expect(waveParams(W, 12).hunterMax).toBe(1);
    expect(waveParams(W, 13).hunterMax).toBe(2);
    expect(waveParams(W, 20).size).toBe(5 + 2 * 19);
  });

  it('the banner comes first: nothing spawns during the intro', () => {
    const g = makeGame();
    expect(g.drainEvents()).toEqual([{ type: 'waveStart', wave: 1 }]);
    for (let i = 0; i < Math.floor(cfg.waves.introTime * 60) - 2; i++) g.update(1 / 60);
    expect(g.phase).toBe('intro');
    expect(g.zombies.length).toBe(0);
    for (let i = 0; i < 6; i++) g.update(1 / 60);
    expect(g.phase).toBe('active');
    expect(g.zombies.length).toBe(1);
  });

  it('a wave spawns exactly its size, never more than max alive, then clears, breaks, and the next wave starts', () => {
    const { g, events, overMax } = runBot(70, 60, 'endless');
    expect(overMax).toEqual([]);
    const cleared = events.filter((e) => e.type === 'waveCleared').map((e) => (e as { wave: number }).wave);
    const started = events.filter((e) => e.type === 'waveStart').map((e) => (e as { wave: number }).wave);
    expect(cleared.slice(0, 2)).toEqual([1, 2]);
    expect(started.slice(0, 3)).toEqual([1, 2, 3]);
    expect(g.stats.wavesCleared).toBe(cleared.length);
    // every zombie of a cleared wave was spawned and killed: wave sizes add up to the kills
    let size = 0;
    for (const w of cleared) size += waveParams(cfg.waves, w).size;
    expect(g.stats.kills).toBeGreaterThanOrEqual(size);
  });

  it('the break lasts breakTime after a clear', () => {
    const g = makeGame();
    for (let i = 0; i < 60 * 60 && g.phase !== 'break'; i++) {
      g.update(1 / 60);
      for (const z of [...g.zombies]) if (z.labelled && g.lockedId === null) typeWord(g, z.word);
    }
    expect(g.phase).toBe('break');
    const wave = g.wave;
    for (let i = 0; i < Math.floor(cfg.waves.breakTime * 60) - 2; i++) g.update(1 / 60);
    expect(g.wave).toBe(wave);
    for (let i = 0; i < 4; i++) g.update(1 / 60);
    expect(g.wave).toBe(wave + 1);
    expect(g.phase).toBe('intro');
  });

  it('waves mode is won after the last wave; endless keeps going', () => {
    const saved = cfg.waves.count;
    cfg.waves.count = 2;
    const won = runBot(90, 120, 'waves');
    expect(won.g.won).toBe(true);
    expect(won.g.over).toBe(true);
    expect(won.events.some((e) => e.type === 'win')).toBe(true);
    expect(won.g.stats.wavesCleared).toBe(2);
    const endless = runBot(90, 130, 'endless');
    expect(endless.g.won).toBe(false);
    expect(endless.g.stats.wavesCleared).toBeGreaterThan(2);
    cfg.waves.count = saved;
  });

  it('enemy mix: walkers only in waves 1 and 2, hunters from wave 6, hunters capped', () => {
    const kindsAt = (wave: number, n: number) => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const g = makeGame(ENGLISH_200, HARD_WORDS, 100 + i);
        g.wave = wave;
        g.trySpawn();
        out.push(g.zombies[0].kind);
      }
      return out;
    };
    expect(new Set([...kindsAt(1, 60), ...kindsAt(2, 60)])).toEqual(new Set(['walker']));
    expect(kindsAt(5, 80)).not.toContain('hunter');
    expect(kindsAt(6, 200)).toContain('hunter');
    // hunter cap: with one hunter alive in wave 6, no second one
    const g = makeGame();
    g.wave = 6;
    g.trySpawn('hunter');
    const S = cfg.spacing;
    const saved = { ...S };
    S.side = 0;
    S.depth = 0;
    for (let i = 0; i < 40; i++) g.trySpawn();
    Object.assign(S, saved);
    expect(g.zombies.filter((z) => z.kind === 'hunter').length).toBe(1);
  });

  it('word difficulty rises per wave', () => {
    const avgLen = (wave: number) => {
      let total = 0;
      for (let i = 0; i < 80; i++) {
        const g = makeGame(ENGLISH_200, HARD_WORDS, 300 + i);
        g.wave = wave;
        g.trySpawn('walker');
        total += g.zombies[0].word.length;
      }
      return total / 80;
    };
    expect(avgLen(10)).toBeGreaterThan(avgLen(1));
  });
});

describe('crossroads', () => {
  const L = currentLayout();

  it('the main alley is 10% shorter: the crossing is 20 m out, the old far turn was ~22 m', () => {
    expect(L.playerZ - L.crossZ).toBeCloseTo(20, 6);
    expect(L.crossNear).toBeGreaterThan(L.crossFar);
    expect(L.mainFarZ).toBeLessThan(L.crossFar);
    expect(L.leftEndX).toBeLessThan(L.leftX);
    expect(L.rightEndX).toBeGreaterThan(L.rightX);
  });

  it('every street spawns, in proportion to its weight, and 0 weight means never', () => {
    const counts = (weights: Record<Street, number>, seed: number) => {
      const rng = createRng(seed);
      const c: Record<Street, number> = { left: 0, straight: 0, right: 0 };
      for (let i = 0; i < 300; i++) {
        const g = new Game(cfg, rng.fork('g' + i), new WordPicker(rng.fork('w' + i)), { normal: ENGLISH_200, hard: HARD_WORDS }, L, weights);
        g.trySpawn('walker');
        c[g.zombies[0].street]++;
      }
      return c;
    };
    const even = counts({ left: 1, straight: 1, right: 1 }, 5);
    for (const s of STREETS) expect(even[s]).toBeGreaterThan(60);
    const noRight = counts({ left: 1, straight: 3, right: 0 }, 6);
    expect(noRight.right).toBe(0);
    expect(noRight.straight).toBeGreaterThan(noRight.left * 2);
  });

  it('side street zombies spawn out of sight round the corner and turn smoothly into their lane', () => {
    for (const street of ['left', 'right'] as Street[]) {
      const { start, waypoints } = buildPath(L, { street, depth: 3, lateral: L.crossZ, laneX: 0.4, endZ: 0.8, turnPoints: 6 });
      // hidden: the line from the camera to the spawn point passes through the corner building
      const side = street === 'left' ? -1 : 1;
      const wallX = side < 0 ? L.leftX : L.rightX;
      const f = wallX / start.x; // where the sight line crosses the wall plane
      const zAtWall = L.playerZ + (start.z - L.playerZ) * f;
      expect(zAtWall).toBeGreaterThan(L.crossNear); // blocked by the near corner
      // the heading changes in small steps round the corner (no snap)
      const pts = [start, ...waypoints];
      let maxTurn = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        const b = Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
        let d = Math.abs(b - a);
        if (d > Math.PI) d = 2 * Math.PI - d;
        maxTurn = Math.max(maxTurn, d);
      }
      expect(maxTurn).toBeLessThan(Math.PI / 5); // the full 90 degree turn takes several steps
      expect(waypoints[waypoints.length - 1]).toEqual({ x: 0.4, z: 0.8 });
    }
  });

  it('zombies from all three streets reach the player (the kill line still ends the run)', () => {
    for (const street of STREETS) {
      const g = makeGame();
      expect(g.trySpawn('walker', street)).toBe(true);
      for (let i = 0; i < 60 * 120 && !g.over; i++) {
        (g as unknown as { spawnTimer: number }).spawnTimer = 1e9;
        g.update(1 / 60);
      }
      expect(g.over).toBe(true);
    }
  });

  it('a zombie in a side street can be locked once it is inside the label distance', () => {
    const g = makeGame(['house'], ['abandoned']);
    const saved = cfg.labelDistance;
    cfg.labelDistance = 40; // reaches into the side streets
    expect(g.trySpawn('walker', 'left')).toBe(true);
    const z = g.zombies[0];
    g.update(1 / 60);
    expect(z.emerged).toBe(false); // still in the side street
    expect(z.labelled).toBe(true);
    g.key('h');
    expect(g.lockedId).toBe(z.id);
    cfg.labelDistance = saved;
  });

  it('zombies merging from the side streets do not stack on top of each other', () => {
    const g = makeGame();
    (g as unknown as { spawnTimer: number }).spawnTimer = 1e9;
    // a wave from both side streets at once, aimed at the same lane
    for (const street of ['left', 'right', 'left', 'right'] as Street[]) g.trySpawn('walker', street);
    for (const z of g.zombies) {
      z.laneX = 0;
      z.path[z.path.length - 1].x = 0;
    }
    let minGap = Infinity;
    for (let i = 0; i < 60 * 25 && !g.over; i++) {
      (g as unknown as { spawnTimer: number }).spawnTimer = 1e9;
      g.update(1 / 60);
      const main = g.zombies.filter((z) => z.emerged && z.z > L.crossNear);
      for (let a = 0; a < main.length; a++)
        for (let b = a + 1; b < main.length; b++)
          minGap = Math.min(minGap, Math.hypot(main[a].x - main[b].x, main[a].z - main[b].z));
    }
    expect(minGap).toBeGreaterThan(0.6);
  });

  it('layout sliders: computeLayout follows the settings', () => {
    const base = { playerZ: 1.5, startZ: 7, leftX: -2, rightX: 2 };
    const a = computeLayout({ ...CONFIG.layout, crossingDistance: 30, sideStreetWidth: 5, sideStreetLength: 10, mainAlleyLength: 70 }, base);
    expect(a.playerZ - a.crossZ).toBeCloseTo(30, 6);
    expect(a.crossNear - a.crossFar).toBeCloseTo(5, 6);
    expect(a.leftX - a.leftEndX).toBeCloseTo(10, 6);
    expect(a.startZ - a.mainFarZ).toBeCloseTo(70, 6);
  });
});
