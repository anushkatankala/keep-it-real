#!/usr/bin/env node
/**
 * Builds a narrated tour from a floor plan.
 *
 * This is the only part of the tour that talks to Gemini or ElevenLabs, and it
 * runs ahead of time. Everything it needs to say and every camera move it will
 * make is resolved here and written to disk, so playback is a static file read
 * that cannot fail on a network call. See CONTRACT.md.
 *
 *   node app/tour/build.mjs                       # fixture, no keys needed
 *   node app/tour/build.mjs --project ../../projects/maple
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { synthesisePlan } from "./adapt.mjs";
import { analysePlan, headingDelta, headingToRoom, normaliseHeading } from "./targets.mjs";
import { planRoute } from "./route.mjs";
import {
  DEFAULT_TEXT_MODEL,
  EXTERIOR_STOP_ID,
  generateScript,
  loadScript,
  validateScript
} from "./script.mjs";
import { DEFAULT_MODEL_ID, findPhraseTime, synthesise } from "./voice.mjs";

const HERE = import.meta.dirname;

const USAGE = `
Usage: node app/tour/build.mjs [options]

Turns a floor plan into tour.json plus narration audio.

Options:
  --project <dir>   Project folder holding plan.json   (default: fixture)
  --config <file>   Room configuration from the web app, laid out into a plan
  --name <name>     Property name for the narration    (with --config)
  --out <dir>       Output folder                      (default: build/<plan id>)
  --script <file>   Hand-written narration to use instead of Gemini
  --gemini          Write the script with Gemini even if a script file exists
  --voice-id <id>   ElevenLabs voice                   (env ELEVENLABS_VOICE_ID)
  --no-voice        Skip speech; time the tour from word length instead
  --help            Show this message

With no GEMINI_API_KEY the build uses <project>/script.json.
With no ELEVENLABS_API_KEY the tour is silent and timed by estimate.
Both paths produce a complete, playable tour.json.
`.trim();

/** Camera feel. A small vocabulary, applied consistently, reads better than a large one. */
const BASE_FOV = 74;
const MOVE_FOV = 64;
const EXIT_FOV = 66;
const DRIFT_DEGREES_PER_SECOND = 2.2;
const MOVE_DURATION_MS = 2200;
const EXIT_DURATION_MS = 1600;
/** How long before a cut to start turning toward the next room. */
const EXIT_LEAD_SECONDS = 2.0;

const PITCH_BY_KIND = { windows: -2, door: -4, centre: 0 };

const round = (value) => Math.round(value * 1000) / 1000;

function parseArgs(argv) {
  const args = {
    project: join(HERE, "fixture"),
    projectSet: false,
    config: null,
    name: null,
    out: null,
    script: null,
    gemini: false,
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? null,
    voice: true
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--project") { args.project = resolve(argv[++i]); args.projectSet = true; }
    else if (arg === "--config") args.config = resolve(argv[++i]);
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--out") args.out = resolve(argv[++i]);
    else if (arg === "--script") args.script = resolve(argv[++i]);
    else if (arg === "--gemini") args.gemini = true;
    else if (arg === "--voice-id") args.voiceId = argv[++i];
    else if (arg === "--no-voice") args.voice = false;
    else throw new Error(`Unknown option ${arg}`);
  }

  return args;
}

/**
 * Turns the script's named targets and quoted phrases into timed headings.
 * A phrase that cannot be found still produces a move, spread evenly through
 * the stop, because a camera that moves at roughly the right moment beats one
 * that does not move at all.
 */
function resolveMoves({ moves, targets, text, timing }) {
  const resolved = [];

  moves.forEach((move, index) => {
    const target = targets[move.target];
    if (!target || target.heading === null) return;

    const found = findPhraseTime(text, timing.words, move.atPhrase);
    const fallback = (timing.duration * (index + 1)) / (moves.length + 1);

    resolved.push({
      at: round(Math.min(found ?? fallback, Math.max(timing.duration - 1.2, 0))),
      heading: round(target.heading),
      pitch: PITCH_BY_KIND[target.kind] ?? 0,
      fov: Math.round(move.fov ?? MOVE_FOV),
      target: move.target
    });
  });

  return resolved.sort((a, b) => a.at - b.at);
}

