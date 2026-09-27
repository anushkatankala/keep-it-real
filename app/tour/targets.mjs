/**
 * Floor plan geometry: room centres, doorways between rooms that share a wall,
 * and the exterior walls where daylight comes from.
 *
 * Everything the script model and the camera need is derived here, so neither
 * ever has to reason about coordinates. See CONTRACT.md for the heading
 * convention: degrees in [0, 360), 0 along +U, increasing clockwise seen from
 * above.
 */

/** Rooms closer than this along an axis are treated as sharing a wall. */
const EDGE_TOLERANCE = 0.05;

/** A shared span shorter than this is a construction artefact, not a doorway. */
const MIN_OPENING = 0.3;

const SQ_FT_PER_SQ_M = 10.7639;

export function normaliseHeading(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/** Signed difference from `a` to `b`, in [-180, 180]. */
export function headingDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

export function roomCentre(room) {
  const { minU, minV, maxU, maxV } = room.rect;
  return { u: (minU + maxU) / 2, v: (minV + maxV) / 2 };
}

export function roomAreaSqFt(room) {
  const { minU, minV, maxU, maxV } = room.rect;
  return Math.round((maxU - minU) * (maxV - minV) * SQ_FT_PER_SQ_M);
}

export function headingBetween(from, to) {
  return normaliseHeading((Math.atan2(-(to.v - from.v), to.u - from.u) * 180) / Math.PI);
}

export function doorKey(a, b) {
  return [a, b].sort().join(":");
}

/** Every room across every floor, tagged with the floor it belongs to. */
export function allRooms(plan) {
  return plan.floors.flatMap((floor) =>
    floor.rooms.map((room) => ({ ...room, floorId: floor.id, elevation: floor.elevation ?? 0 }))
  );
}

/**
 * The wall two rooms share, or null. Rectangles are axis-aligned in the plan's
 * rotated frame, so this is four edge comparisons rather than real polygon work.
 */
function sharedWall(a, b) {
  const ra = a.rect;
  const rb = b.rect;

  for (const at of [ra.maxU, ra.minU]) {
    const touches = Math.abs(at - rb.minU) <= EDGE_TOLERANCE || Math.abs(at - rb.maxU) <= EDGE_TOLERANCE;
    if (!touches) continue;
    const from = Math.max(ra.minV, rb.minV);
    const to = Math.min(ra.maxV, rb.maxV);
    if (to - from < MIN_OPENING) continue;
    return { axis: "u", at, from, to, length: to - from, midpoint: { u: at, v: (from + to) / 2 } };
  }

  for (const at of [ra.maxV, ra.minV]) {
    const touches = Math.abs(at - rb.minV) <= EDGE_TOLERANCE || Math.abs(at - rb.maxV) <= EDGE_TOLERANCE;
    if (!touches) continue;
    const from = Math.max(ra.minU, rb.minU);
    const to = Math.min(ra.maxU, rb.maxU);
    if (to - from < MIN_OPENING) continue;
    return { axis: "v", at, from, to, length: to - from, midpoint: { u: (from + to) / 2, v: at } };
  }

  return null;
}

/**
 * Doorways for every room, keyed by room id. Two rooms are connected when their
 * rectangles touch along an edge and overlap enough to walk through, unless
 * `doorOverrides` suppresses that pair.
 */
export function doorways(rooms, doorOverrides = {}) {
  const doors = new Map(rooms.map((room) => [room.id, []]));

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.floorId !== b.floorId) continue;
      if (doorOverrides[doorKey(a.id, b.id)] === false) continue;

      const wall = sharedWall(a, b);
      if (!wall) continue;

      const centreA = roomCentre(a);
      const centreB = roomCentre(b);
      doors.get(a.id).push({ roomId: b.id, name: b.name, wall, heading: headingBetween(centreA, wall.midpoint) });
      doors.get(b.id).push({ roomId: a.id, name: a.name, wall, heading: headingBetween(centreB, wall.midpoint) });
    }
  }

  return doors;
}

