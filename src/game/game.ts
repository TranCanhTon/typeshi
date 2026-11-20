// Core game rules (GAME_SPEC sections 2 and 3). Pure logic: no Three.js, no DOM.
// The renderer reads `zombies` every frame and reacts to `events`.

import type { GameConfig } from '../config';
import type { WordPicker } from '../words/picker';
import { buildPath, pathLengthUntilWithin, STREETS, type Street, type StreetLayout } from './layout';
import type { Rng } from './rng';

export type ZombieKind = 'walker' | 'hunter';

export interface Zombie {
  readonly id: number;
  readonly kind: ZombieKind;
  readonly word: string;
  /** Letters typed so far. */
  typed: number;
  /** Ground position. The alley runs along z; the player is at +z. */
  x: number;
  z: number;
  /** Waypoints still to walk to; the last one is on the kill line. */
  path: { x: number; z: number }[];
  /** Speed at spawn time (m/s), before slows. */
  readonly baseSpeed: number;
  /** Current speed after slows (m/s); the renderer uses it for animation speed. */
  speed: number;
  slowTimer: number;
  /** The street it came from. */
  readonly street: Street;
  /** Where it spawned across its street: z for side streets, x for the straight one. */
  readonly lateral: number;
  /** The lane (x) it walks down the main alley in. */
  laneX: number;
  /** Distance walked since spawning (m). */
  travelled: number;
  /** True while it is in the main alley or the crossing (not in a side street). */
  emerged: boolean;
  /**
   * True once it is within `labelDistance` of the player, wherever it is (even
   * still in a side street): it has a label and can be targeted. Never goes back.
   */
  labelled: boolean;
  /** Game time when it got its label (for reaction time stats later). */
  labelledAt: number;
}

export type GameEvent =
  | { type: 'spawn'; zombie: Zombie }
  | { type: 'lock'; id: number }
  | { type: 'shot'; id: number; index: number }
  | { type: 'kill'; id: number; kind: ZombieKind; points: number }
  | { type: 'typo'; id: number | null; key: string; expected: string | null }
  | { type: 'comboTier'; multiplier: number }
  | { type: 'gameover'; id: number };

export interface RunStats {
  time: number;
  score: number;
  kills: number;
  hunterKills: number;
  bestCombo: number;
  /** Every correct key, including the keys that lock on. */
  correctKeys: number;
  /** Every wrong key (locked or not). */
  typos: number;
  /**
   * Active typing time (s): from the key that locks on to the key that
   * finishes the word, summed over words. Waiting for zombies doesn't count.
   */
  typingTime: number;
  /** Correct keys typed inside those spans, after the lock key (see `typingWpm`). */
  typingCorrect: number;
  /** All keys typed inside those spans after the lock key, typos included (for raw WPM). */
  typingKeys: number;
  wordsTyped: number;
  /** Words the player made a typo on (for mistake replay later). */
  missedWords: string[];
}

/** Words per minute from characters and seconds (5 characters = 1 word). */
export function wpmOf(chars: number, seconds: number): number {
  return seconds > 0 ? chars / 5 / (seconds / 60) : 0;
}

export interface WordLists {
  normal: readonly string[];
  hard: readonly string[];
}

export class Game {
  readonly zombies: Zombie[] = [];
  lockedId: number | null = null;
  combo = 0;
  score = 0;
  time = 0;
  over = false;
  readonly stats: RunStats = {
    time: 0, score: 0, kills: 0, hunterKills: 0, bestCombo: 0, correctKeys: 0, typos: 0,
    typingTime: 0, typingCorrect: 0, typingKeys: 0, wordsTyped: 0, missedWords: [],
  };
  private events: GameEvent[] = [];
  private nextId = 1;
  private spawnTimer = 1.0;
  private lastSpawnAt = -Infinity;
  /** Timestamp (s) of the key that locked on to the current word, if any. */
  private lockStart: number | null = null;
  private lastKeyAt = 0;
  /** Running mean length of normal words spawned (for the adaptive spawner). */
  private avgWordLen = 4.5;
  private normalSpawned = 0;

