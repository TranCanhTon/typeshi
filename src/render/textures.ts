// Procedural placeholder textures, drawn on small canvases.
//
// Everything here is generated in code from the seeded RNG. Nothing is cut from
// the reference screenshots. When Ton provides real image textures, swap the
// entries in `createTextureBank` for TextureLoader calls; the rest of the
// renderer only talks to the TextureBank.

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Rng } from '../game/rng';

/** Size every generator draws at. The bank scales copies down to the chosen texture size. */
export const SOURCE_SIZE = 128;

type Ctx = CanvasRenderingContext2D;
type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb(c: RGB, a = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

function jitter(rng: Rng, c: RGB, amt: number): RGB {
  const k = 1 + rng.range(-amt, amt);
  return [c[0] * k, c[1] * k, c[2] * k];
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Tileable 2D value noise, values 0..1. `cells` lattice cells across the texture. */
function valueNoise(rng: Rng, w: number, h: number, cellsX: number, cellsY = cellsX): Float32Array {
  const lat = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cellsY;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const ya = y0 % cellsY;
    const yb = (y0 + 1) % cellsY;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cellsX;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const xa = x0 % cellsX;
      const xb = (x0 + 1) % cellsX;
      const a = lat[ya * cellsX + xa];
      const b = lat[ya * cellsX + xb];
      const c = lat[yb * cellsX + xa];
      const d = lat[yb * cellsX + xb];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Layered value noise, normalised to 0..1. */
function fbm(rng: Rng, w: number, h: number, base = 4, octaves = 4): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  let cells = base;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(rng, w, h, Math.min(cells, w), Math.min(cells, h));
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Run a per-pixel function over the canvas. */
function perPixel(
  ctx: Ctx,
  w: number,
  h: number,
  fn: (i: number, x: number, y: number, px: Uint8ClampedArray) => void,
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(y * w + x, x, y, px);
  ctx.putImageData(img, 0, 0);
}

/** Draw something 9 times offset by the texture size so it wraps seamlessly. */
function wrapDraw(w: number, h: number, draw: (dx: number, dy: number) => void): void {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) draw(dx, dy);
}

function blob(ctx: Ctx, rng: Rng, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.6, 1.25);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * rng.range(0.6, 1.0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Multiply pixels by a noise field plus per-pixel grain. */
function grain(ctx: Ctx, rng: Rng, w: number, h: number, noise: Float32Array, lo: number, hi: number, grainAmt: number): void {
  perPixel(ctx, w, h, (i, _x, _y, px) => {
    const k = lo + (hi - lo) * noise[i] + rng.range(-grainAmt, grainAmt);
    const o = i * 4;
    px[o] *= k;
    px[o + 1] *= k;
    px[o + 2] *= k;
  });
}

// ---------------------------------------------------------------------------
// Generators. Each returns a canvas drawn at SOURCE_SIZE scale.
// ---------------------------------------------------------------------------

export function brickCanvas(rng: Rng): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  const rows = 16;
  const cols = 4;
  const rowH = S / rows;
  const bw = S / cols;
  const mortar = Math.max(1, S / 128);
  ctx.fillStyle = '#4a3f36';
  ctx.fillRect(0, 0, S, S);
  const palette = ['#7d3524', '#8c3d28', '#6c2c20', '#94462e', '#5c271c', '#7a402c', '#6a3326'].map(hex);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let k = -1; k <= cols; k++) {
      const base = rng.chance(0.08) ? hex('#3e2a22') : rng.pick(palette);
      ctx.fillStyle = rgb(jitter(rng, base, 0.12));
      ctx.fillRect(k * bw + off + mortar, r * rowH + mortar, bw - mortar, rowH - mortar);
      // a lighter top edge, a darker bottom edge: reads as relief at low res
      ctx.fillStyle = 'rgba(255,220,190,0.07)';
      ctx.fillRect(k * bw + off + mortar, r * rowH + mortar, bw - mortar, mortar);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(k * bw + off + mortar, (r + 1) * rowH - mortar, bw - mortar, mortar);
    }
  }
  // soot and damp blotches
  const n = fbm(rng, S, S, 4, 4);
  grain(ctx, rng, S, S, n, 0.55, 1.2, 0.07);
  for (let i = 0; i < 5; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(S * 0.06, S * 0.16);
    wrapDraw(S, S, (dx, dy) => blob(ctx, rng, x + dx, y + dy, r, 'rgba(20,14,10,0.18)'));
  }
  return c;
}

