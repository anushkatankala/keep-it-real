"use client";

import { motion, useReducedMotion } from "motion/react";

const WIREFRAME_STROKE = "rgba(255,255,255,0.045)";

/** Draws one simple unfilled architectural house outline. */
function HouseOutline() {
  return (
    <svg
      className="h-full w-full"
      fill="none"
      viewBox="0 0 280 200"
    >
      <g
        fill="none"
        stroke={WIREFRAME_STROKE}
        strokeLinejoin="round"
        strokeWidth="0.8"
      >
        <path d="M24 92 140 20l116 72" />
        <path d="M42 82v94h196V82" />
        <rect height="40" width="30" x="125" y="136" />
        <rect height="30" width="38" x="70" y="108" />
        <rect height="30" width="38" x="172" y="108" />
        <path d="M89 108v30M70 123h38M191 108v30M172 123h38" />
      </g>
    </svg>
  );
}

/** Renders faint architectural decoration behind the landing hero. */
export function LandingBackdrop() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
    >
      <motion.div
        animate={shouldReduceMotion ? undefined : { y: [0, -10, 0] }}
        className="absolute -right-10 top-20 h-[200px] w-[280px]"
        transition={{
          delay: 0,
          duration: 12,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      >
        <HouseOutline />
      </motion.div>

      <motion.div
        animate={
          shouldReduceMotion
            ? undefined
            : { rotate: [-1.5, 1.5, -1.5], y: [0, -10, 0] }
        }
        className="absolute -left-8 top-[calc(50%_-_57px)] h-[114px] w-[160px]"
        transition={{
          delay: 4,
          duration: 18,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      >
        <HouseOutline />
      </motion.div>

      <motion.div
        animate={shouldReduceMotion ? undefined : { y: [0, -10, 0] }}
        className="absolute bottom-[12%] right-[8%] h-[79px] w-[110px]"
        transition={{
          delay: 8,
          duration: 12,
          ease: "easeInOut",
          repeat: Infinity,
        }}
      >
        <HouseOutline />
      </motion.div>
    </div>
  );
}
