// Zombie visuals. Reads positions from the game state each frame and reacts
// to game events; never changes game state itself.
//
//  * walker: zombie_rinono.glb (rigged): walk01/walk02 at random speeds,
//    `damage` blended in on each hit, `death` on kill.
//  * hunter: zombie_blind_hunter.glb (no rig): a procedural lurch (sway,
//    bob, lean), a shudder and knock back on hit, topples backward on death.

import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  Group,
  LoopOnce,
  type Material,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  type Object3D,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CONFIG } from '../config';
import type { Game, GameEvent, Zombie } from '../game/game';
import type { Rng } from '../game/rng';
import { ps1ify } from './ps1Material';

const G = CONFIG.game;
const ZOMBIE_TEXTURE_SIZE = 128;
/** How long a corpse stays before sinking away (s). */
const CORPSE_TIME = 2.8;
const SINK_TIME = 1.2;

interface Template {
  scene: Object3D;
  clips: AnimationClip[];
  /** Scale and y offset that make the model `height` tall with feet at y = 0. */
  baseScale: number;
  baseY: number;
}

export interface ZombieAssets {
  walker: Template;
  hunter: Template;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** Downscale a model texture to PS1 size with nearest filtering (GAME_SPEC 8b). */
function crunchTexture(tex: Texture | null): Texture | null {
  if (!tex?.image) return tex;
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = c.height = ZOMBIE_TEXTURE_SIZE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const t = new CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = SRGBColorSpace;
  t.magFilter = t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  return t;
}

/** Swap the glTF PBR materials for PS1-patched Lambert so zombies sit in the same fog and light. */
function convertMaterials(root: Object3D): void {
  const cache = new Map<Material, Material>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false; // skinned bounds don't follow the animation
    const convert = (src: Material): Material => {
      let out = cache.get(src);
      if (!out) {
        const s = src as Material & { map?: Texture | null; color?: Color };
        out = ps1ify(new MeshLambertMaterial({ map: crunchTexture(s.map ?? null), color: s.color?.clone() ?? new Color(1, 1, 1) }));
        cache.set(src, out);
      }
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(convert) : convert(m.material);
  });
}

function normalise(scene: Object3D, height: number): { baseScale: number; baseY: number } {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const baseScale = height / (box.max.y - box.min.y);
  return { baseScale, baseY: -box.min.y * baseScale };
}

export async function loadZombieAssets(): Promise<ZombieAssets> {
  const loader = new GLTFLoader();
  const [w, h] = await Promise.all([
    loader.loadAsync('/assets/models/zombie_rinono.glb'),
    loader.loadAsync('/assets/models/zombie_blind_hunter.glb'),
  ]);
  convertMaterials(w.scene);
  convertMaterials(h.scene);
  return {
    walker: { scene: w.scene, clips: w.animations, ...normalise(w.scene, G.walker.height) },
    hunter: { scene: h.scene, clips: [], ...normalise(h.scene, G.hunter.height) },
  };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Clone materials so each zombie gets its own slight tint. */
function tint(root: Object3D, rng: Rng, amount: number): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const recolor = (mat: Material): Material => {
      const c = mat.clone() as MeshLambertMaterial;
      c.onBeforeCompile = mat.onBeforeCompile;
      c.customProgramCacheKey = mat.customProgramCacheKey;
      const k = 1 - amount * 0.5 + rng.range(0, amount);
      c.color.setRGB(
        c.color.r * k * rng.range(1 - amount * 0.4, 1 + amount * 0.4),
        c.color.g * k * rng.range(1 - amount * 0.4, 1 + amount * 0.4),
        c.color.b * k * rng.range(1 - amount * 0.4, 1 + amount * 0.4),
      );
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(recolor) : recolor(m.material);
  });
}

abstract class ZombieView {
  /** Positioned at the zombie's feet, rotated to face its walking direction. */
  readonly root = new Group();
  dying = false;
  dead = false;
  protected deathTime = 0;
  protected heading = 0;
  private lastX: number;
  private lastZ: number;

