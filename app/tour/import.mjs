#!/usr/bin/env node
/**
 * Turns what the image model returned for GENERATION_PROMPT.md into a tour
 * project: plan.json with rooms and viewpoints, plus panos/ and the floor plan.
 *
 *   node app/tour/import.mjs app/tour/projects/generated
 *
 * reads <project>/source/ and writes into <project>/. Models rarely follow a
 * schema to the letter, so field names are matched loosely, walls that nearly
 * meet are snapped together, and everything questionable is reported rather
 * than silently accepted.
 */

import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NORTH_HEADING, allRooms, doorKey, normaliseHeading, roomAreaSqFt, roomContains } from "./targets.mjs";

const USAGE = `
Usage: node app/tour/import.mjs <project dir> [--name "142 Maple Street"]

Reads <project>/source/ (style.txt, rooms.json, viewpoints.json, floorplan.*,
panos/, exterior/) and writes <project>/plan.json, <project>/panos/ and
<project>/floorplan.*. See GENERATION_PROMPT.md for what goes in source/.
`.trim();

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const ROOM_TYPES = new Set([
  "entry", "living", "dining", "kitchen", "hallway", "office", "bedroom",
  "bathroom", "laundry", "garage", "basement", "other"
]);

/** Words a model is likely to use for each type, checked in order. */
const TYPE_WORDS = [
  ["entry", ["entry", "foyer", "vestibule", "mudroom"]],
  ["living", ["living", "lounge", "family", "sitting", "great room", "den"]],
  ["dining", ["dining"]],
  ["kitchen", ["kitchen", "pantry"]],
  ["hallway", ["hall", "corridor", "landing", "passage"]],
  ["office", ["office", "study", "library"]],
  ["bathroom", ["bath", "wc", "toilet", "powder", "ensuite", "shower"]],
  ["bedroom", ["bed", "nursery", "guest"]],
  ["laundry", ["laundry", "utility"]],
  ["garage", ["garage"]],
  ["basement", ["basement", "cellar"]]
];

const COMPASS = { north: NORTH_HEADING, east: 0, south: 90, west: 180 };

/** Walls closer than this, but not touching, were meant to be shared. */
const SNAP_DISTANCE = 0.35;
const TOUCH_TOLERANCE = 0.05;

// ------------------------------------------------------------------ images

/** Width and height from a PNG, JPEG or WebP header, or null. */
export function readImageSize(bytes) {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
    return null;
  }

  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }

  return null;
}

/** How the tour will treat an image of this size; matches scene.mjs. */
export function describeImage(size) {
  if (!size) return { kind: "unknown", label: "unreadable image" };
  const ratio = size.width / size.height;
  const dims = `${size.width}x${size.height}`;
  if (Math.abs(ratio - 2) < 0.08) {
    const exact = size.width === size.height * 2;
    return { kind: "panorama", label: `${dims}, 360 panorama${exact ? "" : " (not exactly 2:1, will stretch slightly)"}` };
  }
  return { kind: "photo", label: `${dims}, ${ratio.toFixed(2)}:1, shown as a flat photo` };
}

// ----------------------------------------------------------------- parsing

/** Looks up a field by any of `names`, ignoring case, underscores and dashes. */
function field(object, ...names) {
  if (!object || typeof object !== "object") return undefined;
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/[_-]/g, "")));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(key.toLowerCase().replace(/[_-]/g, ""))) return value;
  }
  return undefined;
}

function number(value) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

/** The array inside whatever wrapper the model put around it. */
function listOf(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    const value = field(data, key);
    if (Array.isArray(value)) return value;
  }
  if (data && typeof data === "object") {
    const arrays = Object.values(data).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  return [];
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "room";
}

function roomTypeOf(raw) {
  const declared = String(field(raw, "type", "kind", "category") ?? "").toLowerCase().trim();
  if (ROOM_TYPES.has(declared)) return declared;
  const text = `${declared} ${field(raw, "name", "label", "title") ?? ""}`.toLowerCase();
  for (const [type, words] of TYPE_WORDS) {
    if (words.some((word) => text.includes(word))) return type;
  }
  return "other";
}

/**
 * A room rectangle from any of the shapes a model tends to produce:
 * min/max X/Y, min/max U/V, x/y/width/height (x,y taken as a corner), or an
 * [x1, y1, x2, y2] array. Returns the rect and a note if an assumption was made.
 */
