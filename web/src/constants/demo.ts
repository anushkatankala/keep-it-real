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

export const DEMO_PROPERTY_NAME = "142 Maple Street";

/** Fixture room id → staged JPEG in app/tour/fixture/demo-assets. */
export const DEMO_ROOM_IMAGES: Record<string, string> = {
  r1: "exterior.jpeg",
  r2: "living.jpeg",
  r3: "kitchen.jpeg",
  r4: "kitchen.jpeg",
  r5: "living.jpeg",
  r6: "bedroom-primary.jpeg",
  r7: "bedroom-second.jpeg",
  r8: "bathroom.jpeg",
};

const STANDARD_BY_TYPE: Record<string, StandardRoomKey> = {
  bedroom: "bedrooms",
  bathroom: "bathrooms",
  living: "livingRooms",
  dining: "diningRooms",
  kitchen: "kitchens",
};

export const DEMO_FLOOR_PLAN_URL = `${CROP_ORIGIN}/demo/assets/floor-plan.jpeg`;

export const croppedViewerUrl = (hasCrop: boolean): string =>
  hasCrop ? `${CROP_ORIGIN}/?src=cropped` : `${CROP_ORIGIN}/`;

export const buildDemoResults = (hasCrop: boolean): ProjectResults => ({
  glbModelUrl: hasCrop ? `${CROP_ORIGIN}/cropped` : `${CROP_ORIGIN}/model`,
  viewerUrl: croppedViewerUrl(hasCrop),
  virtualTourUrl: `${TOUR_ORIGIN}/?mode=walk`,
  aiVideoUrl: `${TOUR_ORIGIN}/?mode=auto`,
});

export interface DemoPlanRoom {
  id: string;
  name: string;
  type: string;
}

export interface DemoPlan {
  id: string;
  name: string;
  floors: Array<{ rooms: DemoPlanRoom[] }>;
}

export interface DemoProjectInput {
  cropRegion: CropRegion | null;
  droneFiles: File[];
  propertyName: string;
  roomConfig: RoomConfig;
}

export const demoAssetUrl = (filename: string): string =>
  `${CROP_ORIGIN}/demo/assets/${filename}`;

export async function fetchDemoAsset(filename: string): Promise<File> {
  const response = await fetch(demoAssetUrl(filename));
  if (!response.ok) {
    throw new Error(`Could not load ${filename} from the crop server.`);
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

/** Loads plan.json and staged room JPEGs from the crop server. */
export async function loadDemoFixture(
  cropRegion: CropRegion | null,
): Promise<DemoProjectInput> {
  const planResponse = await fetch(`${CROP_ORIGIN}/demo/plan.json`);
  if (!planResponse.ok) {
    throw new Error(
      "Example floor plan is unavailable. Start the demo with npm run demo.",
    );
  }

  const plan = (await planResponse.json()) as DemoPlan;
  const rooms = plan.floors?.[0]?.rooms ?? [];
  const filenames = [
    ...new Set([
      "floor-plan.jpeg",
      ...rooms.map((room) => DEMO_ROOM_IMAGES[room.id] ?? "living.jpeg"),
    ]),
  ];
  const files = Object.fromEntries(
    await Promise.all(
      filenames.map(async (filename) => [filename, await fetchDemoAsset(filename)]),
    ),
  ) as Record<string, File>;

  const standardRoomImages = emptyStandardSets();
  const fixtureSpecials: SpecialRoom[] = [];

  for (const room of rooms) {
    const filename = DEMO_ROOM_IMAGES[room.id] ?? "living.jpeg";
    const imageFile = files[filename];
    const standardKey = STANDARD_BY_TYPE[room.type];
    const imageSet = {
      imageFiles: [imageFile],
      imagePreviews: [] as string[],
    };

    if (standardKey) {
      const index = standardRoomImages[standardKey].length;
      standardRoomImages[standardKey].push({
        id: `${standardKey}-${index + 1}`,
        label: room.name,
        ...imageSet,
      });
    } else {
      fixtureSpecials.push({
        id: room.id,
        label: room.name,
        selected: true,
        ...imageSet,
      });
    }
  }

  return {
    cropRegion,
    droneFiles: [files["floor-plan.jpeg"]],
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