  /**
   * @param layout   the street layout (main sets a new one when the layout sliders change;
   *                 zombies already walking keep their paths)
   * @param weights  spawn weight per street, read live (CONFIG.layout.spawnWeights)
   */
  constructor(
    private cfg: GameConfig,
    private rng: Rng,
    private picker: WordPicker,
    private lists: WordLists,
    public layout: StreetLayout,
    private weights: Record<Street, number>,
  ) {}

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  get multiplier(): number {
    let m = 1;
    for (const [combo, mult] of this.cfg.score.tiers) if (this.combo >= combo) m = mult;
    return m;
  }

  get locked(): Zombie | null {
    return this.zombies.find((z) => z.id === this.lockedId) ?? null;
  }

  /**
   * Typing time so far (s), including the word being typed right now.
   * `now` is on the same clock as the timestamps passed to `key()`.
   */
  typingTimeAt(now: number): number {
    return this.stats.typingTime + (this.lockStart !== null ? Math.max(0, now - this.lockStart) : 0);
  }

  /**
   * Typing WPM (net), the main number: correct keys / 5 / minutes, counting
   * only time spent inside words (lock key to last key).
   *
   * The lock key starts each word's clock, the way the first keystroke starts
   * a Monkeytype test, so it is not counted as a character: an n-letter word
   * is n-1 keystroke gaps and n-1 characters. Counting it would add 1/(n-1)
   * per word (+33% on 4-letter words) and read far above Monkeytype.
   */
  typingWpm(now = this.lastKeyAt): number {
    return wpmOf(this.stats.typingCorrect, this.typingTimeAt(now));
  }

  /** Typing WPM, raw: the same, but typos inside words count as characters too. */
  typingRawWpm(now = this.lastKeyAt): number {
    return wpmOf(this.stats.typingKeys, this.typingTimeAt(now));
  }

  /** Run WPM (net): every correct key over the whole run time, waiting included. */
  get runWpm(): number {
    return wpmOf(this.stats.correctKeys, this.time);
  }

  /** Run WPM, raw: every key, typos included, over the whole run time. */
  get runRawWpm(): number {
    return wpmOf(this.stats.correctKeys + this.stats.typos, this.time);
  }

  get accuracy(): number {
    const total = this.stats.correctKeys + this.stats.typos;
    return total > 0 ? this.stats.correctKeys / total : 1;
  }

  /** Empty the event queue (the renderer and UI call this once per frame). */
  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /**
   * Feed one typed character. Anything other than a-z is ignored (space is the grenade, M2).
   * `at` is the keystroke time in seconds on any steady clock (the browser passes the
   * key event's timestamp, so typing time isn't rounded to logic ticks). Defaults to game time.
   */
  key(raw: string, at = this.time): void {
    if (this.over) return;
    const ch = raw.toLowerCase();
    if (!/^[a-z]$/.test(ch)) return;
    this.lastKeyAt = at;

    const locked = this.locked;
    if (locked) {
      const expected = locked.word[locked.typed];
      this.stats.typingKeys++;
      if (ch === expected) {
        this.stats.typingCorrect++;
        this.hit(locked, at);
      } else {
        this.typo(locked, ch, expected);
      }
      return;
    }

    // Not locked: the first letters on screen are unique, so at most one matches.
    // Only labelled zombies count: you can't type a word you can't see.
    const target = this.zombies.find((z) => z.labelled && z.word[0] === ch);
    if (target) {
      this.lockedId = target.id;
      this.lockStart = at; // this key starts the word's clock
      this.events.push({ type: 'lock', id: target.id });
      this.hit(target, at);
    } else {
      this.typo(null, ch, null);
    }
  }

  /** Close the current word's typing span. */
  private endSpan(at: number): void {
    if (this.lockStart === null) return;
    this.stats.typingTime += Math.max(0, at - this.lockStart);
    this.lockStart = null;
  }

  private hit(z: Zombie, at: number): void {
    const tierBefore = this.multiplier;
    z.typed++;
    this.combo++;
    this.stats.correctKeys++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    if (this.multiplier > tierBefore) this.events.push({ type: 'comboTier', multiplier: this.multiplier });
    this.score += this.cfg.score.perLetter * this.multiplier;
    const k = z.kind === 'hunter' ? this.cfg.hunter : this.cfg.walker;
    z.slowTimer = k.slowTime;
    this.events.push({ type: 'shot', id: z.id, index: z.typed - 1 });
    if (z.typed >= z.word.length) {
      this.endSpan(at);
      this.stats.wordsTyped++;
      this.kill(z);
    }
  }

