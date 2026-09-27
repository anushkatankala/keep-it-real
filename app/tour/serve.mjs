#!/usr/bin/env node
/**
 * Serves a built tour.
 *
 * Read-only and deliberately dull: it hands over tour.json, plan.json, the
 * narration audio, the panoramas and the house GLB, and nothing else. All the
 * generation happened in build.mjs, so nothing here can fail on an API call.
 */

import "./env.mjs";

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..");

const USAGE = `
Usage: node app/tour/serve.mjs [options]

Options:
  --project <dir>   Project folder holding plan.json   (default: fixture)
  --build <dir>     Built tour folder                  (default: build/<plan id>)
  --model <file>    House GLB for the exterior shot    (default: plan, then house.glb)
  --live <dir>      Where uploads are saved            (default: <project>/.live)
  --port <number>   Port to listen on                  (default: 5174)
  --help            Show this message

Uploads from the web app (plan, floor plan image, panoramas) are written to the
live folder and take precedence over the project's own files, so the project
itself is never modified and uploads survive a restart.
`.trim();

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const EXTENSION_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const FRAME_ANCESTORS =
  "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8"
};

function parseArgs(argv) {
  const args = { project: join(HERE, "fixture"), build: null, model: null, live: null, port: 5174 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--project") args.project = resolve(argv[++i]);
    else if (arg === "--build") args.build = resolve(argv[++i]);
    else if (arg === "--model") args.model = resolve(argv[++i]);
    else if (arg === "--live") args.live = resolve(argv[++i]);
    else if (arg === "--port") args.port = Number(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }

  if (!Number.isInteger(args.port) || args.port < 1) throw new Error("--port must be a positive integer");
  return args;
}

/**
 * Resolves a URL path inside one of the static roots, refusing traversal.
 * `/lib/` exposes the build's own folder so the page can import the geometry
 * module, so it is restricted to source files rather than everything there.
 */
function staticPath(pathname, roots) {
  for (const [prefix, directory] of Object.entries(roots)) {
    if (!pathname.startsWith(prefix)) continue;
    if (prefix === "/lib/" && !pathname.endsWith(".mjs")) return null;

    const relative = pathname.slice(prefix.length) || "index.html";
    const candidate = resolve(directory, relative);
    if (candidate.startsWith(resolve(directory))) return candidate;
  }
  return null;
}

function commonHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-security-policy": FRAME_ANCESTORS,
    "cache-control": "no-store",
    ...extra
  };
}

function send(response, status, body, contentType) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, commonHeaders({
    "content-type": contentType,
    "content-length": Buffer.byteLength(payload)
  }));
  response.end(payload);
}