/** The parts of [from, to] that no interval in `covered` overlaps. */
function uncoveredSpans(from, to, covered) {
  const sorted = covered
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  const spans = [];
  let cursor = from;
  for (const [a, b] of sorted) {
    if (a - cursor > EDGE_TOLERANCE) spans.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (to - cursor > EDGE_TOLERANCE) spans.push([cursor, to]);

  return spans.filter(([a, b]) => b - a >= MIN_OPENING);
}

/**
 * Wall segments of a room that no other room touches. These face outside, which
 * is where the windows are.
 */
export function exteriorWalls(room, rooms) {
  const { minU, minV, maxU, maxV } = room.rect;
  const others = rooms.filter((other) => other.id !== room.id && other.floorId === room.floorId);
  const centre = roomCentre(room);
  const walls = [];

  const edges = [
    { axis: "u", at: minU, from: minV, to: maxV, outward: 180 },
    { axis: "u", at: maxU, from: minV, to: maxV, outward: 0 },
    { axis: "v", at: minV, from: minU, to: maxU, outward: 90 },
    { axis: "v", at: maxV, from: minU, to: maxU, outward: 270 }
  ];

  for (const edge of edges) {
    const covered = [];
    for (const other of others) {
      const r = other.rect;
      if (edge.axis === "u") {
        const meets = Math.abs(edge.at - r.minU) <= EDGE_TOLERANCE || Math.abs(edge.at - r.maxU) <= EDGE_TOLERANCE;
        if (meets) covered.push([r.minV, r.maxV]);
      } else {
        const meets = Math.abs(edge.at - r.minV) <= EDGE_TOLERANCE || Math.abs(edge.at - r.maxV) <= EDGE_TOLERANCE;
        if (meets) covered.push([r.minU, r.maxU]);
      }
    }

    for (const [from, to] of uncoveredSpans(edge.from, edge.to, covered)) {
      const midpoint =
        edge.axis === "u" ? { u: edge.at, v: (from + to) / 2 } : { u: (from + to) / 2, v: edge.at };
      walls.push({
        axis: edge.axis,
        at: edge.at,
        from,
        to,
        length: to - from,
        midpoint,
        outward: edge.outward,
        heading: headingBetween(centre, midpoint)
      });
    }
  }

  return walls.sort((a, b) => b.length - a.length);
}

/**
 * Named camera targets for one room. The script model receives only these names,
 * so it cannot ask the camera to look at something that does not exist.
 */
export function targetsFor(room, rooms, doors) {
  const targets = {
    centre: { kind: "centre", heading: null, description: "straight ahead, no turn" }
  };

  const walls = exteriorWalls(room, rooms);
  if (walls.length > 0) {
    targets.windows = {
      kind: "windows",
      heading: walls[0].heading,
      length: walls[0].length,
      description: `the ${walls[0].length.toFixed(1)} m outside wall, where the windows are`
    };
  }
  if (walls.length > 1) {
    targets["windows:2"] = {
      kind: "windows",
      heading: walls[1].heading,
      length: walls[1].length,
      description: `a second outside wall, ${walls[1].length.toFixed(1)} m`
    };
  }

  for (const door of doors.get(room.id) ?? []) {
    targets[`door:${door.roomId}`] = {
      kind: "door",
      roomId: door.roomId,
      heading: door.heading,
      description: `the doorway through to the ${door.name.toLowerCase()}`
    };
  }

  return targets;
}

/** Heading of +V, which is north on a plan drawn with north at the top. */
export const NORTH_HEADING = 270;

export function roomContains(room, point, margin = 0) {
  const { minU, minV, maxU, maxV } = room.rect;
  return (
    point.u >= minU - margin && point.u <= maxU + margin && point.v >= minV - margin && point.v <= maxV + margin
  );
}

/**
 * The plan's camera positions, grouped by room and ordered along each room's
 * long axis so a stop can walk through them in a straight line.
 *
 * A plan without `viewpoints` gets one per room at its centre, with the room id
 * as the viewpoint id. That keeps `panos/<roomId>.jpg` working unchanged.
 * `facing` is the heading the centre of the image looks toward; it defaults to
 * 0 because that is what the panorama convention has always said.
 */
export function planViewpoints(plan, rooms = allRooms(plan)) {
  const authored = Array.isArray(plan.viewpoints) && plan.viewpoints.length > 0;
  const viewpoints = authored
    ? plan.viewpoints.map((point) => ({
        id: String(point.id),
        roomId: String(point.roomId),
        u: Number(point.u),
        v: Number(point.v),
        facing: normaliseHeading(Number(point.facing ?? 0))
      }))
    : rooms.map((room) => ({ id: room.id, roomId: room.id, ...roomCentre(room), facing: 0 }));

  const byRoom = new Map(rooms.map((room) => [room.id, []]));
  for (const point of viewpoints) byRoom.get(point.roomId)?.push(point);

  for (const room of rooms) {
    const points = byRoom.get(room.id);
    if (points.length === 0) {
      // A room nobody photographed still needs somewhere to stand, or the
      // route would have a stop with nothing to show.
      const fallback = { id: room.id, roomId: room.id, ...roomCentre(room), facing: 0 };
      points.push(fallback);
      viewpoints.push(fallback);
      continue;
    }
    const { minU, minV, maxU, maxV } = room.rect;
    const axis = maxU - minU >= maxV - minV ? "u" : "v";
    points.sort((a, b) => a[axis] - b[axis]);
  }

  return {
    viewpoints,
    byId: new Map(viewpoints.map((point) => [point.id, point])),
    byRoom
  };
}

/**
 * One pass over a plan producing everything downstream needs: rooms, lookup,
 * doorways, named targets per room, and the viewpoints inside each room.
 */
export function analysePlan(plan) {
  const rooms = allRooms(plan);
  const byId = new Map(rooms.map((room) => [room.id, room]));
  // A hidden room keeps its walls, so its neighbours do not mistake the shared
  // wall for an outside one, but nobody can walk into it.
  const doors = doorways(rooms, plan.doorOverrides ?? {});
  for (const [roomId, list] of doors) {
    doors.set(roomId, byId.get(roomId).hidden ? [] : list.filter((door) => !byId.get(door.roomId).hidden));
  }
  const targets = new Map(rooms.map((room) => [room.id, targetsFor(room, rooms, doors)]));
  const centres = new Map(rooms.map((room) => [room.id, roomCentre(room)]));
  const points = planViewpoints(plan, rooms);

  return {
    plan,
    rooms,
    byId,
    doors,
    targets,
    centres,
    viewpoints: points.viewpoints,
    viewpointById: points.byId,
    viewpointsByRoom: points.byRoom
  };
}

/** Heading to use when leaving `fromRoom` for `toRoom`, or null if not adjacent. */
export function headingToRoom(geometry, fromRoomId, toRoomId) {
  const door = (geometry.doors.get(fromRoomId) ?? []).find((entry) => entry.roomId === toRoomId);
  if (door) return door.heading;

  const from = geometry.centres.get(fromRoomId);
  const to = geometry.centres.get(toRoomId);
  if (!from || !to) return null;
  return headingBetween(from, to);
}
