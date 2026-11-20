// Word lists.
//
// Source: written by hand for Dead Keys (common English words), released
// as CC0 / public domain. Not copied from Monkeytype or any other project
// (GAME_SPEC rule 7). Lowercase a-z only; single letter words are left out
// because they would die on the first key.

/** "English 200": short, common words for normal zombies. */
export const ENGLISH_200: readonly string[] = dedupe(`
the be to of and in that have it for not on with he as you do at this but his by from they we
say her she or an will my one all would there their what so up out if about who get which go me
when make can like time no just him know take people into year your good some could them see
other than then now look only come its over think also back after use two how our work first
well way even new want because any these give day most us great small world still hand high
life place part run house point old keep find both long home last eye never under might while
night close open dark dead door word fear walk light left right end turn head face blood bone
cold wall city street rain fire smoke ash grave rot bite claw flesh skull teeth hunt hide run
wait stay quiet scream shout fight shoot gun load aim fast slow near far deep down below above
moon fog mist alley brick rust iron glass key lock gate floor roof stair window shadow ghost
crawl limp drag moan groan howl hungry sick pale grey black red burn break crack drop fall
jump kick push pull grab hold climb sleep wake dream blind eyes mouth arms legs heart brain
zero quick queen joke jaw knife axe vat yard young your zone box wax fix six
`);

/** Long, awkward words for the Blind Hunter elite (8 to 14 letters). */
export const HARD_WORDS: readonly string[] = dedupe(`
abandoned aftermath ambulance apocalypse asphyxiate barricade bewildered blasphemy bloodthirsty
breathless butchered calamitous carnivorous catastrophe cemetery claustrophobic contagious
corrupted crematorium decompose deformity delirious desecrated desolation devastation disfigured
dismember dreadful embalmed emergency epidemic exhumation extinction festering flashlight
frightened gangrenous ghoulishly gruesome hazardous hemorrhage hideousness hollowness horrified
hysterical incubation infection infestation jeopardize juxtapose kerosene knucklebone labyrinth
lacerated lockdown malignant massacre mausoleum midnight monstrous mortality mutilated necrotic
nightmare nocturnal oblivion obsidian outbreak overwhelmed pandemic paralyzed pestilence
petrified phantasm poisonous possessed putrefied quarantine quicksilver ravenous relentless
resurrect sacrifice scavenger screeching sepulchre shambling shrapnel sickening skeletal
slaughter spectral stagnant strangled suffocate survivor terrified threshold tormented
treacherous tremendous unearthly unhallowed unrelenting vaccination vengeance vigilance
virulent vulnerable wasteland wilderness withering wretched xylophone yesterday zealously
zombified
`);

function dedupe(text: string): readonly string[] {
  const words = text
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{2,}$/.test(w));
  return [...new Set(words)];
}
