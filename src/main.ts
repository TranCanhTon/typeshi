// Dead Keys: the alley, the game loop, run control (title, pause, results) and audio.

import { AmbientLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { AudioManager } from './audio/audio';
import { CONFIG, currentLayout } from './config';
import { Game, type Mode } from './game/game';
import { createRng } from './game/rng';
import { buildAlley } from './render/alley';
import { Dust } from './render/dust';
import { createGun } from './render/gun';
import { Lamps } from './render/lamps';
import { RetroPost } from './render/post';
import { ps1Uniforms } from './render/ps1Material';
import { createTextureBank } from './render/textures';
import { loadZombieAssets, ZombieRenderer } from './render/zombies';
import { createDebugPanel } from './ui/debugPanel';
import { DebugReadout, Hud, Screens, type PlayerSettings } from './ui/hud';
import { WordLabels } from './ui/labels';
import './ui/style.css';
import { ENGLISH_200, HARD_WORDS } from './words/lists';
import { WordPicker } from './words/picker';

const BEST_KEY = 'deadkeys.best.endless';

// Live, editable copy of the look settings (the debug panel writes into it).
const look = structuredClone(CONFIG.look);
const worldRng = createRng(CONFIG.seed);

// ---------------------------------------------------------------------------
// Player settings (pause menu > Settings), saved in localStorage
// ---------------------------------------------------------------------------

function loadSettings(): PlayerSettings {
  const s: PlayerSettings = { renderWidth: CONFIG.look.render.width, volumes: { ...CONFIG.audio.volume } };
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG.settings.storageKey) ?? 'null') as Partial<PlayerSettings> | null;
    const R = CONFIG.settings.renderWidth;
    if (saved && Number.isFinite(saved.renderWidth)) s.renderWidth = Math.min(R.max, Math.max(R.min, saved.renderWidth!));
    for (const k of ['master', 'sfx', 'ambience'] as const) {
      const v = saved?.volumes?.[k];
      if (Number.isFinite(v)) s.volumes[k] = Math.min(1, Math.max(0, v!));
    }
  } catch {
    /* nothing saved or storage unavailable: defaults */
  }
  return s;
}

