# AI realtor video tour

A narrated cinematic tour of a house: a slow orbit of the real photogrammetry
model, then a scripted camera through each room's panorama, with an agent
talking over it.

`CONTRACT.md` is the spec. This file is how to run it.

## Run it right now

No API keys, no floor plan, no panoramas needed.

```bash
npm install
npm run tour:build     # writes app/tour/build/maple/tour.json
npm run tour:serve     # http://127.0.0.1:5174
```

You get the full tour of a fixture house: eight rooms, a routed path through the
doorways, scripted camera moves, and word-synced captions. It plays silently,
because timings are estimated from word length until a voice key exists.

The panoramas are drawn procedurally, with compass ticks and labelled markers
where the windows and doorways are. They are also the calibration tool: if the
camera pans to a door marker and the marker is not centred, something disagrees
about the heading convention.

## Adding the keys

Nothing changes shape when keys appear. The same build produces the same
`tour.json`, with real audio instead of estimates and a written script instead
of the hand-written one.

```bash
$env:ELEVENLABS_API_KEY  = "..."      # PowerShell
$env:ELEVENLABS_VOICE_ID = "..."
$env:GEMINI_API_KEY      = "..."

npm run tour:build -- --gemini
```

- With `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`, each stop is spoken and
  timed from the returned character alignment. Results are cached by a hash of
  voice and text, so re-running is free and unchanged lines are never re-charged.
- With `GEMINI_API_KEY`, `--gemini` writes the narration from the floor plan.
  Without the flag, an existing `script.json` wins, which is what you want once
  a script has been tuned by hand.
- Optional: `GEMINI_TEXT_MODEL`, `ELEVENLABS_MODEL_ID`.

Pick the ElevenLabs voice deliberately. It is the single biggest factor in
whether the tour sounds like a listing or a robot.

## Building from the web app's rooms

The configure page collects room counts, not a floor plan, so `adapt.mjs` lays
those counts out into one: rooms either side of a corridor running back from the
front door, which is what gives every room a doorway and an outside wall.

```bash
node app/tour/build.mjs --config app/tour/fixture/room-config.json --name "18 Oakwood Drive"
node app/tour/serve.mjs --project app/tour/projects/property --build app/tour/build/property
```

`fixture/room-config.json` shows the shape: it is the web app's `RoomConfig` with
the `File` fields dropped. Room ids carry over from the web app, so panoramas
should be named after them — `panos/bedrooms-1.jpg`, `panos/garage.jpg`.

The layout is invented, not surveyed. That is fine while the interiors are
generated too, since the tour only has to be self-consistent. See section 1b of
`CONTRACT.md`.

## Using a real floor plan

A project folder needs `plan.json`, optionally `panos/<roomId>.jpg` and the GLB
named by `plan.model`.

```bash
node app/tour/build.mjs --project ../projects/maple
node app/tour/serve.mjs --project ../projects/maple
```

Missing pieces degrade rather than break: no GLB gives a placeholder house
sized from the plan's bounds, and a missing panorama gives the procedural one.
So the tour can be built the moment a floor plan exists, before any image has
been generated.

## Swapping in the interactive walkthrough

`public/scene.mjs` implements the five-method `TourScene` interface. The
director calls nothing else, so pointing it at the real walkthrough is one line
in `public/tour.js`:

```js
const scene = new WalkthroughScene(dom.stage, { plan });
```

as long as that class exposes `showExterior`, `showRoom`, `lookAt`, `drift` and
`setInteractive`. If it has its own API, write an adapter object with those five
methods rather than changing the director.

The walkthrough that landed in `public/360-tour-builder/` is Pannellum, and it
maps onto the interface closely: `loadScene` is `showRoom`, `setYaw`/`setPitch`/
`setHfov` are `lookAt`, and `startAutoRotate` is `drift`. Two things to watch —
Pannellum's `hfov` is horizontal where our `fov` is vertical, and its per-scene
`northOffset` is the knob that reconciles its yaw with our heading 0.

Keep `scene.mjs` afterwards. It is the fallback if the walkthrough breaks during
the demo.

## For the demo

Commit `app/tour/build/<project>/`, including the mp3s. Playback reads only
those files, so a committed build runs offline on any laptop with no keys and
no network.

Note that `.gitignore` excludes `*.glb`, so the exterior model is not committed
with it. Either relax that rule for the demo project or accept the placeholder
house in the opening shot.

## Layout

- `adapt.mjs` — turns the web app's room counts into a laid-out `plan.json`
- `targets.mjs` — room centres, doorways from shared walls, exterior walls
- `route.mjs` — orders rooms by walking the doorway graph
- `script.mjs` — Gemini structured output, or loads hand-written narration
- `voice.mjs` — ElevenLabs with timestamps, disk cache, estimated fallback
- `build.mjs` — resolves all of the above into `tour.json` plus audio
- `serve.mjs` — static server, no generation
- `public/scene.mjs` — reference TourScene
- `public/director.mjs` — plays keyframes off the narration's clock
- `public/placeholder.mjs` — procedural calibration panorama
- `fixture/` — a hand-written house and script, so everything runs with nothing
