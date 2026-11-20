// The alley, built in code from boxes and flat quads (GAME_SPEC section 8).
//
// Main alley (looks like docs/refs/ref_alley.png, approved in M0):
//   left:  red brick building (barred windows, door, garage shutter, graffiti),
//          then a taller grey plaster block stepping slightly into the alley
//   right: grey-beige plaster building with drainpipes and a red metal frame,
//          then a lighter, lower building stepping in (the alley narrows)
// At its far end a crossroads: side streets go off left and right, and the
// main alley carries on straight into the fog. Corner buildings frame the
// side street openings. The layout itself comes from game/layout.ts.
//
// Coordinates: x across the main alley (left is negative), y up, z along it.
// The camera stands near z = 1.5 and looks toward -z.

import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  type Texture,
} from 'three';
import { CONFIG } from '../config';
import type { StreetLayout } from '../game/layout';
import type { Rng } from '../game/rng';
import { ps1ify } from './ps1Material';
import type { AlleyTextures } from './textures';

const A = CONFIG.alley;
const TILE = CONFIG.textureTile;

// ---------------------------------------------------------------------------
// Main alley features (level layout, not tuning).
//
// These were hand placed for the original alley, whose left wall ran to
// z = -19 and right wall to z = -22. They are now mapped onto the shorter
// alley that ends at the crossing: positions scale, sizes stay the same.
// ---------------------------------------------------------------------------

const OLD_LEFT_END = -19;
const OLD_RIGHT_END = -22;

