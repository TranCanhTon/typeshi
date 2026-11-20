// Street layout: the crossroads at the far end of the main alley.
// Pure numbers (no Three.js), shared by the renderer, the lamps and the
// zombie paths, so they always agree.
//
//              (main alley continues into the fog)
//              |            |
//   -----------+            +-----------   <- crossFar
//   left street      crossing     right street
//   -----------+            +-----------   <- crossNear
//              |            |
//              |  main      |
//              |  alley     |
//              |     P      |              <- player (z = playerZ), looking toward -z
//
// x runs across the main alley (left is negative), z along it.

export type Street = 'left' | 'straight' | 'right';
export const STREETS: readonly Street[] = ['left', 'straight', 'right'];

export interface LayoutConfig {
  /** Length of the whole main alley, from its start behind the player to its far end in the fog (m). */
  mainAlleyLength: number;
  /** Distance from the player to the centre of the crossing (m). */
  crossingDistance: number;
  /** How far each side street runs from the crossing before it ends in the fog (m). */
  sideStreetLength: number;
  /** Width of the side streets (also the depth of the crossing) (m). */
  sideStreetWidth: number;
  /** Intensity of the sodium lamp over the crossing (candela). */
  crossingLampIntensity: number;
  /** Relative chance a zombie spawns in each street. 0 = never. */
  spawnWeights: Record<Street, number>;
}

export interface Point {
  x: number;
  z: number;
}

/** A lamp: bulb position plus how it is mounted. */
export interface LampSpec {
  x: number;
  y: number;
  z: number;
  /** Wall lamps: direction the wall faces (into the street). Null for the hanging crossing lamp. */
  normal: Point | null;
  /** Distance from the bulb back to the wall (wall lamps). */
  wallDist: number;
  /** Hanging lamp: points high on the corner buildings its cables run to. */
  cables?: { x: number; y: number; z: number }[];
  /** True for the crossing lamp (its intensity has its own slider). */
  crossing: boolean;
}

export interface StreetLayout {
  playerZ: number;
  /** Where the main alley starts, behind the player. */
  startZ: number;
  /** Main alley walls near the player (first stretch, wider). */
  nearLeftX: number;
  nearRightX: number;
  /** Main alley walls from the step onward, through the crossing and beyond. */
  leftX: number;
  rightX: number;
  /** Where the walls step in on each side. */
  stepLeftZ: number;
  stepRightZ: number;
  /** Crossing: centre and edges (z). */
  crossZ: number;
  crossNear: number;
  crossFar: number;
  /** Far end of the main alley's continuation (z). */
  mainFarZ: number;
  /** Far ends of the side streets (x). */
  leftEndX: number;
  rightEndX: number;
  lamps: LampSpec[];
}

/** Lamp count is fixed (the fog shader is compiled for it). */
export const LAMP_COUNT = 6;

const NEAR_INSET_LEFT = 0.25; // the walls step into the alley partway down
const NEAR_INSET_RIGHT = 0.4;
/** Where the steps happen, as a fraction of the way from the player to the crossing. */
const STEP_LEFT_FRAC = 0.68;
const STEP_RIGHT_FRAC = 0.575;

