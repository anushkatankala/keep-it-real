# AI video tour: integration contract

The narrated tour is built as an isolated module under `app/tour/`. It touches no
other workstream's files. This document is the agreement between it and the rest
of the project, so that the pieces merge without renegotiation.

Read this before producing floor plan data, generating panoramas, or building the
interactive walkthrough.

## How the tour plugs in

Generation is offline, playback is static.

```
plan.json + panoramas  ->  node app/tour/build.mjs  ->  tour.json + audio/*.mp3
                                                              |
                                          static page reads it, calls a TourScene
```

`build.mjs` is the only thing that talks to Gemini or ElevenLabs. It runs ahead of
time on a laptop and writes its output to disk. The tour page fetches those files
and nothing else, so playback cannot fail on a network call, a rate limit, or a
missing key. The built tour is committed, which means the demo works offline.

## 1. Input: `plan.json`

Produced by the floor plan editor. The tour reads it and never writes it.

```json
{
  "id": "maple",
  "name": "142 Maple Street",
  "style": "modern farmhouse",
  "model": "house.glb",
  "up": "z",
  "horizontal": ["x", "y"],
  "rotation": 0,
  "bounds": { "min": [-9, -6, 0], "max": [9, 6, 6] },
  "floors": [
    {
      "id": "f0",
      "name": "Ground floor",
      "elevation": 0,
      "ceiling": 2.7,
      "rooms": [
        {
          "id": "r1",
          "name": "Entry",
          "type": "entry",
          "rect": { "minU": -2, "minV": -6, "maxU": 2, "maxV": -3 },
          "areaSqFt": 129,
          "notes": "double-height ceiling"
        }
      ]
    }
  ],
  "doorOverrides": { "r2:r6": false }
}
```

Rules that the tour depends on:

- **Rectangles are axis-aligned in the rotated frame.** One `rotation` for the whole
  project, inherited from the crop step, not one per room. Buildings are
  rectilinear; this keeps both the drawing UI and the adjacency test simple.
- **`u` and `v` are the two non-vertical axes**, named by `horizontal`, in the GLB's
  own units, which is metres for OpenDroneMap output. These are the same
  coordinates `glbFootprint` and `cropGlb` already use.
- **Rooms that share a wall get a door.** Adjacency is derived, not authored: two
  rooms are connected when their rectangles touch along an edge within 0.05 m and
  overlap by more than 0.3 m. `doorOverrides` suppresses a derived door, keyed by
  the two room ids sorted and joined with a colon.
- **Edge coordinates must match exactly** where rooms are meant to be adjacent. The
  editor should snap to existing edges. If walls are 0.2 m apart the rooms are not
  neighbours and the tour will teleport between them instead of walking.
- **`type` is one of**: `entry`, `living`, `dining`, `kitchen`, `hallway`, `office`,
  `bedroom`, `bathroom`, `laundry`, `garage`, `basement`, `other`. The route planner
  orders the tour by these, and the script writer uses them for narration.
- **`areaSqFt` is computed** from the rectangle, with a user override allowed. The
  narration quotes it, so it should be the number the user agreed to.
- **`notes`** is free text per room and is passed to the script model. This is where
  "south-facing windows" or "original hardwood" belongs.

## 1b. When there is no floor plan: `adapt.mjs`

No workstream produces geometry. The web app's configure page collects how many of
each room the house has and a photo set per room, and that is all:

```ts
interface RoomConfig {
  bedrooms: number; bathrooms: number; livingRooms: number;
  diningRooms: number; kitchens: number;
  standardRoomImages: Record<StandardRoomKey, RoomImageSet[]>;
  specialRooms: SpecialRoom[];
}
```

There are no rectangles, no coordinates, no square footage, no floors, and no
adjacency. `adapt.mjs` bridges the gap by laying those counts out into a plan:

```
node app/tour/adapt.mjs --config room-config.json --name "18 Oakwood Drive"
node app/tour/build.mjs --config room-config.json --name "18 Oakwood Drive"
```

Rooms are placed in two bands either side of a corridor running back from the front
door, so every room ends up with one wall on the corridor and one on the outside.
That is what gives the geometry layer a doorway and a window direction for every
room. Doors between two ordinary rooms that merely happen to share a wall are
suppressed through `doorOverrides`, so the route runs through the corridor the way
a real house does; kitchen-to-dining stays open.

