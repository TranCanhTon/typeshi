// Placeholder pistol in the lower right (boxes only, GAME_SPEC rule 3).
// Recoil, muzzle flash, tracer and jam come in M2.

import { BoxGeometry, Group, Mesh, MeshLambertMaterial, type PerspectiveCamera } from 'three';
import { ps1ify } from './ps1Material';

export function createGun(camera: PerspectiveCamera): Group {
  const gun = new Group();
  const metal = ps1ify(new MeshLambertMaterial({ color: 0x2a2826, emissive: 0x16110c }));
  const grip = ps1ify(new MeshLambertMaterial({ color: 0x3a2618, emissive: 0x120a05 }));
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, mat: MeshLambertMaterial, rx = 0): void => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    gun.add(m);
  };
  part(0.05, 0.055, 0.26, 0, 0, 0, metal); // slide
  part(0.03, 0.03, 0.06, 0, -0.005, -0.15, metal); // muzzle
  part(0.045, 0.13, 0.06, 0, -0.085, 0.09, grip, -0.25); // grip
  part(0.012, 0.035, 0.05, 0, -0.045, 0.03, metal); // trigger guard
  gun.scale.setScalar(0.55);
  gun.position.set(0.15, -0.135, -0.36);
  gun.rotation.set(0.05, 0.1, 0);
  camera.add(gun);
  return gun;
}