function saveSettings(s: PlayerSettings): void {
  try {
    localStorage.setItem(CONFIG.settings.storageKey, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

const settings = loadSettings();
look.render.width = settings.renderWidth;
const audio = new AudioManager(settings.volumes, worldRng.fork('audio'));

const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const app = document.getElementById('app')!;
app.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(look.camera.fov, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);
scene.add(camera);

const { bank, textures } = createTextureBank(worldRng.fork('textures'), look.ps1.textureSize);
let layout = currentLayout();
// Same seed every build, so the streets look the same until the layout changes.
let alley = buildAlley(worldRng.fork('alley'), textures, layout, (t) => bank.remove(t));
scene.add(alley.group);
const ambient = new AmbientLight();
scene.add(ambient);
const lamps = new Lamps(worldRng.fork('lamps'), look, layout);
scene.add(lamps.group);
const dust = new Dust(worldRng.fork('dust'), look, lamps, layout);
scene.add(dust.points);
createGun(camera);

const post = new RetroPost(renderer, scene, camera);
const labels = new WordLabels(app);
const hud = new Hud(app);
const screens = new Screens(app);
const readout = new DebugReadout(app);

function applyLook(): void {
  const aspect = window.innerWidth / window.innerHeight;
  post.setResolution(look.render.width, aspect);
  post.setDither(look.ps1.ditherStrength, look.ps1.colorDepth);
  ps1Uniforms.uSnapGrid.value.set(post.width / 2, post.height / 2);
  ps1Uniforms.uSnap.value = look.ps1.vertexSnap;
  ps1Uniforms.uAffine.value = look.ps1.affineWarp;
  ps1Uniforms.uFogDensity.value = look.fog.density;
  ps1Uniforms.uFogNear.value.set(look.fog.nearColor);
  ps1Uniforms.uFogFar.value.set(look.fog.farColor);
  ps1Uniforms.uFogColorDist.value = look.fog.colorDistance;
  ps1Uniforms.uLampGlow.value = look.fog.lampGlow;
  ps1Uniforms.uLampGlowRadius.value = look.fog.lampGlowRadius;
  bank.setSize(Number(look.ps1.textureSize));
  ambient.color.set(look.ambient.color);
  ambient.intensity = look.ambient.intensity;
  lamps.applyLook();
  camera.fov = look.camera.fov;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  dust.applyLook(post.height / (window.innerHeight * renderer.getPixelRatio()));
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyLook();
});

/**
 * Rebuild the streets after a layout slider changes: geometry, lamps, dust,
 * and the paths new zombies take. Zombies already walking keep their paths.
 */
function rebuildLayout(): void {
  layout = currentLayout();
  scene.remove(alley.group);
  alley.dispose();
  alley = buildAlley(worldRng.fork('alley'), textures, layout, (t) => bank.remove(t));
  scene.add(alley.group);
  lamps.setLayout(layout);
  dust.setLayout(layout);
  if (game) game.layout = layout;
  bank.setSize(Number(look.ps1.textureSize));
}

// The Gameplay and Layout folders edit CONFIG in place; the running game reads it every tick.
const gui = createDebugPanel(look, applyLook, CONFIG.game, { layout: CONFIG.layout, onLayout: rebuildLayout, onLamp: () => lamps.applyLook() });
gui.hide();
applyLook();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

type Phase = 'loading' | 'title' | 'playing' | 'paused' | 'over';
let phase: Phase = 'loading';
let game: Game | null = null;
let zombies: ZombieRenderer | null = null;
/** The mode of the last run, for "play again". */
let lastMode: Mode = 'waves';
/** When the pause started, on the key event clock (performance.now() / 1000). */
let pausedAt = 0;

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score: number): void {
  try {
    if (score > readBest()) localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* storage unavailable: best just isn't kept */
  }
}

function startRun(mode: Mode): void {
  lastMode = mode;
  // Each run gets its own seed; everything random in the run flows from it.
  const runRng = createRng((Date.now() ^ 0x9e3779b9) >>> 0);
  game = new Game(
    CONFIG.game,
    runRng.fork('game'),
    new WordPicker(runRng.fork('words'), CONFIG.game.words.recentMemory),
    { normal: ENGLISH_200, hard: HARD_WORDS },
    layout,
    CONFIG.layout.spawnWeights,
    mode,
  );
  acc = 0;
  zombies?.clear();
  labels.clear();
  screens.hide();
  setFrozen(false);
  hud.clearBanner();
  hud.show(true);
  unfocus();
  phase = 'playing';
}

/** Death or the win: show the results. */
function endRun(g: Game): void {
  const best = readBest();
  saveBest(g.score);
  labels.clear();
  hud.clearBanner();
  screens.results(g, best);
  phase = 'over';
}

function toMenu(): void {
  game = null;
  zombies?.clear();
  labels.clear();
  setFrozen(false);
  hud.clearBanner();
  unfocus();
  hud.show(false);
  screens.title();
  phase = 'title';
}

/** Freeze or unfreeze the HUD and label CSS animations. */
function setFrozen(frozen: boolean): void {
  hud.setPaused(frozen);
  labels.setPaused(frozen);
}

/** Drop focus from menu buttons and sliders so keys go to the game again. */
function unfocus(): void {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

/**
 * Esc mid-run. The logic simply isn't stepped while paused, so zombies,
 * spawns, spits, the blind timer and the wave timers all hold. The typing
 * clock runs on key event timestamps, so resume() moves it past the pause.
 */
function pause(): void {
  if (phase !== 'playing' || !game) return;
  phase = 'paused';
  pausedAt = performance.now() / 1000;
  setFrozen(true);
  screens.pause(settings);
}

function resume(): void {
  if (phase !== 'paused' || !game) return;
  game.shiftKeyClock(performance.now() / 1000 - pausedAt);
  setFrozen(false);
  screens.hide();
  unfocus();
  phase = 'playing';
}

screens.onResume = resume;
screens.onRestart = () => {
  if (phase === 'paused') startRun(lastMode);
};
screens.onSettings = (s) => {
  look.render.width = s.renderWidth;
  applyLook();
  for (const c of gui.controllersRecursive()) c.updateDisplay();
  audio.setVolumes(s.volumes);
  saveSettings(s);
};

screens.onPickMode = (mode) => {
  if (phase === 'title') startRun(mode);
};
screens.onRetry = () => {
  if (phase === 'over') startRun(lastMode);
};
screens.onMenu = () => {
  if (phase === 'over' || phase === 'paused') toMenu();
};

// Leaving the tab or window mid-run pauses (otherwise the typing clock would count the time away).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('blur', pause);
// Browsers only allow sound after the first input.
window.addEventListener('pointerdown', () => audio.unlock());

window.addEventListener('keydown', (e) => {
  audio.unlock();
  // Esc toggles the pause, wherever focus is. It never reaches game.key, so it's never a typo.
  if (e.key === 'Escape') {
    if (phase === 'playing') pause();
    else if (phase === 'paused') resume();
    e.preventDefault();
    return;
  }
  // let the debug panel's number fields and the settings sliders have their keys
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'F2') {
    readout.toggle();
    e.preventDefault();
    return;
  }
  if (e.key === '`') {
    gui._hidden ? gui.show() : gui.hide();
    e.preventDefault();
    return;
  }
  if (phase === 'title' && (e.key === 'Enter' || e.key === '1' || e.key === '2')) {
    startRun(e.key === '2' ? 'endless' : 'waves');
    e.preventDefault();
    return;
  }
  if (phase === 'over' && e.key === 'Enter') {
    startRun(lastMode);
    e.preventDefault();
    return;
  }
  if (phase === 'over' && (e.key === 'm' || e.key === 'M')) {
    toMenu();
    e.preventDefault();
    return;
  }
  if (phase === 'paused' && !e.repeat) {
    const k = e.key.toLowerCase();
    if (k === 'r') startRun(lastMode);
    else if (k === 'q') toMenu();
    else if (k === 's' && !screens.inSettings) screens.pauseSettings();
    else if (k === 'b' && screens.inSettings) screens.pauseMain();
    if (e.key === ' ') e.preventDefault();
    return;
  }
  if (phase === 'playing' && game && e.key.length === 1) {
    if (e.key === ' ') e.preventDefault(); // stop the page scrolling; space is never part of a word
    // the key event's own timestamp, so typing time isn't rounded to frames or logic ticks
    if (!e.repeat) game.key(e.key, e.timeStamp / 1000);
  }
});

hud.show(false);
// Wait for the zombies and the label font before showing anything, so labels
// never appear in a fallback font or get measured at the wrong size.
Promise.all([loadZombieAssets(), document.fonts.load(`${CONFIG.labels.fontSize}px "DK Label"`)])
  .then(([assets, faces]) => {
    if (faces.length === 0) console.warn('Label font did not load; using the fallback font.');
    zombies = new ZombieRenderer(assets, worldRng.fork('zombie-views'));
    scene.add(zombies.group);
    updateCamera();
    zombies.warmup(() => renderer.compile(scene, camera));
    screens.title();
    phase = 'title';
  })
  .catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:8px;left:8px">Failed to load zombies: ${String(err)}</pre>`);
  });

