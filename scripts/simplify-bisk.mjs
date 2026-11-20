// Build public/assets/models/bisk_lod.glb from bisk.glb (Bisk by Rahi_IV, CC BY 4.0).
//
//  1. Bake every mesh into world space (the original nests several transforms).
//  2. Tone the model down (Ton's call): flatten the chest bulge on the body and
//     jacket, and turn the exposed cleavage into a dark top by giving those skin
//     triangles the jacket's black material.
//  3. Simplify each part to a triangle budget with meshoptimizer (113k -> ~5k;
//     most of the original is 92k tris of hair curves).
//
// Run: npm run simplify:bisk

import { NodeIO } from '@gltf-transform/core';
import { dedup, flatten, prune, simplifyPrimitive, transformPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = 'public/assets/models/bisk.glb';
const OUT = 'public/assets/models/bisk_lod.glb';

/** Triangle budget per material in the finished model. */
const BUDGET = { Skin: 2000, Hair: 900, jeans: 800, Jacket: 700, Horn: 250, Tooth: 150, Dona: 150, Eyes: 80 };

/** The chest, in world space (model is ~3.75 tall, faces +z). */
const CHEST = {
  y0: 2.32, // band where the bulge is
  y1: 2.98,
  plane: 0.24, // front of the torso without the bulge (z)
  keep: 0.3, // how much of the bulge in front of that plane is kept
  coverX: 0.45, // half width of the dark top
  coverZ: 0.12, // skin in front of this (in the band) becomes the top
  ringX: 0.3, // the gold ring at the centre of the chest is removed (bracelets kept)
};
/** Push the jacket out along its normals so simplified skin doesn't poke through it. */
const JACKET_INFLATE = 0.02;

function triCount(prim) {
  const idx = prim.getIndices();
  return (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
}

/** Smooth 0..1..0 window across the chest band. */
function bandWeight(y) {
  if (y <= CHEST.y0 || y >= CHEST.y1) return 0;
  const t = (y - CHEST.y0) / (CHEST.y1 - CHEST.y0);
  return Math.sin(Math.PI * t) ** 0.6;
}

await MeshoptSimplifier.ready;
const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();
const before = root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + triCount(p), 0);

// 1. world space
await doc.transform(flatten(), dedup());
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) transformPrimitive(prim, node.getWorldMatrix());
  node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
}

// 2. tone down
const jacket = root.listMaterials().find((m) => m.getName() === 'Jacket');
let flattened = 0;
let covered = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of [...mesh.listPrimitives()]) {
    const name = prim.getMaterial()?.getName();
    // the gold ring that sat on the chest: drop its triangles (keep the bracelets)
    if (name === 'Dona' && prim.getIndices()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const keep = [];
      const p = [0, 0, 0];
      for (let t = 0; t < idx.getCount(); t += 3) {
        let x = 0;
        let y = 0;
        for (let k = 0; k < 3; k++) {
          pos.getElement(idx.getScalar(t + k), p);
          x += p[0] / 3;
          y += p[1] / 3;
        }
        if (!(Math.abs(x) < CHEST.ringX && y > CHEST.y0 - 0.1 && y < CHEST.y1 + 0.1)) keep.push(idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2));
      }
      idx.setArray(new (idx.getArray().constructor)(keep));
      continue;
    }
    if (name !== 'Skin' && name !== 'Jacket') continue;
    const pos = prim.getAttribute('POSITION');
    const v = [0, 0, 0];
    if (name === 'Jacket') {
      const nor = prim.getAttribute('NORMAL');
      const n = [0, 0, 0];
      if (nor) {
        // Some exports flip normals inward: check which way they point on average
        // (away from the sleeve/torso centre line = outward) and push that way.
        let outward = 0;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          nor.getElement(i, n);
          outward += n[0] * v[0] + n[2] * (v[2] + 0.05);
        }
        const sign = outward >= 0 ? 1 : -1;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          nor.getElement(i, n);
          const d = JACKET_INFLATE * sign;
          pos.setElement(i, [v[0] + n[0] * d, v[1] + n[1] * d, v[2] + n[2] * d]);
        }
        console.log('jacket normals point ' + (sign > 0 ? 'outward' : 'inward (flipped for the push)'));
      }
    }
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const w = bandWeight(v[1]);
      if (w > 0 && v[2] > CHEST.plane && Math.abs(v[0]) < 0.7) {
        const flat = CHEST.plane + (v[2] - CHEST.plane) * CHEST.keep;
        v[2] = v[2] + (flat - v[2]) * w;
        pos.setElement(i, v);
        flattened++;
      }
    }
    // the cleavage: skin triangles at the front of the chest band move to the jacket material
    const idx = prim.getIndices();
    if (name !== 'Skin' || !idx || !jacket) continue;
    const keep = [];
    const cover = [];
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const c = [0, 0, 0];
    for (let t = 0; t < idx.getCount(); t += 3) {
      const i0 = idx.getScalar(t);
      const i1 = idx.getScalar(t + 1);
      const i2 = idx.getScalar(t + 2);
      pos.getElement(i0, a);
      pos.getElement(i1, b);
      pos.getElement(i2, c);
      const x = (a[0] + b[0] + c[0]) / 3;
      const y = (a[1] + b[1] + c[1]) / 3;
      const z = (a[2] + b[2] + c[2]) / 3;
      const inTop = y > CHEST.y0 - 0.06 && y < CHEST.y1 + 0.02 && z > CHEST.coverZ && Math.abs(x) < CHEST.coverX;
      (inTop ? cover : keep).push(i0, i1, i2);
    }
    if (cover.length === 0) continue;
    covered += cover.length / 3;
    const Arr = idx.getArray().constructor;
    idx.setArray(new Arr(keep));
    const top = doc
      .createPrimitive()
      .setMaterial(jacket)
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Arr(cover)).setBuffer(idx.getBuffer()));
    for (const sem of prim.listSemantics()) top.setAttribute(sem, prim.getAttribute(sem));
    mesh.addPrimitive(top);
  }
}

// 3. simplify to budget
await doc.transform(weld());
const perMaterial = {};
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const n = prim.getMaterial()?.getName() ?? '?';
    perMaterial[n] = (perMaterial[n] ?? 0) + triCount(prim);
  }
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const n = prim.getMaterial()?.getName() ?? '?';
    const budget = BUDGET[n] ?? 100;
    const ratio = Math.min(1, budget / perMaterial[n]);
    if (ratio < 1) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.02 });
  }
}
await doc.transform(prune());

const after = root.listMeshes().flatMap((m) => m.listPrimitives());
const byMat = {};
for (const p of after) {
  const n = p.getMaterial()?.getName() ?? '?';
  byMat[n] = (byMat[n] ?? 0) + triCount(p);
}
await io.write(OUT, doc);
const total = Object.values(byMat).reduce((s, x) => s + x, 0);
console.log(`bisk: ${Math.round(before)} -> ${Math.round(total)} tris (flattened ${flattened} chest vertices, ${covered} skin tris now a dark top)`);
console.log('per material:', JSON.stringify(Object.fromEntries(Object.entries(byMat).map(([k, v]) => [k, Math.round(v)]))));