export function plasterCanvas(rng: Rng, baseHex: string, variation = 0.35): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, S, S);
  // stains
  for (let i = 0; i < 9; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(S * 0.05, S * 0.2);
    const a = rng.range(0.06, 0.18);
    wrapDraw(S, S, (dx, dy) => blob(ctx, rng, x + dx, y + dy, r, `rgba(40,30,20,${a})`));
  }
  // chipped spots showing brick underneath
  for (let i = 0; i < 3; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(S * 0.02, S * 0.05);
    wrapDraw(S, S, (dx, dy) => blob(ctx, rng, x + dx, y + dy, r, 'rgba(110,55,38,0.85)'));
  }
  // cracks
  ctx.strokeStyle = 'rgba(25,20,15,0.55)';
  ctx.lineWidth = Math.max(1, S / 128);
  for (let i = 0; i < 4; i++) {
    let x = rng.range(0, S);
    let y = rng.range(0, S);
    const pts: [number, number][] = [[x, y]];
    const steps = rng.int(4, 9);
    for (let s = 0; s < steps; s++) {
      x += rng.range(-S * 0.06, S * 0.06);
      y += rng.range(S * 0.01, S * 0.06);
      pts.push([x, y]);
    }
    wrapDraw(S, S, (dx, dy) => {
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(px + dx, py + dy) : ctx.lineTo(px + dx, py + dy)));
      ctx.stroke();
    });
  }
  const n = fbm(rng, S, S, 3, 5);
  grain(ctx, rng, S, S, n, 1 - variation, 1 + variation * 0.4, 0.05);
  return c;
}

export function floorCanvas(rng: Rng): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  const tiles = 4;
  const t = S / tiles;
  const grout = Math.max(1, Math.round(S / 96));
  ctx.fillStyle = '#2e2922';
  ctx.fillRect(0, 0, S, S);
  const stone = hex('#8a7f6b');
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const col = jitter(rng, stone, 0.14);
      ctx.fillStyle = rgb(col);
      ctx.fillRect(x * t + grout, y * t + grout, t - grout, t - grout);
      // subtle bevel
      ctx.fillStyle = 'rgba(255,240,210,0.06)';
      ctx.fillRect(x * t + grout, y * t + grout, t - grout, grout);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x * t + grout, (y + 1) * t - grout, t - grout, grout);
      // a chipped corner now and then
      if (rng.chance(0.3)) {
        ctx.fillStyle = 'rgba(30,26,20,0.7)';
        ctx.fillRect(x * t + grout, y * t + grout, rng.int(2, 5) * grout, rng.int(1, 3) * grout);
      }
    }
  }
  // dark stains
  for (let i = 0; i < 7; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(S * 0.04, S * 0.13);
    const a = rng.range(0.15, 0.4);
    wrapDraw(S, S, (dx, dy) => blob(ctx, rng, x + dx, y + dy, r, `rgba(28,20,12,${a})`));
  }
  // wet patches: darker, slightly cooler
  for (let i = 0; i < 4; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(S * 0.08, S * 0.18);
    wrapDraw(S, S, (dx, dy) => blob(ctx, rng, x + dx, y + dy, r, 'rgba(18,18,20,0.28)'));
  }
  const n = fbm(rng, S, S, 4, 4);
  grain(ctx, rng, S, S, n, 0.7, 1.15, 0.08);
  return c;
}

const GRAFFITI_WORDS = ['DEAD', 'ROTT', 'NOX', 'GHUL', 'KRAW', 'VEXA', 'SKUL', 'MOLD', 'ZEDZ', 'HUSK', 'GRIM', 'RUIN', 'BONE', 'DUSK', 'OKAI', 'NERV'];
const GRAFFITI_COLORS: [string, string][] = [
  ['#d8d0a8', '#2d6a3a'],
  ['#c23b2a', '#f0d040'],
  ['#3b7bc2', '#e8e8e8'],
  ['#e09030', '#5a2a7a'],
  ['#77c044', '#151515'],
  ['#ececec', '#c02020'],
  ['#e8c838', '#1d4fa0'],
  ['#9a5cc8', '#f2f2f2'],
];

