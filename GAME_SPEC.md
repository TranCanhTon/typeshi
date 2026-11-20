# Typing Zombie Game: Spec v0.1

Working title: **Dead Keys** (placeholder, change anytime)

A first person typing shooter in the browser. You stand at one end of a dark alley, zombies walk at you out of the fog, and you kill them by typing the words over their heads. The game is also a typing trainer: it tracks your weak keys and feeds them back into the game.

---

## 0. Rules for Claude Code (read first)

1. **Build one milestone at a time** (section 9). When a milestone is done, stop, tell Ton how to run and test it, and wait for his OK before starting the next one.
2. **Ask before deciding.** Anything listed in section 10 (Open Questions), or anything this spec doesn't cover, gets a question to Ton first. Don't guess and build.
3. **Don't try to model characters, guns or detailed props in code.** Use placeholders (capsules, boxes, flat colors) until Ton provides assets. When a milestone needs assets, tell Ton exactly what to find and which format. **Exception: the alley itself is built in code** (section 8), using Ton's textures and props.
4. **All tuning numbers go in one config file** (`src/config.ts`). No magic numbers scattered around the code.
5. **All randomness goes through one seeded RNG**, because the daily run depends on it.
6. Keep game logic separate from rendering, so the rules can be tested without Three.js.
7. Don't copy Monkeytype source files or word lists unless their license allows it. Use word lists with a permissive license and note where they came from.
8. No real brand names or logos in the game world.

---

## 1. Tech

* Vite, TypeScript, Three.js
* Runs in the browser, no backend
* Saves to localStorage, or IndexedDB if history gets big
* Postprocessing through Three's EffectComposer with custom shader passes
* Positional audio through Three's audio or the Web Audio API
* A fixed timestep game loop for logic, with rendering on requestAnimationFrame

Suggested structure:

```
src/
  config.ts          all tuning numbers
  main.ts
  game/              pure logic: spawner, typing, combo, score, waves, rng
  render/            scene, camera, gun viewmodel, zombies, effects, post shaders
  ui/                HUD, word labels, menus, results screen
  audio/
  stats/             tracking, storage, analysis (weak keys, bigrams)
  words/             word lists and word picker
public/assets/
  models/  textures/  sounds/  fonts/
docs/refs/           Ton's reference screenshots
```

---

## 2. Core Loop

* The camera is fixed in first person at the near end of a narrow alley, with a gun held in the lower right of the screen.
* Zombies spawn at the far end, inside the fog, and walk toward the player.
* Each zombie has one word floating above its head.
* **No two zombies on screen ever share a first letter.** The spawner only picks words whose first letter isn't already in use. If no valid word exists, the spawn waits.
* **Lock on:** typing a letter that matches the first letter of any zombie's word locks onto that zombie immediately. The gun and camera turn smoothly to aim at it.
* **Locked until done:** there's no cancel. You stay locked until the word is finished or the zombie dies some other way (grenade).
* **Every correct letter fires one shot** at the locked zombie:
  * Muzzle flash, recoil, tracer, hit effect
  * The zombie flinches and **slows down a bit** (short slow, tunable)
  * That letter on the label changes color to show it's typed
* **Finishing the word kills the zombie.** Death effect (see section 10), then score.
* **Typo:** a wrong key while locked, or a key that matches no zombie when not locked.
  * The gun plays a **jam effect** (click sound, quick stuck slide animation, the expected letter flashes red). This is only feedback. There is **no delay**, you can keep typing immediately.
  * **Resets the combo.** Costs nothing else, no mana and no score.
  * The letter isn't consumed. You still need to type the correct one.
* **Death:** a zombie reaching the player (crossing the kill line) means instant game over. No health bar.
* **Space bar** throws the grenade (section 3). Space is never part of a word in phase 1. Pressing space when the bar isn't full does nothing and isn't a typo.

---

## 3. Combo, Score, Grenade

**Combo** = correct keystrokes in a row. Any typo resets it to 0.

**Score**
* Points per correct letter and per kill, multiplied by the combo tier
* Default tiers (tunable): 1x from 0, 2x at 10, 3x at 25, 4x at 50, 5x at 100
* Score only. **The combo never changes damage.**

