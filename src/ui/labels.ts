// Word labels: plain HTML at full screen resolution, on top of the retro
// render, so the words stay sharp (GAME_SPEC section 8, Readability).
//
// A zombie has no label until the game marks it `labelled` (within
// CONFIG.game.labelDistance). Then the label pops in, fully sharp.
//
// Layout, so labels never jump around:
//  * Stable order: labels are ordered by distance (closest first), but the
//    order only changes after the new order has held for `reorderDelay`.
//  * Stacking: the locked target's label is placed first, right over its
//    zombie, and never moves for anyone. Then the others, closest first,
//    each sitting on its own zombie unless that overlaps a label already
//    placed, in which case it stacks above. Closest = lowest, drawn on top.
//  * Hysteresis: a label already pushed up keeps a wider side margin, so it
//    doesn't flick in and out of the stack as zombies drift sideways.
//  * Smoothing: labels slide toward their spot instead of snapping there.
//  * Whole pixels only: positions are rounded so text stays crisp.
//
// Which word is which zombie:
//  * Every label has a thin stem from its bottom centre to its own zombie's
//    head, angled if needed, so it points at the right body even when stacked.
//  * A small type marker before the word: none for walkers, a colour each for
//    runner, Bisk and its blob, and the Hunter (CONFIG.labels.markers).
//  * (The locked zombie also gets an outline in the lock colour: render/zombies.ts.)

import { type Camera, Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Game, GameEvent, ZombieKind } from '../game/game';

const TYPO_FLASH_MS = 280;
const L = CONFIG.labels;

interface Label {
  id: number;
  el: HTMLDivElement;
  stem: HTMLDivElement;
  letters: HTMLSpanElement[];
  typed: number;
  locked: boolean;
  w: number;
  h: number;
  /** Current top-left position (px, smoothed). */
  x: number;
  y: number;
  fresh: boolean;
  pushed: boolean;
}

interface Placement {
  l: Label;
  /** Screen point just above the zombie's head, where the label's bottom centre sits. */
  ax: number;
  ay: number;
  /** Screen point of the zombie's head, where the stem ends. */
  hx: number;
  hy: number;
  dist: number;
}