/** Draws a chunky outlined graffiti piece into a box on an existing context. */
function drawPiece(ctx: Ctx, rng: Rng, x: number, y: number, w: number, h: number): void {
  const word = rng.pick(GRAFFITI_WORDS);
  const [fill, outline] = rng.pick(GRAFFITI_COLORS);
  const size = Math.min(h * 0.8, (w / word.length) * 1.5);
  ctx.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const letterW = w / (word.length + 0.4);
  const letters = [...word].map((ch, i) => ({
    ch,
    lx: x + letterW * (i + 0.7),
    ly: y + h / 2 + rng.range(-h * 0.1, h * 0.1),
    rot: rng.range(-0.25, 0.25),
    sc: rng.range(0.9, 1.2),
  }));
  const pass = (style: string, lw: number, mode: 'stroke' | 'fill'): void => {
    for (const L of letters) {
      ctx.save();
      ctx.translate(L.lx, L.ly);
      ctx.rotate(L.rot);
      ctx.scale(L.sc, L.sc * 1.15);
      ctx.textAlign = 'center';
      if (mode === 'stroke') {
        ctx.strokeStyle = style;
        ctx.lineWidth = lw;
        ctx.strokeText(L.ch, 0, 0);
      } else {
        ctx.fillStyle = style;
        ctx.fillText(L.ch, 0, 0);
      }
      ctx.restore();
    }
  };
  pass('#0b0b0b', size * 0.34, 'stroke');
  pass(outline, size * 0.18, 'stroke');
  pass(fill, 0, 'fill');
  // drips
  ctx.fillStyle = fill;
  for (let i = 0; i < 4; i++) {
    const L = rng.pick(letters);
    const dx = L.lx + rng.range(-letterW * 0.3, letterW * 0.3);
    ctx.fillRect(dx, L.ly + size * 0.3, Math.max(1, size * 0.05), rng.range(size * 0.2, size * 0.7));
  }
}

/** Thin scribbled tag. */
function drawTag(ctx: Ctx, rng: Rng, x: number, y: number, w: number, h: number): void {
  ctx.strokeStyle = rng.pick(['#e8e8e8', '#111111', '#d03030', '#40a0e0', '#e0c040']);
  ctx.lineWidth = Math.max(1, h * 0.07);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let px = x;
  ctx.moveTo(px, y + h * 0.6);
  const strokes = rng.int(6, 12);
  for (let i = 0; i < strokes; i++) {
    px += w / strokes;
    ctx.lineTo(px - rng.range(0, w / strokes), y + rng.range(0.1, 0.9) * h);
  }
  ctx.lineTo(x + w, y + h * rng.range(0.4, 0.8));
  ctx.stroke();
  // underline swoosh
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.95);
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 1.15, x + w, y + h * 0.85);
  ctx.stroke();
}

/** Transparent graffiti decal, 2:1. */
export function graffitiCanvas(rng: Rng, forcePiece = false): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S * 2, S);
  if (forcePiece || rng.chance(0.75)) {
    drawPiece(ctx, rng, S * 0.1, S * 0.1, S * 1.8, S * 0.75);
  } else {
    drawTag(ctx, rng, S * 0.2, S * 0.25, S * 1.4, S * 0.45);
  }
  if (rng.chance(0.6)) drawTag(ctx, rng, rng.range(0, S * 1.2), rng.range(S * 0.55, S * 0.75), S * 0.6, S * 0.2);
  return c;
}

/** Rusty roll-up shutter, optionally covered in graffiti. Mapped once onto an opening (not tiled). */
export function shutterCanvas(rng: Rng, graffiti: boolean): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#6a6862';
  ctx.fillRect(0, 0, S, S);
  const rib = Math.max(2, Math.round(S / 28));
  for (let y = 0; y < S; y += rib) {
    ctx.fillStyle = 'rgba(200,198,190,0.25)';
    ctx.fillRect(0, y, S, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + rib - 1, S, 1);
  }
  // rust, heavier toward the bottom
  const n = fbm(rng, S, S, 4, 4);
  perPixel(ctx, S, S, (i, _x, y, px) => {
    const rust = clamp((n[i] - 0.55) * 3 + (y / S) * 0.5, 0, 1);
    const o = i * 4;
    px[o] = px[o] * (1 - rust) + 110 * rust;
    px[o + 1] = px[o + 1] * (1 - rust) + 52 * rust;
    px[o + 2] = px[o + 2] * (1 - rust) + 24 * rust;
    const k = 0.8 + n[i] * 0.35 + rng.range(-0.05, 0.05);
    px[o] *= k;
    px[o + 1] *= k;
    px[o + 2] *= k;
  });
  if (graffiti) {
    drawPiece(ctx, rng, S * 0.04, S * 0.12, S * 0.92, S * 0.42);
    drawPiece(ctx, rng, S * 0.08, S * 0.5, S * 0.85, S * 0.3);
    for (let i = 0; i < 3; i++) drawTag(ctx, rng, rng.range(0, S * 0.6), rng.range(S * 0.05, S * 0.85), S * 0.35, S * 0.1);
  }
  // bottom bar and top housing
  ctx.fillStyle = '#26231f';
  ctx.fillRect(0, S - rib * 2, S, rib * 2);
  ctx.fillStyle = '#3a3731';
  ctx.fillRect(0, 0, S, rib * 2);
  // a little grime over everything
  perPixel(ctx, S, S, (_i, _x, y, px) => {
    const k = 1 - Math.pow(y / S, 3) * 0.35;
    px[_i * 4] *= k;
    px[_i * 4 + 1] *= k;
    px[_i * 4 + 2] *= k;
  });
  return c;
}