**Grenade (mana bar)**
* Bar from 0 to 100
* Filled by clean streaks: each correct letter while the combo is above 0 adds a little, and hitting a combo tier adds a bonus. Exact rates are tunable (see section 10).
* Typos don't drain the bar, they just stop it filling by resetting the combo.
* When full, **space** throws a grenade that kills every zombie currently on screen. The bar resets to 0.
* Grenade kills give a small score bonus (tunable).

---

## 4. Modes

### Waves mode
* A set number of waves (default 20), like Brotato
* Each wave has a type, for example:
  * **Horde:** lots of zombies, short easy words
  * **Elite:** few zombies, long hard words
  * **Mixed:** a bit of both
* A short break between waves (default 5 second countdown) with the wave number shown
* Clearing the last wave shows a win screen and the results
* The exact wave list and design is an open question (section 10). Build the system so waves are defined as data in config.

### Endless mode
* Zombies keep spawning and difficulty keeps rising over time until you die
* Score and time survived are what count

### Practice range
* No death. Zombies stand still at different distances.
* Words are weighted heavily toward your weak keys and bigrams
* For drilling, not scoring

### Daily run
* Endless mode with a seed taken from the date, so the same words and spawns for everyone that day
* Keeps your local best for each day

---

## 5. Difficulty

**Word difficulty** = length plus rare letters plus awkward bigrams. The word picker can ask for "easy", "medium" or "hard" words from the active list.

**Adaptive difficulty** (toggle in settings, on by default)
* Measures your rolling WPM (current run plus recent runs)
* Sets zombie walk speed so the time a zombie takes to reach you is slightly shorter than the time you'd need at your average speed, so it's always a bit too fast
* In waves mode it scales the base speed. In endless mode the ramp goes on top of it.

---

## 6. Words (Monkeytype style settings)

* **Word lists:** English 200, English 1k, English 10k, Home row only, Code keywords, Custom (paste your own list)
* **Punctuation toggle:** adds things like `, . ' ; ! ?` to some words
* **Numbers toggle:** swaps some words for numbers
* **Capitals toggle:** off by default, lowercase only
* **Weak key focus toggle:** a share of words (default 30%) is picked to contain your weakest keys and bigrams
* **Mistake replay toggle:** words you typoed last run come back in the next run

---

## 7. Training Stats

Tracked every run and saved:

* Raw WPM and net WPM
* Accuracy
* Consistency (how even your speed is)
* Best streak
* Score, wave reached, time survived
* **Per key:** hits, misses, average time to press
* **Per bigram** (letter pairs like `th`, `ie`): accuracy and average time
* **Reaction time:** time from a zombie's word becoming readable to your first letter on it
* **Panic accuracy:** accuracy while the closest zombie is near (inside 30% of the alley length) vs while everything is far
* The list of words you typoed

**Results screen** after each run:
* Summary numbers at the top
* WPM over the course of the run as a line graph
* A keyboard heatmap of accuracy per key
* Worst 5 keys and worst 5 bigrams
* The words you missed
* A personal best badge if you beat one

**Progress screen** (from the main menu):
* WPM, accuracy and score over all runs as graphs
* Personal bests per mode and per word list
* How your weak keys have changed over time

**Every chart and heatmap shows the actual numbers on it** (values and counts as labels), not just colors or bars.

---

## 8. Look and Feel

Reference screenshots go in `docs/refs/`. Look at them before building anything visual.

* `ref_alley.png`: **the setting.** A narrow city alley with brick and plaster walls, graffiti, shuttered doors, pipes, windows above, and a wet stone floor.
* `ref_fog_station.png`: **texture and fog.** Low res textures, deep fog swallowing the distance, glowing lamps.
* `ref_ps1_town.png`: **the retro look.** PS1 era, blurry low res textures, thick fog, grim.
* `ref_font.png`: **font direction.** Old school RuneScape style pixel fonts.

