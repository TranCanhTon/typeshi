// Minimal HUD (GAME_SPEC section 8): score top left, wave top centre, combo
// and multiplier top right, and the big "Wave N" banner. Plain HTML; styled
// properly in M3. Also the title (mode select), game over and win screens.

import { CONFIG } from '../config';
import type { Game, GameEvent, Mode } from '../game/game';

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function waveLabel(game: Game): string {
  return game.mode === 'waves' ? `Wave ${game.wave} / ${CONFIG.game.waves.count}` : `Wave ${game.wave}`;
}

export class Hud {
  private root: HTMLDivElement;
  private score: HTMLDivElement;
  private wave: HTMLDivElement;
  private combo: HTMLDivElement;
  private banner: HTMLDivElement;
  private shownScore = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dk-hud';
    this.root.innerHTML = `
      <div class="dk-hud-score"></div>
      <div class="dk-hud-wave"></div>
      <div class="dk-hud-combo"></div>
      <div class="dk-banner"></div>`;
    parent.appendChild(this.root);
    this.score = this.root.querySelector('.dk-hud-score')!;
    this.wave = this.root.querySelector('.dk-hud-wave')!;
    this.combo = this.root.querySelector('.dk-hud-combo')!;
    this.banner = this.root.querySelector('.dk-banner')!;
    this.root.style.setProperty('--dk-banner-ms', `${CONFIG.game.waves.introTime * 1000}ms`);
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  onEvent(e: GameEvent): void {
    if (e.type === 'typo') this.flash(this.combo, 'err');
    if (e.type === 'comboTier') this.flash(this.combo, 'up');
    if (e.type === 'waveStart') {
      this.banner.textContent = `Wave ${e.wave}`;
      this.flash(this.banner, 'show');
    }
  }

  /** Hide the banner straight away (new run, game over). */
  clearBanner(): void {
    this.banner.classList.remove('show');
  }

  update(game: Game): void {
    if (game.score !== this.shownScore) {
      this.score.textContent = game.score.toLocaleString('en-US');
      this.shownScore = game.score;
    }
    this.wave.textContent = waveLabel(game);
    this.combo.innerHTML = `<span class="n">${game.combo}</span> combo <span class="x">x${game.multiplier}</span>`;
  }

