// Results screen after death or the win (v2 Part F): the summary numbers with
// personal-best badges, Typing WPM per wave as a line chart, a keyboard heatmap
// of accuracy per key, the worst keys and the typoed words.

import { CONFIG } from '../config';
import { keyAccuracy, worstKeys, type PbField, type PbResult, type RunRecord } from '../game/stats';

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const FORMAT: Record<PbField, (v: number) => string> = {
  score: (v) => Math.round(v).toLocaleString('en-US'),
  typingWpm: (v) => v.toFixed(0),
  runWpm: (v) => v.toFixed(0),
  accuracy: (v) => `${(v * 100).toFixed(1)}%`,
  bestCombo: (v) => v.toFixed(0),
  wavesCleared: (v) => v.toFixed(0),
  time: fmtTime,
  reactionAvg: (v) => `${v.toFixed(2)} s`,
};

/** One summary number: label, value, and either a PB badge or the best so far. */
function tile(rec: RunRecord, pb: PbResult, field: PbField, label: string, hero = false): string {
  const v = rec[field];
  const shown = field === 'reactionAvg' && rec.reactionAvg === 0 ? '–' : FORMAT[field](v);
  const old = pb.previous.values[field];
  let foot = '';
  if (pb.beaten.includes(field)) foot = `<span class="pb">PB</span>${old !== undefined ? `<small>was ${FORMAT[field](old)}</small>` : ''}`;
  else if (old !== undefined) foot = `<small>best ${FORMAT[field](old)}</small>`;
  return `<div class="dk-tile${hero ? ' hero' : ''}"><span class="l">${label}</span><span class="v">${shown}</span><span class="f">${foot}</span></div>`;
}