function rectOf(raw) {
  const source = field(raw, "rect", "bounds", "box", "rectangle") ?? raw;

  if (Array.isArray(source) && source.length === 4 && source.every((value) => number(value) !== undefined)) {
    const [x1, y1, x2, y2] = source.map(number);
    return { rect: ordered(x1, y1, x2, y2) };
  }

  const minX = number(field(source, "minX", "minU", "x1", "left", "west"));
  const maxX = number(field(source, "maxX", "maxU", "x2", "right", "east"));
  const minY = number(field(source, "minY", "minV", "y1", "bottom", "south"));
  const maxY = number(field(source, "maxY", "maxV", "y2", "top", "north"));
  if ([minX, maxX, minY, maxY].every((value) => value !== undefined)) {
    return { rect: ordered(minX, minY, maxX, maxY) };
  }

  const x = number(field(source, "x", "u"));
  const y = number(field(source, "y", "v"));
  const width = number(field(source, "width", "w", "sizeX"));
  const height = number(field(source, "height", "h", "depth", "length", "sizeY"));
  if ([x, y, width, height].every((value) => value !== undefined)) {
    return { rect: ordered(x, y, x + width, y + height), note: "x,y read as the south-west corner" };
  }

  return { rect: null };
}

function ordered(x1, y1, x2, y2) {
  return {
    minU: Math.min(x1, x2),
    minV: Math.min(y1, y2),
    maxU: Math.max(x1, x2),
    maxV: Math.max(y1, y2)
  };
}

function pointOf(raw) {
  const source = field(raw, "position", "pos", "location", "point", "coords", "coordinates") ?? raw;
  if (Array.isArray(source) && source.length >= 2) return { u: number(source[0]), v: number(source[1]) };
  return { u: number(field(source, "x", "u")), v: number(field(source, "y", "v")) };
}

function facingOf(raw) {
  const value = field(raw, "facing", "heading", "northOffset", "direction", "yaw");
  if (typeof value === "string" && COMPASS[value.toLowerCase().trim()] !== undefined) {
    return COMPASS[value.toLowerCase().trim()];
  }
  const numeric = number(value);
  // The prompt fixes the centre of every panorama on north, so that is the
  // default rather than the contract's +U.
  return numeric === undefined ? NORTH_HEADING : normaliseHeading(numeric);
}

// -------------------------------------------------------------- snapping

/**
 * Moves edges that nearly meet onto one shared coordinate, because the tour
 * only puts a door between rooms whose walls touch within 5 cm. Returns a note
 * for every snap so the user can check it matches the drawing.
 */
export function snapWalls(rooms) {
  const notes = [];
  const edgesOf = (room) => [
    { room, key: "minU", axis: "u" },
    { room, key: "maxU", axis: "u" },
    { room, key: "minV", axis: "v" },
    { room, key: "maxV", axis: "v" }
  ];

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      for (const a of edgesOf(rooms[i])) {
        for (const b of edgesOf(rooms[j])) {
          if (a.axis !== b.axis || a.key.slice(0, 3) === b.key.slice(0, 3)) continue;
          const gap = Math.abs(a.room.rect[a.key] - b.room.rect[b.key]);
          if (gap <= TOUCH_TOLERANCE || gap > SNAP_DISTANCE) continue;

          const [from, to] = a.axis === "u" ? ["minV", "maxV"] : ["minU", "maxU"];
          const overlap =
            Math.min(a.room.rect[to], b.room.rect[to]) - Math.max(a.room.rect[from], b.room.rect[from]);
          if (overlap < 0.3) continue;

          const shared = Math.round(((a.room.rect[a.key] + b.room.rect[b.key]) / 2) * 1000) / 1000;
          a.room.rect[a.key] = shared;
          b.room.rect[b.key] = shared;
          notes.push(`${a.room.id} and ${b.room.id}: walls were ${gap.toFixed(2)} m apart, joined at ${shared}`);
        }
      }
    }
  }

  return notes;
}

// ---------------------------------------------------------------- import

/**
 * Builds a plan from parsed rooms.json and viewpoints.json. Pure, so it can be
 * tested and reused by the design page's import button.
 */