**The layout is invented.** It is not a survey of the real house, and
`plan.generated` records that so nobody downstream mistakes it for one.
This is sound only because the interior panoramas are generated too: the tour has to
be internally consistent, not accurate. When the narration says "through to the
kitchen", the camera turns toward the room the tour visits next, and a room
described as bright genuinely has an exterior wall. If a real floor plan editor ever
lands, it supersedes this entirely and nothing downstream changes.

Room ids come from the web app (`bedrooms-1`, `garage`), which makes them the join
key for panoramas: whatever generates interiors should write `panos/bedrooms-1.jpg`.

## 2. The heading convention

**Settle this before anyone writes camera or panorama code.** If the panorama
generator and the camera disagree, every camera move points the wrong way and the
bug is invisible until integration.

- Heading is in degrees, `0` to `360`, and points along the **+U axis at 0**,
  increasing **clockwise seen from above**.
- In code: `heading = degrees(atan2(-(toV - fromV), toU - fromU))`, normalised.
- Pitch is degrees, negative looking down, `0` at the horizon.

## 3. Panorama convention

- Equirectangular, 2:1 aspect ratio, delivered as `panos/<roomId>.jpg`. The
  server also accepts `.jpeg`, `.png` and `.webp` under the same name, so the
  generator can write whichever it produces.
- **The centre column of the image faces heading 0.** The left and right edges meet
  at heading 180, so the seam sits directly behind heading 0. Put the seam
  somewhere dull when prompting.
- Until real panoramas exist, the scene draws a placeholder texture procedurally:
  a horizon, the room name, and compass ticks every 30 degrees. The ticks are the
  calibration tool. If a camera move to heading 90 does not land on the tick
  labelled 90, the convention is broken somewhere.

## 4. Output: the `TourScene` interface

This is what the interactive walkthrough needs to expose for the tour to become a
playback mode inside it, rather than a separate page.

```js
showExterior(glbUrl)                                  // load and frame the real house
showRoom(roomId, { fade })                            // crossfade to that room's panorama
lookAt({ heading, pitch, fov }, { duration, ease })   // tweened camera move
drift(degreesPerSecond)                               // slow constant yaw, the base motion
setInteractive(enabled)                               // lock user input during playback
```

`app/tour/public/scene.mjs` is a working reference implementation of exactly this
interface: an inverted sphere with an equirectangular texture, a camera at its
centre, and an exterior GLB mode.

The walkthrough can either implement this surface directly, or keep its own API and
ship a thin adapter object. Either is fine. What matters is that the tour director
only ever calls these five methods, so it does not care which one it is driving.

Keep the reference implementation after the walkthrough lands. It is the fallback
that guarantees a demo.

## 5. Built artefact: `tour.json`

Written by `build.mjs`, read by the player. Everything is precomputed; the player
does no geometry and no string parsing.

```json
{
  "projectId": "maple",
  "generatedAt": "2026-09-26T17:00:00.000Z",
  "voice": { "provider": "elevenlabs", "voiceId": "...", "modelId": "..." },
  "stops": [
    {
      "id": "s0",
      "kind": "exterior",
      "audio": "audio/s0.mp3",
      "duration": 11.4,
      "text": "Welcome to 142 Maple Street.",
      "words": [{ "text": "Welcome", "start": 0.0, "end": 0.42 }],
      "camera": [{ "at": 0, "type": "orbit", "from": 210, "to": 330, "elevation": 22 }]
    },
    {
      "id": "s3",
      "kind": "room",
      "roomId": "r3",
      "audio": "audio/s3.mp3",
      "duration": 14.2,
      "text": "And here is the kitchen, with counters running the full length of the room.",
      "words": [{ "text": "And", "start": 0.0, "end": 0.21 }],
      "camera": [
        { "at": 0.0, "type": "drift", "speed": 2.5 },
        { "at": 4.8, "type": "lookAt", "heading": 275, "pitch": -4, "fov": 58, "duration": 2200 }
      ]
    }
  ]
}
```

- `at` and `duration` are seconds from the start of that stop.
- `audio` may be `null` when no ElevenLabs key was present at build time. The player
  then runs on a virtual clock with estimated timings, so the whole tour still plays
  end to end, silently. This is the default developer experience before keys arrive.

