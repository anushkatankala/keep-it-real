"use client";

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
  const handleRoomDecrement = () => {
    onChange(Math.max(min, value - 1));
  };

  const handleRoomIncrement = () => {
    onChange(Math.min(max, value + 1));
  };

  return (
    <div className="flex min-h-20 items-center justify-between border-b border-white/[0.06]">
      <span className="text-sm font-light text-white/70">{label}</span>

      <div className="flex items-center" aria-label={`${label} count`}>
        <button
          aria-label={`Decrease ${label}`}
          className="h-9 w-9 border border-white/15 text-lg font-light text-white/60 transition-colors hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
          disabled={value <= min}
          onClick={handleRoomDecrement}
          type="button"
        >
          −
        </button>
        <output
          aria-live="polite"
          className="flex h-9 w-12 items-center justify-center border-y border-white/15 text-sm font-medium tabular-nums text-white/80"
        >
          {value}
        </output>
        <button
          aria-label={`Increase ${label}`}
          className="h-9 w-9 border border-white/15 text-lg font-light text-white/60 transition-colors hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
          disabled={value >= max}
          onClick={handleRoomIncrement}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  );
}