export function importPlan({ rooms: roomData, viewpoints: pointData, style = null, name = null, id = "generated" }) {
  const warnings = [];
  const notes = [];
  const usedIds = new Set();
  const uniqueId = (wanted) => {
    let candidate = wanted;
    for (let n = 2; usedIds.has(candidate); n++) candidate = `${wanted}-${n}`;
    usedIds.add(candidate);
    return candidate;
  };

  const rooms = [];
  const idAlias = new Map();

  for (const [index, raw] of listOf(roomData, "rooms", "spaces").entries()) {
    const label = String(field(raw, "name", "label", "title") ?? `Room ${index + 1}`);
    const { rect, note } = rectOf(raw);
    if (!rect) {
      warnings.push(`skipped "${label}": no rectangle found`);
      continue;
    }
    if (rect.maxU - rect.minU < 0.5 || rect.maxV - rect.minV < 0.5) {
      warnings.push(`skipped "${label}": smaller than 0.5 m on a side`);
      continue;
    }
    if (note) notes.push(`${label}: ${note}`);

    const declaredId = field(raw, "id", "roomId", "key");
    const roomId = uniqueId(slug(declaredId ?? label));
    if (declaredId !== undefined) idAlias.set(String(declaredId).toLowerCase(), roomId);
    idAlias.set(label.toLowerCase(), roomId);

    const room = { id: roomId, name: label, type: roomTypeOf(raw), rect };
    if (field(raw, "hidden", "exclude", "skip") === true) room.hidden = true;
    const notesText = field(raw, "notes", "description", "features");
    if (notesText) room.notes = Array.isArray(notesText) ? notesText.join(", ") : String(notesText);
    rooms.push(room);
  }

  if (rooms.length === 0) throw new Error("No usable rooms in rooms.json");

  notes.push(...snapWalls(rooms));
  for (const room of rooms) room.areaSqFt = roomAreaSqFt(room);

  const planRooms = allRooms({ floors: [{ id: "f0", rooms }] });
  const viewpoints = [];
  const pointIds = new Set();

  for (const [index, raw] of listOf(pointData, "viewpoints", "points", "cameras", "panoramas").entries()) {
    let pointId = slug(field(raw, "id", "viewpointId", "name") ?? `v${index + 1}`);
    while (pointIds.has(pointId)) pointId = `${pointId}-b`;

    const { u, v } = pointOf(raw);
    if (u === undefined || v === undefined) {
      warnings.push(`skipped viewpoint ${pointId}: no x,y position`);
      continue;
    }

    const declaredRoom = field(raw, "roomId", "room", "roomName");
    let roomId = declaredRoom === undefined ? null : idAlias.get(String(declaredRoom).toLowerCase()) ?? null;
    const containing = planRooms.find((room) => roomContains(room, { u, v }));
    const inside = roomId ? roomContains(planRooms.find((room) => room.id === roomId), { u, v }, 0.1) : false;

    if (!roomId && containing) {
      roomId = containing.id;
      if (declaredRoom !== undefined) warnings.push(`${pointId}: unknown room "${declaredRoom}", placed in ${roomId} by position`);
    } else if (roomId && !inside && containing) {
      warnings.push(`${pointId}: listed in ${roomId} but stands in ${containing.id}, moved to ${containing.id}`);
      roomId = containing.id;
    } else if (!roomId) {
      warnings.push(`skipped viewpoint ${pointId}: outside every room`);
      continue;
    } else if (!inside) {
      warnings.push(`${pointId}: position is outside ${roomId}, kept there anyway`);
    }

    pointIds.add(pointId);
    viewpoints.push({ id: pointId, roomId, u, v, facing: facingOf(raw) });
  }

  for (const room of rooms) {
    if (!room.hidden && !viewpoints.some((point) => point.roomId === room.id)) {
      warnings.push(`${room.id} (${room.name}) has no viewpoint; the tour will stand at its centre`);
    }
  }

  // Walls that touch but have no door in the drawing, keyed "a:b" by the
  // source's own room ids.
  const doorOverrides = {};
  for (const [key, value] of Object.entries(field(roomData, "doorOverrides", "noDoors") ?? {})) {
    const ids = key.split(":").map((part) => idAlias.get(part.trim().toLowerCase()));
    if (ids.length !== 2 || ids.some((part) => !part)) {
      warnings.push(`ignored door override "${key}": unknown room`);
      continue;
    }
    doorOverrides[doorKey(ids[0], ids[1])] = Boolean(value);
  }

  const us = rooms.flatMap((room) => [room.rect.minU, room.rect.maxU]);
  const vs = rooms.flatMap((room) => [room.rect.minV, room.rect.maxV]);

  const plan = {
    id,
    name: name ?? "Generated house",
    style: style ?? undefined,
    model: "house.glb",
    up: "z",
    horizontal: ["x", "y"],
    rotation: 0,
    generated: true,
    bounds: { min: [Math.min(...us), Math.min(...vs), 0], max: [Math.max(...us), Math.max(...vs), 3] },
    floors: [{ id: "f0", name: "Ground floor", elevation: 0, ceiling: 2.7, rooms }],
    viewpoints,
    doorOverrides
  };

  return { plan, warnings, notes };
}

// -------------------------------------------------------------------- CLI

async function readJson(path) {
  const text = await readFile(path, "utf8");
  // Models like to wrap JSON in a markdown fence.
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    throw new Error(`${basename(path)} is not valid JSON: ${error.message}`);
  }
}

