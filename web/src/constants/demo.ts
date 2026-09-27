import { createInitialSpecialRooms } from "@/constants/rooms";
import type {
  CropRegion,
  ProjectResults,
  RoomConfig,
  RoomImageSet,
  SpecialRoom,
  StandardRoomKey,
} from "@/types";

export const CROP_ORIGIN = "http://127.0.0.1:5173";
export const TOUR_ORIGIN = "http://127.0.0.1:5174";

export const DEMO_PROPERTY_NAME = "Generated House";

const STANDARD_BY_TYPE: Record<string, StandardRoomKey> = {
  bedroom: "bedrooms",
  bathroom: "bathrooms",
  living: "livingRooms",
  dining: "diningRooms",
  kitchen: "kitchens",
};

export const DEMO_FLOOR_PLAN_URL = `${TOUR_ORIGIN}/floorplan`;

export const croppedViewerUrl = (hasCrop: boolean): string =>
  hasCrop ? `${CROP_ORIGIN}/?src=cropped` : `${CROP_ORIGIN}/`;

export const buildDemoResults = (hasCrop: boolean): ProjectResults => {
  const stamp = Date.now();
  return {
    glbModelUrl: hasCrop ? `${CROP_ORIGIN}/cropped` : `${CROP_ORIGIN}/model`,
    viewerUrl: croppedViewerUrl(hasCrop),
    virtualTourUrl: `${TOUR_ORIGIN}/?mode=walk&v=${stamp}`,
    aiVideoUrl: `${TOUR_ORIGIN}/video/tour.mp4?v=${stamp}`,
    aiVideoCaptionsUrl: `${TOUR_ORIGIN}/video/tour.vtt?v=${stamp}`,
  };
};

export interface DemoPlanRoom {
  id: string;
  name: string;
  type: string;
  hidden?: boolean;
}

export interface DemoPlan {
  id: string;
  name: string;
  floors: Array<{ rooms: DemoPlanRoom[] }>;
  viewpoints?: Array<{ id: string; roomId: string }>;
}

export interface TourStop {
  id: string;
  name: string;
  duration: number;
  text: string;
}

/** One transcript row per stop of the built tour, timed from its narration. */
export async function loadTourTranscript(): Promise<
  Array<{ time: string; seconds: number; text: string }>