// ---------------------------------------------------------------------------
// Loop: fixed-step logic, render every animation frame
// ---------------------------------------------------------------------------

let time = 0;
function updateCamera(): void {
  const s = look.camera.sway;
  const w = look.camera.swaySpeed;
  camera.position.set(Math.sin(time * w * 0.71) * s, look.camera.height + Math.sin(time * w * 1.13) * s * 0.6, CONFIG.camera.z);
  camera.lookAt(Math.sin(time * w * 0.43) * s * 6, CONFIG.camera.lookAtY + Math.sin(time * w * 0.61) * s * 4, CONFIG.camera.lookAtZ);
}

let last = performance.now();
let acc = 0;
const STEP = CONFIG.game.fixedStep;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt);
  requestAnimationFrame(frame);
}

/** One frame: fixed-step logic, events, views, render. */
function tick(dt: number): void {
  time += dt;

  if (game && phase === 'playing') {
    acc += dt;
    while (acc >= STEP) {
      game.update(STEP);
      acc -= STEP;
    }
    for (const e of game.drainEvents()) {
      audio.onEvent(e);
      zombies?.onEvent(e);
      labels.onEvent(e);
      hud.onEvent(e);
      if (e.type === 'gameover' || e.type === 'win') endRun(game);
    }
    hud.update(game);
    readout.update(game, performance.now() / 1000);
  }

  // Bisk's spit: blur and dim the world and the labels (still faintly readable)
  const inRun = phase === 'playing' || phase === 'paused';
  const blind = game && inRun ? game.blindLevel : 0;
  const BL = CONFIG.game.bisk.blind;
  post.setBlind(blind, BL.blur, BL.dim, BL.tint);
  labels.setBlind(blind);

  if (game && zombies) {
    // paused: views hold still (dt 0) but keep drawing
    const viewDt = phase === 'paused' ? 0 : dt;
    zombies.update(game, viewDt);
    if (inRun) {
      labels.update(
        game,
        camera,
        (id, out) => zombies!.labelAnchor(id, out),
        (id, out) => zombies!.headAnchor(id, out),
        window.innerWidth,
        window.innerHeight,
        viewDt,
      );
    }
  }

  lamps.update(dt);
  dust.update(dt);
  updateCamera();
  camera.updateMatrixWorld();
  post.render();
}
requestAnimationFrame(frame);

// Handy for poking at the game from the browser console. `step(dt)` runs one
// frame by hand (useful when the tab is in the background and gets no frames).
Object.assign(window, { __dk: { scene, camera, renderer, post, look, applyLook, getGame: () => game, step: tick, getLayout: () => layout, rebuildLayout, config: CONFIG, audio, pause, resume, getPhase: () => phase } });