async function findFile(dir, stem) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  const match = entries.find(
    (entry) => IMAGE_EXTENSIONS.has(extname(entry).toLowerCase()) && basename(entry, extname(entry)).toLowerCase() === stem.toLowerCase()
  );
  return match ? join(dir, match) : null;
}

function parseArgs(argv) {
  const args = { project: null, name: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg === "--name") args.name = argv[++i];
    else if (!args.project) args.project = resolve(arg);
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (!args.project) return { help: true };
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const source = join(args.project, "source");
  for (const required of ["rooms.json", "viewpoints.json"]) {
    if (!existsSync(join(source, required))) throw new Error(`Missing ${join(source, required)}`);
  }

  const style = existsSync(join(source, "style.txt"))
    ? (await readFile(join(source, "style.txt"), "utf8")).trim()
    : null;

  const roomsData = await readJson(join(source, "rooms.json"));
  const { plan, warnings, notes } = importPlan({
    rooms: roomsData,
    viewpoints: await readJson(join(source, "viewpoints.json")),
    style,
    name: args.name,
    id: slug(basename(args.project))
  });

  console.log(`${plan.name}: ${plan.floors[0].rooms.length} rooms, ${plan.viewpoints.length} viewpoints`);
  for (const room of plan.floors[0].rooms) {
    const points = plan.viewpoints.filter((point) => point.roomId === room.id).map((point) => point.id);
    console.log(`  ${room.id.padEnd(16)} ${room.type.padEnd(9)} ${String(room.areaSqFt).padStart(4)} sq ft  ${points.join(", ") || "-"}`);
  }

  const panoSource = join(source, "panos");
  const panoTarget = join(args.project, "panos");
  await mkdir(panoTarget, { recursive: true });
  const matched = new Set();

  console.log("\nImages:");
  for (const point of plan.viewpoints) {
    const file = await findFile(panoSource, point.id);
    if (!file) {
      warnings.push(`no image for viewpoint ${point.id}; expected source/panos/${point.id}.jpg`);
      continue;
    }
    matched.add(basename(file));
    const bytes = await readFile(file);
    console.log(`  ${point.id.padEnd(8)} ${describeImage(readImageSize(bytes)).label}`);
    await copyFile(file, join(panoTarget, point.id + extname(file).toLowerCase()));
  }

  if (existsSync(panoSource)) {
    const unused = (await readdir(panoSource)).filter(
      (entry) => IMAGE_EXTENSIONS.has(extname(entry).toLowerCase()) && !matched.has(entry)
    );
    if (unused.length > 0) warnings.push(`images not matching any viewpoint id: ${unused.join(", ")}`);
  }

  const floorplan = await findFile(source, "floorplan");
  if (floorplan) {
    const target = `floorplan${extname(floorplan).toLowerCase()}`;
    await copyFile(floorplan, join(args.project, target));
    // Where plan metres fall on the image, if the source says. The design
    // page's calibration writes the same fields.
    const calibration = field(roomsData, "floorplan", "calibration");
    const pixelsPerMetre = number(field(calibration, "pixelsPerMetre", "scale"));
    const originPx = field(calibration, "originPx", "origin");
    plan.floorplan = { image: target };
    if (pixelsPerMetre && Array.isArray(originPx) && originPx.length === 2) {
      plan.floorplan.pixelsPerMetre = pixelsPerMetre;
      plan.floorplan.originPx = originPx.map(Number);
    }
    console.log(`  floorplan ${describeImage(readImageSize(await readFile(floorplan))).label.split(",")[0]}`);
  } else {
    warnings.push("no source/floorplan image; the map will draw rooms without it");
  }

  const exteriorSource = join(source, "exterior");
  if (existsSync(exteriorSource)) {
    const stills = (await readdir(exteriorSource)).filter((entry) => IMAGE_EXTENSIONS.has(extname(entry).toLowerCase()));
    await mkdir(join(args.project, "exterior"), { recursive: true });
    for (const still of stills) await copyFile(join(exteriorSource, still), join(args.project, "exterior", still));
    if (stills.length > 0) plan.exterior = stills.map((still) => `exterior/${still}`);
  }

  await writeFile(join(args.project, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

  if (notes.length > 0) {
    console.log("\nAdjusted:");
    for (const note of notes) console.log(`  ${note}`);
  }
  if (warnings.length > 0) {
    console.log("\nCheck:");
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }
  console.log(`\nWrote ${join(args.project, "plan.json")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`\nError: ${error?.message ?? error}`);
    process.exit(1);
  }
}
