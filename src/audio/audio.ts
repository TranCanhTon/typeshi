// Audio manager: named sound events with silent fallbacks.
//
// Every event has one or more file names in CONFIG.audio.files. On start the
// manager looks for public/assets/sounds/<name>.<ext> (ogg, mp3, wav, in that
// order). Whatever is missing just stays silent, so sounds can be dropped in
// one by one without touching code.
//
// Browsers only allow audio after a key press or click, so nothing plays (and
// nothing is decoded) until unlock() is called from the first input.

import { CONFIG } from '../config';
import type { GameEvent } from '../game/game';
import type { Rng } from '../game/rng';

export type SoundEvent = keyof typeof CONFIG.audio.files;

export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private buffers = new Map<SoundEvent, AudioBuffer[]>();
  private ambienceSource: AudioBufferSourceNode | null = null;
  private loading: Promise<void> | null = null;
  readonly volumes: Volumes;

  /** `rng`: random variation (which gunshot, pitch) goes through the seeded RNG like everything else. */
  constructor(volumes: Volumes, private rng: Rng) {
    this.volumes = { ...volumes };
  }

  /** Call from the first key press or click. Safe to call again. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return; // no Web Audio: the game stays silent
    }
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.amb = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.applyVolumes();
    this.loading = this.loadAll().then(() => this.startAmbience());
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  /** Which events have a file (for the settings screen and debugging). */
  loaded(): SoundEvent[] {
    return [...this.buffers.keys()];
  }

  /** Play a named event once. `pitch` scales the playback rate. Missing sounds are silent. */
  play(name: SoundEvent, pitch = 1, volume = 1): void {
    const list = this.buffers.get(name);
    if (!this.ctx || !this.sfx || !list || list.length === 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = list[Math.floor(this.rng.next() * list.length)];
    src.playbackRate.value = pitch;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfx);
    src.start();
  }

  /** Map game events to sounds. */
  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'shot': {
        const j = CONFIG.audio.gunshotPitchJitter;
        this.play('gunshot', 1 + this.rng.range(-j, j));
        this.play('hit', 1, 0.8);
        break;
      }
      case 'typo':
        this.play('jam');
        break;
      case 'kill':
        this.play(e.kind === 'blob' ? 'spitBreak' : 'zombieDeath');
        break;
      case 'spawn':
        if (e.zombie.kind === 'runner') this.play('runnerBark');
        break;
      case 'lunge':
        this.play('biskSpit');
        break;
      case 'blinded':
        this.play('blinded');
        break;
      case 'waveStart':
        this.play('waveStart');
        break;
      case 'gameover':
        this.play('gameOver');
        break;
    }
  }

  // -------------------------------------------------------------------------

  private applyVolumes(): void {
    if (!this.master || !this.sfx || !this.amb) return;
    this.master.gain.value = this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.amb.gain.value = this.volumes.ambience;
  }

  private async loadAll(): Promise<void> {
    const A = CONFIG.audio;
    const jobs: Promise<void>[] = [];
    for (const [event, names] of Object.entries(A.files) as [SoundEvent, string[]][]) {
      for (const name of names) {
        jobs.push(
          this.loadOne(name).then((buf) => {
            if (!buf) return;
            const list = this.buffers.get(event) ?? [];
            list.push(buf);
            this.buffers.set(event, list);
          }),
        );
      }
    }
    await Promise.all(jobs);
  }

  /** Try each extension; anything missing (404, or the dev server's HTML fallback) is null. */
  private async loadOne(name: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    for (const ext of CONFIG.audio.extensions) {
      try {
        const res = await fetch(`${CONFIG.audio.base}${name}.${ext}`);
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || type.includes('text/html')) continue;
        return await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        // not there or not decodable: try the next extension
      }
    }
    return null;
  }

  private startAmbience(): void {
    const list = this.buffers.get('ambience');
    if (!this.ctx || !this.amb || !list?.length || this.ambienceSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = list[0];
    src.loop = true;
    src.connect(this.amb);
    src.start();
    this.ambienceSource = src;
  }

  /** Resolves when every sound has been looked for (tests / debugging). */
  ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }
}