/** Dark window with a faint frame. `lit` gives a warm interior light. */
export function windowCanvas(rng: Rng, lit: boolean): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  const frame = lit ? '#7c7466' : rgb(jitter(rng, hex('#5d574d'), 0.2));
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, S, S);
  const f = Math.round(S * 0.07);
  const m = Math.max(2, Math.round(S * 0.035));
  if (lit) {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#f2c27a');
    g.addColorStop(1, '#b5772e');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#15171a');
    g.addColorStop(0.5, '#0a0b0d');
    g.addColorStop(1, '#121315');
    ctx.fillStyle = g;
  }
  ctx.fillRect(f, f, S - f * 2, S - f * 2);
  if (lit) {
    // curtain shapes
    ctx.fillStyle = 'rgba(90,40,20,0.55)';
    ctx.fillRect(f, f, S * 0.18, S - f * 2);
    ctx.fillRect(S - f - S * 0.22, f, S * 0.22, S - f * 2);
  } else {
    // faint reflection streak
    ctx.fillStyle = 'rgba(120,110,100,0.12)';
    ctx.beginPath();
    ctx.moveTo(S * 0.25, f);
    ctx.lineTo(S * 0.45, f);
    ctx.lineTo(S * 0.2, S - f);
    ctx.lineTo(f, S - f);
    ctx.closePath();
    ctx.fill();
  }
  // mullions
  ctx.fillStyle = frame;
  ctx.fillRect(S / 2 - m / 2, f, m, S - f * 2);
  ctx.fillRect(f, Math.round(S * 0.38), S - f * 2, m);
  const n = fbm(rng, S, S, 4, 3);
  grain(ctx, rng, S, S, n, 0.75, 1.1, 0.04);
  return c;
}

/** Heavy metal back door. */
export function doorCanvas(rng: Rng): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#3b3a35';
  ctx.fillRect(0, 0, S, S);
  const p = Math.round(S * 0.12);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(1, S / 64);
  ctx.strokeRect(p, p, S - p * 2, S * 0.38);
  ctx.strokeRect(p, S * 0.55, S - p * 2, S * 0.33);
  ctx.fillStyle = '#8a8370';
  ctx.fillRect(S * 0.78, S * 0.5, S * 0.08, S * 0.05);
  drawTag(ctx, rng, S * 0.1, S * 0.6, S * 0.7, S * 0.18);
  const n = fbm(rng, S, S, 4, 4);
  perPixel(ctx, S, S, (i, _x, _y, px) => {
    const rust = clamp((n[i] - 0.6) * 3, 0, 0.8);
    const o = i * 4;
    px[o] = px[o] * (1 - rust) + 95 * rust;
    px[o + 1] = px[o + 1] * (1 - rust) + 45 * rust;
    px[o + 2] = px[o + 2] * (1 - rust) + 22 * rust;
  });
  return c;
}

/**
 * Grime overlay for wall bottoms (RGBA, tiles horizontally).
 * fromTop = false: dirt rising from the ground. fromTop = true: water streaks running down.
 */
export function grimeCanvas(rng: Rng, fromTop: boolean): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#120d09';
  ctx.fillRect(0, 0, S, S);
  const cols = valueNoise(rng, S, 1, 16, 1);
  const fine = valueNoise(rng, S, 1, 64, 1);
  const blot = fbm(rng, S, S, 4, 4);
  perPixel(ctx, S, S, (i, x, y, px) => {
    // t = 0 at the dirty edge, 1 at the clean edge
    const t = fromTop ? y / S : 1 - y / S;
    const reach = fromTop ? 0.25 + cols[x] * 0.75 * fine[x] : 0.35 + cols[x] * 0.45;
    let a = clamp(1 - t / reach, 0, 1);
    a = a * a * (fromTop ? 0.55 : 0.85);
    a *= 0.7 + blot[i] * 0.6;
    px[i * 4 + 3] = clamp(a, 0, 1) * 255;
  });
  return c;
}

