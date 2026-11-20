# Sounds

Drop sound files here with these names. Each name can be `.ogg`, `.mp3` or `.wav`
(tried in that order). Anything missing is silent, so you can add them one at a time.
Event names and files are set in `src/config.ts` under `audio.files`.

| File | Plays when |
|---|---|
| `gunshot_1`, `gunshot_2`, `gunshot_3` | every correct letter (a shot); one of the three at random, with a slight random pitch |
| `hit` | the shot hits the zombie (plays with the gunshot) |
| `jam` | a typo (gun jams) |
| `zombie_death` | a zombie, runner, Bisk or Hunter is killed |
| `runner_bark` | a runner (zombie dog) spawns |
| `bisk_spit` | Bisk lunges to spit |
| `spit_break` | you break a spit blob by typing its word |
| `blinded` | a spit blob hits you |
| `wave_start` | the "Wave N" banner appears |
| `game_over` | you die |
| `ambience` | loops all the time (wind, buzzing lamps, distant dog or siren) |

Volumes (master, effects, ambience) are in the pause menu's Settings and are saved.
