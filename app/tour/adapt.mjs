#!/usr/bin/env node
/**
 * Turning the web app's room configuration into a floor plan.
 *
 * The configure page collects how many of each room a house has, not where they
 * are. No part of the product produces geometry. The tour needs geometry,
 * because every camera move is aimed at a doorway or an outside wall, so this
 * synthesises a plausible one.
 *
 * The result is not the real house, and it is not trying to be. The panoramas
 * are generated too, so the tour only has to be internally consistent: when the
 * narration says "through to the kitchen", the camera turns toward the room the
 * tour actually visits next, and the room with windows actually has an outside
 * wall. See CONTRACT.md for the schema this produces.
 *
 *   node app/tour/adapt.mjs --config config.json
 *   node app/tour/adapt.mjs --config config.json --out projects/oakwood
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { allRooms, doorKey, doorways, roomAreaSqFt } from "./targets.mjs";

const HERE = import.meta.dirname;

const USAGE = `
Usage: node app/tour/adapt.mjs --config <file> [options]

Turns a web-app room configuration into plan.json for the tour builder.

Options:
  --config <file>   Room configuration exported from the web app
  --out <dir>       Where to write plan.json        (default: projects/<id>)
  --id <id>         Plan id, also the output folder (default: property)
  --name <name>     Property name for the narration
  --style <text>    Style hint for the narration
  --model <file>    GLB filename for the exterior shot
  --help            Show this message
`.trim();

/**
 * Web-app room keys to contract room types. The configure page has no entry or
 * hallway; those are the two rooms a tour cannot do without, so they are added.
 */
const TYPE_BY_STANDARD_KEY = {
  bedrooms: "bedroom",
  bathrooms: "bathroom",
  livingRooms: "living",
  diningRooms: "dining",
  kitchens: "kitchen"
};

const TYPE_BY_SPECIAL_ID = {
  basement: "basement",
  "boiler-room": "other",
  attic: "other",
  garage: "garage",
  "laundry-room": "laundry",
  "home-office": "office",
  gym: "other",
  "storage-room": "other"
};

const SINGULAR_BY_STANDARD_KEY = {
  bedrooms: "Bedroom",
  bathrooms: "Bathroom",
  livingRooms: "Living Room",
  diningRooms: "Dining Room",
  kitchens: "Kitchen"
};

/** Rough floor areas in square metres, before the bands are squared off. */
const AREA_BY_TYPE = {
  living: 32,
  kitchen: 15,
  dining: 16,
  office: 11,
  bedroom: 15,
  bathroom: 7,
  laundry: 6,
  garage: 34,
  basement: 28,
  other: 12
};

/** The first bedroom is the one a realtor leads with, so it gets the space. */
const PRIMARY_BEDROOM_AREA = 21;

/** Rooms are laid out from the entry outward in this order. */
const PLACEMENT_ORDER = [
  "living",
  "kitchen",
  "dining",
  "office",
  "other",
  "bedroom",
  "bathroom",
  "laundry",
  "basement",
  "garage"
];

/** Pairs that open into each other in a real house, despite sharing a wall. */
const OPEN_PLAN = new Set(["dining|living", "dining|kitchen", "kitchen|living"]);

/** Rooms you reach everything else through. */
const TRANSIT_TYPES = new Set(["entry", "hallway"]);

const BAND_DEPTH = 4.6;
const HALL_HALF_WIDTH = 0.9;
const ENTRY_LENGTH = 2.4;
/** Below this a corridor is a doorway, so the hallway is dropped instead. */
const MIN_HALL_LENGTH = 1.2;
const CEILING = 2.7;
/** Ridge height above the floor, for the exterior model's bounding box. */
const RIDGE = 6.4;

const round = (value) => Math.round(value * 1000) / 1000;

function typePair(a, b) {
  return [a, b].sort().join("|");
}

/**
 * The flat room list the configure page describes: one entry per room instance,
 * carrying the id the web app already assigned so panoramas can be matched to
 * rooms by filename.
 */
