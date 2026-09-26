"use client";

import { useRouter } from "next/navigation";

import { RouteGuard } from "@/components/layout/RouteGuard";
import { Button } from "@/components/ui/Button";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { RoomCounter } from "@/components/ui/RoomCounter";
import { RoomSelector } from "@/components/ui/RoomSelector";
import {
  MAX_ROOM_COUNT,
  MIN_ROOM_COUNT,
  STANDARD_ROOMS,
} from "@/constants/rooms";
import { useProject } from "@/context/ProjectContext";
import type { StandardRoomKey } from "@/types";

/** Collects standard room counts and optional-space reference images. */
export default function RoomConfigPage() {
  const router = useRouter();
  const {
    roomConfig,
    setIsProcessing,
    setResults,
    setSpecialRoomImages,
    setStandardRoomCount,
    setStandardRoomImages,
    toggleSpecialRoom,
  } = useProject();

  const hasStandardRoom = STANDARD_ROOMS.some(
    ({ key }) => roomConfig[key] > MIN_ROOM_COUNT,
  );
  const hasSpecialRoom = roomConfig.specialRooms.some(
    ({ selected }) => selected,
  );
  const hasRoomSelection = hasStandardRoom || hasSpecialRoom;
  const hasAllStandardRoomImages = STANDARD_ROOMS.every(({ key }) => {
    const imageSets = roomConfig.standardRoomImages[key];
    return (
      imageSets.length === roomConfig[key] &&
      imageSets.every(({ imageFiles }) => imageFiles.length > 0)
    );
  });
  const hasAllSpecialRoomImages = roomConfig.specialRooms.every(
    ({ selected, imageFiles }) => !selected || imageFiles.length > 0,
  );
  const hasAllRequiredImages =
    hasAllStandardRoomImages && hasAllSpecialRoomImages;
  const canProcessProperty = hasRoomSelection && hasAllRequiredImages;

  const handleRoomCountChange = (
    room: StandardRoomKey,
    count: number,
  ) => {
    setStandardRoomCount(room, count);
  };

  const handleSpecialRoomToggle = (roomId: string) => {
    toggleSpecialRoom(roomId);
  };

  const handleStandardRoomFilesChange = (
    room: StandardRoomKey,
    imageSetId: string,
    files: File[],
  ) => {
    setStandardRoomImages(room, imageSetId, files);
  };

  const handleSpecialRoomFilesChange = (
    roomId: string,
    files: File[],
  ) => {
    setSpecialRoomImages(roomId, files);
  };

  const handleProcessProperty = () => {
    setResults(null);
    setIsProcessing(true);
    router.push("/results");
  };

  return (
    <RouteGuard>
      <main className="min-h-screen px-8 pb-24 pt-40">
        <div className="mx-auto max-w-3xl">
          <header className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">
              02 / Interior map
            </p>
            <h1 className="mt-7 text-4xl font-light tracking-tight text-ink">
              Define the interior.
            </h1>
            <p className="mt-5 text-sm font-light leading-loose text-white/50">
              Add each space, then attach at least one interior image to every
              room instance.
            </p>
          </header>

          <section className="mt-24" aria-labelledby="standard-rooms-heading">
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">
              Standard rooms
            </p>
            <h2
              className="sr-only"
              id="standard-rooms-heading"
            >
              Standard Rooms
            </h2>
            <div className="mt-6 border-t border-white/[0.06]">
              {STANDARD_ROOMS.map(({ key, label }) => {
                const handleCounterChange = (count: number) => {
                  handleRoomCountChange(key, count);
                };
                const imageSets = roomConfig.standardRoomImages[key];

                return (
                  <div key={key}>
                    <RoomCounter
                      label={label}
                      max={MAX_ROOM_COUNT}
                      min={MIN_ROOM_COUNT}
                      onChange={handleCounterChange}
                      value={roomConfig[key]}
                    />
                    {imageSets.length > 0 ? (
                      <div className="space-y-3 border-b border-white/[0.06] pb-6 pt-3">
                        {imageSets.map((imageSet) => {
                          const handleImageSetFilesChange = (files: File[]) => {
                            handleStandardRoomFilesChange(
                              key,
                              imageSet.id,
                              files,
                            );
                          };

                          return (
                            <FileDropZone
                              key={imageSet.id}
                              compact
                              files={imageSet.imageFiles}
                              label={`${imageSet.label} images`}
                              onFilesChange={handleImageSetFilesChange}
                              previews={imageSet.imagePreviews}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section
            className="mt-28"
            aria-labelledby="additional-spaces-heading"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">
              Additional spaces
            </p>
            <h2
              className="sr-only"
              id="additional-spaces-heading"
            >
              Additional Spaces
            </h2>
            <p className="mb-7 mt-4 max-w-2xl text-sm font-light leading-loose text-white/50">
              Select any non-standard spaces. Each selected space also
              requires at least one image.
            </p>
            <RoomSelector
              onFilesChange={handleSpecialRoomFilesChange}
              onToggle={handleSpecialRoomToggle}
              rooms={roomConfig.specialRooms}
            />
          </section>

          <div className="mt-24 flex items-center justify-between gap-8 border-t border-white/[0.06] pt-8">
            <p className="max-w-md text-xs font-light leading-loose text-white/40">
              {!hasRoomSelection
                ? "Add at least one room to continue."
                : hasAllRequiredImages
                  ? "Every room has image coverage."
                  : "Upload at least one image for every room before processing."}
            </p>
            <Button
              disabled={!canProcessProperty}
              onClick={handleProcessProperty}
            >
              Process Property →
            </Button>
          </div>
        </div>
      </main>
    </RouteGuard>
  );
}