  private kill(z: Zombie): void {
    const base = z.kind === 'hunter' ? this.cfg.score.perHunterKill : this.cfg.score.perKill;
    const points = base * this.multiplier;
    this.score += points;
    this.stats.kills++;
    if (z.kind === 'hunter') this.stats.hunterKills++;
    this.zombies.splice(this.zombies.indexOf(z), 1);
    if (this.lockedId === z.id) this.lockedId = null;
    this.events.push({ type: 'kill', id: z.id, kind: z.kind, points });
  }

  private typo(z: Zombie | null, key: string, expected: string | null): void {
    this.combo = 0;
    this.stats.typos++;
    if (z && !this.stats.missedWords.includes(z.word)) this.stats.missedWords.push(z.word);
    this.events.push({ type: 'typo', id: z?.id ?? null, key, expected });
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  update(dt: number): void {
    if (this.over) return;
    this.time += dt;
    this.updateSpawning(dt);
    this.moveZombies(dt);
    this.stats.time = this.time;
    this.stats.score = this.score;
  }

  /** Difficulty ramp shared by spawning and movement. */
  get speedMultiplier(): number {
    const e = this.cfg.endless;
    return 1 + (e.speedMax - 1) * Math.min(1, this.time / e.speedRampTime);
  }

  get spawnInterval(): number {
    const e = this.cfg.endless;
    return e.intervalMin + (e.intervalStart - e.intervalMin) * Math.exp(-this.time / e.intervalDecay);
  }

  get maxAlive(): number {
    const e = this.cfg.endless;
    return Math.min(e.maxAliveEnd, e.maxAliveStart + Math.floor(this.time / e.maxAliveGrowth));
  }

  // --- Adaptive spawning ------------------------------------------------------
  // The timed spawner alone tops out around 0.4 words/s early on, far below what
  // a fast typist needs (100 WPM is about 1.4 short words/s). With adaptive on,
  // the spawner also keeps enough zombies coming that you're never left waiting:
  // it estimates your word rate from your Typing WPM and keeps that many words
  // in the pipeline (spawned but not yet locked), counting the walk-in time from
  // the passage to the label distance. It only tops the field up as you clear
  // it, so a slower typist is never flooded; the timed ramp still adds pressure.

  /** Estimated typing speed: a prior that quickly gives way to your measured Typing WPM. */
  get estimatedWpm(): number {
    const a = this.cfg.adaptive;
    const n = this.stats.wordsTyped;
    return (a.assumedWpm * a.priorWords + this.typingWpm() * n) / (a.priorWords + n);
  }

  /** Words per second you can clear: typing the word plus switching to the next one. */
  get demandWordsPerSec(): number {
    const charsPerSec = (this.estimatedWpm * 5) / 60;
    const wordTime = Math.max(1, this.avgWordLen - 1) / Math.max(0.5, charsPerSec) + this.cfg.adaptive.switchTime;
    return 1 / wordTime;
  }

  /** Seconds from spawning to getting a label, averaged over the streets by spawn weight. */
  get pipelineSeconds(): number {
    const S = this.cfg.streets;
    const L = this.layout;
    let total = 0;
    let wsum = 0;
    for (const street of STREETS) {
      const w = Math.max(0, this.weights[street] ?? 0);
      if (w === 0) continue;
      const [d0, d1] = street === 'straight' ? S.spawnDepthStraight : S.spawnDepthSide;
      const { start, waypoints } = buildPath(L, {
        street,
        depth: (d0 + d1) / 2,
        lateral: street === 'straight' ? 0 : L.crossZ,
        laneX: 0,
        endZ: this.cfg.killZ + 0.5,
        turnPoints: S.turnPoints,
      });
      total += w * pathLengthUntilWithin(start, waypoints, this.cfg.playerZ, this.cfg.labelDistance);
      wsum += w;
    }
    const dist = wsum > 0 ? total / wsum : 0;
    return dist / (this.cfg.walker.speed * this.speedMultiplier);
  }

  /** How many not-yet-locked zombies the adaptive spawner keeps on the way. */
  get targetReady(): number {
    const a = this.cfg.adaptive;
    return Math.ceil(this.demandWordsPerSec * a.headroom * (this.pipelineSeconds + a.switchTime)) + a.buffer;
  }

  /** Zombies alive and not locked: what's left for you to type. */
  get ready(): number {
    return this.zombies.filter((z) => z.id !== this.lockedId).length;
  }

  private updateSpawning(dt: number): void {
    this.spawnTimer -= dt;
    const a = this.cfg.adaptive;
    const timed = this.spawnTimer <= 0 && this.zombies.length < this.maxAlive;
    const demand =
      a.enabled &&
      this.ready < this.targetReady &&
      this.zombies.length < a.maxAlive &&
      this.time - this.lastSpawnAt >= a.minGap;
    if (!timed && !demand) return;
    // If no lane has room or no word has a free first letter, the spawn just waits.
    if (this.trySpawn() && timed) this.spawnTimer = this.spawnInterval;
  }

  /**
   * Spawn one zombie now, in a street picked by spawn weight (or `forceStreet`).
   * Returns false if no street has room or no word has a free first letter.
   */
  trySpawn(forceKind?: ZombieKind, forceStreet?: Street): boolean {
    const kind = forceKind ?? this.rollKind();
    // Spacing first: try the streets in weighted random order until one has room.
    let spot: { street: Street; lateral: number; laneX: number } | null = null;
    for (const street of forceStreet ? [forceStreet] : this.streetOrder()) {
      spot = this.pickSpot(kind, street);
      if (spot) break;
    }
    if (!spot) return false;
    const used = new Set(this.zombies.map((z) => z.word[0]));
    const w = this.cfg.words;
    const word =
      kind === 'hunter'
        ? this.picker.pick(this.lists.hard, { usedFirstLetters: used })
        : this.picker.pick(this.lists.normal, {
            usedFirstLetters: used,
            maxDifficulty: w.difficultyStart + w.difficultyPerSecond * this.time,
          });
    if (!word) return false;

    const S = this.cfg.streets;
    const k = kind === 'hunter' ? this.cfg.hunter : this.cfg.walker;
    const [d0, d1] = spot.street === 'straight' ? S.spawnDepthStraight : S.spawnDepthSide;
    const { start, waypoints } = buildPath(this.layout, {
      street: spot.street,
      depth: this.rng.range(d0, d1),
      lateral: spot.lateral,
      laneX: spot.laneX,
      endZ: this.cfg.killZ + 0.5,
      turnPoints: S.turnPoints,
    });
    const z: Zombie = {
      id: this.nextId++,
      kind,
      word,
      typed: 0,
      x: start.x,
      z: start.z,
      path: waypoints,
      baseSpeed: k.speed * this.speedMultiplier,
      speed: k.speed * this.speedMultiplier,
      slowTimer: 0,
      street: spot.street,
      lateral: spot.lateral,
      laneX: spot.laneX,
      travelled: 0,
      emerged: false,
      labelled: false,
      labelledAt: 0,
    };
    this.zombies.push(z);
    this.lastSpawnAt = this.time;
    if (kind === 'walker') {
      this.normalSpawned++;
      this.avgWordLen += (word.length - this.avgWordLen) / Math.min(this.normalSpawned + 2, 50);
    }
    this.events.push({ type: 'spawn', zombie: z });
    return true;
  }

  private spacingScale(kind: ZombieKind): number {
    return kind === 'hunter' ? this.cfg.spacing.hunterScale : 1;
  }

  /** Streets in weighted random order (streets with weight 0 left out). */
  private streetOrder(): Street[] {
    const pool = STREETS.filter((s) => (this.weights[s] ?? 0) > 0);
    const out: Street[] = [];
    while (pool.length > 0) {
      const total = pool.reduce((t, s) => t + this.weights[s], 0);
      let r = this.rng.next() * total;
      const i = pool.findIndex((s) => (r -= this.weights[s]) < 0);
      out.push(...pool.splice(i < 0 ? pool.length - 1 : i, 1));
    }
    return out;
  }

  /** Most open of several evenly spread candidates in [lo, hi], at least `need` from all `taken`. */
  private openSpot(lo: number, hi: number, taken: { at: number; need: number }[]): number | null {
    const candidates = 9;
    let best: number | null = null;
    let bestGap = -1;
    for (let i = 0; i < candidates; i++) {
      const x = lo + ((hi - lo) * (i + this.rng.next())) / candidates;
      let gap = Infinity;
      for (const t of taken) gap = Math.min(gap, Math.abs(t.at - x) / t.need);
      if (gap >= 1 && gap > bestGap) {
        best = x;
        bestGap = gap;
      }
    }
    return best;
  }

  /**
   * Spacing per street: a new zombie needs a spot across its street at least
   * `spacing.side` from every zombie of the same street that has walked less
   * than `spacing.depth` (they all walk the same route, so that keeps them
   * `depth` apart front to back). Its main alley lane is the one most clear of
   * zombies around the crossing, where the streets merge. Null = no room.
   */
  private pickSpot(kind: ZombieKind, street: Street): { street: Street; lateral: number; laneX: number } | null {
    const S = this.cfg.spacing;
    const L = this.layout;
    const scale = (o: Zombie): number => Math.max(this.spacingScale(kind), this.spacingScale(o.kind));
    // Each street keeps to its own side of the main alley (left street on the
    // left, right street on the right, straight down the middle), so paths
    // rarely cross at the corner and nobody has to wait for cross traffic.
    const [allLo, allHi] = this.cfg.streets.laneX;
    const w = allHi - allLo;
    const [laneLo, laneHi] =
      street === 'left' ? [allLo, allLo + 0.45 * w] : street === 'right' ? [allHi - 0.45 * w, allHi] : [allLo + 0.3 * w, allHi - 0.3 * w];
    const m = this.cfg.streets.wallMargin;
    const sameStreet = this.zombies
      .filter((o) => o.street === street && o.travelled < S.depth * this.spacingScale(o.kind))
      .map((o) => ({ at: street === 'straight' ? o.laneX : o.lateral, need: S.side * scale(o) }));
    const [lo, hi] = street === 'straight' ? [laneLo, laneHi] : [L.crossFar + m, L.crossNear - m];
    const lateral = this.openSpot(lo, hi, sameStreet);
    if (lateral === null) return null;
    if (street === 'straight') return { street, lateral, laneX: lateral };
    // main alley lane: clear of everyone near the crossing, if possible
    const nearCrossing = this.zombies
      .filter((o) => o.z > L.crossFar - 3 && o.z < L.crossNear + S.depth * 2)
      .map((o) => ({ at: o.laneX, need: S.side * scale(o) }));
    const laneX = this.openSpot(laneLo, laneHi, nearCrossing) ?? this.rng.range(laneLo, laneHi);
    return { street, lateral, laneX };
  }

  private rollKind(): ZombieKind {
    const h = this.cfg.hunter;
    if (this.time < h.firstAfter) return 'walker';
    const alive = this.zombies.filter((z) => z.kind === 'hunter').length;
    const cap = this.time >= h.lateAfter ? h.maxAliveLate : h.maxAlive;
    if (alive >= cap) return 'walker';
    const chance = Math.min(h.chanceMax, h.chanceStart + h.chancePerSecond * (this.time - h.firstAfter));
    return this.rng.chance(chance) ? 'hunter' : 'walker';
  }

  /** In the main alley or the crossing (side streets excluded), with a little slack. */
  private inMain(z: Zombie, slack = 0): boolean {
    return z.x >= this.layout.leftX - slack && z.x <= this.layout.rightX + slack;
  }

  /** Unit direction a zombie is walking (toward its next waypoint). */
  private heading(z: Zombie): { x: number; z: number } {
    const t = z.path[0];
    if (t) {
      const dx = t.x - z.x;
      const dz = t.z - z.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) return { x: dx / d, z: dz / d };
    }
    return { x: 0, z: 1 };
  }

