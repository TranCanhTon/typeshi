// Zombie visuals. Reads positions from the game state each frame and reacts
// to game events; never changes game state itself.
//
//  * walker: Free Zombies pack (Denys Almaral): ten rigged zombies on two
//    skeletons. Each spawn picks a random zombie and one of four walk styles
//    at a random speed. The pack has no hit or death animations, so the hit
//    is a procedural lean back and the death a stagger and topple backward.
//  * runner: low_poly_zombie_dog.glb (no rig): a procedural gallop (bob,
//    rock, sway), flinch on hit, flops onto its side on death.
//  * bisk: bisk_lod.glb (no rig): shuffles to its stop point, a scripted
//    lunge (scale up, lean in) before each spit, topples backward on death.
//  * blob: Bisk's spit, a glowing green ball that arcs at the camera. Bursts
//    when its word is typed; vanishes into the screen when it hits.
//  * hunter: zombie_blind_hunter.glb (no rig): a procedural lurch (sway,
//    bob, lean), a shudder and knock back on hit, topples backward on death.

import {
  BackSide,
  SkinnedMesh,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  AdditiveBlending,
  Group,
  IcosahedronGeometry,
  LoadingManager,
  MeshBasicMaterial,
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

type Skeleton = 'Female' | 'Male';

interface WalkerVariant extends Template {
  name: string;
  skeleton: Skeleton;
}

interface WalkClip {
  clip: AnimationClip;
  /** Ground speed (m/s) the feet match at timeScale 1. */
  groundSpeed: number;
}

/** A static model centred on its footprint (the dog's origin is at its head). */
interface CenteredTemplate extends Template {
  /** Model-space centre of the footprint, to offset so it turns about its middle. */
  cx: number;
  cz: number;
}

export interface ZombieAssets {
  walkers: WalkerVariant[];
  /** Walk styles per skeleton type. */
  walks: Record<Skeleton, WalkClip[]>;
  hunter: Template;
  runner: CenteredTemplate;
  bisk: Template;
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

function centered(scene: Object3D, height: number): CenteredTemplate {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  return {
    scene,
    clips: [],
    ...normalise(scene, height),
    cx: (box.min.x + box.max.x) / 2,
    cz: (box.min.z + box.max.z) / 2,
  };
}

/** Keep only tracks that point at bones this rig actually has (no "no target node" warnings). */
function fitClip(clip: AnimationClip, rig: Object3D): AnimationClip {
  const names = new Set<string>();
  rig.traverse((o) => names.add(o.name));
  const out = clip.clone();
  out.tracks = out.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))));
  return out;
}