  constructor(z: Zombie, readonly height: number) {
    this.root.position.set(z.x, 0, z.z);
    // start out facing along the path, so there's no snap on the first step
    const next = z.path[0];
    if (next) this.heading = Math.atan2(next.x - z.x, next.z - z.z);
    this.root.rotation.y = this.heading;
    this.lastX = z.x;
    this.lastZ = z.z;
  }

  /** Follow the logic position; turn smoothly toward the walking direction. */
  follow(z: Zombie, dt: number): void {
    const dx = z.x - this.lastX;
    const dz = z.z - this.lastZ;
    if (dx * dx + dz * dz > 1e-8) {
      const target = Math.atan2(dx, dz);
      let diff = target - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, dt * 5);
    }
    this.lastX = z.x;
    this.lastZ = z.z;
    this.root.position.x = z.x;
    this.root.position.z = z.z;
    this.root.rotation.y = this.heading;
  }

  die(): void {
    this.dying = true;
    this.deathTime = 0;
  }

  /** After the corpse time, sink into the floor and report finished. */
  protected updateCorpse(dt: number): void {
    this.deathTime += dt;
    const sink = this.deathTime - CORPSE_TIME;
    if (sink > 0) this.root.position.y = -Math.min(1, sink / SINK_TIME) * this.height * 0.6;
    if (sink > SINK_TIME) this.dead = true;
  }

  /** World position for the word label. */
  labelAnchor(out: Vector3): Vector3 {
    return out.set(this.root.position.x, this.height + 0.25, this.root.position.z);
  }

  abstract update(z: Zombie | null, dt: number): void;
  abstract hit(): void;
}

class WalkerView extends ZombieView {
  private mixer: AnimationMixer;
  private walk: AnimationAction;
  private damage: AnimationAction | null;
  private death: AnimationAction | null;
  private animRate: number;
  private damageTimer = 0;

  constructor(z: Zombie, t: Template, rng: Rng) {
    const size = 1 + rng.range(-G.walker.sizeJitter, G.walker.sizeJitter);
    super(z, G.walker.height * size);
    const model = cloneSkinned(t.scene);
    model.scale.multiplyScalar(t.baseScale * size);
    model.position.y = t.baseY * size;
    tint(model, rng, G.walker.tintJitter);
    this.root.add(model);

    this.mixer = new AnimationMixer(model);
    const clip = (name: string): AnimationClip | undefined => t.clips.find((c) => c.name === name);
    const walkClip = clip(rng.chance(0.5) ? 'walk01' : 'walk02') ?? clip('walk01') ?? t.clips[0];
    this.walk = this.mixer.clipAction(walkClip);
    this.walk.time = rng.range(0, walkClip.duration); // out of sync with the others
    this.walk.play();
    this.animRate = 1 + rng.range(-G.walker.animJitter, G.walker.animJitter);

    const dmg = clip('damage');
    this.damage = dmg ? this.mixer.clipAction(dmg) : null;
    if (this.damage) {
      this.damage.setLoop(LoopOnce, 1);
    }
    const dth = clip('death');
    this.death = dth ? this.mixer.clipAction(dth) : null;
    if (this.death) {
      this.death.setLoop(LoopOnce, 1);
      this.death.clampWhenFinished = true;
    }
  }

  hit(): void {
    if (!this.damage || this.dying) return;
    // a short flinch: blend the start of the damage clip over the walk
    this.damage.reset().setEffectiveWeight(1).fadeIn(0.05).play();
    this.damageTimer = 0.32;
  }

  die(): void {
    super.die();
    this.damage?.fadeOut(0.1);
    if (this.death) {
      this.death.reset().play();
      this.walk.crossFadeTo(this.death, 0.15, false);
    } else {
      this.walk.stop();
    }
  }

  update(z: Zombie | null, dt: number): void {
    if (z && !this.dying) {
      this.follow(z, dt);
      // match the walk cycle to the actual speed (slows show up as a stagger)
      this.walk.timeScale = (z.speed / G.walker.animSpeed) * this.animRate;
    }
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) this.damage?.fadeOut(0.2);
    }
    if (this.dying) this.updateCorpse(dt);
    this.mixer.update(dt);
  }
}

class HunterView extends ZombieView {
  /** Pivot at the feet for sway and the death topple. */
  private pivot = new Group();
  private phase: number;
  private shudder = 0;
  private knock = 0;
  private speedRatio = 1;
  private rng: Rng;

