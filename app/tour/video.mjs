#!/usr/bin/env node
/**
 * Turns a built tour into a narrated walkthrough video.
 *
 * Each stop becomes one image-to-video clip whose first frame is taken from
 * the tour's own panorama, so the footage shows the same house the virtual
 * tour does. The ElevenLabs narration from the build is the only soundtrack:
 * clips are rendered silent and cut to the length of their stop's audio.
 *
 *   node app/tour/video.mjs --project app/tour/projects/generated
 *   node app/tour/video.mjs --project app/tour/projects/generated --dry-run
 */

import "./env.mjs";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";

import { createClient, credentialsFromEnv } from "./higgsfield.mjs";

const HERE = import.meta.dirname;
const run = promisify(execFile);

const DEFAULT_MODEL = "kling-video/v3.0/std/image-to-video";

const USAGE = `
Usage: node app/tour/video.mjs [options]

Options:
  --project <dir>     Project folder with plan.json and panos/   (required)
  --build <dir>       Built tour folder with tour.json          (default: build/<plan id>)
  --model <path>      Higgsfield image-to-video model           (default: ${DEFAULT_MODEL})
  --max-usd <n>       Refuse to start if uncached clips cost more (default: 3)
  --concurrency <n>   Clips rendered at once                     (default: 3)
  --only <stopId>     Render just this stop if uncached, then re-stitch
  --pano-shot <stopId>@<yaw>
                      Film this stop as a free camera move inside its panorama,
                      pushing in toward <yaw> degrees from the image centre,
                      instead of calling the API. Repeatable.
  --dry-run           Build keyframes and price the run, spend nothing
  --help              Show this message
`.trim();

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
/**
 * Every shot is a slow camera move, which stays smooth slowed this far once
 * the in-between frames are motion-interpolated; the rest is a held frame.
 */
const MAX_STRETCH = 1.6;
const CAMERA_PITCH = -4;
const START_FOV = 90;
/** The end frame of a room: panned this far from the start and pushed in. */
const END_PAN = 28;
const END_FOV = 70;
/** Stills of the cropped GLB rendered by keyframe.html; used for the opening shot when present. */
const MODEL_KEYFRAMES = { start: "s0-glb-start.jpg", end: "s0-glb-end.jpg" };

const verticalFov = (hFov) => (2 * Math.atan(Math.tan((hFov * Math.PI) / 360) * (HEIGHT / WIDTH)) * 180) / Math.PI;

const GUARD =
  "Photorealistic real-estate walkthrough footage. Keep the architecture, furniture, materials, " +
  "colours and lighting exactly as in the first and last frames; do not add, remove or change any object. " +
  "Steady gimbal camera, no cuts.";
const NEGATIVE =
  "people, animals, text, watermark, logo, warped walls, bending lines, morphing furniture, flicker, fast motion";

const round = (value) => Math.round(value * 1000) / 1000;

function parseArgs(argv) {
  const args = { project: null, build: null, model: DEFAULT_MODEL, maxUsd: 3, concurrency: 3, only: null, dryRun: false, panoShots: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--project") args.project = resolve(argv[++i]);
    else if (arg === "--build") args.build = resolve(argv[++i]);
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--max-usd") args.maxUsd = Number(argv[++i]);
    else if (arg === "--concurrency") args.concurrency = Math.max(1, Number(argv[++i]));
    else if (arg === "--only") args.only = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--pano-shot") {
      const [stopId, yaw] = String(argv[++i]).split("@");
      if (!stopId || !Number.isFinite(Number(yaw))) throw new Error("--pano-shot expects <stopId>@<yaw>, e.g. s6@-152");
      args.panoShots.set(stopId, Number(yaw));
    }
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!args.project) throw new Error("--project is required");
  return args;
}

