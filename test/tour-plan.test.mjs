import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { analysePlan, NORTH_HEADING } from "../app/tour/targets.mjs";
import { importPlan, readImageSize, describeImage } from "../app/tour/import.mjs";

const fixture = JSON.parse(await readFile(new URL("../app/tour/fixture/plan.json", import.meta.url), "utf8"));

test("a plan without viewpoints gets one per room, named after the room", () => {
  const geometry = analysePlan(fixture);
  assert.equal(geometry.viewpoints.length, geometry.rooms.length);
  for (const room of geometry.rooms) {
    const [point] = geometry.viewpointsByRoom.get(room.id);
    assert.equal(point.id, room.id);
    assert.equal(point.facing, 0);
  }
});

test("viewpoints in one room are ordered along its long axis", () => {
  const plan = {
    ...fixture,
    viewpoints: [
      { id: "far", roomId: "r2", u: -3, v: -3 },
      { id: "near", roomId: "r2", u: -8, v: -3 },
      { id: "mid", roomId: "r2", u: -5.5, v: -3 }
    ]
  };
  const geometry = analysePlan(plan);
  assert.deepEqual(geometry.viewpointsByRoom.get("r2").map((point) => point.id), ["near", "mid", "far"]);
  // Rooms nobody placed a viewpoint in still get one, so every stop has a picture.
  assert.equal(geometry.viewpointsByRoom.get("r3")[0].id, "r3");
});

test("import accepts loose field names and snaps walls that nearly meet", () => {
  const { plan, notes } = importPlan({
    rooms: {
      rooms: [
        { id: "R1", name: "Living Room", rect: { min_x: 0, min_y: 0, max_x: 5, max_y: 4 } },
        { id: "R2", name: "Kitchen", bounds: [5.2, 0, 9, 4] }
      ]
    },
    viewpoints: [
      { id: "v1", room: "R1", position: { x: 2.5, y: 2 } },
      { id: "v2", room_id: "R2", x: 7, y: 2, facing: "east" }
    ]
  });

  const [living, kitchen] = plan.floors[0].rooms;
  assert.equal(living.type, "living");
  assert.equal(kitchen.type, "kitchen");
  assert.equal(living.rect.maxU, kitchen.rect.minU, "the 0.2 m gap should be closed");
  assert.ok(notes.some((note) => note.includes("joined")));

  const geometry = analysePlan(plan);
  assert.equal(geometry.doors.get(living.id).length, 1, "snapped rooms share a door");
  assert.equal(plan.viewpoints[0].facing, NORTH_HEADING);
  assert.equal(plan.viewpoints[1].facing, 0);
});

test("a hidden room is left off the route but still walls in its neighbours", async () => {
  const { planRoute } = await import("../app/tour/route.mjs");
  const plan = structuredClone(fixture);
  const living = plan.floors[0].rooms.find((room) => room.id === "r2");
  const before = Object.keys(analysePlan(plan).targets.get("r1"));
  living.hidden = true;

  const geometry = analysePlan(plan);
  assert.ok(!planRoute(geometry).some((stop) => stop.roomId === "r2"));
  assert.ok(!geometry.doors.get("r1").some((door) => door.roomId === "r2"));
  assert.equal(geometry.doors.get("r2").length, 0);
  // No new "windows" target appears on the wall the entry shares with it.
  const after = Object.keys(geometry.targets.get("r1"));
  assert.deepEqual(after, before.filter((name) => name !== "door:r2"));
});

test("import maps door overrides through the source's room ids", () => {
  const { plan } = importPlan({
    rooms: {
      rooms: [
        { id: "R1", name: "Hallway", rect: { minX: 0, minY: 0, maxX: 6, maxY: 1.5 } },
        { id: "R2", name: "Living", rect: { minX: 0, minY: -4, maxX: 6, maxY: 0 } }
      ],
      doorOverrides: { "R2:R1": false }
    },
    viewpoints: []
  });
  assert.deepEqual(plan.doorOverrides, { "r1:r2": false });
  assert.equal(analysePlan(plan).doors.get("r1").length, 0);
});

test("import moves a viewpoint to the room it actually stands in", () => {
  const { plan, warnings } = importPlan({
    rooms: [
      { id: "a", name: "Bedroom", rect: { minX: 0, minY: 0, maxX: 4, maxY: 4 } },
      { id: "b", name: "Bathroom", rect: { minX: 4, minY: 0, maxX: 7, maxY: 4 } }
    ],
    viewpoints: [{ id: "v1", roomId: "a", x: 5.5, y: 2 }]
  });
  assert.equal(plan.viewpoints[0].roomId, "b");
  assert.ok(warnings.some((warning) => warning.includes("moved to b")));
});

test("image sizes are read from PNG and JPEG headers", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(4096, 16);
  png.writeUInt32BE(2048, 20);
  assert.deepEqual(readImageSize(png), { width: 4096, height: 2048 });
  assert.equal(describeImage(readImageSize(png)).kind, "panorama");

  // SOI, then an SOF0 segment: length 17, precision 8, height 1080, width 1920.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(readImageSize(jpeg), { width: 1920, height: 1080 });
  assert.equal(describeImage(readImageSize(jpeg)).kind, "photo");
});