const HEIGHTS = { left1: 15, left2: 17.6, right1: 16, right2: 13.5 };
const FLOORS = { left1: 4, left2: 5, right1: 4, right2: 3 };
const OLD_WINDOW_COLS = {
  left1: [4.5, 1.2, -2.1, -5.4, -8.7, -11.6],
  left2: [-13.6, -16.2, -18.4],
  right1: [3.5, 0.2, -3.1, -6.4, -9.7],
  right2: [-13.4, -16.0, -18.6, -21.1],
};
/** Upper windows that are always lit: [column index, floor index]. */
const FORCED_LIT: Record<string, [number, number][]> = {
  left2: [[1, 3]],
  right2: [[1, 0], [2, 1]],
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
type UV = [number, number];

/** Collects quads into one BufferGeometry, fixing winding from the given normal. */
class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uvs: number[] = [];
  private idx: number[] = [];

  quad(p: [V3, V3, V3, V3], n: V3, uv: [UV, UV, UV, UV]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...p[i]);
      this.nor.push(...n);
      this.uvs.push(...uv[i]);
    }
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** A rectangle in the facade plane (local XY at z = n), split into small quads. */
  rect(u0: number, u1: number, v0: number, v1: number, n: number, tile: number): void {
    const nx = Math.max(1, Math.ceil((u1 - u0) / A.maxQuad));
    const ny = Math.max(1, Math.ceil((v1 - v0) / A.maxQuad));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const a = u0 + ((u1 - u0) * i) / nx;
        const b = u0 + ((u1 - u0) * (i + 1)) / nx;
        const c = v0 + ((v1 - v0) * j) / ny;
        const d = v0 + ((v1 - v0) * (j + 1)) / ny;
        this.quad(
          [[a, c, n], [b, c, n], [b, d, n], [a, d, n]],
          [0, 0, 1],
          [[a / tile, c / tile], [b / tile, c / tile], [b / tile, d / tile], [a / tile, d / tile]],
        );
      }
    }
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** Box whose UVs are scaled to world size so tiling textures line up. */
function worldBox(w: number, h: number, d: number, tile: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  // face order: +x, -x, +y, -y, +z, -z; 4 verts each
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

/** Horizontal strip that tiles along its width only (for grime overlays). */
function stripGeo(w: number, h: number, tile: number): PlaneGeometry {
  const g = new PlaneGeometry(w, h, Math.max(1, Math.ceil(w / A.maxQuad)), 1);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, 0.01 + uv.getY(i) * 0.98);
  return g;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function createMaterials(T: AlleyTextures) {
  const lam = (map: Texture | null, color = 0xffffff): MeshLambertMaterial =>
    ps1ify(new MeshLambertMaterial({ map, color }));
  const decal = (map: Texture, alphaTest: number, blend: boolean): MeshLambertMaterial =>
    ps1ify(
      new MeshLambertMaterial({
        map,
        transparent: blend,
        alphaTest: blend ? 0 : alphaTest,
        depthWrite: !blend,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
  return {
    lam,
    decal,
    brick: lam(T.brick),
    plasterGrey: lam(T.plasterGrey),
    plasterBeige: lam(T.plasterBeige),
    plasterLight: lam(T.plasterLight),
    plasterDark: lam(T.plasterDark),
    trim: lam(T.stoneTrim),
    floor: ps1ify(new MeshPhongMaterial({ map: T.floor, specular: 0x1c1813, shininess: 22 })),
    windows: T.windows.map((map) => ps1ify(new MeshPhongMaterial({ map, specular: 0x4a4a4a, shininess: 80 }))),
    lit: T.litWindows.map((map) => ps1ify(new MeshBasicMaterial({ map, color: 0xb0a090 }))),
    door: lam(T.door),
    dark: lam(null, 0x070605),
    metal: lam(null, 0x34322d),
    pipe: lam(null, 0x47443d),
    red: lam(null, 0x7c1d14),
    grimeBottom: decal(T.grimeBottom, 0, true),
    grimeTop: decal(T.grimeTop, 0, true),
    stain: decal(T.stain, 0, true),
    puddle: ps1ify(
      new MeshPhongMaterial({
        color: 0x0e0b08,
        specular: 0x8a7560,
        shininess: 120,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    ),
    bag: ps1ify(new MeshPhongMaterial({ color: 0x181a17, specular: 0x3a3a3a, shininess: 40 })),
    cardboard: lam(null, 0x5d4630),
    trash: lam(null),
    sky: ps1ify(new MeshBasicMaterial({ color: 0x000000, side: BackSide })),
  };
}

type Mats = ReturnType<typeof createMaterials>;

// ---------------------------------------------------------------------------
// Facade: one building face with recessed openings, decals and fixtures.
// Built in local space (u along the face, v up, +z out of the wall into the
// alley) and then placed into the world.
// ---------------------------------------------------------------------------

type Side = 'left' | 'right' | 'end' | 'back';
type OpeningKind = 'window' | 'lit' | 'barred' | 'door' | 'shutter' | 'graffitiShutter' | 'dark';

interface Opening {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  depth: number;
  kind: OpeningKind;
  sill: boolean;
}

class Facade {
  readonly group = new Group();
  private openings: Opening[] = [];
  private lo: number;
  private hi: number;
  readonly width: number;

  /**
   * side: which way the face looks.
   *   'left'  faces +x (a wall on the left of a street running along z)
   *   'right' faces -x
   *   'end'   faces +z (toward the player)
   *   'back'  faces -z (away from the player)
   * plane: the x (left/right) or z (end/back) of the wall; a..b: its extent along it.
   */
  constructor(
    private M: Mats,
    private T: AlleyTextures,
    private rng: Rng,
    private side: Side,
    plane: number,
    a: number,
    b: number,
    readonly height: number,
    private wallMat: Material,
    private tile: number,
  ) {
    this.lo = Math.min(a, b);
    this.hi = Math.max(a, b);
    this.width = this.hi - this.lo;
    if (side === 'left') {
      this.group.position.set(plane, 0, this.hi);
      this.group.rotation.y = Math.PI / 2;
    } else if (side === 'right') {
      this.group.position.set(plane, 0, this.lo);
      this.group.rotation.y = -Math.PI / 2;
    } else if (side === 'back') {
      this.group.position.set(this.hi, 0, plane);
      this.group.rotation.y = Math.PI;
    } else {
      this.group.position.set(this.lo, 0, plane);
    }
  }

  /** World coordinate along the wall (z for left/right walls, x for end/back walls) to local u. */
  u(w: number): number {
    return this.side === 'left' || this.side === 'back' ? this.hi - w : w - this.lo;
  }

  /** Local u back to the world coordinate along the wall. */
  w(u: number): number {
    return this.side === 'left' || this.side === 'back' ? this.hi - u : this.lo + u;
  }

  private span(a: number, b: number): [number, number] {
    const u0 = this.u(a);
    const u1 = this.u(b);
    return u0 < u1 ? [u0, u1] : [u1, u0];
  }

  opening(a: number, b: number, v0: number, v1: number, kind: OpeningKind, sill = false, depth = A.windowDepth): this {
    const [u0, u1] = this.span(a, b);
    this.openings.push({ u0, u1, v0, v1, kind, sill, depth });
    return this;
  }

  /** A grid of upper floor windows at the given column centres (world coordinates). */
  windowGrid(cols: number[], floors: number, lit: [number, number][] = []): this {
    cols.forEach((c, ci) => {
      for (let f = 0; f < floors; f++) {
        const base = A.groundFloorHeight + f * A.floorHeight;
        const v0 = base + A.windowSillHeight;
        const forced = lit.some(([cc, ff]) => cc === ci && ff === f);
        const kind: OpeningKind = forced || this.rng.chance(A.litWindowChance) ? 'lit' : 'window';
        this.opening(c - A.windowWidth / 2, c + A.windowWidth / 2, v0, v0 + A.windowHeight, kind, true);
      }
    });
    return this;
  }

  /** Horizontal ledge or cornice sticking out of the wall. */
  band(v0: number, v1: number, out: number, mat: Material = this.M.trim): this {
    const m = new Mesh(worldBox(this.width + 0.02, v1 - v0, out, TILE.plaster), mat);
    m.position.set(this.width / 2, (v0 + v1) / 2, out / 2);
    this.group.add(m);
    return this;
  }

  /** Dirt rising from the ground along the whole face. */
  grime(height: number): this {
    const m = new Mesh(stripGeo(this.width, height, TILE.grime), this.M.grimeBottom);
    m.position.set(this.width / 2, height / 2, 0.012);
    this.group.add(m);
    return this;
  }

  /** Water streaks running down from a height. */
  streaks(a: number, b: number, top: number, length: number): this {
    const [u0, u1] = this.span(a, b);
    const m = new Mesh(stripGeo(u1 - u0, length, TILE.grime), this.M.grimeTop);
    m.position.set((u0 + u1) / 2, top - length / 2, 0.014);
    this.group.add(m);
    return this;
  }

  /** Graffiti decal (2:1 texture) stretched over a wall area. */
  graffiti(a: number, b: number, v0: number, v1: number): this {
    const [u0, u1] = this.span(a, b);
    const mat = this.M.decal(this.T.graffiti(u1 - u0 >= 2.5), 0.5, false);
    const m = new Mesh(new PlaneGeometry(u1 - u0, v1 - v0, 2, 1), mat);
    m.position.set((u0 + u1) / 2, (v0 + v1) / 2, 0.02);
    this.group.add(m);
    return this;
  }

  /** Vertical drainpipe with brackets and a kick-out at the bottom. */
  pipe(at: number, top: number, radius = 0.06): this {
    const u = this.u(at);
    const len = top - 0.35;
    const p = new Mesh(new CylinderGeometry(radius, radius, len, 6), this.M.pipe);
    p.position.set(u, 0.35 + len / 2, radius + 0.04);
    this.group.add(p);
    const foot = new Mesh(new CylinderGeometry(radius, radius, 0.3, 6), this.M.pipe);
    foot.rotation.x = Math.PI / 2.6;
    foot.position.set(u, 0.22, radius + 0.14);
    this.group.add(foot);
    for (let y = 1.6; y < top; y += 2.2) {
      const br = new Mesh(new BoxGeometry(radius * 3, 0.05, radius + 0.06), this.M.metal);
      br.position.set(u, y, (radius + 0.06) / 2);
      this.group.add(br);
    }
    return this;
  }

  /** Horizontal pipe along the wall. */
  hpipe(a: number, b: number, v: number, radius = 0.05, mat: Material = this.M.pipe): this {
    const [u0, u1] = this.span(a, b);
    const p = new Mesh(new CylinderGeometry(radius, radius, u1 - u0, 6), mat);
    p.rotation.z = Math.PI / 2;
    p.position.set((u0 + u1) / 2, v, radius + 0.05);
    this.group.add(p);
    return this;
  }

  /** Square-section bar on the wall from (a, v0) to (a, v1) (vertical) or along. */
  bar(a: number, b: number, v0: number, v1: number, size: number, mat: Material): this {
    const [u0, u1] = this.span(a, b);
    const w = Math.max(size, u1 - u0);
    const h = Math.max(size, v1 - v0);
    const m = new Mesh(new BoxGeometry(w, h, size), mat);
    m.position.set((u0 + u1) / 2, (v0 + v1) / 2, size / 2 + 0.06);
    this.group.add(m);
    return this;
  }

  /** Generic object placed in local facade space. */
  add(obj: Object3D, at: number, v: number, out: number): this {
    obj.position.set(this.u(at), v, out);
    this.group.add(obj);
    return this;
  }

  build(): Group {
    const M = this.M;
    const wall = new GeoBuilder();

    // Split the face into a grid at every opening edge and skip the holes.
    const us = [...new Set([0, this.width, ...this.openings.flatMap((o) => [o.u0, o.u1])])].sort((a, b) => a - b);
    const vs = [...new Set([0, this.height, ...this.openings.flatMap((o) => [o.v0, o.v1])])].sort((a, b) => a - b);
    for (let i = 0; i < us.length - 1; i++) {
      for (let j = 0; j < vs.length - 1; j++) {
        const uc = (us[i] + us[i + 1]) / 2;
        const vc = (vs[j] + vs[j + 1]) / 2;
        const hole = this.openings.some((o) => uc > o.u0 && uc < o.u1 && vc > o.v0 && vc < o.v1);
        if (!hole) wall.rect(us[i], us[i + 1], vs[j], vs[j + 1], 0, this.tile);
      }
    }

    for (const o of this.openings) {
      const d = -o.depth;
      const t = this.tile;
      // reveals (the inside faces of the recess)
      wall.quad([[o.u0, o.v0, 0], [o.u0, o.v0, d], [o.u0, o.v1, d], [o.u0, o.v1, 0]], [1, 0, 0],
        [[0, o.v0 / t], [o.depth / t, o.v0 / t], [o.depth / t, o.v1 / t], [0, o.v1 / t]]);
      wall.quad([[o.u1, o.v0, 0], [o.u1, o.v0, d], [o.u1, o.v1, d], [o.u1, o.v1, 0]], [-1, 0, 0],
        [[0, o.v0 / t], [o.depth / t, o.v0 / t], [o.depth / t, o.v1 / t], [0, o.v1 / t]]);
      wall.quad([[o.u0, o.v1, 0], [o.u1, o.v1, 0], [o.u1, o.v1, d], [o.u0, o.v1, d]], [0, -1, 0],
        [[o.u0 / t, 0], [o.u1 / t, 0], [o.u1 / t, o.depth / t], [o.u0 / t, o.depth / t]]);
      if (o.v0 > 0.001) {
        wall.quad([[o.u0, o.v0, 0], [o.u1, o.v0, 0], [o.u1, o.v0, d], [o.u0, o.v0, d]], [0, 1, 0],
          [[o.u0 / t, 0], [o.u1 / t, 0], [o.u1 / t, o.depth / t], [o.u0 / t, o.depth / t]]);
      }

      // back panel: glass, door or shutter
      const w = o.u1 - o.u0;
      const h = o.v1 - o.v0;
      let mat: Material;
      switch (o.kind) {
        case 'lit': mat = this.rng.pick(M.lit); break;
        case 'door': mat = M.door; break;
        case 'shutter': mat = M.lam(this.T.shutter(false)); break;
        case 'graffitiShutter': mat = M.lam(this.T.shutter(true)); break;
        case 'dark': mat = M.dark; break;
        default: mat = this.rng.pick(M.windows);
      }
      const back = new Mesh(new PlaneGeometry(w, h, Math.ceil(w / A.maxQuad), Math.ceil(h / A.maxQuad)), mat);
      back.position.set((o.u0 + o.u1) / 2, (o.v0 + o.v1) / 2, d);
      this.group.add(back);

      if (o.sill) {
        const s = new Mesh(worldBox(w + 0.14, 0.07, 0.13, TILE.plaster), M.trim);
        s.position.set((o.u0 + o.u1) / 2, o.v0 - 0.035, 0.04);
        this.group.add(s);
        // streak of dirt running down from the sill
        if (this.rng.chance(0.55)) {
          const st = new Mesh(stripGeo(w * 0.9, 1.4, TILE.grime), M.grimeTop);
          st.position.set((o.u0 + o.u1) / 2, o.v0 - 0.75, 0.014);
          this.group.add(st);
        }
      }

      if (o.kind === 'barred') {
        const bars = new Group();
        const n = Math.max(3, Math.round(w / 0.12));
        for (let i = 1; i < n; i++) {
          const b = new Mesh(new BoxGeometry(0.025, h, 0.025), M.metal);
          b.position.set(o.u0 + (w * i) / n, (o.v0 + o.v1) / 2, -0.05);
          bars.add(b);
        }
        for (const f of [0.18, 0.82]) {
          const b = new Mesh(new BoxGeometry(w, 0.03, 0.03), M.metal);
          b.position.set((o.u0 + o.u1) / 2, o.v0 + h * f, -0.03);
          bars.add(b);
        }
        this.group.add(bars);
      }
    }

    this.group.add(new Mesh(wall.build(), this.wallMat));
    return this.group;
  }
}

// ---------------------------------------------------------------------------
// Generic facade dressing for the new streets: ground floor doors, shutters
// and barred windows, graffiti and pipes in the gaps, window rows above.
// Same parts and materials as the main alley, placed by the seeded RNG.
// ---------------------------------------------------------------------------

type GroundKind = OpeningKind | 'gap';

interface DressOptions {
  floors: number;
  /** Keep features this far from both ends of the face (m). */
  margin?: number;
  /** Openings placed first, in local u: [u0, u1, kind]. */
  fixed?: [number, number, OpeningKind][];
  /** Upper windows forced lit: [column, floor]. */
  lit?: [number, number][];
  pipes?: boolean;
}

function groundSize(kind: OpeningKind): [number, number, number] {
  // [v0, v1, recess depth]
  if (kind === 'barred') return [0.95, 2.3, 0.28];
  if (kind === 'door' || kind === 'dark') return [0, 2.3, 0.32];
  return [0, 2.6, 0.25];
}

function dress(f: Facade, rng: Rng, o: DressOptions): Facade {
  const W = f.width;
  const G = A.groundFloorHeight;
  const margin = o.margin ?? 0.6;
  const taken: [number, number][] = [];
  const add = (u0: number, u1: number, kind: OpeningKind): void => {
    const [v0, v1, depth] = groundSize(kind);
    f.opening(f.w(u0), f.w(u1), v0, v1, kind, false, depth);
    taken.push([u0, u1]);
  };
  const clear = (a: number, b: number): boolean => taken.every(([t0, t1]) => b + 0.7 <= t0 || a - 0.7 >= t1);
  for (const [u0, u1, kind] of o.fixed ?? []) add(u0, u1, kind);

  const kinds: GroundKind[] = ['door', 'graffitiShutter', 'shutter', 'barred', 'barred', 'gap', 'gap'];
  let u = margin + rng.range(0, 1.2);
  while (u < W - margin - 1) {
    const kind = rng.pick(kinds);
    const w =
      kind === 'door' ? 1.1 : kind === 'shutter' || kind === 'graffitiShutter' ? rng.range(2.0, 2.6) : kind === 'barred' ? rng.range(1.2, 1.8) : rng.range(1.2, 2.6);
    if (u + w > W - margin) break;
    if (kind !== 'gap' && clear(u, u + w)) add(u, u + w, kind);
    u += w + rng.range(0.9, 1.8);
  }

  // stretches of bare ground floor wall: graffiti, and a drainpipe here and there
  taken.sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  let prev = 0;
  for (const [t0, t1] of taken) {
    if (t0 - prev > 0.1) gaps.push([prev, t0]);
    prev = Math.max(prev, t1);
  }
  if (W - prev > 0.1) gaps.push([prev, W]);
  for (const [g0, g1] of gaps) {
    const room = g1 - g0 - 0.5;
    if (room >= 1.2 && rng.chance(0.75)) {
      const w = Math.min(room, rng.range(1.2, 3.2));
      const s = g0 + 0.25 + rng.range(0, room - w);
      const h = Math.min(1.5, (w / 2) * rng.range(0.9, 1.3));
      const v0 = rng.range(0.3, 0.7);
      f.graffiti(f.w(s), f.w(s + w), v0, v0 + h);
    }
  }
  if (o.pipes !== false) {
    const room = gaps.filter(([g0, g1]) => g1 - g0 > 0.8);
    for (let i = 0; i < Math.max(1, Math.floor(W / 10)) && room.length > 0; i++) {
      const [g0, g1] = room.splice(rng.int(0, room.length - 1), 1)[0];
      f.pipe(f.w((g0 + g1) / 2), f.height - 0.3);
    }
  }

  const cols = Math.max(1, Math.floor((W - 2 * margin) / 3.2));
  f.windowGrid(
    Array.from({ length: cols }, (_, i) => f.w(margin + ((W - 2 * margin) * (i + 0.5)) / cols)),
    o.floors,
    o.lit ?? [],
  );
  f.band(G - 0.22, G, 0.06).band(f.height - 0.3, f.height, 0.2).grime(2.6);
  return f;
}

// ---------------------------------------------------------------------------
// The streets
// ---------------------------------------------------------------------------

export interface BuiltAlley {
  group: Group;
  /** Free the geometry, materials and per-build textures (call before rebuilding). */
  dispose(): void;
}

/**
 * Build the main alley and the crossroads for a layout.
 * `release` is called for every texture made just for this build (graffiti,
 * shutters) when it is disposed, so rebuilding doesn't leak textures.
 */
export function buildAlley(rng: Rng, textures: AlleyTextures, L: StreetLayout, release: (t: Texture) => void): BuiltAlley {
  const created: Texture[] = [];
  const T: AlleyTextures = {
    ...textures,
    graffiti: (piece?: boolean) => {
      const t = textures.graffiti(piece);
      created.push(t);
      return t;
    },
    shutter: (graffiti: boolean) => {
      const t = textures.shutter(graffiti);
      created.push(t);
      return t;
    },
  };
  const M = createMaterials(T);
  const root = new Group();
  root.name = 'alley';
  const F = (side: Side, plane: number, a: number, b: number, h: number, mat: Material, tile: number): Facade =>
    new Facade(M, T, rng.fork(`facade-${side}-${plane.toFixed(2)}-${a.toFixed(2)}`), side, plane, a, b, h, mat, tile);
  const G = A.groundFloorHeight;

  // Map the hand-placed main alley features onto the alley's current length.
  const P = L.playerZ;
  const sL = (P - L.crossNear) / (P - OLD_LEFT_END);
  const sR = (P - L.crossNear) / (P - OLD_RIGHT_END);
  const mL = (z: number): number => P + (z - P) * sL;
  const mR = (z: number): number => P + (z - P) * sR;
  const oL = (a: number, b: number): [number, number] => [mL(a), mL(b)];
  const oR = (a: number, b: number): [number, number] => [mR(a), mR(b)];

  // --- Main alley, left 1: red brick -----------------------------------------
  root.add(
    F('left', L.nearLeftX, L.startZ, L.stepLeftZ, HEIGHTS.left1, M.brick, TILE.brick)
      .opening(...oL(0.6, -1.4), 0.95, 2.35, 'barred', false, 0.3)
      .opening(...oL(-2.2, -4.0), 0.95, 2.35, 'barred', false, 0.3)
      .opening(...oL(-6.0, -7.2), 0, 2.35, 'door', false, 0.35)
      .opening(...oL(-9.2, -11.6), 0, 2.6, 'graffitiShutter', false, 0.3)
      .windowGrid(OLD_WINDOW_COLS.left1.map(mL), FLOORS.left1)
      .band(G - 0.3, G, 0.08)
      .band(HEIGHTS.left1 - 0.35, HEIGHTS.left1, 0.22)
      .grime(2.8)
      .graffiti(...oL(-4.05, -5.95), 0.35, 1.3)
      .graffiti(...oL(-0.2, -4.2), 2.35, 3.0)
      .graffiti(...oL(-7.25, -9.15), 0.3, 1.25)
      .pipe(mL(-5.0), HEIGHTS.left1 - 0.3)
      .streaks(...oL(-4.6, -5.4), HEIGHTS.left1 - 0.4, 6)
      .build(),
  );

  // --- Main alley, left 2: taller grey plaster block, the near-left corner ---
  root.add(
    F('left', L.leftX, L.stepLeftZ, L.crossNear, HEIGHTS.left2, M.plasterDark, TILE.plaster)
      .opening(...oL(-13.4, -15.4), 0, 2.5, 'graffitiShutter', false, 0.25)
      .opening(...oL(-16.8, -17.8), 0, 2.3, 'dark', false, 0.4)
      .windowGrid(OLD_WINDOW_COLS.left2.map(mL), FLOORS.left2, FORCED_LIT.left2)
      .band(G - 0.25, G, 0.06)
      .band(HEIGHTS.left2 - 0.3, HEIGHTS.left2, 0.18)
      .grime(2.4)
      .graffiti(...oL(-15.45, -16.75), 0.4, 1.05)
      .pipe(mL(-18.75), HEIGHTS.left2 - 0.3)
      .hpipe(L.stepLeftZ, L.crossNear + 0.2, 3.65)
      .build(),
  );
  // the step between left 1 and left 2, facing the camera
  root.add(F('end', L.stepLeftZ, -12, L.leftX, HEIGHTS.left2, M.plasterDark, TILE.plaster).grime(2.4).build());

  // --- Main alley, right 1: grey-beige plaster with the red frame ------------
  root.add(
    F('right', L.nearRightX, L.stepRightZ, L.startZ, HEIGHTS.right1, M.plasterGrey, TILE.plaster)
      .opening(...oR(-6.8, -8.2), 1.0, 2.3, 'barred', false, 0.28)
      .opening(...oR(-10.0, -11.2), 0, 2.3, 'door', false, 0.35)
      .windowGrid(OLD_WINDOW_COLS.right1.map(mR), FLOORS.right1)
      .band(G - 0.15, G, 0.05)
      .band(HEIGHTS.right1 - 0.3, HEIGHTS.right1, 0.2)
      .grime(3.0)
      .graffiti(...oR(-3.0, -6.0), 0.9, 2.9)
      .graffiti(...oR(-0.5, -2.6), 0.3, 1.35)
      .pipe(mR(-8.6), HEIGHTS.right1 - 0.3)
      .pipe(mR(-11.75), HEIGHTS.right1 - 0.3)
      .hpipe(mR(-8.6), L.stepRightZ, 2.8, 0.045, M.metal)
      // red metal frame around the big graffiti, with a pipe running up the wall
      .bar(mR(-2.8), mR(-2.8), 0.7, 9.5, 0.09, M.red)
      .bar(mR(-6.2), mR(-6.2), 0.7, 3.25, 0.09, M.red)
      .bar(mR(-2.8), mR(-6.2), 3.2, 3.3, 0.09, M.red)
      .streaks(...oR(-2.4, -3.2), 9.5, 5)
      .build(),
  );

  // --- Main alley, right 2: lighter, lower building, the near-right corner ---
  root.add(
    F('right', L.rightX, L.crossNear, L.stepRightZ, HEIGHTS.right2, M.plasterLight, TILE.plaster)
      .opening(...oR(-13.0, -14.0), 0, 2.3, 'door', false, 0.3)
      .opening(...oR(-15.4, -16.6), 1.0, 2.2, 'barred', false, 0.25)
      .opening(...oR(-18.6, -21.0), 0, 2.6, 'graffitiShutter', false, 0.25)
      .windowGrid(OLD_WINDOW_COLS.right2.map(mR), FLOORS.right2, FORCED_LIT.right2)
      .band(G - 0.2, G, 0.06)
      .band(HEIGHTS.right2 - 0.3, HEIGHTS.right2, 0.2)
      .grime(2.6)
      .graffiti(...oR(-14.1, -15.3), 0.4, 1.0)
      .graffiti(...oR(-16.7, -18.5), 0.3, 1.2)
      .pipe(mR(-21.75), HEIGHTS.right2 - 0.3)
      .build(),
  );
  // the step between right 1 and right 2, facing the camera
  root.add(F('end', L.stepRightZ, L.rightX, L.nearRightX, HEIGHTS.right2, M.plasterLight, TILE.plaster).grime(2.6).build());

  // --- The crossroads ----------------------------------------------------------
  const dr = (label: string): Rng => rng.fork(`dress-${label}`);
  const floorsFor = (h: number): number => Math.max(1, Math.floor((h - G - 0.6) / A.floorHeight));

  // Near-left corner, its face along the left street (faces away from the player)
  const hNL = HEIGHTS.left2;
  root.add(dress(F('back', L.crossNear, L.leftEndX, L.leftX, hNL, M.plasterDark, TILE.plaster), dr('nl'), { floors: floorsFor(hNL) }).build());
  // Near-right corner, along the right street
  const hNR = HEIGHTS.right2;
  root.add(dress(F('back', L.crossNear, L.rightX, L.rightEndX, hNR, M.plasterLight, TILE.plaster), dr('nr'), { floors: floorsFor(hNR) }).build());

  // Far-left corner: the face you see through the left opening, with graffiti
  // shutters at the corner like the old end wall, and its face along the main alley beyond.
  const hFL = 12.5;
  {
    const f = F('end', L.crossFar, L.leftEndX, L.leftX, hFL, M.plasterBeige, TILE.plaster);
    root.add(dress(f, dr('fl-side'), { floors: floorsFor(hFL), fixed: [[f.width - 2.6, f.width - 0.7, 'graffitiShutter']], lit: [[0, 1]] }).build());
  }
  root.add(dress(F('left', L.leftX, L.crossFar, L.mainFarZ, hFL, M.plasterBeige, TILE.plaster), dr('fl-main'), { floors: floorsFor(hFL), lit: [[1, 0]] }).build());

  // Far-right corner, same idea
  const hFR = 15;
  {
    const f = F('end', L.crossFar, L.rightX, L.rightEndX, hFR, M.plasterGrey, TILE.plaster);
    root.add(dress(f, dr('fr-side'), { floors: floorsFor(hFR), fixed: [[0.7, 2.9, 'graffitiShutter']], lit: [[1, 2]] }).build());
  }
  root.add(dress(F('right', L.rightX, L.mainFarZ, L.crossFar, hFR, M.plasterGrey, TILE.plaster), dr('fr-main'), { floors: floorsFor(hFR) }).build());

  // Where the three streets end, deep in the fog
  root.add(dress(F('left', L.leftEndX, L.crossFar, L.crossNear, 12, M.brick, TILE.brick), dr('l-end'), { floors: 2, margin: 0.4, pipes: false }).build());
  root.add(dress(F('right', L.rightEndX, L.crossFar, L.crossNear, 12, M.brick, TILE.brick), dr('r-end'), { floors: 2, margin: 0.4, pipes: false }).build());
  root.add(dress(F('end', L.mainFarZ, L.leftX, L.rightX, 14, M.plasterDark, TILE.plaster), dr('m-end'), { floors: 3, margin: 0.4, pipes: false }).build());

  // Stone quoins up the four corners of the crossing: in the lamp light they mark
  // where the walls break open, which is otherwise hard to read down a narrow alley.
  root.add(quoins(M, L.leftX, L.crossNear, 1, 1, HEIGHTS.left2));
  root.add(quoins(M, L.rightX, L.crossNear, -1, 1, HEIGHTS.right2));
  root.add(quoins(M, L.leftX, L.crossFar, 1, -1, hFL));
  root.add(quoins(M, L.rightX, L.crossFar, -1, -1, hFR));

  // Far skyline block behind it all, lost in fog
  const far = new Mesh(worldBox(40, 24, 4, TILE.plaster), M.plasterDark);
  far.position.set(0, 12, L.mainFarZ - 12);
  root.add(far);

  // --- Floor --------------------------------------------------------------------
  const fx0 = L.leftEndX - 1;
  const fx1 = L.rightEndX + 1;
  const fz0 = L.mainFarZ - 1;
  const fz1 = L.startZ;
  const floorGeo = new PlaneGeometry(fx1 - fx0, fz1 - fz0, Math.ceil(fx1 - fx0), Math.ceil(fz1 - fz0));
  floorGeo.rotateX(-Math.PI / 2);
  {
    const pos = floorGeo.getAttribute('position');
    const uv = floorGeo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + (fx1 - fx0) / 2) / TILE.floor, (pos.getZ(i) + (fz1 - fz0) / 2) / TILE.floor);
    }
  }
  const floor = new Mesh(floorGeo, M.floor);
  floor.position.set((fx0 + fx1) / 2, 0, (fz0 + fz1) / 2);
  root.add(floor);

  root.add(buildFloorClutter(rng.fork('clutter'), M, L, mL, mR));

  // --- Sky: everything behind the buildings, rendered as fog ------------------
  root.add(new Mesh(new SphereGeometry(150, 10, 6), M.sky));

  return {
    group: root,
    dispose(): void {
      root.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
      });
      for (const t of created) release(t);
    },
  };
}

/**
 * Alternating long/short stone blocks up a building corner at (x, z).
 * sx: which way the main alley face looks (+1 = +x), so the side street lies at -sx.
 * sz: which way the main alley face runs from the corner (+1 = toward the player).
 */
function quoins(M: Mats, x: number, z: number, sx: number, sz: number, height: number): Group {
  const g = new Group();
  const block = 0.32;
  const out = 0.05;
  for (let y = 0, i = 0; y + block <= height - 0.4; y += block + 0.04, i++) {
    const long = i % 2 === 0 ? 0.62 : 0.4;
    const short = i % 2 === 0 ? 0.4 : 0.62;
    // along the main alley face, and along the side street face, meeting at the corner
    const a = new Mesh(worldBox(out * 2, block, long, TILE.plaster), M.trim);
    a.position.set(x, y + block / 2, z + sz * (long / 2));
    const b = new Mesh(worldBox(short, block, out * 2, TILE.plaster), M.trim);
    b.position.set(x - sx * (short / 2), y + block / 2, z);
    g.add(a, b);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Puddles, stains, trash
// ---------------------------------------------------------------------------

/** A floor area to scatter clutter over. `along` is the axis the street runs on. */
interface Area {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  along: 'x' | 'z';
  /** Share of each clutter count this area gets. */
  share: number;
}

function buildFloorClutter(rng: Rng, M: Mats, L: StreetLayout, mL: (z: number) => number, mR: (z: number) => number): Group {
  const g = new Group();
  const C = CONFIG.trash;
  const nearX = (z: number): [number, number] => [z > L.stepLeftZ ? L.nearLeftX : L.leftX, z > L.stepRightZ ? L.nearRightX : L.rightX];

  // The main alley up to the crossing keeps the original amounts; the new streets get a bit less each.
  const areas: Area[] = [
    { x0: L.nearLeftX, x1: L.nearRightX, z0: L.crossNear, z1: -0.8, along: 'z', share: 1 },
    { x0: L.leftX, x1: L.rightX, z0: L.mainFarZ + 1, z1: L.crossNear, along: 'z', share: 0.55 },
    { x0: L.leftEndX + 0.8, x1: L.leftX, z0: L.crossFar, z1: L.crossNear, along: 'x', share: 0.45 },
    { x0: L.rightX, x1: L.rightEndX - 0.8, z0: L.crossFar, z1: L.crossNear, along: 'x', share: 0.45 },
  ];
  /** Random point in an area; `wall` = hug one of its long walls, `inset` from the walls. */
  const spot = (a: Area, inset: number, wall = false): [number, number] => {
    let x = rng.range(a.x0, a.x1);
    let z = rng.range(a.z0, a.z1);
    if (a.along === 'z') {
      let [l, r] = a === areas[0] ? nearX(z) : [a.x0, a.x1];
      if (wall) [l, r] = rng.chance(0.5) ? [l, l + 0.8] : [r - 0.8, r];
      x = rng.range(l + (wall ? 0.05 : inset), r - (wall ? 0.05 : inset));
    } else {
      let [b, t] = [a.z0, a.z1];
      if (wall) [b, t] = rng.chance(0.5) ? [b, b + 0.8] : [t - 0.8, t];
      z = rng.range(b + (wall ? 0.05 : inset), t - (wall ? 0.05 : inset));
    }
    return [x, z];
  };
  const count = (n: number, a: Area): number => Math.round(n * a.share);

  for (const a of areas) {
    // stains (decals)
    for (let i = 0; i < count(C.stains, a); i++) {
      const s = rng.range(0.6, 1.8);
      const m = new Mesh(new PlaneGeometry(s, s * rng.range(0.6, 1.2)), M.stain);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rng.range(0, Math.PI * 2);
      const [x, z] = spot(a, 0.4);
      m.position.set(x, 0.003, z);
      g.add(m);
    }
    // puddles: low-poly blobs with a shiny dark material that catches the lamps
    for (let i = 0; i < count(C.puddles, a); i++) {
      const geo = new CircleGeometry(1, 9);
      const pos = geo.getAttribute('position');
      for (let k = 1; k < pos.count; k++) {
        const j = rng.range(0.65, 1.15);
        pos.setXY(k, pos.getX(k) * j, pos.getY(k) * j);
      }
      const m = new Mesh(geo, M.puddle);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rng.range(0, Math.PI * 2);
      m.scale.set(rng.range(0.35, 0.9), rng.range(0.25, 0.6), 1);
      const [x, z] = spot(a, 0.6);
      // keep the area right in front of the camera clear
      if (a === areas[0] && z > -3) continue;
      m.position.set(x, 0.006, z);
      g.add(m);
    }
    // cans
    const canGeo = new CylinderGeometry(0.033, 0.033, 0.12, 6);
    const canColors = [0x8a1e1a, 0x9a9a92, 0x2a6a32, 0x2a3a8a];
    for (let i = 0; i < count(C.cans, a); i++) {
      const m = new Mesh(canGeo, M.lam(null, rng.pick(canColors)));
      m.rotation.set(0, rng.range(0, Math.PI * 2), Math.PI / 2, 'YXZ');
      const [x, z] = spot(a, 0.2);
      m.position.set(x, 0.033, z);
      g.add(m);
    }
  }

  // paper scraps and leaves, mostly along the walls
  const scrapGeo = new PlaneGeometry(1, 1);
  scrapGeo.rotateX(-Math.PI / 2);
  const total = areas.reduce((s, a) => s + count(C.scraps, a), 0);
  const scraps = new InstancedMesh(scrapGeo, M.trash, total);
  const palette = ['#d8d4c4', '#b9b3a0', '#a83224', '#c8a838', '#3a5a9a', '#6a4a2a', '#4a6a2a', '#8a2a5a', '#e0e0d8'].map(
    (h) => new Color(h),
  );
  const dummy = new Object3D();
  let n = 0;
  for (const a of areas) {
    for (let i = 0; i < count(C.scraps, a); i++, n++) {
      const [x, z] = spot(a, 0.3, rng.chance(0.6));
      dummy.position.set(x, 0.008 + n * 0.00002, z);
      dummy.rotation.set(rng.range(-0.08, 0.08), rng.range(0, Math.PI * 2), rng.range(-0.08, 0.08));
      const s = rng.range(0.05, 0.2);
      dummy.scale.set(s, 1, s * rng.range(0.5, 1.4));
      dummy.updateMatrix();
      scraps.setMatrixAt(n, dummy.matrix);
      scraps.setColorAt(n, rng.pick(palette));
    }
  }
  g.add(scraps);

  // bin bags against the walls (20-face blobs, very PS1)
  const bagSpots: [number, number][] = [
    [L.nearLeftX + 0.35, mL(-4.5)],
    [L.nearRightX - 0.35, mR(-9.1)],
    [L.rightX - 0.35, mR(-17.3)],
    [L.rightX - 0.45, mR(-17.9)],
    // the new streets
    [L.leftX - 3.5, L.crossNear - 0.4],
    [L.rightX + 4.5, L.crossFar + 0.4],
    [L.rightX + 5.0, L.crossFar + 0.45],
    [L.leftX + 0.4, L.crossFar - 3.5],
  ];
  for (const [x, z] of bagSpots.slice(0, C.bags + 4)) {
    const r = rng.range(0.26, 0.36);
    const m = new Mesh(new IcosahedronGeometry(r, 0), M.bag);
    m.scale.set(1, rng.range(0.7, 0.95), rng.range(0.8, 1.1));
    m.rotation.set(rng.range(-0.3, 0.3), rng.range(0, Math.PI), rng.range(-0.3, 0.3));
    m.position.set(x, r * 0.7, z);
    g.add(m);
  }

  // a couple of soggy boxes round the far-left corner
  for (const [x, z, s] of [
    [L.leftX - 1.0, L.crossFar + 0.45, 0.55],
    [L.leftX - 1.6, L.crossFar + 0.4, 0.4],
  ] as [number, number, number][]) {
    const m = new Mesh(new BoxGeometry(s, s * 0.7, s * 0.8), M.cardboard);
    m.position.set(x, (s * 0.7) / 2, z);
    m.rotation.y = rng.range(-0.4, 0.4);
    g.add(m);
  }

  return g;
}
