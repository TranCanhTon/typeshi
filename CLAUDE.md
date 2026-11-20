# Dead Keys

The full spec is in GAME_SPEC.md. Read it before doing anything, and follow section 0 (Rules for Claude Code).

Current milestone: **M1 (core loop)**. Stop when it is done and wait for Ton.

## Decisions Ton has made so far

- **M0 alley approved.** Keep it as is. M1 is built in the real alley (not a greybox) with the real zombie models.
- **Layout is a crossroads** (src/game/layout.ts, CONFIG.layout): the main alley is 10% shorter than the original (crossing centre 20 m from the player), with side streets left and right and the main alley continuing straight into the fog. Zombies spawn out of sight in one of the three streets (weighted), curve round the corner and walk down the main alley in their street's side of it. Same look, lighting, fog and PS1 style as M0.
- **Two zombie types:** `zombie_rinono.glb` is the normal walker. `zombie_blind_hunter.glb` is the **elite/boss**: one long, hard word (from `HARD_WORDS`), bigger and slower.
- The Blind Hunter has no rig, so it uses a **procedural lurch** (sway, bob, lean; shudder and knock back on hit; topples backward on death) until Ton rigs it. Its license is CC BY-NC (non commercial).
- Labels and HUD use **Gamestation Text** (SIL OFL, `public/assets/fonts/GamestationText.otf`), supplied by Ton in place of AnalogMono.
- Labels appear (no blur stage) at `game.labelDistance`; only labelled zombies are targetable.
- **Typing WPM** (main number) counts only time inside words, lock key to last key, and does not count the lock key as a character. **Run WPM** is over the whole run. Adaptive spawning (`game.adaptive`) keeps fast typists fed.

## Commands

- `npm run dev`: dev server at http://localhost:5173
- `npm test`: game logic tests (vitest, no Three.js)
- `npm run build`: typecheck and production build
- In game: F2 = WPM/spawner readout, backquote = tuning panel. `window.__dk.step(dt)` runs one frame by hand when the tab gets no frames.