export function roomsFromConfig(roomConfig) {
  const rooms = [];

  for (const [key, type] of Object.entries(TYPE_BY_STANDARD_KEY)) {
    const count = roomConfig[key] ?? 0;
    const imageSets = roomConfig.standardRoomImages?.[key] ?? [];
    const singular = SINGULAR_BY_STANDARD_KEY[key];

    for (let index = 0; index < count; index++) {
      const imageSet = imageSets[index];
      rooms.push({
        id: imageSet?.id ?? `${key}-${index + 1}`,
        name: imageSet?.label ?? `${singular} ${index + 1}`,
        type,
        ordinal: index
      });
    }
  }

  for (const special of roomConfig.specialRooms ?? []) {
    if (!special.selected) continue;
    rooms.push({
      id: special.id,
      name: special.label,
      type: TYPE_BY_SPECIAL_ID[special.id] ?? "other",
      ordinal: 0
    });
  }

  return rooms;
}

function targetArea(room) {
  if (room.type === "bedroom" && room.ordinal === 0) return PRIMARY_BEDROOM_AREA;
  return AREA_BY_TYPE[room.type] ?? AREA_BY_TYPE.other;
}

/**
 * Split the rooms across the two sides of the corridor, keeping the two sides a
 * similar length so the house comes out roughly rectangular. Walking the rooms
 * in placement order and always adding to the shorter side also lands the
 * living space near the front door, which is where the tour starts.
 */
function assignBands(rooms) {
  const ordered = [...rooms].sort(
    (a, b) => PLACEMENT_ORDER.indexOf(a.type) - PLACEMENT_ORDER.indexOf(b.type)
  );

  const bands = [
    { rooms: [], length: 0 },
    { rooms: [], length: 0 }
  ];

  for (const room of ordered) {
    const width = targetArea(room) / BAND_DEPTH;
    const band = bands[0].length <= bands[1].length ? bands[0] : bands[1];
    band.rooms.push({ ...room, width });
    band.length += width;
  }

  return bands;
}

/** Tile one band along U, stretched so it spans the whole house. */
function placeBand(band, totalLength, minV, maxV) {
  if (band.rooms.length === 0) return [];

  const scale = totalLength / band.length;
  const placed = [];
  let cursor = 0;

  band.rooms.forEach((room, index) => {
    const isLast = index === band.rooms.length - 1;
    const end = isLast ? totalLength : cursor + room.width * scale;
    placed.push({
      id: room.id,
      name: room.name,
      type: room.type,
      rect: { minU: round(cursor), minV: round(minV), maxU: round(end), maxV: round(maxV) }
    });
    cursor = end;
  });

  return placed;
}

/**
 * Doors between two ordinary rooms, which share a wall only because the layout
 * packed them side by side. Suppressing them forces the route through the
 * corridor, the way a real house works.
 */
function deriveDoorOverrides(plan, rooms) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const doors = doorways(allRooms(plan), {});
  const overrides = {};

  const primaryBedroom = rooms.find((room) => room.type === "bedroom" && room.ordinal === 0);
  const primaryBathroom = rooms.find((room) => room.type === "bathroom" && room.ordinal === 0);
  const ensuite =
    primaryBedroom && primaryBathroom ? doorKey(primaryBedroom.id, primaryBathroom.id) : null;

  for (const [roomId, connections] of doors) {
    for (const connection of connections) {
      const a = byId.get(roomId);
      const b = byId.get(connection.roomId);
      if (!a || !b) continue;
      if (TRANSIT_TYPES.has(a.type) || TRANSIT_TYPES.has(b.type)) continue;

      const key = doorKey(a.id, b.id);
      if (key === ensuite) continue;
      if (OPEN_PLAN.has(typePair(a.type, b.type))) continue;

      overrides[key] = false;
    }
  }

  return overrides;
}

/**
 * Build a floor plan from a room configuration.
 *
 * Rooms sit in two bands either side of a corridor that runs back from the
 * front door, so every room has one wall on the corridor and one on the
 * outside. That gives the geometry layer a doorway and a window direction for
 * every room, which is all the camera ever asks for.
 */
