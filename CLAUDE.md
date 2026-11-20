# Dead Keys

The full spec is in GAME_SPEC.md. Read it before doing anything, and follow section 0 (Rules for Claude Code).

Current work: **Version 2, parts A to F** (Ton's v2 brief), built in order on branch `feat/v2`. After each part: commit (conventional commits, no co-author line), update this file, tell Ton how to test, and stop until he says go.

Done: **Part A** (Free Zombies walkers), **Part B** (waves), **Part C** (runner, Bisk, blobs).

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
- **Typing WPM** (main number) counts only time inside words, lock key to last key, and does not count the lock key as a character. **Run WPM** is over the whole run.

- **Waves everywhere (Part B).** Zombies only come in waves, in both modes: "Wave N" banner (`waves.introTime`, 2.5 s), the wave spawns, it's cleared when all of it is spawned and dead, then a break (`waves.breakTime`, 3 s). **Waves mode** = 20 waves then the win screen; **Endless** = the same formula forever. The title screen picks the mode (1/Enter = Waves, 2 = Endless); results have Play again (Enter) and Main menu (M).
  - The wave formula (`game.waves`, `src/game/waves.ts`) is the **only spawn source**. Ton removed the adaptive spawner (`game.adaptive`) because it spawned far too many zombies, and the time-based `game.endless` ramp. Wave 1: 5 zombies, one every 2.5 s, max 3 alive; each wave +2 zombies, interval x0.93 (floor 0.8 s), max alive +1 every 2 waves (cap 8), walk speed x1.04 (cap x1.8); word difficulty rises per wave (`words.difficultyPerWave`).
  - Enemy mix is data (`waves.mix`): walkers from wave 1, runners from 3, Bisk from 4, Blind Hunter from 6, Bisk a bit more common than the Hunter. Max 1 Hunter alive, 2 from wave 13 (`SPAWNABLE` in game.ts lists the types the mix can pick).
  - Unique first letters and the street/lane spacing are unchanged. HUD top centre shows "Wave N" ("Wave N / 20" in waves mode). F2 readout shows the wave state.

- **Enemy types (Part C).** Four enemies plus spit blobs (`EnemyKind`, `ZombieKind` in game.ts):
  - **Runner** = `zombie_dog.glb` ("Low poly zombie dog", onmioji, CC BY 4.0; path in `game.runner.model`). 1.8x walker speed, 3-4 letter words, procedural gallop (no rig), flops onto its side on death.
  - **Bisk** = `bisk_lod.glb`, built from Rahi_IV's `bisk.glb` by `npm run simplify:bisk` (113,740 -> ~5,500 tris). **Toned down at Ton's request**: chest flattened, the exposed chest covered with the jacket's black material, the chest ring removed. Shuffles to `bisk.stopDistance` (11 m) down the main alley and stays. ~2 s after its word appears it lunges (scale + lean) and spits a glowing green blob, then again every ~4.5 s while alive (one blob in flight at a time). Max 1 Bisk alive.
  - **Blob**: its own 3-4 letter word, unique first letter, labelled at once; reaches you in 1.5 s. Typed = broken. Hit = **blinded** for 2 s (heavy blur, dim, green tint on the world; blur and fade on the labels, still readable), fading back over the last 0.5 s. Typing still works. Blobs don't count toward max alive or the kill line, but a wave isn't cleared while one is in flight.
  - The "fiona - super star kartz" file Ton sent is **not used** (Shrek/DreamWorks character ripped from a licensed game).

## v2 decisions for later parts (answered before Part A)

- **Spits vs lock-on**: strict lock. You finish your current word before you can type a blob's word.
- **No grenade.** Instead a **sound-wave blast** that kills every enemy on screen (score: 25 per kill, no multiplier). Trigger and charge rules still to confirm (assume the spec's grenade rules: bar filled by clean streaks, Space when full).

## Commands

- `npm install` first after cloning or moving the folder (node_modules isn't committed). Model files are gitignored: they live only on disk.
- `npm run dev`: dev server at http://localhost:5173
- `npm test`: game logic tests (vitest, no Three.js)
- `npm run build`: typecheck and production build
- In game: F2 = WPM/spawner readout, backquote = tuning panel. `window.__dk.step(dt)` runs one frame by hand when the tab gets no frames.