### Scene
* **Build the alley in code** from simple geometry: two long building walls, a floor, recessed windows and doors, a back wall lost in fog. PS1 era levels were this simple anyway, so this fits the look. Detail comes from Ton's textures (brick, plaster, wet stone, graffiti decals) and a few downloaded props (dumpster, trash bags, streetlight). Until those exist, use flat colors.
* A narrow alley with buildings close on both sides. The far end disappears into fog and darkness, and zombies come from there.
* Clutter: trash bags, a dumpster, puddles, pipes, fire escape, a couple of shuttered doors, graffiti
* Night, heavy fog
* **Lighting: dark warm orange from a few sodium streetlights and wall lamps.** Pools of light with near black between them, so zombies walk in and out of the light as they come. One lamp flickers.
* Fog is dark warm brown near the lights and fades to almost black in the distance
* Small floating dust or drizzle particles

### Retro look (postprocessing, all intensities tunable)
* Low internal render resolution (start around 480x270), scaled up with nearest neighbor
* Vertex snapping (PS1 wobble)
* Nearest filtering on textures, low res textures
* Color reduction with ordered dithering
* Heavy distance fog
* A settings slider for retro intensity, from subtle to full PS1

### Readability (important)
* **Word labels and the HUD render at full resolution, on top of the retro pass**, not through it. The world can be crunchy, but the words must always be sharp.
* Labels always face the camera and get a dark backing so they read against the fog
* A word becomes readable once the zombie is close enough out of the fog (tunable distance). Before that, show a blurred or dimmed label.
* Colors: untyped letters in pale warm white, typed letters in orange, the locked target's label highlighted, a red flash on a typo

### Gun
* First person viewmodel in the lower right. Pistol or revolver as a placeholder until Ton provides a model.
* Per shot: recoil kick, muzzle flash that briefly **lights up the alley** (a real light, it should look great in the dark), tracer, small camera shake
* Jam: dry click plus a short stuck slide animation

### Zombies
* Placeholder: dark capsules with two glowing eyes until Ton provides models
* Walk, flinch on hit, die. Animations come from Ton's models when they arrive.
* **Death and blood:** Ton wants "a bit of blood and an effect when a zombie dies". The exact style is an open question, so **ask Ton before building it.**

### HUD and menus
* Minimal HUD:
  * Score top left
  * Combo and multiplier top right
  * Wave or time top center
  * Grenade bar bottom center, as a grenade icon that fills up and glows when ready (with "SPACE")
* Menus: dark brown and black panels with thin beveled borders, warm orange and yellow text, OSRS inspired, with light VHS noise
* The main menu background is the alley itself at low res, with a zombie standing in the fog
* **Font:** OSRS pixel style. RuneScape's own fonts belong to Jagex, so use a free look alike. Final pick is an open question.

### Sound
* Punchy gunshot on every letter, with 3 or more variations and slight random pitch
* Jam click
* Wet hit sound
* Positional zombie groans, so you can hear which side and how far
* Death sound
* Grenade explosion
* Ambience: wind, buzzing streetlight, distant dog or siren
* Music: open question, leave a slot for it

---

## 8b. Assets So Far

| File | What | Author | License | Notes |
|---|---|---|---|---|
| `public/assets/models/zombie_rinono.glb` | ANIMATION ZOMBIE | RINONO (sketchfab.com/Jguyfioy) | CC BY 4.0, **credit required** | Rigged, 64 bones, 4.6k triangles, one 1024px texture. Clips: `walk01`, `walk02`, `run`, `damage`, `death`, `idle01`, `idle02`, `attack01`, `attack02`, `caution`, `down`, `eat`, `on_all_four_A`, `on_all_four_B`, `on_all_four_eat`, `Default Take` |

| `public/assets/models/zombie_blind_hunter.glb` | Zombie Bind Hunter | KIFIR (sketchfab.com/kifir) | CC BY NC 4.0, credit required, **non commercial only** | **No rig, no animations**, 5.5k triangles, three 1024px textures. Look test only (M0). Don't use it in the real game unless Ton rigs it. |

| `public/assets/fonts/GamestationText.otf` | Gamestation Text | Derivative of Play by Jonas Hecksher (fontspace.com) | SIL OFL 1.1 | Word labels and HUD. License in `GamestationText-OFL.txt`; keep it next to the font. |