  constructor(z: Zombie, t: Template, rng: Rng) {
    const size = 1 + rng.range(-G.hunter.sizeJitter, G.hunter.sizeJitter);
    super(z, G.hunter.height * size);
    this.rng = rng;
    const model = t.scene.clone(true);
    model.scale.multiplyScalar(t.baseScale * size);
    model.position.y = t.baseY * size;
    tint(model, rng, 0.1);
    this.pivot.add(model);
    this.root.add(this.pivot);
    this.phase = rng.range(0, Math.PI * 2);
  }

  hit(): void {
    if (this.dying) return;
    this.shudder = 1;
    this.knock = 1;
  }

  update(z: Zombie | null, dt: number): void {
    const H = G.hunter;
    if (z && !this.dying) {
      this.follow(z, dt);
      this.speedRatio = z.speed / H.speed;
    }
    if (!this.dying) {
      // heavy, uneven stomp: one sway per two steps, bob on every step
      this.phase += dt * Math.PI * H.stepRate * Math.max(0.25, this.speedRatio);
      const s = Math.sin(this.phase);
      const bob = Math.abs(Math.sin(this.phase)) * H.bob;
      this.shudder = Math.max(0, this.shudder - dt * 4);
      this.knock = Math.max(0, this.knock - dt * 5);
      const jitter = this.shudder * 0.06;
      this.pivot.rotation.z = s * H.sway + (this.rng.next() - 0.5) * jitter;
      this.pivot.rotation.x = H.lean - this.knock * 0.18 + (this.rng.next() - 0.5) * jitter;
      this.pivot.position.y = bob;
      this.pivot.position.z = -this.knock * 0.12;
    } else {
      // topple backward with an ease in, then lie still
      const t = Math.min(1, this.deathTime / 0.9);
      this.pivot.rotation.x = H.lean + (-Math.PI / 2 - H.lean) * t * t;
      this.pivot.rotation.z *= 0.9;
      this.pivot.position.y = Math.max(0, this.pivot.position.y - dt);
      this.updateCorpse(dt);
    }
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class ZombieRenderer {
  readonly group = new Group();
  private views = new Map<number, ZombieView>();

  constructor(private assets: ZombieAssets, private rng: Rng) {
    this.group.name = 'zombies';
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'spawn': {
        const v =
          e.zombie.kind === 'hunter'
            ? new HunterView(e.zombie, this.assets.hunter, this.rng)
            : new WalkerView(e.zombie, this.assets.walker, this.rng);
        this.views.set(e.zombie.id, v);
        this.group.add(v.root);
        break;
      }
      case 'shot':
        this.views.get(e.id)?.hit();
        break;
      case 'kill':
        this.views.get(e.id)?.die();
        break;
    }
  }

  update(game: Game, dt: number): void {
    const byId = new Map(game.zombies.map((z) => [z.id, z]));
    for (const [id, v] of this.views) {
      v.update(byId.get(id) ?? null, dt);
      if (v.dead) {
        this.group.remove(v.root);
        this.views.delete(id);
      }
    }
  }

  labelAnchor(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    return v ? v.labelAnchor(out) : null;
  }

  clear(): void {
    for (const v of this.views.values()) this.group.remove(v.root);
    this.views.clear();
  }

  /**
   * Compile the zombie shaders up front. Otherwise the first walker and the
   * first hunter each freeze the game for a moment while their shaders build.
   */
  warmup(compile: () => void): void {
    const fake = (kind: 'walker' | 'hunter'): Zombie => ({
      id: -1, kind, word: 'x', typed: 0, x: 0, z: -6, path: [], baseSpeed: 1, speed: 1,
      slowTimer: 0, street: 'straight', lateral: 0, laneX: 0, travelled: 0, emerged: false, labelled: false, labelledAt: 0,
    });
    const views = [
      new WalkerView(fake('walker'), this.assets.walker, this.rng),
      new HunterView(fake('hunter'), this.assets.hunter, this.rng),
    ];
    for (const v of views) this.group.add(v.root);
    compile();
    for (const v of views) this.group.remove(v.root);
  }
}
