#!/usr/bin/env node
/**
 * Serves a built tour.
 *
 * Read-only and deliberately dull: it hands over tour.json, plan.json, the
 * narration audio, the panoramas and the house GLB, and nothing else. All the
 * generation happened in build.mjs, so nothing here can fail on an API call.
 */

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "..", "..");

const USAGE = `
Usage: node app/tour/serve.mjs [options]

Options:
  --project <dir>   Project folder holding plan.json   (default: fixture)
  --build <dir>     Built tour folder                  (default: build/<plan id>)
  --model <file>    House GLB for the exterior shot    (default: plan, then house.glb)
  --port <number>   Port to listen on                  (default: 5174)
  --help            Show this message
`.trim();

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
  ".wav": "audio/wav"
};

function parseArgs(argv) {
  const args = { project: join(HERE, "fixture"), build: null, model: null, port: 5174 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--project") args.project = resolve(argv[++i]);
    else if (arg === "--build") args.build = resolve(argv[++i]);
    else if (arg === "--model") args.model = resolve(argv[++i]);
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
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

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const planPath = join(args.project, "plan.json");
  const plan = JSON.parse(
    await readFile(planPath, "utf8").catch(() => {
      throw new Error(`Cannot read ${planPath}`);
    })
  );

  const buildDir = args.build ?? join(HERE, "build", plan.id ?? "tour");
  const namedModel = plan.model ? join(args.project, plan.model) : null;
  const repoHouse = join(REPO, "house.glb");
  const modelPath = args.model ?? (namedModel && existsSync(namedModel) ? namedModel : null) ?? (existsSync(repoHouse) ? repoHouse : null);

  const roots = {
    "/vendor/three/": join(REPO, "node_modules/three/"),
    "/lib/": join(HERE, "/"),
    "/audio/": join(buildDir, "audio/"),
    "/": join(HERE, "public/")
  };

  if (modelPath) console.log(`House model: ${modelPath}`);
  else console.log("No house.glb found; the tour will use the placeholder model.");

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, commonHeaders());
      return response.end();
    }

    try {
      if (url.pathname === "/api/plan") return sendJson(response, 200, plan);

      if (url.pathname === "/api/tour") {
        const tour = await readFile(join(buildDir, "tour.json"), "utf8").catch(() => null);
        if (!tour) return sendJson(response, 404, { error: "No tour.json. Run: node app/tour/build.mjs" });
        return send(response, 200, tour, "application/json");
      }

      // The contract names panoramas .jpg, but whoever generates them may well
      // write png or webp, and that should not silently fall back to the
      // placeholder. Any of the three answers to the documented URL.
      if (url.pathname.startsWith("/panos/")) {
        const name = url.pathname.slice("/panos/".length).replace(/\.[^.]+$/, "");
        if (name.includes("/") || name.includes("\\") || name.includes("..")) {
          return sendJson(response, 400, { error: "Bad panorama name" });
        }
        for (const extension of [".jpg", ".jpeg", ".png", ".webp"]) {
          const bytes = await readFile(join(args.project, "panos", name + extension)).catch(() => null);
          if (bytes) return send(response, 200, bytes, MIME[extension]);
        }
        return sendJson(response, 404, { error: `No panorama for ${name}` });
      }

      if (url.pathname === "/model") {
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
      return send(response, 200, body, MIME[extname(file)] ?? "application/octet-stream");
    } catch (error) {
      console.error(`${request.method} ${url.pathname}: ${error.message}`);
      sendJson(response, 500, { error: error.message });
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
