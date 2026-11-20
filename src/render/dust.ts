// Floating dust motes that only show up where the lamps light them.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { CONFIG, type LookSettings } from '../config';
import type { Rng } from '../game/rng';
import type { StreetLayout } from '../game/layout';
import type { Lamps } from './lamps';

/** Where motes float: the main alley from the camera to just past the crossing (set from the layout). */
const BOX = { x0: CONFIG.alley.leftX + 0.1, x1: CONFIG.alley.rightX - 0.1, y0: 0.1, y1: 6.5, z0: -20, z1: 1.2 };
const GLOW_RADIUS = 2.6;

export class Dust {
  readonly points: Points;
  private geo = new BufferGeometry();
  private mat: PointsMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private phase: Float32Array;
  private time = 0;
  private tmpV = new Vector3();
  private tmpC = new Color();
  private max: number;

  constructor(private rng: Rng, private look: LookSettings, private lamps: Lamps, layout: StreetLayout) {
    Dust.fitBox(layout);
    this.max = 2000;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.phase = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) this.respawn(i, true);
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.mat = new PointsMaterial({
      size: look.dust.size,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.applyLook(1);
  }

  private static fitBox(L: StreetLayout): void {
    BOX.x0 = L.leftX + 0.1;
    BOX.x1 = L.rightX - 0.1;
    BOX.z0 = L.crossFar - 2;
  }

  /** Move the motes into a new layout. */
  setLayout(L: StreetLayout): void {
    Dust.fitBox(L);
    for (let i = 0; i < this.max; i++) this.respawn(i, true);
  }

  private respawn(i: number, anywhere: boolean): void {
    const r = this.rng;
    this.pos[i * 3] = r.range(BOX.x0, BOX.x1);
    this.pos[i * 3 + 1] = anywhere ? r.range(BOX.y0, BOX.y1) : BOX.y1;
    this.pos[i * 3 + 2] = r.range(BOX.z0, BOX.z1);
    this.phase[i] = r.range(0, Math.PI * 2);
  }

  /** `pixelScale` = low res height / canvas height, since three sizes points in canvas pixels. */
  applyLook(pixelScale: number): void {
    this.mat.size = this.look.dust.size * pixelScale;
    this.geo.setDrawRange(0, Math.min(this.max, Math.round(this.look.dust.count)));
  }

  update(dt: number): void {
    this.time += dt;
    const D = this.look.dust;
    const n = Math.min(this.max, Math.round(D.count));
    const t = this.time;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const ph = this.phase[i];
      this.pos[o] += Math.sin(t * 0.31 + ph) * D.drift * dt;
      this.pos[o + 1] += (Math.sin(t * 0.23 + ph * 1.7) * 0.6 - 0.25) * D.drift * dt;
      this.pos[o + 2] += Math.cos(t * 0.27 + ph * 0.6) * D.drift * dt;
      if (this.pos[o + 1] < BOX.y0) this.respawn(i, false);
      this.tmpV.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
      this.lamps.glowAt(this.tmpV, GLOW_RADIUS, this.tmpC);
      const twinkle = 0.6 + 0.4 * Math.sin(t * 2.1 + ph * 5);
      const k = D.brightness * twinkle;
      this.col[o] = this.tmpC.r * k;
      this.col[o + 1] = this.tmpC.g * k;
      this.col[o + 2] = this.tmpC.b * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