function roomKeyframes({ geometry, roomId, previousRoomId, nextRoomId, moves }) {
  const targets = geometry.targets.get(roomId) ?? {};

  // Walking in through a door means facing away from it, into the room. The
  // first room is entered from outside, so it opens with its back to the
  // windows, which is both what the front door does and what leaves the
  // scripted pan toward those windows something to reveal.
  const arrival = previousRoomId ? headingToRoom(geometry, roomId, previousRoomId) : null;
  const opening = round(
    normaliseHeading((arrival ?? targets.windows?.heading ?? 180) + 180)
  );

  // Drift the short way toward whatever we are asked to look at first, so the
  // scripted pan continues a motion already underway instead of reversing it.
  const turn = moves.length > 0 ? Math.sign(headingDelta(opening, moves[0].heading)) : 1;

  const keyframes = [
    { at: 0, type: "lookAt", heading: round(opening), pitch: 0, fov: BASE_FOV, duration: 0 },
    { at: 0, type: "drift", speed: round(DRIFT_DEGREES_PER_SECOND * (turn || 1)) }
  ];

  for (const move of moves) {
    keyframes.push({
      at: move.at,
      type: "lookAt",
      heading: move.heading,
      pitch: move.pitch,
      fov: move.fov,
      duration: MOVE_DURATION_MS
    });
  }

  return { keyframes, targets, nextRoomId };
}

function appendExit({ keyframes, geometry, roomId, nextRoomId, duration }) {
  if (!nextRoomId) return keyframes;

  const heading = headingToRoom(geometry, roomId, nextRoomId);
  if (heading === null) return keyframes;

  const lastMove = keyframes.filter((frame) => frame.type === "lookAt").at(-1);
  const earliest = lastMove ? lastMove.at + MOVE_DURATION_MS / 1000 : 0;
  const at = Math.max(earliest, duration - EXIT_LEAD_SECONDS);
  if (at >= duration) return keyframes;

  keyframes.push({
    at: round(at),
    type: "lookAt",
    heading: round(heading),
    pitch: -3,
    fov: EXIT_FOV,
    duration: EXIT_DURATION_MS
  });

  return keyframes;
}

/** The opening shot orbits the real house and lands facing its front. */
function exteriorKeyframes(geometry) {
  const entry = geometry.rooms.find((room) => room.type === "entry") ?? geometry.rooms[0];
  const front = geometry.targets.get(entry?.id)?.windows?.heading ?? 90;

  return [
    {
      at: 0,
      type: "orbit",
      from: round(normaliseHeading(front - 115)),
      to: round(front),
      elevation: 18,
      fov: 55
    }
  ];
}

async function readScript({ args, plan, geometry, route }) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const candidate = args.script ?? join(args.project, "script.json");
  const haveFile = existsSync(candidate);

  if (args.gemini || (!haveFile && geminiKey)) {
    if (!geminiKey) throw new Error("--gemini needs GEMINI_API_KEY");
    const model = process.env.GEMINI_TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
    console.log(`  script: Gemini (${model})`);
    const onRetry = ({ attempt, reason }) =>
      console.log(`    attempt ${attempt} failed (${reason}), retrying`);

    try {
      return await generateScript({ plan, geometry, route, apiKey: geminiKey, model, onRetry });
    } catch (error) {
      // Losing the whole build to a busy model is the worst possible outcome on
      // demo day, so a usable script on disk wins over a perfect one from the API.
      if (!haveFile) throw error;
      console.log(`    Gemini failed (${error.message.split("\n")[0]})`);
      console.log(`  script: falling back to ${basename(candidate)}`);
      return loadScript(candidate);
    }
  }

  if (!haveFile) {
    throw new Error(
      `No narration available. Either set GEMINI_API_KEY, or write ${candidate}.\n` +
        `The fixture at app/tour/fixture/script.json shows the format.`
    );
  }

  console.log(`  script: ${basename(candidate)} (hand-written)`);
  return loadScript(candidate);
}

async function planFromProject(args) {
  const planPath = join(args.project, "plan.json");
  return JSON.parse(
    await readFile(planPath, "utf8").catch(() => {
      throw new Error(`Cannot read ${planPath}`);
    })
  );
}

/**
 * Lay a room configuration out into a plan, and keep it. The project folder is
 * where panoramas and a hand-written script live, so the generated plan has to
 * land there too rather than staying in memory.
 */
