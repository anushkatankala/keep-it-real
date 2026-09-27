#!/usr/bin/env node
/**
 * Starts the hackathon demo stack from one command:
 *   node demo.mjs
 *
 *   5173  crop viewer + full/cropped house.glb + demo assets
 *   5174  AI tour player and walkthrough video for the generated house
 *   3000  Next.js web app  ← open this
 *
 * Reuses a listener that is already serving our routes (EADDRINUSE).
 * Depends on local house.glb (gitignored) next to this file.
 */
import "./app/tour/env.mjs";

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const WEB = join(ROOT, "web");
const HOUSE = join(ROOT, "house.glb");

const TOUR_PROJECT = "app/tour/projects/generated";
const TOUR_BUILD = "app/tour/build/generated";
const TOUR_PLAN_ID = "generated";

const CROP_PORT = 5173;
const TOUR_PORT = 5174;
const WEB_PORT = 3000;

const children = [];
let shuttingDown = false;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function portOpen(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(400);
    socket.on("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
    socket.on("error", () => resolvePort(false));
  });
}

async function fetchOk(url, test) {
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return false;
  if (!test) return true;
  try {
    return test(await response.json());
  } catch {
    return false;
  }
}

async function isOurCrop() {
  const hasMeta = await fetchOk(`http://127.0.0.1:${CROP_PORT}/meta`, (meta) => Boolean(meta?.bounds));
  const hasPlan = await fetchOk(`http://127.0.0.1:${CROP_PORT}/demo/plan.json`, (plan) => Boolean(plan?.id));
  return hasMeta && hasPlan;
}

async function isOurTour() {
  return fetchOk(`http://127.0.0.1:${TOUR_PORT}/api/plan`, (plan) => plan?.id === TOUR_PLAN_ID);
}

async function isOurWeb() {
  const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`).catch(() => null);
  return Boolean(response?.ok);
}

function prefixLines(label, chunk, write) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length) write(`[${label}] ${line}\n`);
  }
}

function startProcess(label, command, args, cwd, useShell = false) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell,
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => prefixLines(label, chunk, (line) => process.stdout.write(line)));
  child.stderr.on("data", (chunk) => prefixLines(label, chunk, (line) => process.stderr.write(line)));
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`[${label}] exited (${signal ?? code})`);
    }
  });
  children.push(child);
  return child;
}

async function ensureService({ label, port, ours, start }) {
  if (await ours()) {
    console.log(`${label}: already running on ${port}, reusing.`);
    return;
  }
  if (await portOpen(port)) {
    throw new Error(
      `${label}: port ${port} is in use by something else. Stop that process, then retry.`
    );
  }
  start();
}

async function waitFor(label, check, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await sleep(400);
  }
  throw new Error(`${label} did not become ready in time.`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nStopping demo processes…");
  for (const child of children) {
    if (child.exitCode !== null) continue;
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

async function main() {
  if (!existsSync(HOUSE)) {
    throw new Error(
      `Missing ${HOUSE}. The demo depends on this local file (*.glb is gitignored).`
    );
  }

  await ensureService({
    label: "Crop viewer",
    port: CROP_PORT,
    ours: isOurCrop,
    start: () =>
      startProcess("crop", process.execPath, ["server.mjs", "house.glb", "--port", String(CROP_PORT)], ROOT)
  });

  await ensureService({
    label: "AI tour",
    port: TOUR_PORT,
    ours: isOurTour,
    start: () =>
      startProcess(
        "tour",
        process.execPath,
        [
          "app/tour/serve.mjs",
          "--project",
          TOUR_PROJECT,
          "--build",
          TOUR_BUILD,
          "--model",
          "house.glb",
          "--port",
          String(TOUR_PORT)
        ],
        ROOT
      )
  });

  await ensureService({
    label: "Web app",
    port: WEB_PORT,
    ours: isOurWeb,
    start: () =>
      startProcess(
        "web",
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["run", "dev", "--", "--port", String(WEB_PORT)],
        WEB,
        process.platform === "win32"
      )
  });

  await waitFor("Crop viewer", isOurCrop);
  await waitFor("AI tour", isOurTour);
  await waitFor("Web app", isOurWeb, 90000);

  console.log("");
  console.log("Demo is ready.");
  console.log("");
  console.log("  Open  http://localhost:3000");
  console.log("");
  console.log("  Crop viewer   http://127.0.0.1:5173");
  console.log("  AI tour       http://127.0.0.1:5174");
  console.log("");
  console.log("  house.glb is local and gitignored — judges need that file on disk.");
  console.log("  Press Ctrl-C to stop processes this command started.");
  console.log("");
}

try {
  await main();
} catch (error) {
  console.error(`\nError: ${error?.message ?? error}`);
  shutdown();
  process.exit(1);
}