export function computeLayout(
  c: LayoutConfig,
  base: { playerZ: number; startZ: number; leftX: number; rightX: number },
): StreetLayout {
  const playerZ = base.playerZ;
  const W = Math.max(2, c.sideStreetWidth);
  const crossZ = playerZ - Math.max(6, c.crossingDistance);
  const crossNear = crossZ + W / 2;
  const crossFar = crossZ - W / 2;
  const nearLen = playerZ - crossNear;
  const leftX = base.leftX + NEAR_INSET_LEFT;
  const rightX = base.rightX - NEAR_INSET_RIGHT;
  const mainFarZ = Math.min(base.startZ - c.mainAlleyLength, crossFar - 6);
  const sideLen = Math.max(4, c.sideStreetLength);
  const leftEndX = leftX - sideLen;
  const rightEndX = rightX + sideLen;

  const lamps: LampSpec[] = [
    // 0: main alley, left wall, near the player
    { x: base.leftX + 0.45, y: 3.95, z: playerZ - 0.29 * nearLen, normal: { x: 1, z: 0 }, wallDist: 0.45, crossing: false },
    // 1: main alley, right wall, further down (this one flickers)
    { x: base.rightX - 0.45, y: 4.2, z: playerZ - 0.455 * nearLen, normal: { x: -1, z: 0 }, wallDist: 0.45, crossing: false },
    // 2: hanging over the crossing, strung between two corners
    {
      x: (leftX + rightX) / 2, y: 4.7, z: crossZ, normal: null, wallDist: 0, crossing: true,
      cables: [
        { x: leftX, y: 6.4, z: crossNear },
        { x: rightX, y: 6.4, z: crossFar },
      ],
    },
    // 3: left street, on its far wall just inside the mouth, so its light spills out through the gap
    { x: leftX - Math.min(2.6, sideLen * 0.4), y: 3.6, z: crossFar + 0.45, normal: { x: 0, z: 1 }, wallDist: 0.45, crossing: false },
    // 4: right street, the same
    { x: rightX + Math.min(2.6, sideLen * 0.4), y: 3.6, z: crossFar + 0.45, normal: { x: 0, z: 1 }, wallDist: 0.45, crossing: false },
    // 5: main alley beyond the crossing, left wall
    { x: leftX + 0.45, y: 3.9, z: crossFar - Math.min(9, (crossFar - mainFarZ) * 0.5), normal: { x: 1, z: 0 }, wallDist: 0.45, crossing: false },
  ];

  return {
    playerZ,
    startZ: base.startZ,
    nearLeftX: base.leftX,
    nearRightX: base.rightX,
    leftX,
    rightX,
    stepLeftZ: playerZ - STEP_LEFT_FRAC * nearLen,
    stepRightZ: playerZ - STEP_RIGHT_FRAC * nearLen,
    crossZ,
    crossNear,
    crossFar,
    mainFarZ,
    leftEndX,
    rightEndX,
    lamps,
  };
}

// ---------------------------------------------------------------------------
// Zombie paths
// ---------------------------------------------------------------------------

export interface PathParams {
  street: Street;
  /** Spawn depth into the street, beyond the crossing edge (m). */
  depth: number;
  /** Lateral position inside the street where it spawns: z for side streets, x for straight. */
  lateral: number;
  /** Lane (x) it walks down the main alley in. */
  laneX: number;
  /** z of the last waypoint (just past the kill line). */
  endZ: number;
  /** Points used to draw the curve round the corner. */
  turnPoints: number;
}

/** Start point and waypoints (in order) for a zombie walking from its street to the player. */
export function buildPath(L: StreetLayout, p: PathParams): { start: Point; waypoints: Point[] } {
  if (p.street === 'straight') {
    const start = { x: p.lateral, z: L.crossFar - p.depth };
    return { start, waypoints: [{ x: p.laneX, z: L.crossNear }, { x: p.laneX, z: p.endZ }] };
  }
  const side = p.street === 'left' ? -1 : 1;
  const wallX = side < 0 ? L.leftX : L.rightX;
  const z0 = p.lateral;
  const start = { x: wallX + side * p.depth, z: z0 };
  // Walk along the side street to its mouth, then curve round the corner
  // (a quadratic Bezier) into the main alley lane, heading for the player.
  const p0 = { x: wallX - side * 0.15, z: z0 };
  const turn = Math.abs(p.laneX - p0.x);
  const p2 = { x: p.laneX, z: Math.min(z0 + Math.max(1.2, turn), L.crossNear + 1.5) };
  const c = { x: p.laneX, z: z0 };
  const waypoints: Point[] = [p0];
  const n = Math.max(2, p.turnPoints);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const d = t * t;
    waypoints.push({ x: a * p0.x + b * c.x + d * p2.x, z: a * p0.z + b * c.z + d * p2.z });
  }
  waypoints.push({ x: p.laneX, z: p.endZ });
  return { start, waypoints };
}

/** Length of a path from its start until it first comes within `dist` of the player (m). */
export function pathLengthUntilWithin(
  start: Point,
  waypoints: Point[],
  playerZ: number,
  dist: number,
): number {
  const within = (q: Point) => Math.hypot(q.x, playerZ - q.z) <= dist;
  if (within(start)) return 0;
  let len = 0;
  let prev = start;
  for (const w of waypoints) {
    const seg = Math.hypot(w.x - prev.x, w.z - prev.z);
    const steps = Math.max(1, Math.ceil(seg / 0.1));
    for (let i = 1; i <= steps; i++) {
      const q = { x: prev.x + ((w.x - prev.x) * i) / steps, z: prev.z + ((w.z - prev.z) * i) / steps };
      if (within(q)) return len + (seg * i) / steps;
    }
    len += seg;
    prev = w;
  }
  return len;
}