> {
  const response = await fetch(`${TOUR_ORIGIN}/api/tour`);
  if (!response.ok) throw new Error("The tour has not been built yet.");
  const tour = (await response.json()) as { stops: TourStop[] };

  let offset = 0;
  return tour.stops.map((stop) => {
    const seconds = offset;
    offset += stop.duration;
    const whole = Math.floor(seconds);
    const time = `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
    return { time, seconds, text: `${stop.name}. ${stop.text}` };
  });
}

export interface DemoProjectInput {
  cropRegion: CropRegion | null;
  droneFiles: File[];
  propertyName: string;
  roomConfig: RoomConfig;
}

async function fetchTourImage(path: string, filename: string): Promise<File> {
  const response = await fetch(`${TOUR_ORIGIN}${path}`);
  if (!response.ok) {
    throw new Error(`Could not load ${filename} from the tour server.`);
  }
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

const emptyStandardSets = (): Record<StandardRoomKey, RoomImageSet[]> => ({
  bedrooms: [],
  bathrooms: [],
  livingRooms: [],
  diningRooms: [],
  kitchens: [],
});

/**
 * Loads the example house the tour server is serving: its plan, floor plan
 * image and the first panorama of every room the tour visits.
 */
export async function loadDemoFixture(
  cropRegion: CropRegion | null,
): Promise<DemoProjectInput> {
  const planResponse = await fetch(`${TOUR_ORIGIN}/api/plan`);
  if (!planResponse.ok) {
    throw new Error(
      "Example floor plan is unavailable. Start the demo with npm run demo.",
    );
  }

  const plan = (await planResponse.json()) as DemoPlan;
  const rooms = (plan.floors ?? [])
    .flatMap((floor) => floor.rooms)
    .filter((room) => !room.hidden);
  const panoId = (room: DemoPlanRoom) =>
    plan.viewpoints?.find((point) => point.roomId === room.id)?.id ?? room.id;

  const [floorPlan, ...roomImages] = await Promise.all([
    fetchTourImage("/floorplan", "floor-plan.jpeg"),
    ...rooms.map((room) => fetchTourImage(`/panos/${panoId(room)}`, `${panoId(room)}.jpeg`)),
  ]);

  const standardRoomImages = emptyStandardSets();
  const fixtureSpecials: SpecialRoom[] = [];

  for (const [index, room] of rooms.entries()) {
    const standardKey = STANDARD_BY_TYPE[room.type];
    const imageSet = {
      imageFiles: [roomImages[index]],
      imagePreviews: [] as string[],
    };

    if (standardKey) {
      const index = standardRoomImages[standardKey].length;
      standardRoomImages[standardKey].push({
        id: `${standardKey}-${index + 1}`,
        label: room.name,
        planRoomId: room.id,
        ...imageSet,
      });
    } else {
      fixtureSpecials.push({
        id: room.id,
        label: room.name,
        selected: true,
        planRoomId: room.id,
        ...imageSet,
      });
    }
  }

  return {
    cropRegion,
    droneFiles: [floorPlan],
    propertyName: plan.name ?? DEMO_PROPERTY_NAME,
    roomConfig: {
      bedrooms: standardRoomImages.bedrooms.length,
      bathrooms: standardRoomImages.bathrooms.length,
      livingRooms: standardRoomImages.livingRooms.length,
      diningRooms: standardRoomImages.diningRooms.length,
      kitchens: standardRoomImages.kitchens.length,
      standardRoomImages,
      specialRooms: [
        ...fixtureSpecials,
        ...createInitialSpecialRooms().filter(
          (room) => !fixtureSpecials.some((special) => special.id === room.id),
        ),
      ],
    },
  };
}

const TYPE_TO_STANDARD: Record<string, StandardRoomKey> = STANDARD_BY_TYPE;

function firstImage(
  files: File[] | undefined,
): File | undefined {
  return files?.[0];
}

function collectRoomPhotos(roomConfig: RoomConfig): Map<string, File> {
  const photos = new Map<string, File>();

  const remember = (keys: Array<string | undefined>, files: File[]) => {
    const file = firstImage(files);
    if (!file) return;
    for (const key of keys) {
      if (key) photos.set(key.toLowerCase(), file);
    }
  };

  for (const imageSets of Object.values(roomConfig.standardRoomImages)) {
    for (const imageSet of imageSets) {
      remember([imageSet.planRoomId, imageSet.id, imageSet.label], imageSet.imageFiles);
    }
  }
  for (const room of roomConfig.specialRooms) {
    if (!room.selected) continue;
    remember([room.planRoomId, room.id, room.label], room.imageFiles);
  }

  return photos;
}

function photoForPlanRoom(
  room: DemoPlanRoom,
  photos: Map<string, File>,
  used: Set<File>,
  roomConfig: RoomConfig,
): File | undefined {
  const direct =
    photos.get(room.id.toLowerCase()) ?? photos.get(room.name.toLowerCase());
  if (direct) return direct;

  const standardKey = TYPE_TO_STANDARD[room.type];
  if (standardKey) {
    const unused = roomConfig.standardRoomImages[standardKey].find(
      (imageSet) => firstImage(imageSet.imageFiles) && !used.has(imageSet.imageFiles[0]),
    );
    return firstImage(unused?.imageFiles);
  }

  const unusedSpecial = roomConfig.specialRooms.find(
    (special) =>
      special.selected &&
      firstImage(special.imageFiles) &&
      !used.has(special.imageFiles[0]) &&
      (special.planRoomId === room.id ||
        special.id === room.id ||
        special.label.toLowerCase() === room.name.toLowerCase()),
  );
  return firstImage(unusedSpecial?.imageFiles);
}

/**
 * Pushes the current room photos to the tour server so the walkthrough and
 * narrated video show those interiors instead of the fixture panoramas.
 */
export async function publishTourMedia(roomConfig: RoomConfig): Promise<void> {
  const planResponse = await fetch(`${TOUR_ORIGIN}/api/plan`);
  if (!planResponse.ok) {
    throw new Error("Tour server is not running. Start it with npm run demo.");
  }

  const plan = (await planResponse.json()) as DemoPlan;
  const rooms = plan.floors?.flatMap((floor) => floor.rooms) ?? [];
  const photos = collectRoomPhotos(roomConfig);
  const used = new Set<File>();

  for (const room of rooms) {
    const file = photoForPlanRoom(room, photos, used, roomConfig);
    if (!file) continue;
    used.add(file);

    const response = await fetch(`${TOUR_ORIGIN}/api/pano/${room.id}`, {
      method: "PUT",
      headers: { "content-type": file.type || "image/jpeg" },
      body: file,
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(
        `Could not attach the ${room.name} photo to the tour${detail?.error ? `: ${detail.error}` : "."}`,
      );
    }
  }
}
