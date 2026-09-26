#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { cropGlb, glbFootprint } from "./dist/index.js";

const USAGE = `
Usage: node server.mjs [model.glb] [options]

Opens a browser viewer where you drag a rectangle over the model to crop it.

Options:
  --port <number>    Port to listen on   (default: 5173)
  --help             Show this message
`.trim();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary"
};

const ROOT = resolve(import.meta.dirname);
const STATIC_ROOTS = {
  "/vendor/three/": join(ROOT, "node_modules/three/"),
  "/": join(ROOT, "public/")
};

function parseArgs(argv) {
  const args = { port: 5173, model: "house.glb" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--port") args.port = Number(argv[++i]);
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else args.model = arg;
  }
  if (!Number.isInteger(args.port) || args.port < 1) throw new Error("--port must be a positive integer");
  return args;
}

/** Resolves a URL path inside one of the static roots, refusing traversal. */
function staticPath(pathname) {
  for (const [prefix, directory] of Object.entries(STATIC_ROOTS)) {
    if (!pathname.startsWith(prefix)) continue;
    const relative = pathname.slice(prefix.length) || "index.html";
    const candidate = resolve(directory, relative);
    if (candidate.startsWith(directory)) return candidate;
  }
  return null;
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), "application/json");
}

async function readBody(request, limitBytes = 1 << 20) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limitBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function validateRegion(value) {
  const region = {
    minU: Number(value?.minU),
    minV: Number(value?.minV),
    maxU: Number(value?.maxU),
    maxV: Number(value?.maxV),
    rotation: Number(value?.rotation ?? 0)
  };
  if (Object.values(region).some((number) => !Number.isFinite(number))) {
    throw new Error("region must contain finite minU, minV, maxU, maxV and rotation");
  }
  return region;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const modelPath = resolve(args.model);
  const original = await readFile(modelPath).catch(() => {
    throw new Error(`Cannot read ${modelPath}. Generate one first with: node run.mjs ./photos --out house.glb`);
  });
  const footprint = await glbFootprint(original);
  const metadata = {
    name: args.model,
    up: footprint.up,
    horizontal: footprint.horizontal,
    bounds: footprint.bounds,
    triangles: footprint.triangles,
    bytes: original.byteLength
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/meta") return sendJson(response, 200, metadata);

      if (url.pathname === "/model") {
        return send(response, 200, original, "model/gltf-binary");
      }

      if (url.pathname === "/crop") {
        if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST" });
        const payload = JSON.parse(await readBody(request));
        const region = validateRegion(payload.region);
        const started = Date.now();
        const result = await cropGlb(original, {
          region,
          up: metadata.up,
          select: payload.select === "overlapping" ? "overlapping" : "centroid"
        });
        console.log(
          `crop ${JSON.stringify(region)} -> ${result.keptTriangles}/${result.totalTriangles} triangles ` +
            `in ${Date.now() - started}ms`
        );
        response.writeHead(200, {
          "content-type": "model/gltf-binary",
          "content-length": result.glb.byteLength,
          "cache-control": "no-store",
          "x-kept-triangles": String(result.keptTriangles),
          "x-total-triangles": String(result.totalTriangles)
        });
        return response.end(Buffer.from(result.glb));
      }

      const file = staticPath(url.pathname);
      if (!file) return sendJson(response, 404, { error: "Not found" });
      const body = await readFile(file).catch(() => null);
      if (!body) return sendJson(response, 404, { error: `Not found: ${url.pathname}` });
      return send(response, 200, body, MIME[extname(file)] ?? "application/octet-stream");
    } catch (error) {
      console.error(`${request.method} ${url.pathname}: ${error.message}`);
      sendJson(response, 400, { error: error.message });
    }
  });

  server.listen(args.port, "127.0.0.1", () => {
    console.log(`${args.model}: ${metadata.triangles.toLocaleString()} triangles, ${metadata.up} is vertical`);
    console.log(`\nOpen http://127.0.0.1:${args.port} — drag a rectangle to crop, then download the GLB.`);
    console.log("Press Ctrl-C to stop.");
  });
}

try {
  await main();
} catch (error) {
  console.error(`\nError: ${error?.message ?? error}`);
  process.exit(1);
}