  /** How far `o` is in front of `z` along z's walking direction, if they'd collide within spacing.depth; else null. */
  private gapAhead(z: Zombie, o: Zombie): number | null {
    const S = this.cfg.spacing;
    const scale = Math.max(this.spacingScale(z.kind), this.spacingScale(o.kind));
    const h = this.heading(z);
    const rx = o.x - z.x;
    const rz = o.z - z.z;
    const along = rx * h.x + rz * h.z;
    if (along <= 0 || along >= S.depth * scale) return null;
    if (Math.abs(rx * h.z - rz * h.x) >= S.bodyWidth * scale) return null;
    return along;
  }

  /** Path length still to walk (m). Shorter = further along = right of way. */
  private remaining(z: Zombie): number {
    let len = 0;
    let px = z.x;
    let pz = z.z;
    for (const w of z.path) {
      len += Math.hypot(w.x - px, w.z - pz);
      px = w.x;
      pz = w.z;
    }
    return len;
  }

  /**
   * Don't walk into the zombie in front. "In front" is measured along each
   * zombie's own walking direction, so it works in the side streets, round the
   * corner and down the main alley alike. A zombie close behind another (within
   * spacing.depth ahead and spacing.side to the side) matches its speed, or
   * stops if it's right on its heels; merging zombies wait at the corner
   * instead of stacking.
   *
   * Right of way: a zombie only ever waits for one that is further along its
   * path (closer to the player). That is a single order over all zombies, so
   * nobody can end up waiting in a circle (A for B, B for C, C for A).
   */
  private followCap(z: Zombie, rem: Map<Zombie, number>): number {
    const S = this.cfg.spacing;
    const mine = rem.get(z)!;
    let cap = Infinity;
    for (const o of this.zombies) {
      if (o === z) continue;
      const theirs = rem.get(o)!;
      if (theirs > mine || (theirs === mine && o.id > z.id)) continue;
      const gap = this.gapAhead(z, o);
      if (gap === null) continue;
      const scale = Math.max(this.spacingScale(z.kind), this.spacingScale(o.kind));
      cap = Math.min(cap, gap < S.depth * scale * 0.6 ? 0 : o.speed);
    }
    return cap;
  }

