// Sodium lamps: a fixture, a glowing bulb, a point light, and the data the
// fog shader needs to make the air around each lamp glow. One lamp flickers.
// Positions come from the street layout (game/layout.ts): wall lamps along
// the streets, and one hanging over the crossing on cables.

import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PointLight, Vector3 } from 'three';
import { CONFIG, type LookSettings } from '../config';
import type { LampSpec, StreetLayout } from '../game/layout';
import type { Rng } from '../game/rng';
import { ps1ify, ps1Uniforms } from './ps1Material';

const BULB_CORE = new Color(0xffe0b0);

interface Lamp {
  spec: LampSpec;
  light: PointLight;
  bulbMat: MeshBasicMaterial;
  /** Current flicker multiplier 0..1. */
  level: number;
}

export class Lamps {
  readonly group = new Group();
  private lamps: Lamp[] = [];
  private color = new Color();
  private fixtureMat = ps1ify(new MeshBasicMaterial({ color: 0x1a1714 }));
  private cableMat = ps1ify(new MeshBasicMaterial({ color: 0x0c0b0a }));
  private flickerTimer = 0;
  private burstLeft = 0;
  private holdLeft = 0;
  private holdLevel = 1;

  constructor(private rng: Rng, private look: LookSettings, layout: StreetLayout) {
    this.setLayout(layout);
  }

  /** (Re)build every lamp for a layout. The lamp count never changes, so shaders don't recompile. */
  setLayout(layout: StreetLayout): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    for (const l of this.lamps) l.bulbMat.dispose();
    this.lamps = [];

    layout.lamps.forEach((spec, i) => {
      const bulbPos = new Vector3(spec.x, spec.y, spec.z);
      const bulbMat = ps1ify(new MeshBasicMaterial({ color: 0xffffff }));
      const fixture = new Group();
      const head = new Mesh(new BoxGeometry(0.34, 0.1, 0.26), this.fixtureMat);
      const bulb = new Mesh(new BoxGeometry(0.22, 0.04, 0.14), bulbMat);
      head.position.set(0, 0.06, 0);
      fixture.add(head, bulb);
      fixture.position.copy(bulbPos);
      let lightPos: Vector3;

      if (spec.normal) {
        // wall lamp: an arm back to the wall; built facing +z, then turned to face the normal
        const n = new Vector3(spec.normal.x, 0, spec.normal.z);
        const armLen = spec.wallDist + 0.1;
        const arm = new Mesh(new BoxGeometry(0.05, 0.05, armLen), this.fixtureMat);
        arm.position.set(0, 0.12, -armLen / 2 + 0.05);
        fixture.add(arm);
        fixture.lookAt(bulbPos.clone().add(n));
        lightPos = bulbPos.clone().addScaledVector(n, 0.15).add(new Vector3(0, -0.2, 0));
      } else {
        // hanging lamp: a short drop, and cables up to the corner buildings
        const drop = new Mesh(new BoxGeometry(0.04, 0.5, 0.04), this.cableMat);
        drop.position.set(0, 0.36, 0);
        fixture.add(drop);
        for (const c of spec.cables ?? []) {
          const from = bulbPos.clone().add(new Vector3(0, 0.6, 0));
          const to = new Vector3(c.x, c.y, c.z);
          const len = from.distanceTo(to);
          const cable = new Mesh(new BoxGeometry(0.025, 0.025, len), this.cableMat);
          cable.position.copy(from).add(to).multiplyScalar(0.5);
          cable.lookAt(to);
          this.group.add(cable);
        }
        lightPos = bulbPos.clone().add(new Vector3(0, -0.25, 0));
      }
      this.group.add(fixture);

      const light = new PointLight(0xffffff, 1, 10, 2);
      light.position.copy(lightPos);
      this.group.add(light);

      ps1Uniforms.uLampPos.value[i].copy(bulbPos).add(new Vector3(0, -0.15, 0));
      this.lamps.push({ spec, light, bulbMat, level: 1 });
    });
    this.applyLook();
  }

  /** Re-read the live look settings and the crossing lamp intensity (called by the debug panel). */
  applyLook(): void {
    const L = this.look.lamps;
    this.color.set(L.color);
    for (const lamp of this.lamps) lamp.light.distance = L.range;
    this.refresh();
  }

  private intensityOf(lamp: Lamp): number {
    return lamp.spec.crossing ? CONFIG.layout.crossingLampIntensity : this.look.lamps.intensity;
  }

  update(dt: number): void {
    const L = this.look.lamps;
    const idx = L.flickerLamp;
    if (idx >= 0 && idx < this.lamps.length) {
      // A failing sodium tube: steady most of the time, then a burst of
      // stutters where it drops out for a few frames.
      if (this.burstLeft > 0) {
        this.burstLeft -= dt;
        this.holdLeft -= dt;
        if (this.holdLeft <= 0) {
          this.holdLeft = this.rng.range(0.03, 0.12);
          this.holdLevel = this.rng.chance(0.55) ? 1 - L.flickerDepth * this.rng.range(0.7, 1) : this.rng.range(0.85, 1);
        }
        this.lamps[idx].level = this.holdLevel;
      } else {
        this.flickerTimer -= dt;
        // a faint hum in the light even when steady
        this.lamps[idx].level = 1 - 0.03 * this.rng.next();
        if (this.flickerTimer <= 0) {
          this.burstLeft = this.rng.range(0.15, 0.9);
          this.flickerTimer = this.rng.range(0.4, 2) * L.flickerInterval;
          this.holdLeft = 0;
        }
      }
      for (let i = 0; i < this.lamps.length; i++) if (i !== idx) this.lamps[i].level = 1;
    } else {
      for (const lamp of this.lamps) lamp.level = 1;
    }
    this.refresh();
  }

  private refresh(): void {
    this.lamps.forEach((lamp, i) => {
      const intensity = this.intensityOf(lamp);
      lamp.light.color.copy(this.color);
      lamp.light.intensity = intensity * lamp.level;
      // bulb: bright, slightly whiter core than the light it throws
      lamp.bulbMat.color.copy(this.color).lerp(BULB_CORE, 0.35).multiplyScalar(0.15 + 0.85 * lamp.level);
      ps1Uniforms.uLampColor.value[i].copy(this.color).multiplyScalar(intensity * lamp.level);
    });
  }

  /** Lamp contribution at a point (used by the dust motes). */
  glowAt(p: Vector3, radius: number, out: Color): Color {
    out.setRGB(0, 0, 0);
    const r2 = radius * radius;
    this.lamps.forEach((lamp) => {
      const d2 = p.distanceToSquared(lamp.light.position);
      const k = Math.exp(-d2 / r2) * lamp.level;
      out.r += this.color.r * k;
      out.g += this.color.g * k;
      out.b += this.color.b * k;
    });
    return out;
  }
}