export function synthesisePlan(roomConfig, options = {}) {
  const configured = roomsFromConfig(roomConfig);
  if (configured.length === 0) {
    throw new Error("Room configuration has no rooms; add at least one before building a tour.");
  }

  const bands = assignBands(configured);
  const totalLength = Math.max(
    bands[0].length,
    bands[1].length,
    ENTRY_LENGTH + MIN_HALL_LENGTH
  );

  const northV = [-(HALL_HALF_WIDTH + BAND_DEPTH), -HALL_HALF_WIDTH];
  const southV = [HALL_HALF_WIDTH, HALL_HALF_WIDTH + BAND_DEPTH];

  const rooms = [];
  const hallLength = totalLength - ENTRY_LENGTH;
  const hasHallway = hallLength >= MIN_HALL_LENGTH;

  rooms.push({
    id: "entry",
    name: "Entry",
    type: "entry",
    rect: {
      minU: 0,
      minV: -HALL_HALF_WIDTH,
      maxU: round(hasHallway ? ENTRY_LENGTH : totalLength),
      maxV: HALL_HALF_WIDTH
    }
  });

  if (hasHallway) {
    rooms.push({
      id: "hallway",
      name: "Hallway",
      type: "hallway",
      rect: {
        minU: round(ENTRY_LENGTH),
        minV: -HALL_HALF_WIDTH,
        maxU: round(totalLength),
        maxV: HALL_HALF_WIDTH
      }
    });
  }

  rooms.push(...placeBand(bands[0], totalLength, northV[0], northV[1]));
  rooms.push(...placeBand(bands[1], totalLength, southV[0], southV[1]));

  // Centre the house on the origin so the exterior model and the plan agree
  // about where the middle of the property is.
  const shift = totalLength / 2;
  for (const room of rooms) {
    room.rect.minU = round(room.rect.minU - shift);
    room.rect.maxU = round(room.rect.maxU - shift);
    room.areaSqFt = roomAreaSqFt(room);
  }

  const halfDepth = HALL_HALF_WIDTH + BAND_DEPTH;
  const plan = {
    id: options.id ?? "property",
    name: options.name ?? "This property",
    style: options.style ?? "bright contemporary interiors, warm wood floors, white walls",
    model: options.model ?? "house.glb",
    up: "z",
    horizontal: ["x", "y"],
    rotation: 0,
    bounds: {
      min: [round(-shift), round(-halfDepth), 0],
      max: [round(shift), round(halfDepth), RIDGE]
    },
    floors: [
      {
        id: "f0",
        name: "Ground floor",
        elevation: 0,
        ceiling: CEILING,
        rooms
      }
    ],
    generated: {
      source: "web room configuration",
      note: "Layout is synthesised from room counts; it is not a survey of the real house."
    }
  };

  plan.doorOverrides = deriveDoorOverrides(plan, [
    { id: "entry", type: "entry", ordinal: 0 },
    { id: "hallway", type: "hallway", ordinal: 0 },
    ...configured
  ]);

  return plan;
}

function parseArgs(argv) {
  const args = { config: null, out: null, id: null, name: null, style: null, model: null };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };

    switch (flag) {
      case "--config": args.config = value(); break;
      case "--out": args.out = value(); break;
      case "--id": args.id = value(); break;
      case "--name": args.name = value(); break;
      case "--style": args.style = value(); break;
      case "--model": args.model = value(); break;
      case "--help": case "-h": console.log(USAGE); process.exit(0);
      default: throw new Error(`Unknown option ${flag}`);
    }
  }

  if (!args.config) throw new Error("--config is required. See --help.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const roomConfig = JSON.parse(await readFile(resolve(args.config), "utf8"));

  const plan = synthesisePlan(roomConfig.roomConfig ?? roomConfig, {
    id: args.id,
    name: args.name,
    style: args.style,
    model: args.model
  });

  const out = args.out ? resolve(args.out) : join(HERE, "projects", plan.id);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

  const rooms = plan.floors[0].rooms;
  const area = rooms.reduce((total, room) => total + room.areaSqFt, 0);
  console.log(`Wrote ${join(out, "plan.json")}`);
  console.log(`  ${rooms.length} rooms, ${area} sq ft`);
  console.log(`  ${rooms.map((room) => room.name).join(", ")}`);
  console.log(`\nNext: node app/tour/build.mjs --project ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