/** Browsers seek audio and video with Range requests, and Safari refuses to play without them. */
function sendRanged(request, response, body, contentType) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (!match || (!match[1] && !match[2])) {
    response.writeHead(200, commonHeaders({
      "content-type": contentType,
      "content-length": body.length,
      "accept-ranges": "bytes"
    }));
    return response.end(body);
  }

  const start = match[1] ? Number(match[1]) : Math.max(body.length - Number(match[2]), 0);
  const end = match[1] && match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
  if (start > end || start >= body.length) {
    response.writeHead(416, commonHeaders({ "content-range": `bytes */${body.length}` }));
    return response.end();
  }
  response.writeHead(206, commonHeaders({
    "content-type": contentType,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${body.length}`,
    "accept-ranges": "bytes"
  }));
  response.end(body.subarray(start, end + 1));
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json");
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Checks an uploaded plan has the shape targets.mjs relies on. It is saved
 * verbatim, so anything wrong here would otherwise surface later as a tour
 * that silently has no rooms.
 */
function validatePlan(plan) {
  const fail = (message) => {
    throw new HttpError(400, `Invalid plan: ${message}`);
  };
  const finite = (value) => typeof value === "number" && Number.isFinite(value);

  if (!plan || typeof plan !== "object") fail("expected a JSON object");
  if (!Array.isArray(plan.floors) || plan.floors.length === 0) fail("floors must be a non-empty array");

  const roomIds = new Set();
  for (const floor of plan.floors) {
    if (!Array.isArray(floor?.rooms)) fail(`floor ${floor?.id ?? "?"} has no rooms array`);
    for (const room of floor.rooms) {
      if (!SAFE_ID.test(String(room?.id ?? ""))) fail(`room id "${room?.id}" must be letters, digits, - or _`);
      if (roomIds.has(room.id)) fail(`duplicate room id ${room.id}`);
      roomIds.add(room.id);
      const rect = room.rect;
      if (!rect || ![rect.minU, rect.minV, rect.maxU, rect.maxV].every(finite)) fail(`room ${room.id} needs a numeric rect`);
      if (rect.minU >= rect.maxU || rect.minV >= rect.maxV) fail(`room ${room.id} has an empty rect`);
    }
  }
  if (roomIds.size === 0) fail("the plan has no rooms");

  if (plan.viewpoints !== undefined) {
    if (!Array.isArray(plan.viewpoints)) fail("viewpoints must be an array");
    const pointIds = new Set();
    for (const point of plan.viewpoints) {
      if (!SAFE_ID.test(String(point?.id ?? ""))) fail(`viewpoint id "${point?.id}" must be letters, digits, - or _`);
      if (pointIds.has(point.id)) fail(`duplicate viewpoint id ${point.id}`);
      pointIds.add(point.id);
      if (!roomIds.has(point.roomId)) fail(`viewpoint ${point.id} is in unknown room ${point.roomId}`);
      if (!finite(point.u) || !finite(point.v)) fail(`viewpoint ${point.id} needs numeric u and v`);
      if (point.facing !== undefined && !finite(point.facing)) fail(`viewpoint ${point.id} facing must be a number`);
    }
  }

  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const liveDir = args.live ?? join(args.project, ".live");
  const projectPlanPath = join(args.project, "plan.json");
  const livePlanPath = join(liveDir, "plan.json");

  async function readPlan() {
    const live = await readFile(livePlanPath, "utf8").catch(() => null);
    if (live) return JSON.parse(live);
    return JSON.parse(
      await readFile(projectPlanPath, "utf8").catch(() => {
        throw new Error(`Cannot read ${projectPlanPath}`);
      })
    );
  }

  const plan = await readPlan();

  const buildDir = args.build ?? join(HERE, "build", plan.id ?? "tour");
  const namedModel = plan.model ? join(args.project, plan.model) : null;
  const repoHouse = join(REPO, "house.glb");
  const modelPath = args.model ?? (namedModel && existsSync(namedModel) ? namedModel : null) ?? (existsSync(repoHouse) ? repoHouse : null);

  const roots = {
    "/vendor/three/": join(REPO, "node_modules/three/"),
    "/lib/": join(HERE, "/"),
    "/audio/": join(buildDir, "audio/"),
    "/video/": join(buildDir, "video/"),
    "/": join(HERE, "public/")
  };

  if (modelPath) console.log(`House model: ${modelPath}`);
  else console.log("No house.glb found; the tour will use the placeholder model.");

  if (existsSync(livePlanPath)) console.log(`Using uploaded plan from ${livePlanPath}`);

  async function readBody(request, limitBytes = 25 << 20) {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
      total += chunk.length;
      if (total > limitBytes) throw new HttpError(413, "Upload is too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /** Written beside the target and renamed, so a reader never sees half a file. */
  async function writeAtomic(path, bytes) {
    await mkdir(resolve(path, ".."), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }

  /** The first existing `<dir>/<name><ext>`, checking uploads before the project. */
  async function findImage(dirs, name) {
    for (const dir of dirs) {
      for (const extension of IMAGE_EXTENSIONS) {
        const bytes = await readFile(join(dir, name + extension)).catch(() => null);
        if (bytes) return { bytes, type: MIME[extension] };
      }
    }
    return null;
  }

  /** Stores one uploaded image as `<dir>/<name><ext>`, replacing any other format of it. */
  async function saveImage(request, dir, name) {
    const type = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    const extension = EXTENSION_BY_TYPE[type];
    if (!extension) throw new HttpError(415, "Send a JPEG, PNG or WebP image");
    const bytes = await readBody(request);
    if (bytes.length === 0) throw new HttpError(400, "Empty upload");
    await removeImage(dir, name);
    await writeAtomic(join(dir, name + extension), bytes);
    return bytes.length;
  }

  async function removeImage(dir, name) {
    await Promise.all(IMAGE_EXTENSIONS.map((extension) => rm(join(dir, name + extension), { force: true })));
  }

  const livePanoDir = join(liveDir, "panos");
  const panoDirs = [livePanoDir, join(args.project, "panos")];
  const floorplanDirs = [liveDir, args.project];

  async function croppedModelBytes() {
    const response = await fetch("http://127.0.0.1:5173/cropped").catch(() => null);
    if (response?.ok) return Buffer.from(await response.arrayBuffer());
    const saved = await readFile(join(REPO, ".last-crop.glb")).catch(() => null);
    return saved;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, commonHeaders());
      return response.end();
    }

    try {
      if (url.pathname === "/api/plan") {
        if (request.method === "PUT") {
          const next = validatePlan(JSON.parse((await readBody(request, 2 << 20)).toString("utf8")));
          await writeAtomic(livePlanPath, `${JSON.stringify(next, null, 2)}\n`);
          console.log(`uploaded plan: ${next.floors.reduce((sum, floor) => sum + floor.rooms.length, 0)} rooms`);
          return sendJson(response, 200, { saved: true });
        }
        if (request.method === "DELETE") {
          await rm(livePlanPath, { force: true });
          return sendJson(response, 200, { removed: true });
        }
        return sendJson(response, 200, await readPlan());
      }

      if (url.pathname === "/api/floorplan") {
        if (request.method === "PUT") {
          const bytes = await saveImage(request, liveDir, "floorplan");
          return sendJson(response, 200, { saved: true, bytes });
        }
        if (request.method === "DELETE") {
          await removeImage(liveDir, "floorplan");
          return sendJson(response, 200, { removed: true });
        }
        return sendJson(response, 405, { error: "Use PUT or DELETE" });
      }

      if (url.pathname === "/floorplan") {
        const image = await findImage(floorplanDirs, "floorplan");
        if (!image) return sendJson(response, 404, { error: "No floor plan image" });
        return send(response, 200, image.bytes, image.type);
      }

      // Clears every upload, returning the tour to the project's own files.
      if (url.pathname === "/api/live" && request.method === "DELETE") {
        await rm(liveDir, { recursive: true, force: true });
        return sendJson(response, 200, { removed: true });
      }

      if (url.pathname === "/api/tour") {
        const tour = await readFile(join(buildDir, "tour.json"), "utf8").catch(() => null);
        if (!tour) return sendJson(response, 404, { error: "No tour.json. Run: node app/tour/build.mjs" });
        return send(response, 200, tour, "application/json");
      }

      // The contract names panoramas .jpg, but whoever generates them may well
      // write png or webp, and that should not silently fall back to the
      // placeholder. Any of the three answers to the documented URL.
      // Keyed by viewpoint id. A plan without viewpoints uses room ids, so the
      // web app's per-room uploads land on the same URL either way.
      if (url.pathname.startsWith("/api/pano/")) {
        const name = url.pathname.slice("/api/pano/".length);
        if (!SAFE_ID.test(name)) return sendJson(response, 400, { error: "Bad viewpoint id" });
        if (request.method === "PUT") {
          const bytes = await saveImage(request, livePanoDir, name);
          console.log(`uploaded pano ${name}: ${bytes} bytes`);
          return sendJson(response, 200, { id: name, bytes });
        }
        if (request.method === "DELETE") {
          await removeImage(livePanoDir, name);
          return sendJson(response, 200, { id: name, removed: true });
        }
        return sendJson(response, 405, { error: "Use PUT or DELETE" });
      }

      // Stills rendered in the browser (the cropped GLB from the tour's own
      // exterior camera) for the video pipeline to animate between.
      if (url.pathname.startsWith("/api/keyframe/") && request.method === "PUT") {
        const name = url.pathname.slice("/api/keyframe/".length);
        if (!SAFE_ID.test(name)) return sendJson(response, 400, { error: "Bad keyframe name" });
        if (!String(request.headers["content-type"] ?? "").startsWith("image/jpeg")) {
          throw new HttpError(415, "Send a JPEG");
        }
        const bytes = await readBody(request);
        await writeAtomic(join(buildDir, "video", "keyframes", `${name}.jpg`), bytes);
        return sendJson(response, 200, { name, bytes: bytes.length });
      }

      // The contract names panoramas .jpg, but whoever generates them may well
      // write png or webp, and that should not silently fall back to the
      // placeholder. Any of them answers to the documented URL.
      if (url.pathname.startsWith("/panos/")) {
        const name = url.pathname.slice("/panos/".length).replace(/\.[^.]+$/, "");
        if (!SAFE_ID.test(name)) return sendJson(response, 400, { error: "Bad panorama name" });
        const image = await findImage(panoDirs, name);
        if (!image) return sendJson(response, 404, { error: `No panorama for ${name}` });
        return send(response, 200, image.bytes, image.type);
      }

      if (url.pathname === "/model") {
        const cropped = await croppedModelBytes();
        if (cropped) return send(response, 200, cropped, "model/gltf-binary");
        const bytes = modelPath ? await readFile(modelPath).catch(() => null) : null;
        // A missing GLB is normal before the photogrammetry step has been run;
        // the scene falls back to a placeholder house.
        if (!bytes) return sendJson(response, 404, { error: "No model" });
        return send(response, 200, bytes, "model/gltf-binary");
      }

      const file = staticPath(url.pathname, roots);
      if (!file) return sendJson(response, 404, { error: "Not found" });

      const body = await readFile(file).catch(() => null);
      if (!body) return sendJson(response, 404, { error: `Not found: ${url.pathname}` });
      return sendRanged(request, response, body, MIME[extname(file)] ?? "application/octet-stream");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 500;
      console.error(`${request.method} ${url.pathname}: ${error.message}`);
      sendJson(response, status, { error: error.message });
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\nPort ${args.port} is already in use. Try: node app/tour/serve.mjs --port ${args.port + 1}`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(args.port, "127.0.0.1", () => {
    console.log(`${plan.name}: serving ${buildDir}`);
    console.log(`\nOpen http://127.0.0.1:${args.port}`);
    console.log("Press Ctrl-C to stop.");
  });
}

try {
  await main();
} catch (error) {
  console.error(`\nError: ${error?.message ?? error}`);
  process.exit(1);
}