async function ffmpeg(args) {
  try {
    return await run(ffmpegPath, ["-hide_banner", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`ffmpeg failed: ${String(error.stderr ?? error.message).split("\n").slice(-6).join("\n")}`);
  }
}

/** Media length from ffmpeg's banner, which ffmpeg-static ships without ffprobe. */
async function mediaDuration(path) {
  const { stderr } = await run(ffmpegPath, ["-hide_banner", "-i", path]).catch((error) => error);
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr ?? "");
  if (!match) throw new Error(`Cannot read duration of ${path}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function findImage(dir, id) {
  for (const extension of ["jpeg", "jpg", "png", "webp"]) {
    const path = join(dir, `${id}.${extension}`);
    if (existsSync(path)) return path;
  }
  return null;
}

async function panoramaView(source, path, { yaw, fov, pitch = CAMERA_PITCH }) {
  const view =
    `v360=input=e:output=flat:yaw=${yaw}:pitch=${pitch}:h_fov=${fov}:v_fov=${verticalFov(fov).toFixed(2)}` +
    `:w=${WIDTH}:h=${HEIGHT}:interp=lanczos`;
  await ffmpeg(["-i", source, "-vf", view, "-q:v", "2", path]);
}

/**
 * The frames a stop's clip starts and ends on, both real views of this house.
 * A room starts on its panorama's centre and ends panned and pushed in from
 * it, so the model only moves the camera between two known pictures instead
 * of inventing the room. The opening uses stills of the cropped GLB when they
 * have been rendered, and the front photo otherwise.
 */
async function makeKeyframes({ stop, index, project, out }) {
  if (stop.kind === "exterior") {
    const start = join(out, MODEL_KEYFRAMES.start);
    const end = join(out, MODEL_KEYFRAMES.end);
    if (existsSync(start) && existsSync(end)) return { start, end, source: "model" };

    const source = findImage(join(project, "exterior"), "front");
    if (!source) throw new Error("No exterior/front image for the opening shot");
    const path = join(out, `${stop.id}.jpg`);
    await ffmpeg(["-i", source, "-vf", `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`, "-q:v", "2", path]);
    return { start: path, end: null, source: "photo" };
  }

  const viewpointId = stop.viewpointIds[0] ?? stop.roomId;
  const source = findImage(join(project, ".live"), viewpointId) ?? findImage(join(project, "panos"), viewpointId);
  if (!source) throw new Error(`No panorama for ${stop.name} (${viewpointId})`);

  const start = join(out, `${stop.id}.jpg`);
  const end = join(out, `${stop.id}-end.jpg`);
  const direction = index % 2 === 0 ? 1 : -1;
  await panoramaView(source, start, { yaw: 0, fov: START_FOV });
  await panoramaView(source, end, { yaw: direction * END_PAN, fov: END_FOV });
  return { start, end, source: "panorama", direction };
}

/**
 * A camera move filmed inside the panorama itself: an eased pan and push-in
 * toward `yaw`, exactly `seconds` long. Free, and it cannot invent anything,
 * which suits a room whose panorama gives a generator nothing to work from.
 */
async function renderPanoShot({ source, path, yaw, seconds }) {
  const from = { yaw: yaw + 15, fov: START_FOV, pitch: CAMERA_PITCH };
  const to = { yaw, fov: 48, pitch: -2 };
  const count = Math.ceil(seconds * FPS);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const frameDir = `${path}.frames`;
  await mkdir(frameDir, { recursive: true });

  // One v360 render per frame: its rotation commands are not absolute, so a
  // scripted move through them drifts off target.
  try {
    const frames = Array.from({ length: count }, (_, frame) => frame);
    await inBatches(frames, 8, async (frame) => {
      const k = ease(frame / Math.max(count - 1, 1));
      const at = (key) => from[key] + (to[key] - from[key]) * k;
      await panoramaView(source, join(frameDir, `${String(frame).padStart(5, "0")}.jpg`), {
        yaw: at("yaw").toFixed(3),
        fov: at("fov"),
        pitch: at("pitch").toFixed(3)
      });
    });
    await ffmpeg([
      "-framerate", String(FPS), "-i", join(frameDir, "%05d.jpg"),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", path
    ]);
  } finally {
    await rm(frameDir, { recursive: true, force: true });
  }
}

function promptFor(stop, frames, style) {
  if (frames.source === "model") {
    return (
      "Smooth aerial drone shot of this exact house: the camera arcs slowly around to face the front and " +
      "descends gently toward the garage and front entry, ending exactly on the last frame. Photorealistic " +
      "natural daylight under a clear sky. Keep the roof, brick, dormer windows, balcony and garage doors " +
      "exactly as in the frames; no people, no text, no cuts."
    );
  }
  const motion =
    frames.source === "photo"
      ? "Slow cinematic push-in toward the front entrance of the house, slight rise."
      : `Slow smooth gimbal move through the ${stop.name.toLowerCase()}: the camera pans ${frames.direction > 0 ? "right" : "left"} ` +
        "and gently pushes in, ending exactly on the last frame.";
  return [motion, GUARD, style].filter(Boolean).join(" ");
}

/** Kling 3.0 renders any whole number of seconds; older models a fixed few. */
function clipLengths(model) {
  if (model.startsWith("kling-video/v3")) return Array.from({ length: 13 }, (_, i) => i + 3);
  if (model.startsWith("kling-video/v2")) return [5, 10];
  if (model.startsWith("minimax/")) return [6, 10];
  return [5, 10, 15];
}

/** The shortest length that needs no more than MAX_STRETCH to cover the narration. */
function clipLength(duration, options) {
  return options.find((length) => length * MAX_STRETCH >= duration) ?? options.at(-1);
}

function captionCues(stops) {
  const cues = [];
  let offset = 0;
  for (const stop of stops) {
    let chunk = [];
    const flush = () => {
      if (chunk.length === 0) return;
      cues.push({ start: offset + chunk[0].start, end: offset + chunk.at(-1).end, text: chunk.map((word) => word.text).join(" ") });
      chunk = [];
    };
    for (const word of stop.words) {
      chunk.push(word);
      if (/[.!?]$/.test(word.text) || chunk.length >= 12) flush();
    }
    flush();
    offset += stop.audioDuration;
  }
  return cues;
}

function vtt(cues) {
  const stamp = (seconds) => {
    const ms = Math.round(seconds * 1000);
    const pad = (value, width = 2) => String(value).padStart(width, "0");
    return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
  };
  return `WEBVTT\n\n${cues.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n")}`;
}

/** The newest existing render of a stop, from any earlier run or model. */
async function latestClip(dir, files, stopId) {
  const candidates = await Promise.all(
    files
      .filter((name) => name.startsWith(`${stopId}-`) && name.endsWith(".mp4"))
      .map(async (name) => ({ path: join(dir, name), time: (await stat(join(dir, name))).mtimeMs }))
  );
  return candidates.sort((a, b) => b.time - a.time)[0]?.path ?? null;
}

async function inBatches(items, size, work) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length > 0) await work(queue.shift());
  });
  await Promise.all(workers);
}

