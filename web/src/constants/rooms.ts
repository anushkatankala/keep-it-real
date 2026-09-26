import type {
  RoomImageSet,
  SpecialRoom,
  StandardRoomKey,
} from "@/types";

export const MIN_ROOM_COUNT = 0;
export const MAX_ROOM_COUNT = 10;

export const STANDARD_ROOMS: ReadonlyArray<{
  key: StandardRoomKey;
  label: string;
  singularLabel: string;
}> = [
  { key: "bedrooms", label: "Bedrooms", singularLabel: "Bedroom" },
  { key: "bathrooms", label: "Bathrooms", singularLabel: "Bathroom" },
  {
    key: "livingRooms",
    label: "Living Rooms",
    singularLabel: "Living Room",
  },
  {
    key: "diningRooms",
    label: "Dining Rooms",
    singularLabel: "Dining Room",
  },
  { key: "kitchens", label: "Kitchens", singularLabel: "Kitchen" },
];

export const SPECIAL_ROOM_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
}> = [
  { id: "basement", label: "Basement" },
  { id: "boiler-room", label: "Boiler Room" },
  { id: "attic", label: "Attic" },
  { id: "garage", label: "Garage" },
  { id: "laundry-room", label: "Laundry Room" },
  { id: "home-office", label: "Home Office" },
  { id: "gym", label: "Gym" },
  { id: "storage-room", label: "Storage Room" },
];

export const createInitialSpecialRooms = (): SpecialRoom[] =>
  SPECIAL_ROOM_OPTIONS.map(({ id, label }) => ({
    id,
    label,
    selected: false,
    imageFiles: [],
    imagePreviews: [],
  }));

export const createInitialStandardRoomImages = (): Record<
  StandardRoomKey,
  RoomImageSet[]
> => ({
  bedrooms: [],
  bathrooms: [],
  livingRooms: [],
  diningRooms: [],
  kitchens: [],
});
