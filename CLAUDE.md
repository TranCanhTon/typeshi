# Dead Keys

The full spec is in GAME_SPEC.md. Read it before doing anything, and follow section 0 (Rules for Claude Code).

Current work: **Version 2, parts A to F** (Ton's v2 brief), built in order on branch `feat/v2`. After each part: commit (conventional commits, no co-author line), update this file, tell Ton how to test, and stop until he says go.

Done: **Part A** (Free Zombies walkers).

## Decisions Ton has made so far

- **M0 alley approved.** Keep it as is. M1 is built in the real alley (not a greybox) with the real zombie models.
- **Layout is a crossroads** (src/game/layout.ts, CONFIG.layout): the main alley is 10% shorter than the original (crossing centre 20 m from the player), with side streets left and right and the main alley continuing straight into the fog. Zombies spawn out of sight in one of the three streets (weighted), curve round the corner and walk down the main alley in their street's side of it. Same look, lighting, fog and PS1 style as M0.
- **Walkers are the Free Zombies pack** (Denys Almaral, `public/assets/models/freezombies/`, config `game.walker.model`). Each spawn picks one of the 10 rigged zombies and one of 4 walk styles (walk, slowWalk, walk_agressive, walk_limp) at a random speed, with tint and size jitter. The pack has **no hit or death animations**, so Ton chose **procedural** ones: hit = lean back + knock back, death = walk winds down, stagger, topple backward, sink. `zombie_rinono.glb` is no longer used or credited.
  - The Sketchfab `polyart_zombies.glb` and the FAB `zombie_ani_player.fbx` are only the presentation scene (all ten looping their own idle at once), so they are not used.
  - Accessories (hair, beanie) are joined into the meshes in this pack, so they can't be toggled.
- `zombie_blind_hunter.glb` is the **elite/boss**: one long, hard word (from `HARD_WORDS`), bigger and slower.
- The Blind Hunter has no rig, so it uses a **procedural lurch** (sway, bob, lean; shudder and knock back on hit; topples backward on death) until Ton rigs it. Its license is CC BY-NC (non commercial).
- Labels and HUD use **Gamestation Text** (SIL OFL, `public/assets/fonts/GamestationText.otf`), supplied by Ton in place of AnalogMono.
- Labels appear (no blur stage) at `game.labelDistance`; only labelled zombies are targetable.
- **Typing WPM** (main number) counts only time inside words, lock key to last key, and does not count the lock key as a character. **Run WPM** is over the whole run. Adaptive spawning (`game.adaptive`) keeps fast typists fed.

## v2 decisions for later parts (answered before Part A)

- **Runner (Part C)** uses `low_poly_zombie_dog.glb` (onmioji, CC BY 4.0) from the start, with a procedural gallop (no rig). Model path in config.
- **Spitter (Part C)**: Ton asked for the "fiona - super star kartz (reupload)" model instead of Rahi_IV's Bisk. Claude declined: it's Princess Fiona from Shrek ripped from a licensed game (DreamWorks IP; a reupload's CC BY tag doesn't make it licensable; spec rule 8). Still open: placeholder spitter or another model. Ask before Part C.
- **Spits vs lock-on**: strict lock. You finish your current word before you can type a blob's word.
- **No grenade.** Instead a **sound-wave blast** that kills every enemy on screen (score: 25 per kill, no multiplier). Trigger and charge rules still to confirm (assume the spec's grenade rules: bar filled by clean streaks, Space when full).

## Commands

- `npm install` first after cloning or moving the folder (node_modules isn't committed). Model files are gitignored: they live only on disk.
- `npm run dev`: dev server at http://localhost:5173
- `npm test`: game logic tests (vitest, no Three.js)
- `npm run build`: typecheck and production build
- In game: F2 = WPM/spawner readout, backquote = tuning panel. `window.__dk.step(dt)` runs one frame by hand when the tab gets no frames.
