"use client";

import { motion, useReducedMotion } from "motion/react";

interface RoomCounterProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** Displays a labeled room count with bounded decrement and increment controls. */
export function RoomCounter({
  label,
  value,
  min,
  max,
  onChange,
}: RoomCounterProps) {
  const shouldReduceMotion = useReducedMotion();

  const handleRoomDecrement = () => {
    onChange(Math.max(min, value - 1));
  };

  const handleRoomIncrement = () => {
    onChange(Math.min(max, value + 1));
  };

  return (
    <div
      className="flex min-h-20 items-center justify-between border-b border-white/[0.06] hover:bg-white/[0.02]"
      style={{ transition: "background 150ms ease" }}
    >
      <span className="text-sm font-light text-white/70">{label}</span>

      <div className="flex items-center" aria-label={`${label} count`}>
        <button
          aria-label={`Decrease ${label}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-lg font-light text-white/70 hover:border-white/20 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]"
          disabled={value <= min}
          onClick={handleRoomDecrement}
          style={{ transition: "all 150ms ease" }}
          type="button"
        >
          −
        </button>
        <output
          aria-live="polite"
          className="min-w-8 text-center text-[15px] font-light tabular-nums text-white"
        >
          <motion.div
            key={value}
            animate={{ opacity: 1, y: 0 }}
            initial={
              shouldReduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: -6 }
            }
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {value}
          </motion.div>
        </output>
        <button
          aria-label={`Increase ${label}`}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-lg font-light text-white/70 hover:border-white/20 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]"
          disabled={value >= max}
          onClick={handleRoomIncrement}
          style={{ transition: "all 150ms ease" }}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