## 6. Camera targets are derived from geometry

The script model never sees coordinates. `targets.mjs` turns each room's rectangle
and its neighbours into named targets, and `build.mjs` resolves the names back into
headings:

- `windows` is the midpoint of the room's longest **exterior** wall, meaning a wall
  segment no other room touches. That is where daylight comes from.
- `door:<roomId>` is the direction of each neighbouring room's centre.
- `centre` holds the current heading.

The script model receives only the names and returns moves referencing them, so it
cannot produce a camera move that points at nothing.

## 7. Timing comes from ElevenLabs alignment

`POST /v1/text-to-speech/{voice_id}/with-timestamps` returns `audio_base64` plus an
`alignment` object with `characters`, `character_start_times_seconds`, and
`character_end_times_seconds`.

Three things fall out of it:

- Stop duration is the last character's end time, so visuals never guess.
- A move tagged with `atPhrase` is located by string index in the narration, and the
  index maps directly to a timestamp. The camera turns toward the windows at the
  exact moment the narrator says "floor-to-ceiling windows".
- Word timings for caption highlighting come from grouping characters on whitespace.

Use `alignment`, not `normalized_alignment`, when locating a phrase, because the
phrase is being searched in the original text.

## 8. Layout and module boundaries

```
app/tour/
  CONTRACT.md          this document
  fixture/             a hand-written 8-room plan.json and narration, no keys needed
  adapt.mjs            web-app room counts -> a laid-out plan.json
  targets.mjs          geometry: centres, doors, exterior walls, headings
  route.mjs            adjacency-aware room ordering
  script.mjs           Gemini structured output, or load hand-written narration
  voice.mjs            ElevenLabs with-timestamps, disk cache, estimated fallback
  build.mjs            CLI tying the above together, writes tour.json and audio
  serve.mjs            static server for the page
  public/
    index.html
    scene.mjs          reference TourScene implementation
    director.mjs       timeline playback off audio currentTime
    captions.mjs       word-synced captions
    placeholder.mjs    procedural calibration panorama
```

Nothing here imports from another workstream. The only shared files are the data
formats above.

## 9. Keys and configuration

Read from the environment, never committed:

- `GEMINI_API_KEY`, optional. Without it, `build.mjs` uses the hand-written narration
  in `fixture/script.json`.
- `ELEVENLABS_API_KEY`, optional. Without it, timings are estimated from word count
  and the tour plays silently.
- `ELEVENLABS_VOICE_ID`, the realtor voice.
- `GEMINI_TEXT_MODEL` and `ELEVENLABS_MODEL_ID` to override defaults.

**Everything runs with no keys at all.** That is deliberate: the full pipeline,
player, camera work, and captions can be developed and demonstrated before any key
exists, and adding keys only upgrades estimated timing to real audio.

## 10. Merge checklist

Where the rest of the project actually stands, as of the `web/` and
`360-tour-builder` merges:

- [x] **Floor plan.** Nobody emits one. `adapt.mjs` synthesises it from room counts
      (section 1b). A real editor would supersede it.
- [ ] **Panoramas.** Nothing writes `panos/<roomId>.jpg` yet. Use the web app's room
      ids as filenames; the scene falls back to a procedural placeholder until then.
- [ ] **Walkthrough scene.** `public/360-tour-builder/` is Pannellum, not three.js. It
      does not expose the five methods, but it maps onto them closely:
      `loadScene` is `showRoom`, `setYaw`/`setPitch`/`setHfov` are `lookAt`, and
      `startAutoRotate` is `drift`. A thin adapter is the intended route. Note that
      Pannellum's `hfov` is *horizontal* where our `fov` is vertical.
- [ ] **Heading convention.** The builder stores a per-scene `northOffset` and already
      computes `yaw - northOffset` for a world bearing. That is the same idea as
      heading 0; the two just need to agree on where north points.
- [ ] **Output slot.** `web/src/app/results/page.tsx` renders the AI walkthrough tab as
      `<video src={results.aiVideoUrl}>`. This tour is a live page, not a video file,
      so that element needs to become an `<iframe>` like the Virtual Tour tab beside
      it. One-line change, but it belongs to the web workstream.
- [x] A built `tour.json` is committed for the demo.