Using the zombie:
* Walk toward the player with `walk01` or `walk02`, picked at random per zombie, with randomized playback speed so they don't move in sync
* Hit flinch: blend in `damage` briefly
* Death: `death`
* Scale the texture down to 128 or 256 pixels with nearest filtering for the PS1 look
* Give each zombie a slight random tint and scale so a horde doesn't look like clones
* Phase 2: `run` for runners, `on_all_four_*` for crawlers

**Credits screen:** add a credits screen in the main menu. Every CC BY asset gets listed there with title, author and license. Keep this table updated as Ton adds assets.

---

## 9. Milestones (phase 1)

Stop after each one and wait for Ton.

**M0: Look test (do this first, before any gameplay)**

The goal is to nail the look and check the assets work before building the game. No typing, no score, no menus.

* Set up the project (Vite, TypeScript, Three.js) with the folder structure from section 1
* **Build the alley in code to match `docs/refs/ref_alley.png` as closely as possible:** same composition, narrow walls on both sides, windows above, shuttered doors, pipes, the alley turning or ending in the distance. Look at the picture, copy its layout and proportions, and make it PS1 and low poly. Flat colors or simple procedural colors for now, since Ton hasn't provided textures yet. **Don't cut textures out of the reference screenshots**, they're from other games.
* Take the texture feel, fog and grim mood from `ref_fog_station.png` and `ref_ps1_town.png`, but **light it dark warm orange** with sodium lamps, not the teal in the station picture
* Retro postprocessing from section 8: low resolution, vertex snapping, dithering, heavy fog
* Load `zombie_rinono.glb` and have 3 to 5 of them walk toward the camera from the fog with `walk01` and `walk02`, looping back to the start when they reach the camera. Press `D` to play `damage` on the nearest one and `K` to play `death`.
* Load `zombie_blind_hunter.glb` as a static model standing in the alley, just to compare how it looks. It has no rig, so don't animate it.
* A placeholder gun shape in the lower right of the screen
* A small debug panel (lil-gui or similar) with live sliders for fog density, fog color, light color and intensity, render resolution, dithering strength, vertex snap amount and texture downscale. **When Ton finds values he likes, write them into `src/config.ts`.**
* Fixed camera looking down the alley, with a tiny bit of idle sway
* Ton judges this by looking at it. Expect several rounds of "darker", "more fog" and so on before moving to M1.

**M1: Greybox core loop**
* The alley as plain boxes, a fixed camera, capsule zombies
* Spawning, unique first letters, words, lock on, a shot per letter, slow on hit, kill, typo with combo reset, death
* Endless mode only, basic score and combo, a word list (English 200)
* Plain HTML labels and HUD
* Goal: find out whether the loop is fun

**M2: Game feel**
* Placeholder gun viewmodel, recoil, muzzle flash light, tracer, flinch, camera turn on lock
* Jam effect
* Grenade bar and grenade
* Placeholder sounds
* Waves mode with a basic wave config

**M3: The vibe**
* Ton's models and textures in the alley
* Retro postprocessing, fog, orange lighting, flicker, particles
* Full resolution labels on top
* Final HUD and menu style
* Ask before doing the death effect

**M4: Training**
* All stat tracking, saving, results screen, heatmap, bigrams, mistake replay, weak key focus, adaptive difficulty

**M5: Settings and extra modes**
* All word settings (section 6), practice range, daily run, progress screen, retro intensity slider, volume settings

---

## 10. Open Questions (ask Ton before building these)

1. Zombie death effect and how much blood
2. Final font
3. Music, or none
4. The wave list for waves mode: how many waves, the wave types, and the mix
5. Grenade fill rates
6. Starting values for speeds, spawn rates, slow on hit, and how fast endless ramps (propose numbers, Ton tunes them by playing)
7. Gun model: pistol, revolver, shotgun?
8. Game name

---

## 11. Phase 2 (not now)

* Shop and/or Brotato style perk pick between waves
* Zombie types: runner, walker, brute with armor, boss, spitter (scrambles words), crawler (half hidden), screamer (calls more zombies)
* Sentences and quotes as a **separate training mode**, not in the zombie game
* Wave mutators inspired by Monkeytype's funbox (mirrored text, no labels until close, capitals only)
* Maybe online leaderboards for the daily run
