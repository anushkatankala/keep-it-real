"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

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
  const shouldReduceMotion = useReducedMotion();

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
            <motion.div
              key={room.id}
              className="shrink-0"
              transition={{ damping: 30, stiffness: 500, type: "spring" }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
            >
              <button
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
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 space-y-3">
        {rooms.map((room) => {
          const handleRoomFilesChange = (files: File[]) => {
            onFilesChange(room.id, files);
          };

          return (
            <AnimatePresence key={room.id} initial={false}>
              {room.selected ? (
                <motion.div
                  animate={{ height: "auto", opacity: 1 }}
                  className="overflow-hidden"
                  exit={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { height: 0, opacity: 0 }
                  }
                  initial={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { height: 0, opacity: 0 }
                  }
                  transition={{
                    duration: shouldReduceMotion ? 0.2 : 0.3,
                    ease: [0.25, 0.1, 0.25, 1],
                  }}
                >
                  <FileDropZone
                    compact
                    files={room.imageFiles}
                    label={`${room.label} reference images`}
                    onFilesChange={handleRoomFilesChange}
                    previews={room.imagePreviews}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          );
        })}
      </div>
    </div>
  );
}
