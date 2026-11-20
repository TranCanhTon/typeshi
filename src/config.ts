// All tuning numbers live here (GAME_SPEC rule 4).
// The debug panel (lil-gui) edits a live copy of these values; its
// "copy values" button prints a block you can paste back over LOOK below.

import { computeLayout, type StreetLayout } from './game/layout';

/** Where the player stands along the alley (z). Shared by the camera and the game rules. */
const PLAYER_Z = 1.5;

export const CONFIG = {
  /** Seed for the one RNG that drives every random choice (textures, trash, flicker...). */
  seed: 1337,

  // ---------------------------------------------------------------------------
  // LOOK: everything the M0 debug panel can tune. Paste "copy values" output here.
  // ---------------------------------------------------------------------------
  look: {
    render: {
      /**
       * Internal render width in pixels; height follows the window aspect (800 -> 450 at 16:9).
       * v2: up from 480 so characters, props and labels read cleaner. Wall textures stay
       * crunchy because they are 64 px with nearest filtering.
       */
      width: 800,
    },
    ps1: {
      /** 0 = no dithering, 1 = one full color step of ordered (Bayer 4x4) noise. */
      ditherStrength: 1.0,
      /** Levels per color channel. 32 = PS1 style 15 bit color. */
      colorDepth: 32,
      /** Vertex snap grid size in low res pixels. 0 = off, 1 = authentic, 3+ = exaggerated wobble. */
      vertexSnap: 1.0,
      /** 0 = perspective correct textures, 1 = full PS1 affine warping. */
      affineWarp: 0.25,
      /** Texture size in pixels (procedural textures are generated at 128 and scaled down). */
      textureSize: 64,
    },
    fog: {
      /** Exp2 fog density. Higher = the far end disappears sooner. */
      density: 0.034,
      /** Fog color close to the camera (dark warm brown). */
      nearColor: '#1d120a',
      /** Fog color far away (almost black). */
      farColor: '#060403',
      /** Distance (m) over which fog color goes from near to far. */
      colorDistance: 20,
      /** How much the lamps light up the fog around them (in-scatter glow). */
      lampGlow: 0.0009,
      /** Glow halo size (m): only view rays passing this close to a lamp glow. Bigger = hazier far end. */
      lampGlowRadius: 1.8,
    },
    lamps: {
      /** Sodium orange. */
      color: '#ff8c2e',
      /** Point light intensity (candela). */
      intensity: 34,
      /** Range in meters after which a lamp gives no light. */
      range: 10,
      /** Index of the lamp that flickers (-1 = none). */
      flickerLamp: 1,
      /** How deep the flicker dips go (0 = steady, 1 = goes fully dark). */
      flickerDepth: 0.85,
      /** Average seconds between flicker bursts. */
      flickerInterval: 2.2,
    },
    ambient: {
      color: '#3a2412',
      intensity: 0.3,
    },
    camera: {
      /** Eye height in meters. */
      height: 1.65,
      /** Vertical field of view in degrees. */
      fov: 68,
      /** Idle sway amplitude in meters. 0 = locked still. */
      sway: 0.012,
      /** Idle sway speed. */
      swaySpeed: 0.45,
    },
    dust: {
      count: 420,
      /** World size of a dust mote in meters. */
      size: 0.03,
      /** How strongly motes catch lamp light. */
      brightness: 1.4,
      /** Drift speed in m/s. */
      drift: 0.06,
    },
  },

  // ---------------------------------------------------------------------------
  // Fixed values (not on the debug panel)
  // ---------------------------------------------------------------------------
  camera: {
    /** Camera position along the alley (z). The alley runs toward -z. */
    z: PLAYER_Z,
    /** Point the camera looks at. Slightly above eye height, like the reference. */
    lookAtY: 2.25,
    lookAtZ: -22,
    near: 0.05,
    far: 220,
  },

  /**
   * The crossroads layout (sliders under "Layout" in the debug panel).
   * The main alley is 10% shorter than the old one: the crossing centre is 20 m
   * from the player, where the old alley's far turn was about 22 m away.
   */
  layout: {
    /** Whole main alley, from its start behind the player to its far end in the fog (m). */
    mainAlleyLength: 48,
    /** Player to the centre of the crossing (m). */
    crossingDistance: 20,
    /** How far each side street runs before it ends in the fog (m). */
    sideStreetLength: 22,
    /** Width of the side streets, which is also the depth of the crossing (m). */
    sideStreetWidth: 3.6,
    /** The sodium lamp hanging over the crossing (candela). */
    crossingLampIntensity: 40,
    /** Relative chance a zombie comes from each street (0 = never). */
    spawnWeights: { left: 1, straight: 1, right: 1 },
  },

  /** Alley dimensions in meters. Facade details (doors, windows) are in render/alley.ts. */
  alley: {
    /** Main alley walls at the near end. */
    leftX: -2.0,
    rightX: 2.0,
    /** Where the alley starts (behind the camera). */
    startZ: 7,
    groundFloorHeight: 3.3,
    floorHeight: 2.9,
    windowWidth: 1.0,
    windowHeight: 1.55,
    windowSillHeight: 0.75,
    windowDepth: 0.26,
    /** Chance an upper window is lit from inside. */
    litWindowChance: 0.06,
    /** Largest quad size in meters. Smaller = less affine warping, more vertex wobble detail. */
    maxQuad: 1.25,
  },

  /** World size (m) that one repeat of each tiling texture covers. */
  textureTile: {
    brick: 1.2,
    plaster: 2.0,
    floor: 2.0,
    grime: 3.0,
  },

  trash: {
    scraps: 90,
    cans: 7,
    bags: 4,
    puddles: 7,
    stains: 10,
  },

  /**
   * Sound (src/audio/audio.ts). Every event has a file name; drop files into
   * public/assets/sounds/ with that name and one of the extensions below. A
   * missing file is simply silent.
   */
  /**
   * Player settings from the pause menu, saved in localStorage under
   * `storageKey`. Defaults come from look.render.width and audio.volume.
   */
  settings: {
    storageKey: 'deadkeys.settings',
    renderWidth: { min: 320, max: 1920, step: 16 },
  },

  audio: {
    base: '/assets/sounds/',
    /** Tried in this order for each name. */
    extensions: ['ogg', 'mp3', 'wav'],
    /** Default volumes 0..1 (the pause menu settings override these and are saved). */
    volume: { master: 0.8, sfx: 0.9, ambience: 0.5 },
    /** Random pitch variation on gunshots (+/- fraction). */
    gunshotPitchJitter: 0.08,
    /** Event -> file names (several = a random pick each time). */
    files: {
      gunshot: ['gunshot_1', 'gunshot_2', 'gunshot_3'],
      jam: ['jam'],
      hit: ['hit'],
      zombieDeath: ['zombie_death'],
      runnerBark: ['runner_bark'],
      biskSpit: ['bisk_spit'],
      spitBreak: ['spit_break'],
      blinded: ['blinded'],
      soundwave: ['soundwave'],
      waveStart: ['wave_start'],
      gameOver: ['game_over'],
      ambience: ['ambience'],
    },
  },

  /** Word labels over the zombies' heads. */
  labels: {
    /** Font size in CSS pixels (fixed, so the layout doesn't shift as zombies approach). */
    fontSize: 24,
    /** Pop-in when a label appears: start scale and duration (ms). */
    popScale: 0.8,
    popMs: 100,
    /** Labels re-sort by distance only after the order has been different for this long (s). */
    reorderDelay: 0.5,
    /** How fast labels slide to their new spot (higher = snappier). */
    smoothing: 14,
    /** Vertical gap between stacked labels (px). */
    gap: 3,
    /** Extra sideways margin a pushed label keeps, so it doesn't flick in and out of the stack (px). */
    stackHysteresis: 12,
    /** Colour of the locked label's border, typed letters, its stem, and the outline on its zombie. */
    lockColor: '#ff9a3c',
    /** Outline thickness on the locked zombie (m). */
    lockOutline: 0.035,
    /** Every label has a stem down to its own zombie's head (px wide, colour). */
    stemWidth: 1,
    stemColor: 'rgba(241, 228, 200, 0.55)',
    /** Small type marker before the word. Walkers have none. */
    markers: {
      runner: '#ffd23a',
      bisk: '#5cff3a',
      blob: '#5cff3a',
      hunter: '#ff3a2e',
    },
    /** Marker size (px). */
    markerSize: 8,
  },

  // ---------------------------------------------------------------------------
  // GAME: gameplay tuning. These are first proposals (GAME_SPEC open question 6);
  // tune them by playing.
  // ---------------------------------------------------------------------------
  game: {
    /** Logic runs at a fixed 60 Hz. */
    fixedStep: 1 / 60,
    /** Where the player stands (z); label distance is measured from here. */
    playerZ: PLAYER_Z,
    /** A zombie whose z reaches this line has got you. */
    killZ: 0.3,
    /**
     * A zombie gets its word label (and can be targeted) once it is this close (m).
     * No label at all before that. Same distance where the old blurred label became readable.
     */
    labelDistance: 17,

    /** Minimum spacing between zombies so they bunch up less (m). */
    spacing: {
      /** Front to back: a new zombie won't take a lane until the last one in it is this far in. */
      depth: 1.4,
      /** Side to side: lanes are at least this far apart. */
      side: 0.85,
      /** Hunters are bulky: their spacing is multiplied by this. */
      hunterScale: 1.5,
      /**
       * Body width for walking behind someone (m): a zombie slows or stops for one in
       * front only if it is closer than this sideways, so neighbouring lanes flow freely.
       */
      bodyWidth: 0.55,
    },

    /**
     * Zombies spawn inside one of the three streets at the crossroads (weights in
     * CONFIG.layout.spawnWeights), walk to the crossing, turn into the main alley
     * and come straight at you.
     */
    streets: {
      /**
       * How far beyond the crossing they spawn (m). Side streets are hidden by the
       * corner buildings after ~2 m; the straight one by fog and darkness. Deeper =
       * a longer walk-in, which the adaptive spawner has to cover with more zombies.
       */
      spawnDepthSide: [2.5, 4] as [number, number],
      spawnDepthStraight: [2.5, 5] as [number, number],
      /** Keep spawn lanes this far from the side street walls (m). */
      wallMargin: 0.6,
      /** Lanes across the main alley on the way to you (x range). */
      laneX: [-1.2, 1.05] as [number, number],
      /** Waypoints used for the curve round each corner. */
      turnPoints: 6,
    },

    walker: {
      /** Walk speed in m/s at the start of a run. */
      speed: 1.1,
      /** Each letter you hit slows it to this fraction of its speed... */
      slowFactor: 0.3,
      /** ...for this many seconds. */
      slowTime: 0.4,
      height: 1.75,
      /** Random size variation (+/- fraction). */
      sizeJitter: 0.08,
      /** Random walk animation speed variation (+/- fraction). */
      animJitter: 0.15,
      /** Random tint variation (+/- fraction per channel). */
      tintJitter: 0.18,

      /**
       * Free Zombies pack by Denys Almaral (FAB). Ten rigged zombies on two
       * skeletons (female / male); animations are separate files per skeleton.
       * Each spawn picks a random zombie and a random walk style.
       */
      model: {
        base: '/assets/models/freezombies/',
        /** The rigs reference this texture by bare name; it lives in Textures/. */
        texture: 'Textures/zcolors.png',
        /** rig-gltf_joined/<name>_joined.gltf. The prefix says which skeleton it uses. */
        variants: [
          'ZombieFemale_A', 'ZombieFemale_B', 'ZombieFemale_C', 'ZombieFemale_D', 'ZombieFemale_E',
          'ZombieMale_A', 'ZombieMale_B', 'ZombieMale_C', 'ZombieMale_D', 'ZombieMale_E',
        ],
        /**
         * Walk styles: animation file suffix, and the ground speed (m/s) the feet
         * match at normal playback, so the cycle is sped up or slowed to fit the
         * zombie's actual speed. The clips walk in place; the game moves the body.
         */
        walks: [
          { file: 'walk_64f', groundSpeed: 0.65 },
          { file: 'slowWalk_85f', groundSpeed: 0.45 },
          { file: 'walk_agressive_64f', groundSpeed: 0.75 },
          { file: 'walk_limp_60f', groundSpeed: 0.5 },
        ],
        /** Keep playback within this range so very fast or slow walkers don't look silly. */
        timeScaleRange: [0.6, 2.2] as [number, number],
      },
      /** The pack has no hit or death animations, so both are procedural. */
      hit: {
        /** Lean back (rad) and knock back (m) on each hit, easing out over `time` seconds. */
        lean: 0.22,
        knock: 0.1,
        shake: 0.05,
        time: 0.3,
      },
      death: {
        /** Stagger, then topple backward over this many seconds. */
        toppleTime: 0.85,
        /** The walk cycle slows to a stop over this many seconds. */
        freezeTime: 0.2,
      },
    },

    /** Runner: the zombie dog. Fast, low, short words. */
    runner: {
      /** 1.8x the walker's 1.1 m/s. */
      speed: 1.98,
      slowFactor: 0.35,
      slowTime: 0.3,
      /** Its words are this many letters long (from the normal list). */
      wordLength: [3, 4] as [number, number],
      /** "Low poly zombie dog" by onmioji (CC BY 4.0). Swap the path to try another dog. */
      model: '/assets/models/zombie_dog.glb',
      /** Height at the shoulders (m). */
      height: 0.85,
      sizeJitter: 0.06,
      tintJitter: 0.15,
      /** Procedural gallop (no rig): strides per second at base speed, bob (m), body rock (rad). */
      gallop: { strideRate: 2.4, bob: 0.07, rock: 0.14, sway: 0.04 },
      /** Death: flops onto its side over this many seconds. */
      deathTime: 0.45,
    },

    /**
     * Bisk, the spitter (Bisk by Rahi_IV, CC BY 4.0, simplified and toned down
     * into bisk_lod.glb by `npm run simplify:bisk`). Shuffles to a stop point
     * partway down the main alley and stays there, spitting until killed.
     */
    bisk: {
      /** Shuffle speed (m/s). */
      speed: 0.55,
      slowFactor: 0.5,
      slowTime: 0.3,
      /** Where it stops: this far from the player (m). Keep it inside labelDistance. */
      stopDistance: 11,
      /** Bisks alive at once. */
      maxAlive: 1,
      model: '/assets/models/bisk_lod.glb',
      height: 1.95,
      sizeJitter: 0.04,
      /** Shuffle: steps per second, sway (rad), bob (m). */
      shuffle: { stepRate: 1.6, sway: 0.06, bob: 0.03 },
      spit: {
        /** First spit this long after its word appears (s)... */
        firstDelay: 2,
        /** ...then every this many seconds (+/- jitter) while it lives. */
        interval: 4.5,
        intervalJitter: 1,
        /** Lunge wind-up before the blob leaves (s). */
        windup: 0.4,
        /** Lunge: scale up and lean forward (rad). */
        lungeScale: 0.15,
        lungeLean: 0.35,
        /** Blob words are this many letters long. */
        wordLength: [3, 4] as [number, number],
        /** Seconds for the blob to reach you. */
        travelTime: 1.5,
        /** Height the blob leaves from, and arrives at (m). */
        launchHeight: 1.7,
        arriveHeight: 1.55,
      },
      /** A blob that reaches you blinds you for `time` seconds, fading back over the last `fade`. */
      blind: {
        time: 2,
        fade: 0.5,
        /** Blur radius at full strength (low res pixels), how much darker, and a green tint. */
        blur: 5,
        dim: 0.55,
        tint: 0.18,
        /** Labels at full strength: blur (px), and how much they fade (still faintly readable). */
        labelBlur: 2.5,
        labelFade: 0.5,
      },
    },

    /** The Blind Hunter elite: big, slow, one long hard word. */
    hunter: {
      speed: 0.7,
      slowFactor: 0.55,
      slowTime: 0.3,
      height: 2.5,
      sizeJitter: 0.05,
      /** When hunters appear and how often is in `waves.mix`. */
      /** Lurch animation: steps per second at base speed, sway (rad), bob (m). */
      stepRate: 1.4,
      sway: 0.09,
      bob: 0.07,
      lean: 0.12,
    },

    /**
     * Waves (both modes). Zombies only ever come in waves: a "Wave N" banner,
     * then the wave spawns; once everything in it is dead there's a break, then
     * the next banner. Waves mode ends after `count` waves with the win screen;
     * endless keeps going on the same formula. The wave formula is the only
     * thing that decides how many zombies come and how fast.
     */
    waves: {
      /** Waves in waves mode. */
      count: 20,
      /** How long the "Wave N" banner shows before spawning starts (s). */
      introTime: 2.5,
      /** Break after a wave is cleared (s). */
      breakTime: 3,
      /** Wave 1. */
      first: {
        size: 5,
        /** Seconds between spawns. */
        interval: 2.5,
        maxAlive: 3,
      },
      /** How each wave ramps from the one before. */
      ramp: {
        sizePerWave: 2,
        intervalFactor: 0.93,
        intervalMin: 0.8,
        /** Max alive goes up by 1 every this many waves... */
        maxAliveEvery: 2,
        /** ...up to this. */
        maxAliveCap: 8,
        /** Walk speed x this per wave... */
        speedFactor: 1.04,
        /** ...up to this. */
        speedMax: 1.8,
      },
      /**
       * Enemy mix: each type appears from wave `from` and is picked by weight
       * against the others available. Runner and Bisk arrive with Part C; until
       * then their spawns go to the types that exist.
       */
      mix: {
        walker: { from: 1, weight: 10 },
        runner: { from: 3, weight: 4 },
        bisk: { from: 4, weight: 1.6 },
        hunter: { from: 6, weight: 1.2 },
      },
      /** Hunters alive at once: `base`, and `late` from wave `lateFrom`. */
      hunterMax: { base: 1, late: 2, lateFrom: 13 },
    },

    words: {
      /** Normal zombies prefer words at or below this difficulty in wave 1... */
      difficultyStart: 4.5,
      /** ...rising by this every wave. */
      difficultyPerWave: 0.5,
      /** Don't repeat a word within this many picks. */
      recentMemory: 25,
    },

    score: {
      perLetter: 10,
      perKill: 50,
      perHunterKill: 250,
      /** [combo needed, multiplier] (GAME_SPEC section 3). */
      tiers: [
        [0, 1],
        [10, 2],
        [25, 3],
        [50, 4],
        [100, 5],
      ] as [number, number][],
    },
  },
};

export type LookSettings = typeof CONFIG.look;
export type GameConfig = typeof CONFIG.game;

/** The street layout from the current CONFIG.layout values. */
export function currentLayout(): StreetLayout {
  const A = CONFIG.alley;
  return computeLayout(CONFIG.layout, { playerZ: PLAYER_Z, startZ: A.startZ, leftX: A.leftX, rightX: A.rightX });
}