/**
 * One clip per stop, cut or stretched to its narration, then joined under the
 * narration. A stop whose clip failed falls back to an earlier render of it,
 * or holds on its first frame, so a single bad render never costs the video.
 */
async function stitch({ shots, build, out }) {
  const inputs = [];
  const filters = [];
  shots.forEach((shot, i) => {
    const d = shot.audioDuration;
    if (shot.clipPath) {
      inputs.push("-i", shot.clipPath);
      const stretch = Math.min(Math.max(d / shot.clipDuration, 1), MAX_STRETCH);
      const hold = Math.max(d - shot.clipDuration * stretch, 0) + 0.5;
      const retime =
        stretch > 1.02
          ? `setpts=${stretch.toFixed(4)}*(PTS-STARTPTS),minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
          : `setpts=PTS-STARTPTS,fps=${FPS}`;
      filters.push(
        `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,` +
          `${retime},tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},` +
          `trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
      );
    } else {
      inputs.push("-loop", "1", "-t", d.toFixed(3), "-i", shot.frames.start);
      filters.push(`[${i}:v]fps=${FPS},setsar=1,trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    }
  });
  shots.forEach((shot, i) => {
    inputs.push("-i", join(build, shot.audio));
    filters.push(`[${shots.length + i}:a]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
  });
  const videoLabels = shots.map((_, i) => `[v${i}]`).join("");
  const audioLabels = shots.map((_, i) => `[a${i}]`).join("");
  filters.push(`${videoLabels}concat=n=${shots.length}:v=1:a=0[v]`, `${audioLabels}concat=n=${shots.length}:v=0:a=1[a]`);

  const output = join(out, "tour.mp4");
  await ffmpeg([
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    output
  ]);
  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const plan = JSON.parse(await readFile(join(args.project, "plan.json"), "utf8"));
  const build = args.build ?? join(HERE, "build", plan.id ?? "tour");
  const tour = JSON.parse(await readFile(join(build, "tour.json"), "utf8"));
  const style = (await readFile(join(args.project, "source", "style.txt"), "utf8").catch(() => ""))
    .replace(/\*|image_\d+\.png( and )?/g, "")
    .split(/(?<=\.)\s/)
    .slice(1, 4)
    .join(" ");

  const out = join(build, "video");
  await mkdir(join(out, "keyframes"), { recursive: true });
  await mkdir(join(out, "clips"), { recursive: true });

  const missingAudio = tour.stops.filter((stop) => !stop.audio);
  if (missingAudio.length > 0) throw new Error("The tour has no narration audio; rebuild it with an ElevenLabs key");

  const lengths = clipLengths(args.model);
  const endFrames = args.model.startsWith("kling-video/v3");

  console.log(`${tour.projectName}: ${tour.stops.length} stops, ${args.model}`);
  const shots = [];
  for (const [index, stop] of tour.stops.entries()) {
    const frames = await makeKeyframes({ stop, index, project: args.project, out: join(out, "keyframes") });
    if (!endFrames) frames.end = null;
    const audioDuration = await mediaDuration(join(build, stop.audio));

    if (args.panoShots.has(stop.id) && stop.kind !== "exterior") {
      const yaw = args.panoShots.get(stop.id);
      const viewpointId = stop.viewpointIds[0] ?? stop.roomId;
      const source = findImage(join(args.project, ".live"), viewpointId) ?? findImage(join(args.project, "panos"), viewpointId);
      const hash = createHash("sha256").update(`${yaw}\u0000${audioDuration}`).update(await readFile(source)).digest("hex").slice(0, 12);
      const clipPath = join(out, "clips", `${stop.id}-pano-${hash}.mp4`);
      if (!existsSync(clipPath)) await renderPanoShot({ source, path: clipPath, yaw, seconds: audioDuration });
      shots.push({ ...stop, frames, audioDuration, duration: audioDuration, prompt: `pano shot toward ${yaw}°`, clipPath, cached: true, panoShot: true });
      continue;
    }

    const duration = clipLength(audioDuration, lengths);
    const prompt = promptFor(stop, frames, style);
    const hash = createHash("sha256")
      .update([args.model, prompt, NEGATIVE, duration].join("\u0000"))
      .update(await readFile(frames.start))
      .update(frames.end ? await readFile(frames.end) : "")
      .digest("hex")
      .slice(0, 12);
    const clipPath = join(out, "clips", `${stop.id}-${hash}.mp4`);
    shots.push({ ...stop, frames, audioDuration, duration, prompt, clipPath, cached: existsSync(clipPath) });
  }

  const client = createClient({ credentials: credentialsFromEnv() });
  const pending = shots.filter((shot) => !shot.cached && (!args.only || shot.id === args.only));
  const inputOf = (shot, imageUrl, endUrl) => ({
    image_url: imageUrl,
    ...(endUrl ? { last_image_url: endUrl } : {}),
    prompt: shot.prompt,
    negative_prompt: NEGATIVE,
    duration: shot.duration,
    ...(endFrames ? { sound: "off" } : {})
  });
  const placeholder = "https://example.com/keyframe.jpg";

  let total = 0;
  for (const shot of pending) {
    shot.usd = await client.estimate(args.model, inputOf(shot, placeholder, shot.frames.end ? placeholder : null));
    total += shot.usd;
  }
  for (const shot of shots) {
    const cost = shot.cached ? "cached" : pending.includes(shot) ? `$${shot.usd.toFixed(3)}` : "skipped";
    console.log(`  ${shot.id} ${shot.name.padEnd(16)} audio ${shot.audioDuration.toFixed(1)}s  clip ${shot.duration}s  ${cost}`);
  }
  console.log(`  total to spend: $${total.toFixed(3)} (cap $${args.maxUsd})`);

  if (args.dryRun) {
    console.log(`\nDry run: keyframes are in ${join(out, "keyframes")}`);
    return;
  }
  if (total > args.maxUsd) throw new Error(`Run would cost $${total.toFixed(2)}, over --max-usd ${args.maxUsd}`);

  const failures = [];
  await inBatches(pending, args.concurrency, async (shot) => {
    const started = Date.now();
    try {
      const imageUrl = await client.upload(await readFile(shot.frames.start));
      const endUrl = shot.frames.end ? await client.upload(await readFile(shot.frames.end)) : null;
      const job = await client.submit(args.model, inputOf(shot, imageUrl, endUrl));
      console.log(`  ${shot.id} submitted (${job.request_id})`);
      const url = await client.wait(job);
      await writeFile(shot.clipPath, await client.download(url));
      console.log(`  ${shot.id} done in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      failures.push(shot.id);
      console.log(`  ${shot.id} failed: ${error.message}`);
    }
  });

  const clipFiles = await readdir(join(out, "clips"));
  for (const shot of shots) {
    if (!existsSync(shot.clipPath)) {
      const earlier = await latestClip(join(out, "clips"), clipFiles, shot.id);
      if (earlier) console.log(`  ${shot.id} using earlier render ${earlier.split("/").at(-1)}`);
      shot.clipPath = earlier;
    }
    if (shot.clipPath) shot.clipDuration = await mediaDuration(shot.clipPath);
  }

  console.log("\nStitching with ffmpeg...");
  const video = await stitch({ shots, build, out });
  await writeFile(join(out, "tour.vtt"), vtt(captionCues(shots)));
  await writeFile(
    join(out, "video.json"),
    `${JSON.stringify(
      {
        model: args.model,
        generatedAt: new Date().toISOString(),
        duration: round(shots.reduce((sum, shot) => sum + shot.audioDuration, 0)),
        shots: shots.map((shot) => ({
          id: shot.id,
          name: shot.name,
          prompt: shot.prompt,
          duration: shot.duration,
          audioDuration: round(shot.audioDuration),
          clip: shot.clipPath ? `clips/${shot.clipPath.split("/").at(-1)}` : null,
          frames: {
            start: `keyframes/${shot.frames.start.split("/").at(-1)}`,
            end: shot.frames.end ? `keyframes/${shot.frames.end.split("/").at(-1)}` : null
          }
        }))
      },
      null,
      2
    )}\n`
  );

  console.log(`Wrote ${video}`);
  if (failures.length > 0) console.log(`Fell back for: ${failures.join(", ")}. Re-run to retry them.`);
}

try {
  await main();
} catch (error) {
  console.error(`\nError: ${error?.message ?? error}`);
  process.exit(1);
}
