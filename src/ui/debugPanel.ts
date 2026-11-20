// Debug panel: live sliders over CONFIG.look and a few CONFIG.game values,
// plus "copy values" which prints them in the same shape as src/config.ts so
// they can be pasted straight back.

import GUI from 'lil-gui';
import type { GameConfig, LookSettings } from '../config';
import type { LayoutConfig } from '../game/layout';

export interface LayoutPanel {
  layout: LayoutConfig;
  /** Rebuild the streets (called when a size slider is released, not while dragging). */
  onLayout: () => void;
  /** Re-read lamp settings (crossing lamp intensity). */
  onLamp: () => void;
}

export function createDebugPanel(look: LookSettings, onChange: () => void, game?: GameConfig, streets?: LayoutPanel): GUI {
  const gui = new GUI({ title: 'Dead Keys: tuning' });
  const ch = (): void => onChange();

  if (streets) {
    const L = streets.layout;
    const rebuild = (): void => streets.onLayout();
    const f = gui.addFolder('Layout (crossroads)');
    f.add(L, 'mainAlleyLength', 20, 90, 1).name('main alley length (m)').onFinishChange(rebuild);
    f.add(L, 'crossingDistance', 8, 40, 0.5).name('player → crossing (m)').onFinishChange(rebuild);
    f.add(L, 'sideStreetLength', 4, 40, 1).name('side street length (m)').onFinishChange(rebuild);
    f.add(L, 'sideStreetWidth', 2.4, 8, 0.1).name('side street width (m)').onFinishChange(rebuild);
    f.add(L, 'crossingLampIntensity', 0, 150, 0.5).name('crossing lamp intensity').onChange(() => streets.onLamp());
    f.add(L.spawnWeights, 'left', 0, 5, 0.1).name('spawn weight: left');
    f.add(L.spawnWeights, 'straight', 0, 5, 0.1).name('spawn weight: straight');
    f.add(L.spawnWeights, 'right', 0, 5, 0.1).name('spawn weight: right');
  }

  if (game) {
    // These write straight into CONFIG.game; the running game reads it every tick.
    const g = gui.addFolder('Gameplay');
    g.add(game, 'labelDistance', 4, 30, 0.5).name('label distance (m)');
    g.add(game.spacing, 'depth', 0, 6, 0.1).name('spacing front-back (m)');
    g.add(game.spacing, 'side', 0, 2.4, 0.05).name('spacing sideways (m)');

    // The wave formula (applies from the next spawn / next wave).
    const w = gui.addFolder('Waves');
    const W = game.waves;
    w.add(W.first, 'size', 1, 30, 1).name('wave 1 zombies');
    w.add(W.first, 'interval', 0.3, 6, 0.05).name('wave 1 spawn every (s)');
    w.add(W.first, 'maxAlive', 1, 12, 1).name('wave 1 max alive');
    w.add(W.ramp, 'sizePerWave', 0, 10, 1).name('+ zombies per wave');
    w.add(W.ramp, 'intervalFactor', 0.7, 1, 0.01).name('interval x per wave');
    w.add(W.ramp, 'intervalMin', 0.2, 3, 0.05).name('interval floor (s)');
    w.add(W.ramp, 'maxAliveEvery', 1, 10, 1).name('+1 max alive every N waves');
    w.add(W.ramp, 'maxAliveCap', 1, 20, 1).name('max alive cap');
    w.add(W.ramp, 'speedFactor', 1, 1.2, 0.005).name('speed x per wave');
    w.add(W.ramp, 'speedMax', 1, 3, 0.05).name('speed cap');
    w.add(W, 'introTime', 0.5, 6, 0.1).name('banner time (s)');
    w.add(W, 'breakTime', 0, 10, 0.5).name('break after wave (s)');
    w.close();
  }

  const r = gui.addFolder('Render');
  r.add(look.render, 'width', 160, 1920, 2).name('render width (px)').onChange(ch);
  r.add(look.ps1, 'ditherStrength', 0, 2, 0.05).name('dithering').onChange(ch);
  r.add(look.ps1, 'colorDepth', 2, 256, 1).name('color depth (levels)').onChange(ch);
  r.add(look.ps1, 'vertexSnap', 0, 6, 0.1).name('vertex snap (px)').onChange(ch);
  r.add(look.ps1, 'affineWarp', 0, 1, 0.05).name('affine warp').onChange(ch);
  r.add(look.ps1, 'textureSize', [16, 32, 64, 128]).name('texture size').onChange(ch);

  const f = gui.addFolder('Fog');
  f.add(look.fog, 'density', 0, 0.15, 0.001).name('density').onChange(ch);
  f.addColor(look.fog, 'nearColor').name('near color').onChange(ch);
  f.addColor(look.fog, 'farColor').name('far color').onChange(ch);
  f.add(look.fog, 'colorDistance', 1, 80, 0.5).name('near→far distance').onChange(ch);
  f.add(look.fog, 'lampGlow', 0, 0.02, 0.0001).name('lamp glow in fog').onChange(ch);
  f.add(look.fog, 'lampGlowRadius', 0.2, 12, 0.1).name('glow radius / haze (m)').onChange(ch);

  const l = gui.addFolder('Lamps');
  l.addColor(look.lamps, 'color').name('lamp color').onChange(ch);
  l.add(look.lamps, 'intensity', 0, 150, 0.5).name('lamp intensity').onChange(ch);
  l.add(look.lamps, 'range', 2, 40, 0.5).name('lamp range (m)').onChange(ch);
  l.add(look.lamps, 'flickerLamp', -1, 2, 1).name('flicker lamp (-1 off)').onChange(ch);
  l.add(look.lamps, 'flickerDepth', 0, 1, 0.05).name('flicker depth').onChange(ch);
  l.add(look.lamps, 'flickerInterval', 0.2, 10, 0.1).name('flicker interval (s)').onChange(ch);

  const a = gui.addFolder('Ambient');
  a.addColor(look.ambient, 'color').name('ambient color').onChange(ch);
  a.add(look.ambient, 'intensity', 0, 5, 0.01).name('ambient light').onChange(ch);

  const c = gui.addFolder('Camera');
  c.add(look.camera, 'height', 0.5, 3, 0.01).name('camera height (m)').onChange(ch);
  c.add(look.camera, 'fov', 30, 110, 1).name('FOV (vertical °)').onChange(ch);
  c.add(look.camera, 'sway', 0, 0.08, 0.001).name('idle sway').onChange(ch);
  c.add(look.camera, 'swaySpeed', 0, 2, 0.01).name('sway speed').onChange(ch);

  const d = gui.addFolder('Dust');
  d.add(look.dust, 'count', 0, 2000, 10).name('count').onChange(ch);
  d.add(look.dust, 'size', 0.005, 0.12, 0.001).name('size (m)').onChange(ch);
  d.add(look.dust, 'brightness', 0, 5, 0.05).name('brightness').onChange(ch);
  d.add(look.dust, 'drift', 0, 0.5, 0.01).name('drift speed').onChange(ch);
  d.close();

  gui.add({ copy: () => copyValues(look, game, streets?.layout) }, 'copy').name('📋 copy values');
  return gui;
}

function toTs(name: string, value: unknown): string {
  return `${name}: ${JSON.stringify(value, null, 2).replace(/"(\w+)":/g, '$1:').replace(/"/g, "'")},`;
}

function copyValues(look: LookSettings, game?: GameConfig, layout?: LayoutConfig): void {
  const blocks = [toTs('look', look)];
  if (layout) blocks.push(toTs('layout', layout));
  if (game) blocks.push(toTs('game', game));
  const text = blocks.join('\n\n');
  console.log(text);
  navigator.clipboard?.writeText(text).catch(() => undefined);
  showOverlay(text);
}

function showOverlay(text: string): void {
  document.getElementById('dk-copy')?.remove();
  const box = document.createElement('div');
  box.id = 'dk-copy';
  box.innerHTML = `<div class="dk-copy-head">Copied to clipboard (also in the console). Paste this to Claude for config.ts.
    <button type="button">close</button></div>`;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  box.appendChild(ta);
  box.querySelector('button')!.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
  ta.select();
}