  private flash(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
}

export class Screens {
  private root: HTMLDivElement;
  /** Called when a mode button on the title screen is clicked. */
  onPickMode: (mode: Mode) => void = () => undefined;
  /** Called when "Main menu" is clicked on the game over / win screen. */
  onMenu: () => void = () => undefined;
  /** Called when "Play again" is clicked. */
  onRetry: () => void = () => undefined;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dk-screen';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const mode = b.dataset.mode as Mode | undefined;
      if (mode) this.onPickMode(mode);
      else if (b.dataset.act === 'menu') this.onMenu();
      else if (b.dataset.act === 'retry') this.onRetry();
    });
  }

  title(): void {
    const n = CONFIG.game.waves.count;
    this.root.innerHTML = `
      <div class="dk-panel">
        <h1>DEAD KEYS</h1>
        <p>Type the word over a zombie's head to shoot it.<br>
        The first letter locks on. Every right letter is a shot.<br>
        Big ones carry long words. Don't let anything reach you.</p>
        <div class="dk-modes">
          <button type="button" data-mode="waves"><b>1</b> Waves<span>survive ${n} waves</span></button>
          <button type="button" data-mode="endless"><b>2</b> Endless<span>waves until you fall</span></button>
        </div>
        <p class="dk-small">Press <b>1</b> or <b>ENTER</b> for Waves, <b>2</b> for Endless &middot; <b>\`</b> toggles the tuning panel</p>
        <p class="dk-small">Credits: Polyart Zombies pack ("Free Zombies") by Denys Almaral &middot;
        "Bisk" by Rahi_IV (CC BY 4.0, simplified and modified) &middot;
        "Low poly zombie dog" by onmioji (CC BY 4.0) &middot;
        "Zombie Blind Hunter" by KIFIR (CC BY-NC 4.0) &middot;
        Gamestation Text font (SIL OFL 1.1, based on Play by Jonas Hecksher)</p>
      </div>`;
    this.root.style.display = '';
  }

  /** Results after death (or the win in waves mode). */
  results(game: Game, best: number): void {
    const stats = game.stats;
    const newBest = stats.score > 0 && stats.score >= best;
    const missed = stats.missedWords.slice(0, 12).join(', ') || 'none';
    const reached = game.won ? `All ${CONFIG.game.waves.count} waves` : `Wave ${game.wave}`;
    this.root.innerHTML = `
      <div class="dk-panel">
        <h1>${game.won ? 'YOU SURVIVED' : 'YOU DIED'}</h1>
        ${newBest ? '<p class="dk-best">NEW BEST</p>' : ''}
        <p class="dk-wpm"><span>${game.typingWpm().toFixed(0)}</span> WPM</p>
        <table>
          <tr><td>Mode</td><td>${game.mode === 'waves' ? 'Waves' : 'Endless'}</td></tr>
          <tr><td>Reached</td><td>${reached} (${stats.wavesCleared} cleared)</td></tr>
          <tr><td>Score</td><td>${stats.score.toLocaleString('en-US')}</td></tr>
          <tr><td>Best</td><td>${Math.max(best, stats.score).toLocaleString('en-US')}</td></tr>
          <tr><td>Survived</td><td>${fmtTime(stats.time)}</td></tr>
          <tr><td>Kills</td><td>${stats.kills} (${stats.hunterKills} hunters)</td></tr>
          <tr><td>Typing WPM</td><td>${game.typingWpm().toFixed(0)} net &middot; ${game.typingRawWpm().toFixed(0)} raw</td></tr>
          <tr><td>Run WPM</td><td>${game.runWpm.toFixed(0)} net &middot; ${game.runRawWpm.toFixed(0)} raw</td></tr>
          <tr><td>Accuracy</td><td>${(game.accuracy * 100).toFixed(1)}%</td></tr>
          <tr><td>Best combo</td><td>${stats.bestCombo}</td></tr>
        </table>
        <p class="dk-small">Typing WPM counts only time spent typing words. Run WPM counts the whole run.</p>
        <p class="dk-small">Missed words: ${missed}</p>
        <div class="dk-modes">
          <button type="button" data-act="retry"><b>ENTER</b> Play again</button>
          <button type="button" data-act="menu"><b>M</b> Main menu</button>
        </div>
      </div>`;
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

/** F2 debug readout: live typing numbers and what the wave spawner is doing. */
export class DebugReadout {
  private root: HTMLPreElement;
  visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('pre');
    this.root.className = 'dk-readout';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }

  /** `now` must be on the same clock as the key timestamps (performance.now() / 1000). */
  update(game: Game, now: number): void {
    if (!this.visible) return;
    const s = game.stats;
    const live = game.lockedId !== null;
    const P = game.params;
    this.root.textContent = [
      `chars typed     ${s.correctKeys} correct, ${s.typos} wrong`,
      `  in words      ${s.typingCorrect} correct, ${s.typingKeys} total (lock keys not counted)`,
      `active typing   ${game.typingTimeAt(now).toFixed(2)} s${live ? ' (word in progress)' : ''}`,
      `run time        ${game.time.toFixed(2)} s`,
      `Typing WPM      ${game.typingWpm(now).toFixed(1)} net / ${game.typingRawWpm(now).toFixed(1)} raw`,
      `Run WPM         ${game.runWpm.toFixed(1)} net / ${game.runRawWpm.toFixed(1)} raw`,
      `words           ${s.wordsTyped}   accuracy ${(game.accuracy * 100).toFixed(1)}%`,
      `-- wave ${game.wave} (${game.mode}) --`,
      `phase           ${game.phase} ${game.phaseTime.toFixed(1)} s`,
      `spawned         ${game.waveSpawned} / ${P.size}  (every ${P.interval.toFixed(2)} s)`,
      `alive           ${game.zombies.length} / max ${P.maxAlive}   hunters max ${P.hunterMax}`,
      `speed           x${P.speed.toFixed(2)}`,
      `labelled        ${game.zombies.filter((z) => z.labelled).length}`,
    ].join('\n');
  }
}