/** Typing WPM per wave, a value written on every point; hover a point for the details. */
function wpmChart(rec: RunRecord): string {
  const pts = rec.waves.filter((w) => w.wpm !== null) as (RunRecord['waves'][number] & { wpm: number })[];
  if (pts.length === 0) return '<p class="dk-small">No words finished, so no chart this time.</p>';
  const W = 640;
  const H = 210;
  const m = { l: 34, r: 14, t: 26, b: 30 };
  const first = rec.waves[0].wave;
  const last = rec.waves[rec.waves.length - 1].wave;
  const maxV = Math.max(...pts.map((p) => p.wpm), rec.typingWpm);
  const step = maxV > 120 ? 40 : maxV > 60 ? 20 : 10;
  const top = Math.max(step, Math.ceil((maxV * 1.12) / step) * step);
  const x = (wave: number) => (last === first ? (m.l + W - m.r) / 2 : m.l + ((wave - first) / (last - first)) * (W - m.l - m.r));
  const y = (v: number) => m.t + (1 - v / top) * (H - m.t - m.b);
  const out: string[] = [];
  for (let v = 0; v <= top; v += step) {
    out.push(`<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`);
    out.push(`<text class="ax" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  // x ticks: every wave while they fit, else every few
  const every = Math.max(1, Math.ceil((last - first + 1) / 20));
  for (let w = first; w <= last; w++) {
    if ((w - first) % every !== 0 && w !== last) continue;
    out.push(`<text class="ax" x="${x(w)}" y="${H - m.b + 16}" text-anchor="middle">${w}</text>`);
  }
  out.push(`<text class="ax" x="${W - m.r}" y="${H - 2}" text-anchor="end">wave</text>`);
  // the run's Typing WPM as a reference line
  const ay = y(rec.typingWpm);
  out.push(`<line class="avg" x1="${m.l}" x2="${W - m.r}" y1="${ay}" y2="${ay}"/>`);
  out.push(`<text class="ax" x="${W - m.r}" y="${ay - 5}" text-anchor="end">run ${rec.typingWpm.toFixed(0)}</text>`);
  out.push(`<polyline class="line" points="${pts.map((p) => `${x(p.wave)},${y(p.wpm)}`).join(' ')}"/>`);
  const small = pts.length > 25 ? ' small' : '';
  for (const p of pts) {
    const died = !p.cleared && !rec.won && p.wave === last;
    const tip = `Wave ${p.wave}: ${p.wpm.toFixed(0)} WPM, ${(p.accuracy * 100).toFixed(0)}% accuracy, ${p.typos} typo${p.typos === 1 ? '' : 's'}${p.cleared ? `, cleared +${p.bonus.toLocaleString('en-US')}` : died ? ', died here' : ''}`;
    out.push(`<g class="pt${died ? ' died' : ''}"><title>${tip}</title>
      <circle class="hit" cx="${x(p.wave)}" cy="${y(p.wpm)}" r="11"/>
      <circle class="dot" cx="${x(p.wave)}" cy="${y(p.wpm)}" r="4"/>
      <text class="val${small}" x="${x(p.wave)}" y="${y(p.wpm) - 9}" text-anchor="middle">${p.wpm.toFixed(0)}</text></g>`);
  }
  return `<svg class="dk-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Typing WPM per wave">${out.join('')}</svg>
    <table class="dk-sr">${pts.map((p) => `<tr><td>Wave ${p.wave}</td><td>${p.wpm.toFixed(0)} WPM</td></tr>`).join('')}</table>`;
}

/** QWERTY letters coloured by miss rate, with the accuracy written on each key. */
function heatmap(rec: RunRecord): string {
  const floor = CONFIG.stats.heatFloor;
  const rows = ROWS.map((row, i) => {
    const keys = [...row].map((ch) => {
      const k = rec.keys[ch];
      const n = k ? k.hits + k.misses : 0;
      if (n === 0) return `<div class="key none" title="${ch}: not typed"><b>${ch}</b><span>–</span></div>`;
      const acc = keyAccuracy(k);
      const heat = Math.min(1, Math.max(0, (1 - acc) / (1 - floor)));
      const pct = acc === 1 ? '100' : (acc * 100).toFixed(acc >= 0.995 ? 1 : 0);
      return `<div class="key" style="--heat:${(heat * 100).toFixed(0)}%" title="${ch}: ${k!.hits} hit, ${k!.misses} missed (${(acc * 100).toFixed(1)}%)"><b>${ch}</b><span>${pct}%</span></div>`;
    });
    return `<div class="row r${i}">${keys.join('')}</div>`;
  });
  return `<div class="dk-keys">${rows.join('')}</div>
    <div class="dk-heat-legend"><span>100%</span><i></i><span>${Math.round(floor * 100)}% or less</span></div>`;
}

export function resultsHtml(rec: RunRecord, pb: PbResult): string {
  const S = CONFIG.stats;
  const n = CONFIG.game.waves.count;
  const reached = rec.won ? `All ${n} waves` : `Wave ${rec.wave}`;
  const worst = worstKeys(rec.keys, S.worstKeys, S.worstKeyMinAttempts);
  const typos = rec.typoWords.slice(0, S.typoWordsShown);
  const k = rec.kills;
  const lowTyping = rec.typingChars < S.pbMinChars;
  return `
    <div class="dk-panel dk-results">
      <h1>${rec.won ? 'YOU SURVIVED' : 'YOU DIED'}</h1>
      <p class="dk-sub">${rec.mode === 'waves' ? 'Waves' : 'Endless'} &middot; ${reached}${pb.beaten.length ? ` &middot; <span class="pb">${pb.beaten.length} new best${pb.beaten.length > 1 ? 's' : ''}</span>` : ''}</p>
      <div class="dk-tiles">
        ${tile(rec, pb, 'typingWpm', 'Typing WPM', true)}
        ${tile(rec, pb, 'score', 'Score', true)}
        ${tile(rec, pb, 'runWpm', 'Run WPM')}
        ${tile(rec, pb, 'accuracy', 'Accuracy')}
        ${tile(rec, pb, 'bestCombo', 'Best combo')}
        ${tile(rec, pb, 'wavesCleared', 'Waves cleared')}
        ${tile(rec, pb, 'time', 'Survived')}
        ${tile(rec, pb, 'reactionAvg', 'Reaction')}
      </div>
      <p class="dk-line">Kills: walkers <b>${k.walker}</b> &middot; runners <b>${k.runner}</b> &middot; Bisk <b>${k.bisk}</b> &middot; Hunters <b>${k.hunter}</b>
        &nbsp;|&nbsp; Spits broken <b>${rec.spitsBroken}</b> vs blinded <b>${rec.timesBlinded}</b></p>
      ${pb.firstRun ? '<p class="dk-small">First run in this mode: these are your bests to beat.</p>' : ''}
      ${lowTyping ? `<p class="dk-small">WPM, accuracy and reaction count for bests after ${S.pbMinChars} letters in words.</p>` : ''}
      <h2>Typing WPM per wave</h2>
      ${wpmChart(rec)}
      <h2>Accuracy per key</h2>
      ${heatmap(rec)}
      <div class="dk-cols">
        <div><h2>Worst keys</h2>${
          worst.length
            ? `<ul class="dk-chips">${worst.map((w) => `<li><b>${w.key}</b> ${(w.accuracy * 100).toFixed(0)}% <small>${w.misses} of ${w.hits + w.misses} missed</small></li>`).join('')}</ul>`
            : `<p class="dk-small">None (keys need ${S.worstKeyMinAttempts} tries and a miss to show here).</p>`
        }</div>
        <div><h2>Typoed words${rec.typoWords.length ? ` (${rec.typoWords.length})` : ''}</h2>${
          typos.length ? `<ul class="dk-chips">${typos.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="dk-small">None. Clean run.</p>'
        }</div>
      </div>
      <p class="dk-small">Typing WPM counts only time spent typing words. Run WPM counts the whole run. Reaction = label appears to first letter.</p>
      <div class="dk-modes">
        <button type="button" data-act="retry"><b>ENTER</b> Restart</button>
        <button type="button" data-act="menu"><b>M</b> Main menu</button>
      </div>
    </div>`;
}
