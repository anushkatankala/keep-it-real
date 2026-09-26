#!/usr/bin/env node
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import { imagesToGlb } from "./dist/index.js";

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp"
};

const USAGE = `
Usage: node run.mjs <photos-dir> [options]

Options:
  --out <path>       Output GLB path              (default: ./output.glb)
  --url <url>        NodeODM origin               (default: $NODEODM_URL or http://127.0.0.1:3001)
  --token <token>    NodeODM token                (default: $NODEODM_TOKEN)
  --quality <level>  "standard" or "high"         (default: standard)
  --poll <seconds>   Status poll interval         (default: 5)
  --timeout <mins>   Give up after this long      (default: 120)
  --help             Show this message

Example:
  docker run --rm -p 3001:3000 opendronemap/nodeodm
  node run.mjs ./photos --out house.glb
`.trim();

function parseArgs(argv) {
  const args = { quality: "standard", pollSeconds: 5, timeoutMinutes: 120 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--out") args.out = next();
    else if (arg === "--url") args.url = next();
    else if (arg === "--token") args.token = next();
    else if (arg === "--quality") args.quality = next();
    else if (arg === "--poll") args.pollSeconds = Number(next());
    else if (arg === "--timeout") args.timeoutMinutes = Number(next());
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else if (args.dir === undefined) args.dir = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }

  if (!args.dir) throw new Error("A photos directory is required");
  if (args.quality !== "standard" && args.quality !== "high") {
    throw new Error(`--quality must be "standard" or "high", got "${args.quality}"`);
  }
  if (!Number.isFinite(args.pollSeconds) || args.pollSeconds <= 0) {
    throw new Error("--poll must be a positive number of seconds");
  }
  if (!Number.isFinite(args.timeoutMinutes) || args.timeoutMinutes <= 0) {
    throw new Error("--timeout must be a positive number of minutes");
  }

  args.out ??= "./output.glb";
  args.url ??= process.env.NODEODM_URL ?? "http://127.0.0.1:3001";
  args.token ??= process.env.NODEODM_TOKEN;
  return args;
}

async function loadImages(dir) {
  const directory = resolve(dir);
  const info = await stat(directory).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Not a directory: ${directory}`);

  const names = (await readdir(directory))
    .filter((name) => !name.startsWith("."))
    .filter((name) => extname(name).toLowerCase() in CONTENT_TYPES)
    .sort();

  if (names.length === 0) {
    throw new Error(
      `No images found in ${directory}. Supported extensions: ${Object.keys(CONTENT_TYPES).join(", ")}`
    );
  }

  return Promise.all(
    names.map(async (name) => ({
      name,
      data: await readFile(join(directory, name)),
      contentType: CONTENT_TYPES[extname(name).toLowerCase()]
    }))
  );
}

async function checkWorker(url, token, signal) {
  const target = new URL("info", `${url.replace(/\/$/, "")}/`);
  if (token) target.searchParams.set("token", token);

  const response = await fetch(target, { signal }).catch((cause) => {
    throw new Error(
      `Cannot reach NodeODM at ${url}. Start one with:\n` +
        "  docker run --rm -p 3001:3000 opendronemap/nodeodm\n" +
        `Underlying error: ${cause.message}`
    );
  });
  if (!response.ok) throw new Error(`NodeODM responded ${response.status} at ${target.pathname}`);

  const info = await response.json().catch(() => ({}));
  return info;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatDuration(milliseconds) {
  const total = Math.round(milliseconds / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const controller = new AbortController();
  process.on("SIGINT", () => {
    console.log("\nCancelling…");
    controller.abort();
  });

  const images = await loadImages(args.dir);
  const totalBytes = images.reduce((sum, image) => sum + image.data.byteLength, 0);
  console.log(`Found ${images.length} image(s), ${formatBytes(totalBytes)} total`);
  if (images.length < 10) {
    console.warn(
      `Warning: photogrammetry usually needs 20+ heavily overlapping photos. ` +
        `${images.length} will probably fail to reconstruct.`
    );
  }

  const worker = await checkWorker(args.url, args.token, controller.signal);
  console.log(`NodeODM ${worker.version ?? "?"} at ${args.url}, ${worker.taskQueueCount ?? 0} task(s) queued`);

  const startedAt = Date.now();
  let lastLine = "";
  const glb = await imagesToGlb(images, {
    nodeOdmUrl: args.url,
    token: args.token,
    quality: args.quality,
    label: `images-to-glb ${basename(resolve(args.dir))}`,
    pollIntervalMs: args.pollSeconds * 1000,
    timeoutMs: args.timeoutMinutes * 60 * 1000,
    signal: controller.signal,
    onProgress: ({ state, progress }) => {
      const percent = progress === null ? "" : ` ${progress.toFixed(1)}%`;
      const line = `[${formatDuration(Date.now() - startedAt)}] ${state}${percent}`;
      if (line === lastLine) return;
      lastLine = line;
      console.log(line);
    }
  });

  const out = resolve(args.out);
  await writeFile(out, glb);
  console.log(`\nWrote ${out} (${formatBytes(glb.byteLength)}) in ${formatDuration(Date.now() - startedAt)}`);
}

try {
  await main();
} catch (error) {
  if (error?.name === "AbortError") {
    console.error("Aborted.");
    process.exit(130);
  }
  console.error(`\nError: ${error?.message ?? error}`);
  if (error?.message?.includes("A photos directory is required")) console.error(`\n${USAGE}`);
  process.exit(1);
}
