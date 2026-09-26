export interface DroneImageSet {
  files: File[];
  previews: string[];
}

export type StandardRoomKey =
  | "bedrooms"
  | "bathrooms"
  | "livingRooms"
  | "diningRooms"
  | "kitchens";

export interface RoomImageSet {
  id: string;
  label: string;
  imageFiles: File[];
  imagePreviews: string[];
}

export interface RoomConfig {
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  diningRooms: number;
  kitchens: number;
  standardRoomImages: Record<StandardRoomKey, RoomImageSet[]>;
  specialRooms: SpecialRoom[];
}

export interface SpecialRoom {
  id: string;
  label: string;
  selected: boolean;
  imageFiles: File[];
  imagePreviews: string[];
}

export interface ProjectState {
  droneImages: DroneImageSet;
  roomConfig: RoomConfig;
  results: ProjectResults | null;
  isProcessing: boolean;
}

export interface ProjectResults {
  glbModelUrl: string | null;
  /** URL of the hosted existing viewer with its model and crop routes ready. */
  viewerUrl: string | null;
  virtualTourUrl: string | null;
  aiVideoUrl: string | null;
}