  private moveZombies(dt: number): void {
    // furthest along first, so followers see this tick's leader speeds
    const rem = new Map(this.zombies.map((z) => [z, this.remaining(z)]));
    const order = [...this.zombies].sort((a, b) => rem.get(a)! - rem.get(b)!);
    for (const z of order) {
      const k = z.kind === 'hunter' ? this.cfg.hunter : this.cfg.walker;
      z.slowTimer = Math.max(0, z.slowTimer - dt);
      z.speed = Math.min(z.baseSpeed * (z.slowTimer > 0 ? k.slowFactor : 1), this.followCap(z, rem));

      let step = z.speed * dt;
      z.travelled += step;
      while (step > 0 && z.path.length > 0) {
        const t = z.path[0];
        const dx = t.x - z.x;
        const dz = t.z - z.z;
        const d = Math.hypot(dx, dz);
        if (d <= step) {
          z.x = t.x;
          z.z = t.z;
          step -= d;
          // the final waypoint sits past the kill line, so keep it
          if (z.path.length > 1) z.path.shift();
          else break;
        } else {
          z.x += (dx / d) * step;
          z.z += (dz / d) * step;
          step = 0;
        }
      }

      z.emerged = this.inMain(z);
      if (!z.labelled && Math.hypot(z.x, this.cfg.playerZ - z.z) <= this.cfg.labelDistance) {
        z.labelled = true;
        z.labelledAt = this.time;
      }
    }

    this.separate(dt);

    const reached = this.zombies.find((z) => z.z >= this.cfg.killZ);
    if (reached) {
      this.endSpan(this.lastKeyAt); // a word cut short still counts up to its last key
      this.over = true;
      this.events.push({ type: 'gameover', id: reached.id });
    }
  }