/** Dark stain decal for the floor (RGBA, not tiled). */
export function stainCanvas(rng: Rng): HTMLCanvasElement {
  const S = SOURCE_SIZE;
  const { c, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#140e08';
  ctx.fillRect(0, 0, S, S);
  const n = fbm(rng, S, S, 4, 4);
  perPixel(ctx, S, S, (i, x, y, px) => {
    const dx = x / S - 0.5;
    const dy = y / S - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy) * 2;
    const a = clamp((1 - d) * 1.6 - 0.25 + (n[i] - 0.5) * 1.3, 0, 0.75);
    px[i * 4 + 3] = a * 255;
  });
  return c;
}

// ---------------------------------------------------------------------------
// Texture bank: owns the source canvases and rescales them on demand.
// ---------------------------------------------------------------------------

interface Entry {
  source: HTMLCanvasElement;
  texture: CanvasTexture;
}

export class TextureBank {
  private entries: Entry[] = [];

  constructor(private size: number) {}

  /** Wrap a source canvas in a pixelated texture at the bank's current size. */
  add(source: HTMLCanvasElement, repeat: boolean): Texture {
    const texture = new CanvasTexture(this.scaled(source, this.size));
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
    this.entries.push({ source, texture });
    return texture;
  }

  /** Forget and free a texture (one made for a scene that is being rebuilt). */
  remove(texture: Texture): void {
    const i = this.entries.findIndex((e) => e.texture === texture);
    if (i >= 0) this.entries.splice(i, 1);
    texture.dispose();
  }

  /** Change the texture resolution of every texture (spec: "texture downscale" slider). */
  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    for (const e of this.entries) {
      e.texture.dispose();
      e.texture.image = this.scaled(e.source, size);
      e.texture.needsUpdate = true;
    }
  }

  private scaled(source: HTMLCanvasElement, size: number): HTMLCanvasElement {
    const k = size / SOURCE_SIZE;
    if (k === 1) return source;
    const w = Math.max(4, Math.round(source.width * k));
    const h = Math.max(4, Math.round(source.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    return c;
  }
}

/** Every texture the alley uses. Swap generators for loaded images here later. */
export function createTextureBank(rng: Rng, size: number) {
  const bank = new TextureBank(size);
  const r = (label: string): Rng => rng.fork(label);
  const graffitiRng = r('graffiti');
  const shutterRng = r('shutters');
  const textures = {
    brick: bank.add(brickCanvas(r('brick')), true),
    plasterGrey: bank.add(plasterCanvas(r('plasterGrey'), '#7a776e', 0.4), true),
    plasterBeige: bank.add(plasterCanvas(r('plasterBeige'), '#9a8a6c', 0.35), true),
    plasterLight: bank.add(plasterCanvas(r('plasterLight'), '#a49a84', 0.35), true),
    plasterDark: bank.add(plasterCanvas(r('plasterDark'), '#4f5450', 0.45), true),
    stoneTrim: bank.add(plasterCanvas(r('trim'), '#8c7a4c', 0.3), true),
    floor: bank.add(floorCanvas(r('floor')), true),
    grimeBottom: bank.add(grimeCanvas(r('grimeB'), false), true),
    grimeTop: bank.add(grimeCanvas(r('grimeT'), true), true),
    stain: bank.add(stainCanvas(r('stain')), false),
    door: bank.add(doorCanvas(r('door')), false),
    windows: [0, 1, 2].map((i) => bank.add(windowCanvas(r('win' + i), false), false)),
    litWindows: [0, 1].map((i) => bank.add(windowCanvas(r('lit' + i), true), false)),
    /** Fresh graffiti decal each call. `piece` forces a big outlined piece instead of a scribble. */
    graffiti: (piece = false) => bank.add(graffitiCanvas(graffitiRng, piece), false),
    /** Fresh shutter each call so no two look the same. */
    shutter: (graffiti: boolean) => bank.add(shutterCanvas(shutterRng, graffiti), false),
  };
  return { bank, textures };
}

export type AlleyTextures = ReturnType<typeof createTextureBank>['textures'];
