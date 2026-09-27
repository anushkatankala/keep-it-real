/**
 * Ordering the rooms into a route a person could actually walk.
 *
 * The naive approach is to sort rooms by type and cut between them, which makes
 * the tour teleport. Instead this walks the doorway graph, so every move is
 * through a real opening, and picks the next destination the way an agent would:
 * the best room you can get to from here.
 */

import { exteriorWalls, roomAreaSqFt } from "./targets.mjs";

/** Earlier types are shown earlier, all else being equal. */
const PRIORITY = [
  "entry",
  "living",
  "kitchen",
  "dining",
  "office",
  "bedroom",
  "bathroom",
  "laundry",
  "basement",
  "garage",
  "hallway",
  "other"
];

/** Rooms you pass through rather than stop in. Still narrated, but briefly. */
const TRANSIT_TYPES = new Set(["hallway"]);

function priorityOf(room) {
  const index = PRIORITY.indexOf(room.type);
  return index === -1 ? PRIORITY.length : index;
}

/** Type priority first, then larger rooms, so the primary bedroom leads. */
function compareRooms(a, b) {
  return priorityOf(a) - priorityOf(b) || (b.areaSqFt ?? roomAreaSqFt(b)) - (a.areaSqFt ?? roomAreaSqFt(a));
}

/**
 * Shortest doorway path from `startId` to every reachable room on the floor,
 * as a map of room id to the path taken to get there.
 */
function pathsFrom(geometry, startId, floorRooms) {
  const onFloor = new Set(floorRooms.map((room) => room.id));
  const paths = new Map([[startId, []]]);
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const door of geometry.doors.get(current) ?? []) {
      if (!onFloor.has(door.roomId) || paths.has(door.roomId)) continue;
      paths.set(door.roomId, [...paths.get(current), door.roomId]);
      queue.push(door.roomId);
    }
  }

  return paths;
}

function chooseStart(floorRooms, allRooms) {
  const withOutsideWall = floorRooms.filter((room) => exteriorWalls(room, allRooms).length > 0);
  const candidates = withOutsideWall.length > 0 ? withOutsideWall : floorRooms;
  return [...candidates].sort(compareRooms)[0];
}

/**
 * The next room to head for: the highest-priority room among those reachable in
 * the fewest doorways. Distance dominates so the tour does not criss-cross the
 * house, but priority breaks ties.
 */
function chooseNext(unvisited, paths, geometry) {
  let best = null;

  for (const roomId of unvisited) {
    const path = paths.get(roomId);
    if (!path) continue;
    const room = geometry.byId.get(roomId);
    const candidate = { roomId, room, distance: path.length };
    if (
      best === null ||
      candidate.distance < best.distance ||
      (candidate.distance === best.distance && compareRooms(room, best.room) < 0)
    ) {
      best = candidate;
    }
  }

  return best;
}

/**
 * An ordered list of stops covering every room on every floor. Rooms passed
 * through on the way somewhere else are included in place and flagged
 * `transit`, so the script can give them a single sentence instead of a full
 * pitch.
 */
export function planRoute(geometry, { transitTypes = TRANSIT_TYPES } = {}) {
  const floors = [...geometry.plan.floors].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const stops = [];

  for (const floor of floors) {
    const floorRooms = geometry.rooms.filter((room) => room.floorId === floor.id && !room.hidden);
    if (floorRooms.length === 0) continue;

    const unvisited = new Set(floorRooms.map((room) => room.id));
    let current = chooseStart(floorRooms, geometry.rooms);

    const visit = (roomId) => {
      unvisited.delete(roomId);
      const room = geometry.byId.get(roomId);
      stops.push({
        roomId,
        floorId: floor.id,
        transit: transitTypes.has(room.type) && stops.length > 0
      });
    };

    visit(current.id);

    while (unvisited.size > 0) {
      const paths = pathsFrom(geometry, current.id, floorRooms);
      const next = chooseNext(unvisited, paths, geometry);

      if (!next) {
        // Nothing else is reachable through a doorway. Whatever is left is
        // walled off, so fall back to showing it anyway rather than dropping it.
        const orphan = [...unvisited].map((id) => geometry.byId.get(id)).sort(compareRooms)[0];
        visit(orphan.id);
        current = orphan;
        continue;
      }

      for (const roomId of paths.get(next.roomId)) {
        if (unvisited.has(roomId)) visit(roomId);
      }
      current = geometry.byId.get(next.roomId);
    }
  }

  return stops;
}