async function planFromConfig(args) {
  const raw = JSON.parse(
    await readFile(args.config, "utf8").catch(() => {
      throw new Error(`Cannot read ${args.config}`);
    })
  );

  const plan = synthesisePlan(raw.roomConfig ?? raw, { name: args.name });
  if (!args.projectSet) args.project = join(HERE, "projects", plan.id);

  await mkdir(args.project, { recursive: true });
  await writeFile(join(args.project, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`  plan: ${plan.floors[0].rooms.length} rooms laid out from ${basename(args.config)}`);

  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const plan = args.config ? await planFromConfig(args) : await planFromProject(args);

  const geometry = analysePlan(plan);
  const route = planRoute(geometry);
  const out = args.out ?? join(HERE, "build", plan.id ?? "tour");

  console.log(`${plan.name}: ${geometry.rooms.length} rooms`);
  console.log(`  route: ${route.map((stop) => geometry.byId.get(stop.roomId).name).join(" -> ")}`);

  const script = await readScript({ args, plan, geometry, route });
  const { stops: narration, warnings } = validateScript(script, { geometry, route });
  for (const warning of warnings) console.warn(`  ! ${warning}`);

  const apiKey = args.voice ? process.env.ELEVENLABS_API_KEY : null;
  const voiceId = args.voiceId;
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL_ID;
  const speaking = Boolean(apiKey && voiceId);
  console.log(
    speaking
      ? `  voice: ElevenLabs ${modelId}, voice ${voiceId}`
      : "  voice: none, timings estimated from word length"
  );

  await mkdir(join(out, "audio"), { recursive: true });

  const byRoomId = new Map(route.map((stop) => [stop.roomId, stop]));
  const order = [EXTERIOR_STOP_ID, ...route.map((stop) => stop.roomId)];
  const stops = [];

  for (const [index, entry] of narration.entries()) {
    const id = `s${index}`;
    const isExterior = entry.roomId === EXTERIOR_STOP_ID;
    const room = geometry.byId.get(entry.roomId);

    const timing = await synthesise(entry.text, {
      apiKey,
      voiceId,
      modelId,
      cacheDir: join(HERE, ".cache"),
      signal: AbortSignal.timeout(120_000)
    });

    let audio = null;
    if (timing.audio) {
      audio = `audio/${id}.mp3`;
      await writeFile(join(out, audio), timing.audio);
    }

    let camera;
    if (isExterior) {
      camera = exteriorKeyframes(geometry);
    } else {
      const previousRoomId = order[index - 1] === EXTERIOR_STOP_ID ? null : order[index - 1] ?? null;
      const nextRoomId = order[index + 1] ?? null;
      const moves = resolveMoves({
        moves: entry.moves,
        targets: geometry.targets.get(entry.roomId) ?? {},
        text: entry.text,
        timing
      });
      const built = roomKeyframes({ geometry, roomId: entry.roomId, previousRoomId, nextRoomId, moves });
      camera = appendExit({
        keyframes: built.keyframes,
        geometry,
        roomId: entry.roomId,
        nextRoomId,
        duration: timing.duration
      });
    }

    stops.push({
      id,
      kind: isExterior ? "exterior" : "room",
      roomId: isExterior ? null : entry.roomId,
      name: isExterior ? plan.name : room?.name ?? entry.roomId,
      transit: Boolean(byRoomId.get(entry.roomId)?.transit),
      audio,
      duration: timing.duration,
      text: entry.text,
      words: timing.words,
      camera: camera.sort((a, b) => a.at - b.at)
    });

    const flag = timing.cached ? " (cached)" : "";
    console.log(`  ${id} ${stops.at(-1).name}: ${timing.duration.toFixed(1)}s${flag}`);
  }

  const tour = {
    projectId: plan.id,
    projectName: plan.name,
    generatedAt: new Date().toISOString(),
    voice: speaking
      ? { provider: "elevenlabs", voiceId, modelId }
      : { provider: "estimated", voiceId: null, modelId: null },
    totalDuration: round(stops.reduce((sum, stop) => sum + stop.duration, 0)),
    stops
  };

  await writeFile(join(out, "tour.json"), `${JSON.stringify(tour, null, 2)}\n`);

  const minutes = Math.floor(tour.totalDuration / 60);
  const seconds = Math.round(tour.totalDuration % 60);
  console.log(`\nWrote ${join(out, "tour.json")}`);
  console.log(`${stops.length} stops, ${minutes}m ${seconds}s total.`);
  console.log(`\nWatch it with: node app/tour/serve.mjs --project ${args.project}`);
}

try {
  await main();
} catch (error) {
  console.error(`\nError: ${error?.message ?? error}`);
  process.exit(1);
}
