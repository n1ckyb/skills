---
name: art-direction
description: Visual identity for Drive-Evird — the brand palette, the cop-blue/robber-red role colour language, night-city setting and lighting model, material and shader style, UI/HUD treatment, and logo usage. Use when building anything the player looks at: HUD, menus, title and splash screens, vehicle materials, city materials, lighting, particles, or icons.
---

# Art direction

Two brands, one game.

- **BickyNee** — the studio. Warm, playful, cartoon, glowing. Appears on the launch
  splash and in credits. Nowhere else.
- **Drive-Evird** — the game. Chrome, red, blue, aggressive, high-contrast on black.
  Everything the player sees in-game descends from this.

They are deliberately different in tone. Do not harmonise them.

Source files and usage rules: `assets/brand/README.md`.

## Palette

Sampled from `assets/brand/drive-evird-logo.png`.

### Core

| Role          | Hex       | Notes                                                                |
| ------------- | --------- | -------------------------------------------------------------------- |
| Void black    | `#000000` | The logo sits on true black. Backgrounds, letterboxing, menu ground. |
| Chrome light  | `#F8F8F8` | Metal highlight, primary text                                        |
| Chrome mid    | `#C8C8C8` | Brushed metal body                                                   |
| Chrome shadow | `#989898` | Metal falloff                                                        |
| Steel dark    | `#484848` | Bevel underside, panel fill                                          |
| Steel deep    | `#383838` | Carbon/hex mesh, darkest readable surface                            |

### Role colours — this is the important one

| Role           | Hex       | Used for                                         |
| -------------- | --------- | ------------------------------------------------ |
| **Robber red** | `#F80808` | Primary `#F80808`, mid `#C80808`, deep `#A80808` |
| **Cop blue**   | `#0858C8` | Primary `#0858C8`, mid `#0848A8`, deep `#082858` |

**The logo already encodes the game's core opposition.** Blue speed streaks on one
side, red on the other, chrome down the middle. Use it: blue is _always_ police, red
is _always_ the robber, everywhere — vehicle liveries, HUD, minimap blips, heat
indicators, siren light, menu accents, win/lose screens.

Establishing this once and never breaking it means the player can read a chase
peripherally, at speed, without processing text. That is worth more than any HUD
element.

Two constraints on it:

