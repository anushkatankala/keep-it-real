"use client";

import type { SpecialRoom } from "@/types";

import { FileDropZone } from "./FileDropZone";

interface RoomSelectorProps {
  rooms: SpecialRoom[];
  onToggle: (roomId: string) => void;
  onFilesChange: (roomId: string, files: File[]) => void;
}

/** Renders special-room toggles and animated upload areas for selected rooms. */
export function RoomSelector({
  rooms,
  onToggle,
  onFilesChange,
}: RoomSelectorProps) {
  return (
    <div>
      <div
        aria-label="Additional space options"
        className="flex gap-2 overflow-x-auto pb-3"
      >
        {rooms.map((room) => {
          const handleRoomToggle = () => {
            onToggle(room.id);
          };

          return (
            <button
              key={room.id}
              aria-pressed={room.selected}
              className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-light transition-colors duration-200 ${
                room.selected
                  ? "border-white bg-white text-black"
                  : "border-white/20 bg-transparent text-white/55 hover:border-white/40 hover:text-white/80"
              }`}
              onClick={handleRoomToggle}
              type="button"
            >
              {room.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-3">
        {rooms.map((room) => {
          const handleRoomFilesChange = (files: File[]) => {
            onFilesChange(room.id, files);
          };

          return (
            <div
              key={room.id}
              aria-hidden={!room.selected}
              className={`grid transition-all duration-300 ${
                room.selected
                  ? "grid-rows-[1fr] opacity-100"
                  : "pointer-events-none grid-rows-[0fr] opacity-0"
              }`}
              inert={!room.selected}
            >
              <div className="min-h-0 overflow-hidden">
                <FileDropZone
                  compact
                  files={room.imageFiles}
                  label={`${room.label} reference images`}
                  onFilesChange={handleRoomFilesChange}
                  previews={room.imagePreviews}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