  /**
   * Keep spacing while walking: zombies closer than `spacing.depth` front to
   * back and `spacing.side` sideways (a faster walker catching a hunter, say)
   * ease apart sideways. Their lane moves with them so the path doesn't pull
   * them straight back together.
   */
  private separate(dt: number): void {
    const S = this.cfg.spacing;
    const [lo, hi] = this.cfg.streets.laneX;
    // only zombies on their last straight stretch toward the player (not mid-turn)
    const list = this.zombies.filter((z) => z.emerged && z.path.length === 1);
    const k = Math.min(1, dt * 3);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const scale = Math.max(this.spacingScale(a.kind), this.spacingScale(b.kind));
        const side = S.side * scale;
        const dx = b.x - a.x;
        if (Math.abs(a.z - b.z) >= S.depth * scale || Math.abs(dx) >= side) continue;
        const dir = dx !== 0 ? Math.sign(dx) : a.id < b.id ? 1 : -1;
        const push = (side - Math.abs(dx)) * 0.5 * k * dir;
        for (const [z, d] of [[a, -push], [b, push]] as [Zombie, number][]) {
          z.x = Math.max(lo, Math.min(hi, z.x + d));
          z.laneX = z.x;
          const last = z.path[z.path.length - 1];
          if (last) last.x = z.x;
        }
      }
    }
  }
}