- **Never use red or blue decoratively.** If something is red it means robber. A red
  building sign or a blue neon strip breaks the whole system. Reserve both hues; the
  city palette below is deliberately built to avoid them.

  **One sanctioned exception: traffic signals** (#26). They were asked for as real
  red/amber/green, and a magenta stop light is a puzzle rather than a signal. The
  exception is bounded three ways, and the bounds are what keep it from spreading:

  - The signal red is `#E01818`, **not** `#F80808` — deeper and less hot, so the
    exact role hue stays unique to the role. A test in `tests/palette.test.ts`
    asserts the two stay distinguishable, so it cannot quietly drift.
  - Shape and stillness carry the difference. A signal is a 0.34 m lens in a
    three-lens housing on a fixed mast, never moving, no glow halo. A robber's
    red is large, moving and weaving, and motion is the strongest cue the eye
    has.
  - Signals never appear on the minimap, which is where a red mark means one
    thing and only one thing.

  Nothing else in the city may use those three colours. If a second exception
  ever looks tempting, that is the moment the system starts costing more than it
  pays.

- **Colour is never the only signal.** Red/blue is a safe pair for the common forms of
  colour blindness (which affect red/green), but low-vision and glare-on-a-phone-screen
  are real. Pair every role colour with a shape or icon — chevron vs shield, solid vs
  hollow blip.

### The night-city emissive palette (#26)

Lives in `src/sim/city/palette.ts`, which is the only place it is written down —
it had been declared independently in six places before that and was drifting.
Windows, signage and street lamps all read from it, and the renderer reads the
same values the generator does.

| Name    | Hex       | Hue  | Used for                               |
| ------- | --------- | ---- | -------------------------------------- |
| Magenta | `#FF2D95` | 330° | The workhorse sign colour              |
| Sodium  | `#FF9A2E` | 31°  | Street-level warmth, the smog's colour |
| Gold    | `#FFD24A` | 45°  | Signage that reads at distance         |
| Jade    | `#29E0A6` | 161° | The cool end, kept clear of cyan       |
| Violet  | `#B84DFF` | 276° | The other cool end, kept clear of blue |
| Ivory   | `#FFE7C4` | 36°  | Unsaturated; lets the others be loud   |

Window light runs `#FFB25A` warm to `#BCDFD0` cool by district tone. The cool end
is deliberately the _quieter_ of the two: cool glass outnumbers warm across a
downtown skyline, so matching them for saturation does not read as balance, it
reads as a green city.

**This is a real departure from the reference, and on purpose.** Classic
neon-noir is drenched in red and cyan, which are exactly the two hues the role
system reserves. A city that glowed either would put a car-coloured light at the
end of every street. Cyan (180°) was the closest rejected candidate.

Two things measured rather than assumed, both now in `tests/palette.test.ts`:

- **Hue distance is a weak instrument on its own.** Amber simply _is_ close to
  red on the wheel — the whole warm family sits 29–32° off it, and nothing can
  change that. What actually makes robber red unmistakable is its channel shape:
  it has no green and no blue (0.03 of each against 0.97 of red), and cop blue is
  the mirror. Every colour above breaks one of those shapes by a wide margin.
  Check a new colour against the shape, not just the angle.
- **Fog rotates hue, and not in the direction you would guess.** Magenta fading
  into the violet haze moves _away_ from red (29.7° → 60.4°) because of its high
  blue channel — that is what the high blue channel is for. Warm amber does the
  opposite: it loses green faster than red and rotates _toward_ red, reaching 6°
  at three-quarter haze. That is not a bug to design away; by then the colour is
  a dim smudge at value 0.36 against robber red's 0.97, and brightness is what
  separates them. Do not write the tempting blanket rule "every emitter stays 20°
  off red at every fade" — it is false.

### Billboards and invented brands

Sixteen advertisers in `src/sim/city/billboards.ts`, painted into one atlas at
boot by `src/engine/billboards.ts`. They are what gives the city _language_ —
before them every lit thing was an abstract coloured panel, which reads as a
lightshow rather than as a place where somebody is trying to sell you something.

Rules for adding one:

- **Parody the category, not a company.** A cola, a bank, a noodle bar, a payday
  lender. A knock-off of a specific firm's name or trade dress is a different
  thing from a joke about advertising, and only one of them belongs in a shipped
  game.
- **The accent is a name from the neon palette**, never a free hex value.
  Billboards are the largest lit surfaces in the world and the easiest place to
  put a robber-red glow at the end of a street by accident. The type enforces it;
  a test asserts it as well, because a widened type would not fail anything else.
- **Keep names to about 16 characters and taglines to about 26.** The painter
  shrinks text to fit rather than clipping, so an over-long tagline does not
  overflow — it silently shrinks to unreadable.
- **The array index is the atlas cell.** Appending is safe; reordering repaints
  every billboard in the world.

Placement is the part that nearly failed. Boards went on rooftops first, which is
correct, looks right in a high wide shot, and is invisible from the chase camera
— it sits low, behind the car, looking level, and the roof of a 60 m tower is
above the top of the screen. Most boards now hang flat on building walls in a
**fixed height band about 17 m up**, not at a fraction of the building's height:
a fraction puts them at 33 m on a tower and 16 m on a low block, so half end up
out of view. Real city advertising clusters low for exactly the same reason.

### Studio palette (BickyNee splash only)

| Role          | Hex       |
| ------------- | --------- |
| Gold          | `#F8C828` |
| Amber         | `#F89818` |
| Cocoa outline | `#682818` |
| Cream         | `#F8F8E8` |
| Denim         | `#385888` |

## Setting: night city

**Recommendation: the game is set at night.** This is where brand and mobile
performance point in the same direction, which is rare enough to take.

Brand: the logos are built on black with hot chrome, red and blue. That is a night
palette. A bright midday city would look nothing like the game's own identity.

Performance (see `mobile-web-ios`): real-time shadows are typically the single most
expensive feature in a mobile 3D scene. At night you largely don't need them —

- Buildings become dark silhouettes with **emissive** window textures. Emissive is
  nearly free and reads as detail without geometry.
- Streetlights become emissive geometry plus cheap baked pools of light on the road,
  not real lights.
- Blob shadows under vehicles are sufficient and cost almost nothing.
- Low ambient light means distant LOD geometry can be far cruder before it's noticed,
  which directly relaxes the budgets in `procedural-world`.
- Wet-road reflections give enormous visual return for a screen-space or cubemap trick,
  and they make the red/blue role colours smear across the road surface — reinforcing
  the brand for free.

Consequence for the world generator: district variety must come from **silhouette,
density and window-light colour temperature**, not from surface colour, because at
night surface colour barely reads.

### The road must be the lit thing

At night the road is what the player reads the world through, so it has to be
_lighter_ than the ground around it. The first pass had asphalt at `#26262b` on
ground at `#383838` — the road darker than the dirt it lay on — and the network
was effectively invisible from every angle, at every distance. That is a bug, not
a matter of taste: a road you cannot see is a road you cannot follow at speed.

Now ground `#141417`, side streets `#3a3a42`, arterials `#4c4c56`. The arterial
step is doing navigational work: the through-route reads from a distance with no
signage and no minimap.

The general rule, and it applies to every marker in the game: **decide what the
player is meant to read, and make that the brightest thing in frame.** Everything
else is context and should sit down.

## Materials

- **Vehicles**: the hero assets. Metallic PBR with a strong environment reflection —
  this is what makes chrome read. Player and cop cars carry the role colours as livery.
- **City**: low-saturation, low-cost. Dark greys and browns, emissive windows. Avoid
  red and blue entirely (see above).
- **Road**: dark, slightly reflective, high-contrast white markings. Markings are a
  navigation aid at speed, so keep them bright.
- Shared texture atlases, KTX2/Basis compressed. One material per atlas, not per
  object — material count is a budget (see `babylon-havok`).

## Effects

Sparingly — post-processing is the first thing cut on mobile.

- Speed: the logo's motion streaks translate to a subtle radial blur or streak effect
  at high speed, ramped by velocity. Strong sense-of-speed return for low cost.
- Siren light: a pulsing blue emissive wash on nearby surfaces is one of the highest
  value effects in the game — it communicates proximity without the player looking
  anywhere. Budget for it deliberately.
- Tyre smoke and sparks on impact, keyed off the tyre model's slip values so effects
  reflect what the physics is actually doing.
- No bloom-everything. Bloom on emissive windows and siren lights only.

## UI and HUD

The logo's treatment — heavy bevel, thick outline, chrome gradient, glow — belongs on
the **title screen and menus**. It does not belong on the HUD.

In-game HUD is **glanceable above all else** (see `mobile-web-ios`): flat, high
contrast, minimal outline, no gradient, no glow that competes with siren lighting. The
player is reading it in peripheral vision at 120km/h. Brand expression happens in the
moments they can actually look — splash, title, menus, results screen.

Typeface: a heavy italic/slanted sans matching the logo's energy for titles; a plain,
highly legible sans for HUD numerals and body. Do not set HUD numbers in the title face.

## Vehicle design language

Bodies are **procedural**, lofted in code from cross-sections along the length
(`src/engine/car-mesh.ts`), not loaded as models. That keeps the download small —
the bundle is already dominated by the physics WASM — costs no asset pipeline, and
makes the silhouette a tunable rather than a file.

What turns a box into a car, in rough order of impact:

1. **Taper the roof inward and rake the screen.** A constant-width extrusion reads
   as a brick no matter how good the material is. Cross-sections carry separate
   widths at sill and roof; narrowing the roof is what gives it a cabin.
2. **Glass that is the hull's own panels.** Split the loft at a belt line: roof
   and screens on top, windows and pillars on the flanks, paint below. See
   "The skin is one loft, split by a belt line" below for why not a second shell.
3. **Lamps, and they must differ front to rear.** White and wide at the front,
   red and higher at the rear. This is the directional cue that survives distance.
4. **Registration plates** — white front, yellow rear. Cheap, and they anchor the
   car to a real-world read instantly.
5. **Trim that follows the contour.** Stripes generated from the same stations as
   the body sit on the surface; a straight box laid over a curved deck floats.

**Place trim from the real cross-section, never by eye.** The hull tapers hard at
nose and tail, so the surface there sits well above the centreline. Headlamps
positioned at a plausible-looking height ended up entirely _inside_ the body and
simply did not appear — no error, no warning, just no headlamps. Interpolate the
section at that z and place against it, protruding slightly.

**Two profiles, two silhouettes.** Robber is a low fastback coupe; cop is a taller
saloon with an upright screen, a door stripe, and a roof lightbar. The lightbar is
the single strongest identity cue in the game — readable from any angle, at any
distance, before colour resolves. Profiles must differ in _outline_, not only in
paint, because paint is the first thing distance takes away.

**A cue the same colour as what it is mounted on is not a cue.** The lightbar
spent its first version as a flat slab of emissive `COP_BLUE` laid flush along
the roofline of a car painted `COP_BLUE`. It was present, correctly positioned,
and completely unreadable: same hue, near-identical value, no outline breaking
the roof. It survived a full angle-by-angle inspection pass unnoticed, because
"a blue shape on the roof of a blue car" looks like bodywork rather than like a
missing feature — which is the harder kind of defect to catch than a part that
simply isn't there.

Three things fixed it, and they generalise to any marker sitting on a
role-coloured surface:

- **Separate in value, not hue.** A near-black housing under the pods is what
  makes them read against blue. Hue contrast alone fails at distance and fails
  harder under glare.
- **Break the outline.** Raise it clear of the surface, so there is something to
  read before colour resolves at all.
- **A light must out-value the paint.** Emissive at roughly the body's own
  brightness reads as a differently-shaded panel. `#8FC4FF` reads as a lamp;
  `COP_BLUE` at 0.9 did not.

Note what stays off the table: the conventional red-and-blue bar. Red means
robber everywhere in this game, and a red pod on a police car breaks the one
system the whole chase is read through.

**Glass needs an interior behind it.** Transparent windows onto an empty shell
look worse than opaque ones — the cabin reads as a modelling error. A tub, a
dash line and two seat blocks are enough. Leave the glass in the same rendering
group as the paint: Babylon draws blended meshes after opaque ones within a
group, so the interior sorts correctly on its own.

**The skin is one loft, split by a belt line** (#38). The greenhouse spent a
long time as a second, inset copy of the cabin stations drawn in a later
rendering group so that it would land on top of the paint. Rendering groups
clear the depth buffer between them, so "on top" meant on top of _everything_:
the roof, the mirrors and the stripes were all tinted, and a painted roof was
impossible because the shell covered it. Now `src/engine/hull.ts` classifies
each surface of the loft — roof, screen or deck on top; window, pillar or body
on the flank — and sends it to the paint mesh or the glass mesh. The roof is
red, there are A- and C-pillars, and the glass depth-tests like anything else.

Three more things from the same pass, each a number before it was a picture:

- **Cover the wheels.** The track is wider than the body on purpose (tuning),
  so the tyres stood 17 cm proud of a flat flank, which is the single strongest
  "toy" cue there is. Arches are lofted out from the flank over each tyre,
  placed from the tuning's wheel position and the suspension's rest height
  rather than by eye, and _closed_ — an open blister shows the sky through the
  car from a low front angle, because its underside is backface-culled and so
  is the far side of the hull. Swell the sills at the wheel stations so the
  arch finishes a curve the flank started; out of a flat side it reads as a box
  bolted on.
- **Put the body on its wheels.** The coupe's sill line sat level with the
  hubs: 35 cm of daylight under a car whose brief is "low". Ten centimetres of
  sill did more for the stance than anything above the belt line.
- **A black drum is not a wheel.** The eye reads a car by its wheels before its
  body. Five spokes on a dark dish behind a bright lip, painted once into a
  shared texture on the cylinder's caps, is the least drawing that reads — and
  because the cap UVs turn with the mesh, it spins.

And one that the tests, not the photographs, found: **both end caps of the
hull were wound inward**, and the nose only looked solid because the tail cap
was showing through the open front. `hull.ts` exports a `faceNormal` that
computes exactly what Babylon's `ComputeNormals` computes, and
`tests/hull.test.ts` checks every triangle against the section centre. Do the
same for any new lofted part; a wrong-wound face has no error and no warning.

**Second pass, and what it measured** (#38, iteration 2). Five critics, three
refuters per proposal, and a review panel over the result. What survived is
in the code; what the pass learned is here:

- **A shared material is a fleet decision.** A stripe proposal wanted the
  chrome trim toned down to grey; that material is also the cop's white door
  panels and every car's handles. It was refuted before it was written. Check
  `view.ts`'s material list before changing a colour: most of them are shared
  across all three profiles on purpose, and the merge groups depend on it.
- **"Black" is brown under this lighting.** The hemispheric light's warm ground
  colour turns the rubber trim olive-brown wherever a street lamp reaches it.
  It still sits below the paint in value, which is what the rule asks, but do
  not expect anything on the car to read as black at night.
- **A rest lamp has to out-value lamp-lit paint.** Robber red saturates under a
  street lamp, and a brake lamp at a quarter of its brightness went darker than
  the paint beside it. The rear now reads through a dark tail panel, a light
  bar and the wing's outline, which is hue and silhouette doing value's job;
  raising the lens further would cross the bloom threshold. Per-profile rest
  levels, so traffic's lamps stay dim.
- **Every car needs the interior tub.** Traffic went without one, and once the
  lamps were brighter they shone straight through two panes of empty
  greenhouse. The rule about glass needing an interior has no exceptions.
- **The front still has the trim-versus-lamps problem.** The chrome bonnet
  stripes foreshorten into two white bars directly above the headlamps from
  dead ahead, and at night they flip between black and white with the angle.
  Next pass: end them before the nose, and give them a finish that does not
  read as a lamp.
- **The loft is flat-shaded.** Unshared vertices mean every station panel and
  every arch facet lights separately, and the front arch tops read as a second
  pair of lamps from behind. Splitting or sharing normals deliberately is the
  next geometry job.

**Photograph the car lit.** `node tools/car-look.mjs <dir> [player|cop|civilian]`
floods the scene and orbits one car, and prints every part's extent in the
chassis frame first. Judge the geometry from the numbers and confirm with one
frame; the night scene is the game and is the wrong place to judge a model.

**Openable panels are hull holes, not overlays.** The bonnet and boot are
separate hinged meshes, and the hull leaves its upper surface out beneath them.
Two consequences that are easy to get wrong:

- The opening needs a **lined tray** — floor and four walls. A solid box fills
  the bay and swallows whatever should sit in it; the hollow hull cannot stand in
  for the walls, because its far side is backface-culled when seen from within.
- Trim over a panel must be **a child of the panel**. Stripes left on the chassis
  hang in mid-air the moment the bonnet lifts.

Panels are flush with their opening, not inset. A panel narrower than its hole
leaves a slot looking straight into the bay, which reads as a hole in the car
rather than as a panel gap.

**Do not let trim compete with the lamps.** Stripes originally ran to the tail and
read as a second pair of lamps from behind. At the rear, the brake lights must be
the only bright thing.

## Readability checks

Findings from inspecting the build from every angle (the visual inspection pass in
`game-testing`). These are cheap to get right and expensive to notice late.

**A contact shadow is what puts an object on the ground.** Without one, a vehicle
reads as pasted onto the scene rather than resting on it, and — worse for this
project — you cannot tell by eye whether the suspension is actually in contact.
That makes handling impossible to judge visually, which is exactly what the tuning
work needs. Blob shadows are nearly free and are the specified approach; they are
not polish, they are the thing that makes the simulation legible. Judge this from a
**ground-level** angle, where floating is unmistakable.

**The silhouette must be directional.** In a cops-and-robbers chase the player has
to read which way another car is facing instantly, in peripheral vision, at speed.
A shape that looks the same from the front and the back fails that regardless of how
good the materials are. Front and rear must differ in silhouette — not only in
lights or colour, which vanish at distance and in glare. Check by viewing the front
and rear shots side by side; if you cannot tell them apart, neither can a player.

**A hard cut from ground to sky reads as a cliff edge.** With no fog or horizon
treatment, the ground plane simply stops against the background and the boundary
draws the eye to exactly the place nothing interesting is happening. The night
setting makes this easy to solve: fog the far field to the background colour so the
ground fades out instead of ending. This matters more, not less, at night, because
the contrast between lit ground and black sky is at its highest.

**Long thin repeated geometry aliases at grazing angles.** Ground lines and lane
markings converge near the horizon and pile into a solid bright band. Anything read
at speed on a large ground plane needs either fading with distance or a
distance-aware treatment. See also the mip-selection note in `game-testing` — a
large ground plane is a hostile surface for fine detail, whichever way you draw it.

## Logo usage

- Splash on launch: **BickyNee** (studio), then title screen: **Drive-Evird** (game).
- Never on a light background; both are built for dark.
- Never restyle, recolour, stretch, rotate, or add effects.
- Maintain clear space around the game logo of at least the height of the "D".
- Both current files have a baked dark background and are raster only — transparent
  and vector sources are still needed **for icons**. The splash and title screen ship
  without them: both grounds are dark, and the marks composite invisibly onto a
  matching one (see below).

### Shipping the raster marks

**Match the screen's ground to the logo's own baked corner, not to `#000`.** The game
logo's corners sample at rgb(0,0,0) and go straight onto void black. The studio logo's
corners are rgb(16,9,21) — dark, but not black — and on a true-black splash it showed
as a visible rectangle. The splash ground is `#100915` for exactly that reason.
`tools/brand-encode.mjs` prints the sampled corner of each mark on every run, so the
number is checked rather than remembered.

**The PNGs cannot ship as they are.** 3.2 MB of reference art against a 1200 KB
gzipped budget for the whole game, and PNG does not gzip. Re-encoded to WebP at the
size each is actually drawn at, both marks together are ~53 KB. Target the drawn size
plus roughly 1.5× for a retina panel — encoding for the largest desktop window doubles
the bytes for pixels nobody on a slow connection will see.

**Splash art must be preloaded with `fetchpriority="high"`.** Left to the browser's
own priorities the 19 KB splash image queues behind the ~430 KB engine chunk. Measured
on a 400 KB/s connection it decoded at 1875 ms — the same instant the menu replaced
it. The splash was a bare dark screen for its entire life and the logo appeared only
as it was being dismissed, which is the precise failure a splash exists to prevent. A
mark that arrives after the screen it belongs to is worse than no mark. Preload the
title art too: referenced only from script-created DOM, it does not start downloading
until the menu is already on screen.

**Do not put a detailed illustrated logo in small UI.** The studio mark was tried at
34 px in a credits line and reads as an orange smudge. Illustration needs room; below
roughly 80 px it stops being brand expression and becomes noise. Set the name as type
instead and give the mark a screen where it has space.

### Role colour on menus

The palette lists "menu accents" among the places role colour is used, and it is still
the wrong choice for a _primary action_. Red means robber and blue means police
everywhere else in the game; a red button meaning "start" is the first crack in that
system. The title screen's primary action is chrome on black — the highest contrast
available — and the brand expression is the logo, which already carries both hues.

Two related notes from building that screen:

- **Chrome shadow `#989898` is the floor for type on black.** Steel dark `#484848` is a
  surface colour. Used for section headings and a link it was technically visible and
  practically unreadable on a phone.
- **Landscape is a contract, and it is short.** A landscape phone is ~390 CSS px tall.
  A vertical stack of menu sections puts everything below the fold. Two columns.
