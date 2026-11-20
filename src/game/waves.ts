// The wave formula (pure logic). Everything about how many zombies come, how
// fast, and which types, is decided here from CONFIG.game.waves.

import type { GameConfig } from '../config';

export type WavesConfig = GameConfig['waves'];
/** Every enemy type the mix can name (some arrive in later parts). */
export type MixKind = keyof WavesConfig['mix'];

export interface WaveParams {
  wave: number;
  /** Zombies in the wave. */
  size: number;
  /** Seconds between spawns. */
  interval: number;
  /** Most zombies alive at once. */
  maxAlive: number;
  /** Walk speed multiplier for zombies spawned in this wave. */
  speed: number;
  /** Most hunters alive at once. */
  hunterMax: number;
}

/** Numbers for wave `wave` (1-based). Wave N ramps from wave N-1 by the same formula forever. */
export function waveParams(c: WavesConfig, wave: number): WaveParams {
  const n = Math.max(0, wave - 1);
  const R = c.ramp;
  return {
    wave,
    size: c.first.size + R.sizePerWave * n,
    interval: Math.max(R.intervalMin, c.first.interval * Math.pow(R.intervalFactor, n)),
    maxAlive: Math.min(R.maxAliveCap, c.first.maxAlive + Math.floor(n / R.maxAliveEvery)),
    speed: Math.min(R.speedMax, Math.pow(R.speedFactor, n)),
    hunterMax: wave >= c.hunterMax.lateFrom ? c.hunterMax.late : c.hunterMax.base,
  };
}

/** Spawn weights for the types available in `wave`, limited to the types the game can spawn. */
export function mixWeights<K extends MixKind>(c: WavesConfig, wave: number, available: readonly K[]): Map<K, number> {
  const out = new Map<K, number>();
  for (const k of available) {
    const m = c.mix[k];
    if (m && wave >= m.from && m.weight > 0) out.set(k, m.weight);
  }
  return out;
}
