# Dead Keys

The full spec is in GAME_SPEC.md. Read it before doing anything, and follow section 0 (Rules for Claude Code).

Last work: **Version 2, parts A to F** (Ton's v2 brief), built in order on branch `feat/v2`. After each part: commit (conventional commits, no co-author line), update this file, tell Ton how to test, and stop until he says go.

Done: **Part A** (Free Zombies walkers), **Part B** (waves), **Part C** (runner, Bisk, blobs), **Part D** (which word is which zombie), **Part E** (pause, settings, audio), **Part F** (score and stats). v2 is complete.

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

- **Which word is which zombie (Part D).** Labels keep their fixed font size (on purpose, so they don't jump). On top of the stacking:
  - **Every label has a stem** from its bottom centre to its own zombie's head (the dog's head is at the front of its body), angled when stacked. This brings back the line Ton removed in v1, now on every label (`labels.stemWidth`, `labels.stemColor`).
  - **The locked zombie gets an outline** in the lock colour (`labels.lockColor`, same as the locked label), an inverted-hull shell `labels.lockOutline` m thick, built the first time it's locked.
  - **Type markers** before the word: none for walkers, yellow square = runner, green square = Bisk, green dot = blob, red square = Hunter (`labels.markers`).

- **Pause, settings, audio (Part E).**
  - Render width default is **800** (`look.render.width`); still a slider in the tuning panel and in Settings.
  - **Esc pauses** mid-run and Esc again resumes. Esc never reaches `game.key`, so it is never a typo. Paused = the logic is not stepped, so zombies, spawns, spit blobs, the blind timer and the wave timers all hold; views and labels update with dt 0; HUD and label CSS animations are paused. The typing clock runs on key event timestamps, so resume calls `Game.shiftKeyClock(pause length)`. Leaving the tab or window also pauses.
  - **Pause menu** in the panel style: Resume (Esc), Restart (R), Settings (S), Quit to main menu (Q). Settings: render width and master, effects and ambience volume sliders, Back (B). Saved in localStorage under `settings.storageKey` (`deadkeys.settings`).
  - **Audio manager** (`src/audio/audio.ts`): named events mapped from game events, files listed in `CONFIG.audio.files`, looked for in `public/assets/sounds/` as .ogg, .mp3 or .wav. Missing files are silent. Starts on the first key press or click (browser rule). Gunshot picks one of 3 files with a random pitch (`audio.gunshotPitchJitter`), through the seeded RNG. The expected filenames are in `public/assets/sounds/README.md`.

- **Score and stats (Part F).**
  - **Score** (`game.score`): 10 per correct letter; kills walker 100, runner 150, Bisk 250, Hunter 400, broken spit 75; letters and kills times the combo tier at that moment (1x, 2x at 10, 3x at 25, 4x at 50, 5x at 100). Wave clear bonus 200 x wave number, x1.5 if the wave had no typos, no multiplier; the banner shows "Wave N cleared +bonus".
  - **Stats per run** (`RunStats` in game.ts, `RunRecord` in `src/game/stats.ts`): Typing WPM (main) and Run WPM, accuracy, best combo, score, waves cleared, time survived, kills per enemy type (spit blobs are not kills, they are spits broken), spits broken vs times blinded, reaction time (label appears to the lock letter, game time), per-key hits and misses, typoed words, and per-wave typing numbers.
  - **Per-key misses**: while locked, a miss counts against the letter you should have typed; with nothing locked (no word starts with the key) it counts against the key pressed.
  - **Saved** in localStorage (`src/stats/store.ts`): the last 50 runs in `deadkeys.runs`, and bests per mode in `deadkeys.pb.waves` / `deadkeys.pb.endless` (the old `deadkeys.best.endless` score seeds the endless bests). A best must be strictly beaten; lower reaction time is better. WPM, accuracy and reaction only count for a best after `stats.pbMinChars` (50) letters in words. The first run in a mode sets the bests without badges.
  - **Results screen** (`src/ui/results.ts`): summary tiles at the top with a PB badge (and the old best) on each new best, Typing WPM per wave as a line chart with the value on every point and the run's Typing WPM as a dashed line (hover a point for accuracy, typos and bonus), a QWERTY heatmap with the accuracy % on each key (warmer = worse, full colour at `stats.heatFloor` 80%), worst 5 keys, typoed words, Restart (Enter) and Main menu (M).

## v2 decisions for later parts (answered before Part A)

- **Spits vs lock-on**: strict lock. You finish your current word before you can type a blob's word.
- **No grenade and no sound-wave blast, for now.** Ton first swapped the grenade for a sound wave that kills every enemy, then dropped it before Part F. So ignore the grenade parts of GAME_SPEC.md (Space, the mana bar, its HUD icon and score bonus). Space does nothing and is never a typo. Part F has no blast-kill score.

## Commands

- `npm install` first after cloning or moving the folder (node_modules isn't committed).
- **Models are not in git.** Everything under `public/assets/models/` is gitignored (licensed downloads, ~35 MB) and lives only on disk, so back the folder up yourself. Layout: the models the game loads sit at the top (`bisk_lod.glb`, `zombie_dog.glb`, `zombie_blind_hunter.glb`, `freezombies/`); `source/` holds originals the build scripts read (`bisk.glb` for `npm run simplify:bisk`); `unused/` holds models no longer used (`zombie_rinono.glb`, `polyart_zombies.glb`).
- `npm run dev`: dev server at http://localhost:5173
- `npm test`: game logic tests (vitest, no Three.js)
- `npm run build`: typecheck and production build
- In game: F2 = WPM/spawner readout, backquote = tuning panel. `window.__dk.step(dt)` runs one frame by hand when the tab gets no frames.