export async function loadZombieAssets(): Promise<ZombieAssets> {
  const M = G.walker.model;
  // The rigs ask for "zcolors.png" next to themselves; it's in the Textures folder.
  const manager = new LoadingManager();
  manager.setURLModifier((url) => (url.endsWith('/zcolors.png') ? M.base + M.texture : url));
  const loader = new GLTFLoader(manager);
  const skeletonOf = (name: string): Skeleton => (name.startsWith('ZombieFemale') ? 'Female' : 'Male');

  const [rigs, walkFiles, h, dog, bisk] = await Promise.all([
    Promise.all(M.variants.map((v) => loader.loadAsync(`${M.base}rig-gltf_joined/${v}_joined.gltf`))),
    Promise.all(
      (['Female', 'Male'] as Skeleton[]).flatMap((sk) =>
        M.walks.map(async (w) => ({
          sk,
          groundSpeed: w.groundSpeed,
          clip: (await loader.loadAsync(`${M.base}animations-gltf/gltf_Zombie${sk}/Zombie${sk}@${w.file}.gltf`)).animations[0],
        })),
      ),
    ),
    loader.loadAsync('/assets/models/zombie_blind_hunter.glb'),
    loader.loadAsync(G.runner.model),
    loader.loadAsync(G.bisk.model),
  ]);

  const walkers: WalkerVariant[] = rigs.map((r, i) => {
    convertMaterials(r.scene);
    return { name: M.variants[i], skeleton: skeletonOf(M.variants[i]), scene: r.scene, clips: [], ...normalise(r.scene, G.walker.height) };
  });
  // fit each walk clip to its skeleton type once (all rigs of a type share bone names)
  const walks: Record<Skeleton, WalkClip[]> = { Female: [], Male: [] };
  for (const w of walkFiles) {
    const rig = walkers.find((v) => v.skeleton === w.sk)!.scene;
    walks[w.sk].push({ clip: fitClip(w.clip, rig), groundSpeed: w.groundSpeed });
  }
  convertMaterials(h.scene);
  convertMaterials(dog.scene);
  convertMaterials(bisk.scene);
  return {
    walkers,
    walks,
    hunter: { scene: h.scene, clips: [], ...normalise(h.scene, G.hunter.height) },
    runner: centered(dog.scene, G.runner.height),
    bisk: { scene: bisk.scene, clips: [], ...normalise(bisk.scene, G.bisk.height) },
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

  /** World position of the head, where the label's stem ends. */
  headAnchor(out: Vector3): Vector3 {
    return out.set(this.root.position.x, Math.max(0.2, this.height - 0.05 + this.root.position.y), this.root.position.z);
  }

  // --- Lock outline -------------------------------------------------------------
  // The locked zombie gets a bright outline in the lock colour: a copy of each
  // mesh, pushed out along its normals and drawn back faces only (the classic
  // inverted hull). Built the first time the zombie is locked.
  private outlines: Mesh[] = [];
  private outlined = false;

  setLocked(on: boolean): void {
    if (on === this.outlined) return;
    this.outlined = on;
    if (on && this.outlines.length === 0) this.buildOutline();
    for (const o of this.outlines) o.visible = on;
  }

  private buildOutline(): void {
    const meshes: Mesh[] = [];
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    this.root.updateMatrixWorld(true);
    const ws = new Vector3();
    for (const m of meshes) {
      // thickness in the mesh's own units, so it's the same in metres on every model
      const scale = m.getWorldScale(ws).x || 1;
      const mat = outlineMaterial(CONFIG.labels.lockOutline / scale);
      let o: Mesh;
      if ((m as SkinnedMesh).isSkinnedMesh) {
        const sm = m as SkinnedMesh;
        o = new SkinnedMesh(sm.geometry, mat);
        (o as SkinnedMesh).bind(sm.skeleton, sm.bindMatrix);
      } else {
        o = new Mesh(m.geometry, mat);
      }
      o.position.copy(m.position);
      o.quaternion.copy(m.quaternion);
      o.scale.copy(m.scale);
      o.frustumCulled = false;
      m.parent?.add(o);
      this.outlines.push(o);
    }
  }

  abstract update(z: Zombie | null, dt: number): void;
  abstract hit(): void;
  /** Bisk only: start the spit lunge. */
  lunge(): void {}
  /** Blob only: it hit you, gone at once. */
  splat(): void {
    this.dead = true;
  }
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/** Back-face shell pushed out along the normals by `thickness` (mesh units), in the lock colour. */
function outlineMaterial(thickness: number): MeshBasicMaterial {
  const m = ps1ify(new MeshBasicMaterial({ color: CONFIG.labels.lockColor, side: BackSide }));
  const ps1 = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    ps1.call(m, shader, renderer);
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uOutline;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize( normal ) * uOutline;');
  };
  m.customProgramCacheKey = () => 'dk-ps1-outline';
  return m;
}

class RunnerView extends ZombieView {
  private pivot = new Group();
  private phase: number;
  private flinch = 0;
  private speedRatio = 1;

  constructor(z: Zombie, t: CenteredTemplate, rng: Rng) {
    const R = G.runner;
    const size = 1 + rng.range(-R.sizeJitter, R.sizeJitter);
    super(z, R.height * size);
    const model = t.scene.clone(true);
    const k = t.baseScale * size;
    model.scale.multiplyScalar(k);
    model.position.set(-t.cx * k, t.baseY * size, -t.cz * k);
    tint(model, rng, R.tintJitter);
    this.pivot.add(model);
    this.root.add(this.pivot);
    this.phase = rng.range(0, Math.PI * 2);
  }

  hit(): void {
    if (!this.dying) this.flinch = 1;
  }

  update(z: Zombie | null, dt: number): void {
    const R = G.runner;
    if (z && !this.dying) {
      this.follow(z, dt);
      this.speedRatio = z.speed / R.speed;
    }
    if (!this.dying) {
      // gallop: a bound per stride, the body rocking nose-down and up
      const r = Math.min(1.2, this.speedRatio);
      this.phase += dt * Math.PI * 2 * R.gallop.strideRate * Math.max(0.15, r);
      this.flinch = Math.max(0, this.flinch - dt * 4);
      this.pivot.position.y = Math.abs(Math.sin(this.phase)) * R.gallop.bob * r;
      this.pivot.rotation.x = Math.sin(this.phase) * R.gallop.rock * r - this.flinch * 0.3;
      this.pivot.rotation.z = Math.cos(this.phase * 0.5) * R.gallop.sway * r;
      this.pivot.position.z = -this.flinch * 0.15;
    } else {
      // flop onto its side
      const t = ease(Math.min(1, this.deathTime / R.deathTime));
      this.pivot.rotation.z = (Math.PI / 2) * t;
      this.pivot.rotation.x *= 0.85;
      this.pivot.position.y = Math.max(0, this.pivot.position.y - dt);
      this.updateCorpse(dt);
    }
  }

  labelAnchor(out: Vector3): Vector3 {
    return out.set(this.root.position.x, this.height + 0.35, this.root.position.z);
  }

  /** The dog's head is at the front of its body, not over its middle. */
  headAnchor(out: Vector3): Vector3 {
    const reach = this.height * 0.55;
    return out.set(
      this.root.position.x + Math.sin(this.heading) * reach,
      this.height * 0.95 + this.root.position.y,
      this.root.position.z + Math.cos(this.heading) * reach,
    );
  }
}

class BiskView extends ZombieView {
  private pivot = new Group();
  private phase: number;
  private shudder = 0;
  private speedRatio = 1;
  /** Seconds since the lunge started (-1 = not lunging). */
  private lungeT = -1;
  private rng: Rng;

  constructor(z: Zombie, t: Template, rng: Rng) {
    const B = G.bisk;
    const size = 1 + rng.range(-B.sizeJitter, B.sizeJitter);
    super(z, B.height * size);
    this.rng = rng;
    const model = t.scene.clone(true);
    model.scale.multiplyScalar(t.baseScale * size);
    model.position.y = t.baseY * size;
    this.pivot.add(model);
    this.root.add(this.pivot);
    this.phase = rng.range(0, Math.PI * 2);
  }

  hit(): void {
    if (!this.dying) this.shudder = 1;
  }

  lunge(): void {
    if (!this.dying) this.lungeT = 0;
  }

  update(z: Zombie | null, dt: number): void {
    const B = G.bisk;
    const S = B.spit;
    if (z && !this.dying) {
      this.follow(z, dt);
      this.speedRatio = z.speed / B.speed;
    }
    if (!this.dying) {
      const r = Math.min(1, this.speedRatio);
      // shuffle while moving; a slow menacing sway when standing
      this.phase += dt * Math.PI * (B.shuffle.stepRate * Math.max(0.35, r));
      this.shudder = Math.max(0, this.shudder - dt * 4);
      let lean = 0;
      let grow = 0;
      if (this.lungeT >= 0) {
        this.lungeT += dt;
        const back = 0.35;
        const k = this.lungeT < S.windup ? ease(this.lungeT / S.windup) : 1 - Math.min(1, (this.lungeT - S.windup) / back);
        lean = S.lungeLean * k;
        grow = S.lungeScale * k;
        if (this.lungeT > S.windup + back) this.lungeT = -1;
      }
      const jitter = (this.rng.next() - 0.5) * this.shudder * 0.08;
      this.pivot.rotation.z = Math.sin(this.phase) * B.shuffle.sway * (0.4 + 0.6 * r) + jitter;
      this.pivot.rotation.x = lean - this.shudder * 0.12;
      this.pivot.position.y = Math.abs(Math.sin(this.phase)) * B.shuffle.bob * r;
      this.pivot.scale.setScalar(1 + grow);
    } else {
      const t = Math.min(1, this.deathTime / 0.9);
      this.pivot.rotation.x = (-Math.PI / 2) * t * t;
      this.pivot.rotation.z *= 0.9;
      this.pivot.scale.setScalar(1);
      this.updateCorpse(dt);
    }
  }
}

const BLOB_CORE = new IcosahedronGeometry(0.15, 0);
const BLOB_SHELL = new IcosahedronGeometry(0.27, 1);

class BlobView extends ZombieView {
  private core: Mesh;
  private shell: Mesh;
  private burst = -1;
  private spin = 0;

  constructor(z: Zombie) {
    super(z, 0.3);
    this.core = new Mesh(BLOB_CORE, ps1ify(new MeshBasicMaterial({ color: 0x9dff4a })));
    this.shell = new Mesh(
      BLOB_SHELL,
      ps1ify(new MeshBasicMaterial({ color: 0x3aff18, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false })),
    );
    this.root.add(this.core, this.shell);
    this.place(z);
  }

  private place(z: Zombie): void {
    const S = G.bisk.spit;
    const t = z.flight ?? 0;
    const y = S.launchHeight + (S.arriveHeight - S.launchHeight) * t + Math.sin(Math.PI * t) * 0.35;
    this.root.position.set(z.x, y, z.z);
  }

  hit(): void {
    this.shell.scale.setScalar(1.35);
  }

  die(): void {
    // broken: a quick green burst
    this.dying = true;
    this.burst = 0;
  }

  update(z: Zombie | null, dt: number): void {
    this.spin += dt * 9;
    this.core.rotation.set(this.spin, this.spin * 0.7, 0);
    this.shell.rotation.set(-this.spin * 0.5, this.spin, 0);
    this.shell.scale.setScalar(Math.max(1, this.shell.scale.x - dt * 3) * (1 + Math.sin(this.spin * 1.7) * 0.06));
    if (z && !this.dying) this.place(z);
    if (this.burst >= 0) {
      this.burst += dt;
      const k = this.burst / 0.2;
      this.root.scale.setScalar(1 + k * 2.5);
      (this.shell.material as MeshBasicMaterial).opacity = 0.35 * (1 - k);
      this.core.visible = false;
      if (k >= 1) this.dead = true;
    }
  }

  labelAnchor(out: Vector3): Vector3 {
    return out.set(this.root.position.x, this.root.position.y + 0.3, this.root.position.z);
  }

  headAnchor(out: Vector3): Vector3 {
    return out.copy(this.root.position);
  }
}

class WalkerView extends ZombieView {
  /** Pivot at the feet for the hit lean and the death topple. */
  private pivot = new Group();
  private mixer: AnimationMixer;
  private walk: AnimationAction;
  private groundSpeed: number;
  private animRate: number;
  private flinch = 0;
  private shakeSeed = 0;
  private rng: Rng;

  /** Which of the ten zombies this is (for debugging). */
  readonly variant: string;

  constructor(z: Zombie, assets: ZombieAssets, rng: Rng) {
    const W = G.walker;
    const size = 1 + rng.range(-W.sizeJitter, W.sizeJitter);
    super(z, W.height * size);
    this.rng = rng;
    const t = rng.pick(assets.walkers);
    this.variant = t.name;
    const model = cloneSkinned(t.scene);
    model.scale.multiplyScalar(t.baseScale * size);
    model.position.y = t.baseY * size;
    tint(model, rng, W.tintJitter);
    this.pivot.add(model);
    this.root.add(this.pivot);

    this.mixer = new AnimationMixer(model);
    const style = rng.pick(assets.walks[t.skeleton]);
    this.groundSpeed = style.groundSpeed;
    this.walk = this.mixer.clipAction(style.clip);
    this.walk.time = rng.range(0, style.clip.duration); // out of sync with the others
    this.walk.play();
    this.animRate = 1 + rng.range(-W.animJitter, W.animJitter);
  }

  hit(): void {
    if (this.dying) return;
    this.flinch = 1;
    this.shakeSeed = this.rng.range(-1, 1);
  }

  update(z: Zombie | null, dt: number): void {
    const W = G.walker;
    if (z && !this.dying) {
      this.follow(z, dt);
      // match the walk cycle to the actual speed (slows show up as a stagger)
      const [lo, hi] = W.model.timeScaleRange;
      this.walk.timeScale = Math.min(hi, Math.max(lo, z.speed / this.groundSpeed)) * this.animRate;
    }
    if (!this.dying) {
      // hit: lean back and get knocked back a little, easing out
      this.flinch = Math.max(0, this.flinch - dt / W.hit.time);
      const f = this.flinch * this.flinch;
      this.pivot.rotation.x = -W.hit.lean * f;
      this.pivot.rotation.z = W.hit.shake * f * this.shakeSeed;
      this.pivot.position.z = -W.hit.knock * f;
    } else {
      // death: the walk winds down, a small stagger, then a topple backward
      this.walk.timeScale = Math.max(0, this.walk.timeScale - (dt / W.death.freezeTime) * Math.max(1, this.walk.timeScale));
      const t = Math.min(1, this.deathTime / W.death.toppleTime);
      const ease = t * t * (3 - 2 * t);
      this.pivot.rotation.x = -(Math.PI / 2) * ease;
      this.pivot.rotation.z = Math.sin(t * Math.PI) * 0.12 * (this.shakeSeed || 1);
      this.pivot.position.z = -0.25 * ease;
      this.updateCorpse(dt);
    }
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
        const v = this.makeView(e.zombie);
        this.views.set(e.zombie.id, v);
        this.group.add(v.root);
        break;
      }
      case 'lunge':
        this.views.get(e.id)?.lunge();
        break;
      case 'blinded':
        this.views.get(e.id)?.splat();
        break;
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
      v.setLocked(id === game.lockedId && !v.dying);
      v.update(byId.get(id) ?? null, dt);
      if (v.dead) {
        this.group.remove(v.root);
        this.views.delete(id);
      }
    }
  }

  private makeView(z: Zombie): ZombieView {
    switch (z.kind) {
      case 'hunter':
        return new HunterView(z, this.assets.hunter, this.rng);
      case 'runner':
        return new RunnerView(z, this.assets.runner, this.rng);
      case 'bisk':
        return new BiskView(z, this.assets.bisk, this.rng);
      case 'blob':
        return new BlobView(z);
      default:
        return new WalkerView(z, this.assets, this.rng);
    }
  }

  labelAnchor(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    return v ? v.labelAnchor(out) : null;
  }

  headAnchor(id: number, out: Vector3): Vector3 | null {
    const v = this.views.get(id);
    return v ? v.headAnchor(out) : null;
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
    const fake = (kind: Zombie['kind']): Zombie => ({
      id: -1, kind, word: 'x', typed: 0, x: 0, z: -6, path: [], baseSpeed: 1, speed: 1,
      slowTimer: 0, street: 'straight', lateral: 0, laneX: 0, travelled: 0, emerged: false, labelled: false, labelledAt: 0,
    });
    const views = (['walker', 'hunter', 'runner', 'bisk', 'blob'] as const).map((k) => this.makeView(fake(k)));
    for (const v of views) this.group.add(v.root);
    views[0].setLocked(true);
    compile();
    views[0].setLocked(false);
    for (const v of views) this.group.remove(v.root);
  }
}