export class WordLabels {
  private root: HTMLDivElement;
  private labels = new Map<number, Label>();
  /** Stable draw/stack order, closest first. */
  private order: number[] = [];
  private mismatchTime = 0;
  private v = new Vector3();
  private h = new Vector3();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dk-labels';
    const css = this.root.style;
    css.setProperty('--dk-label-size', `${L.fontSize}px`);
    css.setProperty('--dk-pop-scale', String(L.popScale));
    css.setProperty('--dk-pop-ms', `${L.popMs}ms`);
    css.setProperty('--dk-typed', L.lockColor);
    css.setProperty('--dk-stem', L.stemColor);
    css.setProperty('--dk-marker-size', `${L.markerSize}px`);
    for (const [k, c] of Object.entries(L.markers)) css.setProperty(`--dk-mark-${k}`, c);
    parent.appendChild(this.root);
  }

  onEvent(e: GameEvent): void {
    if (e.type === 'typo' && e.id !== null) {
      const l = this.labels.get(e.id);
      const span = l?.letters[l.typed];
      if (span) {
        span.classList.remove('err');
        void span.offsetWidth; // restart the flash
        span.classList.add('err');
        setTimeout(() => span.classList.remove('err'), TYPO_FLASH_MS);
      }
    } else if (e.type === 'kill') {
      this.remove(e.id);
    }
  }

  update(
    game: Game,
    camera: Camera,
    anchor: (id: number, out: Vector3) => Vector3 | null,
    head: (id: number, out: Vector3) => Vector3 | null,
    width: number,
    height: number,
    dt: number,
  ): void {
    const items = new Map<number, Placement>();
    for (const z of game.zombies) {
      if (!z.labelled) continue;
      const p = anchor(z.id, this.v);
      if (!p) continue;
      const dist = camera.position.distanceTo(p);
      const hp = head(z.id, this.h) ?? this.h.copy(p);
      p.project(camera);
      hp.project(camera);
      if (p.z > 1) continue; // behind the camera
      const l = this.labels.get(z.id) ?? this.create(z.id, z.word, z.kind);

      if (l.typed !== z.typed) {
        l.letters.forEach((s, i) => s.classList.toggle('t', i < z.typed));
        l.typed = z.typed;
      }
      const locked = game.lockedId === z.id;
      if (locked !== l.locked) {
        l.el.classList.toggle('locked', locked);
        l.locked = locked;
      }
      items.set(z.id, {
        l,
        ax: (p.x * 0.5 + 0.5) * width,
        ay: (-p.y * 0.5 + 0.5) * height,
        hx: (hp.x * 0.5 + 0.5) * width,
        hy: (-hp.y * 0.5 + 0.5) * height,
        dist,
      });
    }
    for (const id of [...this.labels.keys()]) if (!items.has(id)) this.remove(id);

    this.updateOrder(items, dt);
    this.layout(items, dt);
  }

  /** Freeze the label CSS animations (pop, typo flash) while paused. */
  setPaused(paused: boolean): void {
    this.root.classList.toggle('paused', paused);
  }

  private blind = -1;
  /** Blinded by spit: blur and fade the labels too, but keep them faintly readable. */
  setBlind(level: number): void {
    const l = Math.round(level * 50) / 50;
    if (l === this.blind) return;
    this.blind = l;
    const B = CONFIG.game.bisk.blind;
    this.root.style.filter = l > 0 ? `blur(${(B.labelBlur * l).toFixed(2)}px)` : '';
    this.root.style.opacity = l > 0 ? String(1 - B.labelFade * l) : '';
  }

  clear(): void {
    for (const id of [...this.labels.keys()]) this.remove(id);
    this.order = [];
    this.mismatchTime = 0;
  }

  /** Re-measure label sizes (call after the label font has loaded). */
  remeasure(): void {
    for (const l of this.labels.values()) this.measure(l);
  }

  // -------------------------------------------------------------------------

  /** Keep `order` stable; adopt the true distance order only after it has held a while. */
  private updateOrder(items: Map<number, Placement>, dt: number): void {
    this.order = this.order.filter((id) => items.has(id));
    // New labels slot in at their distance position right away.
    for (const [id, it] of items) {
      if (this.order.includes(id)) continue;
      const at = this.order.findIndex((o) => items.get(o)!.dist > it.dist);
      if (at < 0) this.order.push(id);
      else this.order.splice(at, 0, id);
    }
    const desired = [...this.order].sort((a, b) => items.get(a)!.dist - items.get(b)!.dist);
    const same = desired.every((id, i) => id === this.order[i]);
    if (same) {
      this.mismatchTime = 0;
    } else {
      this.mismatchTime += dt;
      if (this.mismatchTime >= L.reorderDelay) {
        this.order = desired;
        this.mismatchTime = 0;
      }
    }
  }

  private layout(items: Map<number, Placement>, dt: number): void {
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const lockedId = [...items.values()].find((it) => it.l.locked)?.l.id;
    const sequence = lockedId !== undefined ? [lockedId, ...this.order.filter((id) => id !== lockedId)] : this.order;
    const k = 1 - Math.exp(-dt * L.smoothing);

    sequence.forEach((id, rank) => {
      const it = items.get(id)!;
      const l = it.l;
      const x0 = it.ax - l.w / 2;
      const x1 = it.ax + l.w / 2;
      let bottom = it.ay;
      if (!l.locked) {
        const margin = L.gap + (l.pushed ? L.stackHysteresis : 0);
        for (let pass = 0; pass < sequence.length; pass++) {
          const hit = placed.find(
            (r) => x0 < r.x1 + margin && x1 > r.x0 - margin && bottom - l.h < r.y1 + L.gap && bottom > r.y0 - L.gap,
          );
          if (!hit) break;
          bottom = hit.y0 - L.gap;
        }
      }
      l.pushed = it.ay - bottom > 0.5;
      placed.push({ x0, x1, y0: bottom - l.h, y1: bottom });

      const tx = x0;
      const ty = bottom - l.h;
      if (l.fresh || l.locked) {
        // new labels appear in place; the locked label stays glued to its zombie
        l.x = tx;
        l.y = ty;
        l.fresh = false;
      } else {
        l.x += (tx - l.x) * k;
        l.y += (ty - l.y) * k;
      }
      const px = Math.round(l.x);
      const py = Math.round(l.y);
      l.el.style.left = `${px}px`;
      l.el.style.top = `${py}px`;
      l.el.style.zIndex = String(l.locked ? 2000 : 1000 - rank);
      this.placeStem(l, px + Math.round(l.w / 2), py + l.h, it.hx, it.hy, rank);
    });
  }

  /** A thin line from the label's bottom centre (sx, sy) to its zombie's head (hx, hy). */
  private placeStem(l: Label, sx: number, sy: number, hx: number, hy: number, rank: number): void {
    const dx = Math.round(hx) - sx;
    const dy = Math.round(hy) - sy;
    const len = Math.round(Math.hypot(dx, dy));
    if (len < 2 || dy <= 0) {
      l.stem.style.display = 'none';
      return;
    }
    const st = l.stem.style;
    st.display = '';
    st.left = `${sx}px`;
    st.top = `${sy}px`;
    st.height = `${len}px`;
    // the stem hangs straight down from its top end, then turns toward the head
    st.transform = `rotate(${(-Math.atan2(dx, dy) * 180) / Math.PI}deg)`;
    // under every label, so labels stay readable; the locked one's stem on top
    st.zIndex = String(l.locked ? 1999 : 100 - Math.min(rank, 99));
    l.stem.classList.toggle('locked', l.locked);
  }

  private create(id: number, word: string, kind: ZombieKind): Label {
    const el = document.createElement('div');
    el.className = `dk-label k-${kind}${kind === 'hunter' ? ' elite' : ''}`;
    const letters = [...word].map((ch) => {
      const s = document.createElement('span');
      s.textContent = ch;
      el.appendChild(s);
      return s;
    });
    const stem = document.createElement('div');
    stem.className = 'dk-stem';
    stem.style.width = `${L.stemWidth}px`;
    stem.style.display = 'none';
    this.root.append(stem, el);
    const l: Label = { id, el, stem, letters, typed: 0, locked: false, w: 0, h: 0, x: 0, y: 0, fresh: true, pushed: false };
    this.measure(l);
    el.classList.add('pop');
    this.labels.set(id, l);
    return l;
  }

  private measure(l: Label): void {
    l.w = l.el.offsetWidth;
    l.h = l.el.offsetHeight;
  }

  private remove(id: number): void {
    const l = this.labels.get(id);
    if (!l) return;
    l.el.remove();
    l.stem.remove();
    this.labels.delete(id);
  }
}
