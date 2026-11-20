// Minimal HUD (GAME_SPEC section 8): score top left, time top centre,
// combo and multiplier top right. Plain HTML for M1; styled in M3.
// Also the title and game over screens.

import type { Game, GameEvent } from '../game/game';

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class Hud {
  private root: HTMLDivElement;
  private score: HTMLDivElement;
  private time: HTMLDivElement;
  private combo: HTMLDivElement;
  private shownScore = -1;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dk-hud';
    this.root.innerHTML = `
      <div class="dk-hud-score"></div>
      <div class="dk-hud-time"></div>
      <div class="dk-hud-combo"></div>`;
    parent.appendChild(this.root);
    this.score = this.root.querySelector('.dk-hud-score')!;
    this.time = this.root.querySelector('.dk-hud-time')!;
    this.combo = this.root.querySelector('.dk-hud-combo')!;
  }

  show(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  onEvent(e: GameEvent): void {
    if (e.type === 'typo') this.flash(this.combo, 'err');
    if (e.type === 'comboTier') this.flash(this.combo, 'up');
  }

  update(game: Game): void {
    if (game.score !== this.shownScore) {
      this.score.textContent = game.score.toLocaleString('en-US');
      this.shownScore = game.score;
    }
    this.time.textContent = fmtTime(game.time);
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

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dk-screen';
    parent.appendChild(this.root);
  }

  title(): void {
    this.root.innerHTML = `
      <div class="dk-panel">
        <h1>DEAD KEYS</h1>
        <p>Type the word over a zombie's head to shoot it.<br>
        The first letter locks on. Every right letter is a shot.<br>
        Big ones carry long words. Don't let anything reach you.</p>
        <p class="dk-cta">Press <b>ENTER</b> to start</p>
        <p class="dk-small">Endless mode &middot; English 200 &middot; <b>\`</b> toggles the look panel</p>
        <p class="dk-small">Credits: "ANIMATION ZOMBIE" by RINONO (CC BY 4.0) &middot;
        "Zombie Blind Hunter" by KIFIR (CC BY-NC 4.0) &middot;
        Gamestation Text font (SIL OFL 1.1, based on Play by Jonas Hecksher)</p>
      </div>`;
    this.root.style.display = '';
  }

  gameOver(game: Game, best: number): void {
    const stats = game.stats;
    const newBest = stats.score > 0 && stats.score >= best;
    const missed = stats.missedWords.slice(0, 12).join(', ') || 'none';
    this.root.innerHTML = `
      <div class="dk-panel">
        <h1>YOU DIED</h1>
        ${newBest ? '<p class="dk-best">NEW BEST</p>' : ''}
        <p class="dk-wpm"><span>${game.typingWpm().toFixed(0)}</span> WPM</p>
        <table>
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
        <p class="dk-cta">Press <b>ENTER</b> to try again</p>
      </div>`;
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}

/** F2 debug readout: live typing numbers and what the spawner is doing. */
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
    this.root.textContent = [
      `chars typed     ${s.correctKeys} correct, ${s.typos} wrong`,
      `  in words      ${s.typingCorrect} correct, ${s.typingKeys} total (lock keys not counted)`,
      `active typing   ${game.typingTimeAt(now).toFixed(2)} s${live ? ' (word in progress)' : ''}`,
      `run time        ${game.time.toFixed(2)} s`,
      `Typing WPM      ${game.typingWpm(now).toFixed(1)} net / ${game.typingRawWpm(now).toFixed(1)} raw`,
      `Run WPM         ${game.runWpm.toFixed(1)} net / ${game.runRawWpm.toFixed(1)} raw`,
      `words           ${s.wordsTyped}   accuracy ${(game.accuracy * 100).toFixed(1)}%`,
      `-- spawner --`,
      `est. WPM        ${game.estimatedWpm.toFixed(0)}  -> ${game.demandWordsPerSec.toFixed(2)} words/s`,
      `ready / target  ${game.ready} / ${game.targetReady}  (pipeline ${game.pipelineSeconds.toFixed(1)} s)`,
      `alive           ${game.zombies.length} (timed cap ${game.maxAlive}, every ${game.spawnInterval.toFixed(2)} s)`,
      `labelled        ${game.zombies.filter((z) => z.labelled).length}`,
    ].join('\n');
  }
}
